/**
 * ============================================================
 * Extraction Orchestrator Service
 * ============================================================
 * Orchestrates the 5-step agentic pipeline:
 *
 *  Step 1 — Call Python bridge (parse + extract locally)
 *  Step 2 — Receive structured JSON result
 *  Step 3 — Validate fields (done inside Python bridge)
 *  Step 4 — Normalize data (done inside Python bridge)
 *  Step 5 — Save to MongoDB + generate Excel
 *
 * Node spawns the Python process, catches stdout/stderr,
 * parses the JSON result, updates the DB record, and
 * appends the row to the project Excel workbook.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const DrawingExtraction = require('../models/DrawingExtraction');
const { appendToProjectExcel } = require('./excelService');
const { generateTransmittal } = require('./transmittalService');
const { getBucket } = require('../utils/gridfs');

const PYTHON_SCRIPT = path.join(__dirname, '../scripts/extract_drawing.py');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';  

/**
 * _downloadFromGridFS
 * Downloads a file from Atlas to a local path (temp)
 */
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
 * runExtractionPipeline
 * ─────────────────────
 * Full pipeline for one uploaded PDF.
 * Called after the file has been saved to disk and the
 * DrawingExtraction record has been created in MongoDB.
 *
 * @param {string} extractionId  - MongoDB _id of the DrawingExtraction doc
 * @param {string} pdfPath       - Absolute path to uploaded PDF
 * @param {string} projectId     - MongoDB project _id (string)
 */
// ── Concurrent Background Worker (10 drawings at once) ───────
const MAX_CONCURRENCY = 10; // Lowered from 25 for better stability on 16-core systems
let activeCount = 0;
const extractionQueue = [];
const excelBatchBuffer = new Map(); // projectId -> Array of rows
const excelWriting = new Map();     // projectId -> boolean

/**
 * Startup Sweep & Periodic Cleanup
 * Resumes stuck items and recovers from "Ghost" processing states.
 */
async function resumeExtractions() {
    try {
        // 1. Recover items stuck since last reboot
        const stuck = await DrawingExtraction.find({
            status: { $in: ['queued', 'processing'] }
        });
        if (stuck.length > 0) {
            console.log(`[Queue] Resuming ${stuck.length} unfinished extractions.`);
            stuck.forEach(doc => {
                extractionQueue.push({
                    extractionId: doc._id.toString(),
                    pdfPath: doc.fileUrl,
                    projectId: doc.projectId.toString()
                });
            });
            _processQueue();
        }
    } catch (err) {
        console.error('[Queue] Startup sweep failed:', err.message);
    }
}

async function cleanupStuckProcesses() {
    try {
        // Items in 'processing' for more than 15 minutes are likely hung
        const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
        const results = await DrawingExtraction.updateMany(
            { status: 'processing', updatedAt: { $lt: fifteenMinsAgo } },
            {
                status: 'failed',
                errorMessage: 'Processing timed out after 15 minutes of inactivity.'
            }
        );
        if (results.modifiedCount > 0) {
            console.log(`[Queue] Cleaned up ${results.modifiedCount} stuck processing records.`);
        }
    } catch (err) {
        console.error('[Queue] Cleanup failed:', err.message);
    }
}

// Start sweep and set interval
resumeExtractions();
setInterval(cleanupStuckProcesses, 60 * 1000); // Check every minute

async function runExtractionPipeline(extractionId, pdfPath, projectId, targetTransmittalNumber = null) {
    extractionQueue.push({ extractionId, pdfPath, projectId, targetTransmittalNumber });
    _processQueue();
}

async function _processQueue() {
    // Fill all available slots
    while (activeCount < MAX_CONCURRENCY && extractionQueue.length > 0) {
        activeCount++;
        const { extractionId, pdfPath, projectId, targetTransmittalNumber } = extractionQueue.shift();

        // Fire-and-forget the actual execution
        _executePipeline(extractionId, pdfPath, projectId, targetTransmittalNumber)
            .catch((err) => {
                // Ignore the error here, as _executePipeline already logs it and marks it failed in DB
            })
            .finally(() => {
                activeCount--;
                _processQueue(); // When one slot opens, check queue again
            });
    }
}

