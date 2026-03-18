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
const DrawingExtraction = require('../models/DrawingExtraction');
const { appendToProjectExcel } = require('./excelService');
const { generateTransmittal } = require('./transmittalService');

const PYTHON_SCRIPT = path.join(__dirname, '../scripts/extract_drawing.py');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';  // or 'python3'

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

async function _executePipeline(extractionId, pdfPath, projectId, targetTransmittalNumber = null) {
    const start = Date.now();

    // 1. Mark as processing AND clear previous errors
    await DrawingExtraction.findByIdAndUpdate(extractionId, {
        status: 'processing',
        errorMessage: ''
    });

    try {
        let result;

        // Fetch the doc to get originalFileName
        const doc = await DrawingExtraction.findById(extractionId).lean();
        const originalFileName = doc ? doc.originalFileName : '';

        // ── Step 1+2: Call Python extraction bridge ────────────
        // We always call the bridge. It performs local PDF parsing 
        // using pdfplumber as the default engine.
        result = await _callPythonBridge(pdfPath, originalFileName);

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
        // If a drawing goes straight to fabrication (numeric rev) without any
        // approval revisions (A, B, C...), it increases the total project count.
        try {
            const history = fields.revisionHistory || [];
            const hasApproval = history.some(r => /^[a-zA-Z]/.test(r.mark)) || /^[a-zA-Z]/.test(fields.revision);
            const hasFabrication = history.some(r => /^[0-9]/.test(r.mark)) || /^[0-9]/.test(fields.revision);

            if (hasFabrication && !hasApproval) {
                // Check if this is the first time we see this drawing number in this project
                const existing = await DrawingExtraction.findOne({
                    projectId,
                    'extractedFields.drawingNumber': fields.drawingNumber,
                    _id: { $ne: extractionId },
                    status: 'completed'
                });

                if (!existing) {
                    console.log(`[Extraction] New fabrication-only drawing ${fields.drawingNumber} found. Incrementing project count.`);
                    const Project = require('../models/Project');
                    await Project.findByIdAndUpdate(projectId, { $inc: { approximateDrawingsCount: 1 } });
                }
            }
        } catch (err) {
            console.error('[Extraction] Failed to increment expected count:', err.message);
        }

        // ── Step 5c: Buffer for Excel batch write ───────────────────────
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
            // Automatically generate a Transmittal for the newly completed extractions!
            try {
                // Determine adminId from the extractions we just processed
                if (rowsToWrite.length > 0) {
                    const extRecord = await DrawingExtraction.findById(rowsToWrite[0].extractionId).lean();
                    if (extRecord && extRecord.createdByAdminId) {
                        // Pick up the target transmittal number carried by the batch
                        // All rows in a batch share the same targetTransmittalNumber since
                        // they were uploaded together.
                        const batchTargetTN = rowsToWrite[0].targetTransmittalNumber ?? null;
                        console.log(`[ExcelService] Auto-generating transmittal for project ${projectId}` +
                            (batchTargetTN ? ` → targeting transmittal #${batchTargetTN}` : '') + '...');
                        await generateTransmittal(projectId, extRecord.createdByAdminId, null, batchTargetTN);
                        console.log(`[ExcelService] ✓ Auto-transmittal complete for project ${projectId}`);
                    }
                }
            } catch (trErr) {
                // If there are no new/revised drawings, transmittalService safely skips generation.
                // We log errors just in case.
                console.log(`[ExcelService] Auto-transmittal info: ${trErr.message}`);
            }
        }
    }
}

module.exports = { runExtractionPipeline };
