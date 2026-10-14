const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const CdrfiExtraction = require('../models/CdrfiExtraction');
const { getBucket } = require('../utils/gridfs');
const { downloadFile: downloadFromOneDrive } = require('../utils/onedrive');
const mongoose = require('mongoose');

const SCRIPT_PATH = path.join(__dirname, '../scripts/extract_rfi.py');

const { getPythonBin } = require('../utils/pythonBin');

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
 * runCdrfiExtraction
 * Spawns the python script and saves parsed CDRFI data to DB
 */
exports.runCdrfiExtraction = async (extractionId, fileRef) => {
    let localPath = fileRef;
    let isTemp = false;
    
    try {
        const doc = await CdrfiExtraction.findById(extractionId);
        if (!doc) {
            console.error('[CdrfiService] Extraction document not found.');
            return;
        }

        doc.status = 'processing';
        await doc.save();

        const os = require('os');
        const tempDir = path.join(os.tmpdir(), 'steel-dms-uploads');

        // ── 1. Check if fileRef already exists on disk ────────
        let foundOnDisk = false;
        if (typeof fileRef === 'string') {
            if (fs.existsSync(fileRef)) {
                localPath = fileRef;
                foundOnDisk = true;
            } else {
                const altPath = path.resolve(__dirname, '../../', fileRef);
                if (fs.existsSync(altPath)) {
                    localPath = altPath;
                    foundOnDisk = true;
                }
            }
        }

        // ── 2. Fall back to GridFS or OneDrive if not on disk ──
        if (!foundOnDisk) {
            const gridId = doc.gridFsFileId || (typeof fileRef === 'string' && mongoose.Types.ObjectId.isValid(fileRef) ? fileRef : null);
            if (gridId) {
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                const tempFileName = `temp_cdrfi_gridfs_${extractionId}_${Date.now()}.pdf`;
                localPath = path.join(tempDir, tempFileName);
                console.log(`[CdrfiService] Downloading GridFS file ${gridId} to ${localPath}`);
                await _downloadFromGridFS(gridId, localPath);
                isTemp = true;
            } else if (typeof fileRef === 'string' && fileRef.length > 20) {
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                const tempFileName = `temp_cdrfi_onedrive_${extractionId}_${Date.now()}.pdf`;
                localPath = path.join(tempDir, tempFileName);
                console.log(`[CdrfiService] Downloading OneDrive file ${fileRef} to ${localPath}`);
                await downloadFromOneDrive(fileRef, localPath);
                isTemp = true;
            }
        }

        if (!fs.existsSync(localPath)) {
            throw new Error(`PDF file not found at ${localPath}`);
        }

        console.log(`[CdrfiService] Starting Python extraction for ${path.basename(localPath)}`);

        const pythonBin = getPythonBin();
        console.log(`[CdrfiService] Using python binary: ${pythonBin}`);

        const output = await new Promise((resolve, reject) => {
            const process = spawn(pythonBin, [SCRIPT_PATH, localPath, doc.originalFileName]);
            let dataOut = '';
            let dataErr = '';

            const timeoutTimer = setTimeout(() => {
                try { process.kill('SIGKILL'); } catch (_) {}
                reject(new Error('Python CDRFI extraction timed out after 60 seconds'));
            }, 60000);

            process.stdout.on('data', (d) => dataOut += d.toString());
            process.stderr.on('data', (d) => dataErr += d.toString());

            process.on('close', (code) => {
                clearTimeout(timeoutTimer);
                // Cleanup temp file
                if (isTemp && fs.existsSync(localPath)) {
                    try { fs.unlinkSync(localPath); } catch (_) {}
                    isTemp = false;
                }

                if (code !== 0) {
                    console.error('[CdrfiService] Python stderr:', dataErr);
                    reject(new Error(`Python exit code ${code}: ${dataErr || 'Script failure'}`));
                } else {
                    resolve(dataOut);
                }
            });

            process.on('error', (err) => {
                clearTimeout(timeoutTimer);
                reject(err);
            });
        });

        // The python script should print a JSON dictionary to stdout
        const match = output.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("No JSON found in python output");

        const result = JSON.parse(match[0]);
        if (!result.success) throw new Error(result.error);

        const extractedRfis = result.rfis || [];

        doc.rfis = extractedRfis;
        doc.status = 'completed';
        await doc.save();

        console.log(`[CdrfiService] Done extracting CDRFI for ${doc.originalFileName}. Extracted ${doc.rfis.length} items.`);

    } catch (err) {
        console.error('[CdrfiService] Failed extraction:', err);
        await CdrfiExtraction.findByIdAndUpdate(extractionId, {
            status: 'failed',
            errorDetails: err.message
        });
    }
};