async function _executePipeline(extractionId, fileRef, projectId, targetTransmittalNumber = null) {
    const start = Date.now();
    let localPath = fileRef;
    let isTemp = false;

    // 1. Mark as processing AND clear previous errors
    await DrawingExtraction.findByIdAndUpdate(extractionId, {
        status: 'processing',
        errorMessage: ''
    });

    // 2. Fetch the doc early so we have originalFileName for hints
    const doc = await DrawingExtraction.findById(extractionId).lean();

    try {
        let result;

        // ── GridFS Check ──────────────────────────────────────
        // If fileRef is a 24-char hex string, it's likely a GridFS ID
        if (mongoose.Types.ObjectId.isValid(fileRef)) {
            const tempDir = path.join(__dirname, '../../uploads/temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            
            const originalBase = doc ? doc.originalFileName.replace(/\.[^/.]+$/, "") : 'temp';
            const sanitizedBase = originalBase.replace(/[^a-z0-9_\-]/gi, '_');
            const tempFileName = `${sanitizedBase}_${extractionId}_${Date.now()}.pdf`;
            localPath = path.join(tempDir, tempFileName);
            
            console.log(`[Extraction] Downloading GridFS file ${fileRef} for hint "${originalBase}" to ${localPath}`);
            await _downloadFromGridFS(fileRef, localPath);
            isTemp = true;
        }

        if (!fs.existsSync(localPath)) {
            throw new Error(`PDF file not found at ${localPath}. It may have been deleted.`);
        }

        const originalFileName = doc ? doc.originalFileName : '';

        // ── Step 1+2: Call Python extraction bridge ────────────
        result = await _callPythonBridge(localPath, originalFileName);

        // Cleanup temporary file immediately if we downloaded from GridFS
        if (isTemp && fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
            isTemp = false;
        }

        if (!result.success) {
            throw new Error(result.error || 'Extraction returned failure');
        }

        const { fields, validation, confidence } = result;

        // ── Step 5a: Update MongoDB record ────────────────────
        const processingTimeMs = Date.now() - start;

        const updatedDoc = await DrawingExtraction.findByIdAndUpdate(
            extractionId,
            {
                status: 'completed',
                extractedFields: fields,
                validationResult: validation,
                extractionConfidence: confidence,
                processingTimeMs,
                errorMessage: '',
            },
            { new: true }
        );

        // ── Step 5b: Dynamic "Total Expected Drawings" Increment ──────
        // Logic: if a sheet only has numeric revisions (0, 1, 2...) it's for fabrication.
        // If it's a new sheet that starts this way, we increase the project's expected total.
        try {
            const cleanMark = (m) => (m || "").toString().replace(/^(rev|revision|mark)\s*:?\s*/i, "").trim();
            const history = fields.revisionHistory || [];
            const marks = history.map(r => cleanMark(r.mark));
            const latestMark = cleanMark(fields.revision);
            
            const allMarks = [...marks];
            if (latestMark) allMarks.push(latestMark);

            const hasApproval = allMarks.some(m => m && /^[a-zA-Z]/.test(m));
            const hasFabrication = allMarks.some(m => m && /^[0-9]/.test(m));

            if (hasFabrication && !hasApproval) {
                const existing = await DrawingExtraction.findOne({
                    projectId,
                    'extractedFields.drawingNumber': fields.drawingNumber,
                    _id: { $ne: extractionId },
                    status: 'completed'
                });

                if (!existing && fields.drawingNumber) {
                    console.log(`[Extraction] FABRICATION-ONLY drawing ${fields.drawingNumber} is new. Incrementing project count.`);
                    const Project = require('../models/Project');
                    await Project.findByIdAndUpdate(projectId, { $inc: { approximateDrawingsCount: 1 } });
                }
            }
        } catch (err) {
            console.error('[Extraction] Error in fabrication-only count:', err.message);
        }

        // ── Step 5c: Ensure approx count matches local reality ──────
        try {
            const Project = require('../models/Project');
            const uniqueSheets = await DrawingExtraction.distinct('extractedFields.drawingNumber', { 
                projectId, 
                status: 'completed',
                'extractedFields.drawingNumber': { $ne: null, $ne: "" }
            });
            const totalFiles = await DrawingExtraction.countDocuments({ projectId, status: 'completed' });
            
            const targetCount = Math.max(uniqueSheets.length, totalFiles);

            const updateResult = await Project.updateOne(
                { _id: projectId, approximateDrawingsCount: { $lt: targetCount } },
                { $set: { approximateDrawingsCount: targetCount } }
            );

            if (updateResult.modifiedCount > 0) {
                console.log(`[Extraction] Synced approx count for ${projectId} to ${targetCount} (sheets: ${uniqueSheets.length}, files: ${totalFiles})`);
            }
        } catch (err) {
            console.error('[Extraction] Error syncing count:', err.message);
        }

        // ── Step 5d: Buffer for Excel batch write ───────────────────────
        try {
            const projectIdStr = projectId.toString();
            if (!excelBatchBuffer.has(projectIdStr)) {
                excelBatchBuffer.set(projectIdStr, []);
            }

            excelBatchBuffer.get(projectIdStr).push({
                drawingNumber: fields.drawingNumber,
                drawingTitle: fields.drawingTitle,
                description: fields.description,
                drawingDescription: fields.drawingDescription,
                revision: fields.revision,
                date: fields.date,
                remarks: fields.remarks,
                revisionHistory: fields.revisionHistory || [],
                scale: fields.scale,
                projectName: fields.projectName,
                clientName: fields.clientName,
                fileName: updatedDoc.originalFileName,
                confidence,
                uploadedBy: updatedDoc.uploadedBy,
                uploadDate: new Date().toISOString().slice(0, 10),
                extractionId: extractionId.toString(),
                // Carry the transmittal routing metadata for the auto-generate step
                targetTransmittalNumber,
            });

            // Trigger background flush (fire-and-forget)
            _flushExcelQueue(projectIdStr);

        } catch (excelErr) {
            console.error('[ExcelService] Failed to buffer Excel:', excelErr.message);
        }

        console.log(
            `[Extraction] ✓ ${updatedDoc.originalFileName} — ` +
            `confidence=${(confidence * 100).toFixed(0)}% — ${processingTimeMs}ms`
        );
        return updatedDoc;

    } catch (err) {
        const processingTimeMs = Date.now() - start;
        console.error(`[Extraction] ✗ ${extractionId}:`, err.message);

        // Cleanup temporary file on error too
        if (isTemp && fs.existsSync(localPath)) {
            try { fs.unlinkSync(localPath); } catch (_) {}
        }

        try {
            await DrawingExtraction.findByIdAndUpdate(extractionId, {
                status: 'failed',
                errorMessage: err.message,
                processingTimeMs,
            });
        } catch (dbErr) {
            console.error('[Extraction] CRITICAL: Failed to update error status in DB:', dbErr.message);
        }

        throw err;
    }
}

function _callPythonBridge(pdfPath, originalFileName = '') {
    return new Promise((resolve, reject) => {
        const args = [PYTHON_SCRIPT, pdfPath];
        if (originalFileName) {
            args.push('--original_filename', originalFileName);
        }

        const proc = spawn(PYTHON_BIN, args, {
            env: { ...process.env },
        });

        console.log(`[Python] Spawned PID ${proc.pid} for ${path.basename(pdfPath)}`);

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

        let timeoutId;

        proc.on('close', (code) => {
            clearTimeout(timeoutId);
            // Log stderr for debugging (doesn't mean failure)
            if (stderr) console.log('[Python stderr]', stderr.slice(0, 500));

            // Find the last JSON object in stdout (there may be debug prints before)
            const jsonMatch = stdout.match(/(\{[\s\S]*\})\s*$/);
            if (!jsonMatch) {
                return reject(new Error(`Python produced no JSON output. Code=${code}. stderr=${stderr.slice(0, 200)}`));
            }

            try {
                const parsed = JSON.parse(jsonMatch[1]);
                resolve(parsed);
            } catch (e) {
                reject(new Error(`Failed to parse Python output as JSON: ${e.message}`));
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timeoutId);
            reject(new Error(`Failed to spawn Python: ${err.message}`));
        });

        // Timeout after 10 minutes (increased from 3m to handle complex drawings)
        timeoutId = setTimeout(() => {
            proc.kill('SIGKILL');
            reject(new Error('Extraction timed out after 10 minutes'));
        }, 10 * 60 * 1000);
    });
}

/**
 * _flushExcelQueue
 * ────────────────
 * Periodically or on-event flushes buffered rows to the project Excel.
 * Ensures only one write happens per project at a time.
 */
async function _flushExcelQueue(projectId) {
    if (excelWriting.get(projectId)) return; // Already writing

    const buffer = excelBatchBuffer.get(projectId);
    if (!buffer || buffer.length === 0) return;

    excelWriting.set(projectId, true);
    const rowsToWrite = [...buffer];
    buffer.length = 0; // Clear the buffer

    try {
        console.log(`[ExcelService] Batch writing ${rowsToWrite.length} rows for project ${projectId}`);
        const { appendRowsToProjectExcel } = require('./excelService');

        const excelPath = await appendRowsToProjectExcel(projectId, rowsToWrite);

        // Update all related extraction records with excel details
        const ids = rowsToWrite.map(r => r.extractionId);
        await DrawingExtraction.updateMany(
            { _id: { $in: ids } },
            {
                excelPath: excelPath,
                excelUrl: `/api/extractions/${projectId}/excel/download`,
            }
        );

    } catch (err) {
        console.error(`[ExcelBatch] Failed to flush for ${projectId}:`, err.message);
        // Put them back in front of buffer to retry? (simplified for now: just log)
    } finally {
        excelWriting.set(projectId, false);
        // Check if more arrived while we were writing
        if (buffer.length > 0) {
            _flushExcelQueue(projectId);
        } else {
            // Buffer is empty, processing for this batch is done.
            // Transmittals are now only created when the user explicitly triggers it
            // from the Transmittal Generator page. Auto-generation from extraction
            // is disabled to avoid fragmenting batches.
        }
    }
}

module.exports = { runExtractionPipeline };
