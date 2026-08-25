const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const RfiExtraction = require('../models/RfiExtraction');
const { getBucket } = require('../utils/gridfs');
const { downloadFile: downloadFromOneDrive } = require('../utils/onedrive');
const storageGateway = require('../utils/storageGateway');
const mongoose = require('mongoose');

const SCRIPT_PATH = path.join(__dirname, '../scripts/extract_rfi.py');
const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');

function _downloadFromGridFS(fileId, destPath) {
    return new Promise((resolve, reject) => {
        const bucket = getBucket();
        const objId = new mongoose.Types.ObjectId(fileId);
        const downloadStream = bucket.openDownloadStream(objId);
        const writeStream = fs.createWriteStream(destPath);

        downloadStream.pipe(writeStream)
            .on('finish', () => resolve(destPath))
            .on('error', (err) => reject(new Error(`GridFS Download Error: ${err.message}`)));
    });
}

/**
 * runRfiExtraction
 * Spawns the python script and saves parsed RFI data to DB
 */
exports.runRfiExtraction = async (extractionId, fileRef) => {
    let localPath = fileRef;
    let isTemp = false;
    
    try {
        const doc = await RfiExtraction.findById(extractionId);
        if (!doc) {
            console.error('[RfiService] Extraction document not found.');
            return;
        }

        doc.status = 'processing';
        await doc.save();

        // ── Storage Resolution ────────────────────────────
        const os = require('os');
        const tempDir = path.join(os.tmpdir(), 'steel-dms-uploads');

        if (typeof fileRef === 'string' && fs.existsSync(fileRef)) {
            // 1. Direct local disk path exists
            localPath = fileRef;
            isTemp = false;
        } else if (typeof fileRef === 'string' && fileRef.startsWith('Projects/')) {
            // 2. Storage Gateway Path
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            const tempFileName = `temp_rfi_gateway_${extractionId}_${Date.now()}.pdf`;
            localPath = path.join(tempDir, tempFileName);

            console.log(`[RfiService] Downloading Storage Gateway file ${fileRef} to ${localPath}`);
            const { stream } = await storageGateway.getFileStream(fileRef);
            
            const dest = fs.createWriteStream(localPath);
            await new Promise((resolve, reject) => {
                stream.pipe(dest);
                dest.on('finish', resolve);
                dest.on('error', reject);
                stream.on('error', reject);
            });
            isTemp = true;
        } else if (mongoose.Types.ObjectId.isValid(fileRef)) {
            // 3. GridFS (24 hex)
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            
            const tempFileName = `temp_rfi_gridfs_${extractionId}_${Date.now()}.pdf`;
            localPath = path.join(tempDir, tempFileName);
            
            console.log(`[RfiService] Downloading GridFS file ${fileRef} to ${localPath}`);
            await _downloadFromGridFS(fileRef, localPath);
            isTemp = true;
        } else if (typeof fileRef === 'string' && fileRef.length > 20 && !fs.existsSync(fileRef)) {
            // 4. Legacy OneDrive ID (only if not a valid local path)
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            
            const tempFileName = `temp_rfi_onedrive_${extractionId}_${Date.now()}.pdf`;
            localPath = path.join(tempDir, tempFileName);
            
            console.log(`[RfiService] Downloading OneDrive file ${fileRef} to ${localPath}`);
            await downloadFromOneDrive(fileRef, localPath);
            isTemp = true;
        }

        if (!fs.existsSync(localPath)) {
            throw new Error(`PDF file not found at ${localPath}`);
        }

        console.log(`[RfiService] Starting Python RFI extraction for ${path.basename(localPath)}`);

        const output = await new Promise((resolve, reject) => {
            const process = spawn(PYTHON_BIN, [SCRIPT_PATH, localPath, doc.originalFileName]);
            let dataOut = '';
            let dataErr = '';

            const timer = setTimeout(() => {
                try { process.kill(); } catch (_) {}
                reject(new Error('RFI extraction timed out after 3 minutes'));
            }, 3 * 60 * 1000);

            process.stdout.on('data', (d) => dataOut += d.toString());
            process.stderr.on('data', (d) => dataErr += d.toString());

            process.on('close', (code) => {
                clearTimeout(timer);
                // Cleanup temp file
                if (isTemp && fs.existsSync(localPath)) {
                    try { fs.unlinkSync(localPath); } catch (_) {}
                    isTemp = false;
                }

                if (code !== 0) {
                    console.error('[RfiService] Python stderr:', dataErr);
                    reject(new Error(`Python exit code ${code}`));
                } else {
                    resolve(dataOut);
                }
            });
        });

        // The python script should print a JSON dictionary to stdout
        const match = output.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("No JSON found in python output");

        const result = JSON.parse(match[0]);
        if (!result.success) throw new Error(result.error);

        // ── Overwrite logic: Ensure unique RFI numbers per project ──
        const extractedRfis = result.rfis || [];
        const rfiNumbers = extractedRfis.map(r => r.rfiNumber).filter(Boolean);

        if (rfiNumbers.length > 0) {
            try {
                // Removed global duplicate cleanup to keep Q numbers from each PDF separate.
            } catch (rfiDelErr) {
                console.error('[RfiService] Overwrite cleanup failed:', rfiDelErr.message);
            }
        }

        doc.rfis = extractedRfis;
        doc.status = 'completed';
        await doc.save();

        console.log(`[RfiService] Done extracting RFI for ${doc.originalFileName}. Extracted ${doc.rfis.length} items.`);

    } catch (err) {
        console.error('[RfiService] Failed extraction:', err);
        await RfiExtraction.findByIdAndUpdate(extractionId, {
            status: 'failed',
            errorDetails: err.message
        });
    }
};

/**
 * Startup Sweep & Periodic Cleanup
 * Resumes stuck items and recovers from "Ghost" processing states.
 */
async function resumeRfiExtractions() {
    try {
        const stuck = await RfiExtraction.find({
            status: { $in: ['queued', 'processing'] }
        });
        if (stuck.length > 0) {
            console.log(`[RfiQueue] Resuming ${stuck.length} unfinished RFI extractions.`);
            stuck.forEach(doc => {
                const fileRef = doc.storageGatewayPath || doc.fileUrl || doc.oneDriveFileId || doc.gridFsFileId;
                exports.runRfiExtraction(doc._id, fileRef);
            });
        }
    } catch (err) {
        console.error('[RfiQueue] Startup sweep failed:', err.message);
    }
}

async function cleanupStuckRfiProcesses() {
    try {
        const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
        const results = await RfiExtraction.updateMany(
            { status: 'processing', updatedAt: { $lt: tenMinsAgo } },
            {
                status: 'failed',
                errorDetails: 'Processing timed out after 10 minutes of inactivity.'
            }
        );
        if (results.modifiedCount > 0) {
            console.log(`[RfiQueue] Cleaned up ${results.modifiedCount} stuck processing records.`);
        }
    } catch (err) {
        console.error('[RfiQueue] Cleanup failed:', err.message);
    }
}

// Start sweep and set interval
setTimeout(resumeRfiExtractions, 5000);
setInterval(cleanupStuckRfiProcesses, 60 * 1000);

