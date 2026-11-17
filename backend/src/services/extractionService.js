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
const { downloadFile: downloadFromOneDrive } = require('../utils/onedrive');
const { Readable } = require('stream');
const storageGateway = require('../utils/storageGateway');

const { getPythonBin } = require('../utils/pythonBin');
const PYTHON_SCRIPT = path.join(__dirname, '../scripts/extract_drawing.py');
const PYTHON_BIN = getPythonBin();

function getParentDrawingRoot(drawingNoOrFilename) {
    if (!drawingNoOrFilename) return { root: '', suffix: null };
    let clean = String(drawingNoOrFilename).replace(/\.pdf$/i, '').trim();
    clean = clean.replace(/^\d{10,14}[-_]/, '').trim();
    clean = clean.replace(/[-_](?:rev)?\d+$/i, '').trim();
    clean = clean.toUpperCase();
    const m = clean.match(/^(.+?)([A-Z])$/);
    if (m) {
        const root = m[1];
        const suffix = m[2];
        if (root.length >= 2 || /\d/.test(root)) {
            return { root, suffix };
        }
    }
    return { root: clean, suffix: null };
}

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
// ── Concurrent Background Worker (2 drawings at once) ───────
const MAX_CONCURRENCY = 2; // Lowered from 10 to prevent AI model from choking on local CPU
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
        // Items in 'processing' for more than 30 minutes are likely hung
        const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
        const results = await DrawingExtraction.updateMany(
            { status: 'processing', updatedAt: { $lt: thirtyMinsAgo } },
            {
                status: 'failed',
                errorMessage: 'Processing timed out after 30 minutes of inactivity.'
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

    try {
        let result;

        // ── GridFS/OneDrive Check ────────────────────────────
        // If fileRef is a 24-char hex string, it could be a GridFS ID.
        // If it's a long alphanumeric string from OneDrive, it won't be a valid ObjectId (usually).
        // Let's check for both.

        if (mongoose.Types.ObjectId.isValid(fileRef)) {
            // Likely GridFS (24 hex)
            const tempDir = path.join(__dirname, '../../uploads/temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            const tempFileName = `temp_gridfs_${extractionId}_${Date.now()}.pdf`;
            localPath = path.join(tempDir, tempFileName);

            console.log(`[Extraction] Downloading GridFS file ${fileRef} to ${localPath}`);
            await _downloadFromGridFS(fileRef, localPath);
            isTemp = true;
        } else if (typeof fileRef === 'string' && fileRef.startsWith('Projects/')) {
            // Storage Gateway Path
            const tempDir = path.join(__dirname, '../../uploads/temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            const tempFileName = `temp_gateway_${extractionId}_${Date.now()}.pdf`;
            localPath = path.join(tempDir, tempFileName);

            console.log(`[Extraction] Downloading Storage Gateway file ${fileRef} to ${localPath}`);
            const { stream } = await storageGateway.getFileStream(fileRef);
            
            const dest = fs.createWriteStream(localPath);
            await new Promise((resolve, reject) => {
                stream.pipe(dest);
                dest.on('finish', resolve);
                dest.on('error', reject);
                stream.on('error', reject);
            });
            isTemp = true;
        } else if (typeof fileRef === 'string' && fileRef.length > 20) {
            // Likely OneDrive ID (usually longer and alphanumeric)
            const tempDir = path.join(__dirname, '../../uploads/temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            const tempFileName = `temp_onedrive_${extractionId}_${Date.now()}.pdf`;
            localPath = path.join(tempDir, tempFileName);

            console.log(`[Extraction] Downloading OneDrive file ${fileRef} to ${localPath}`);
            await downloadFromOneDrive(fileRef, localPath);
            isTemp = true;
        }

        if (!fs.existsSync(localPath)) {
            throw new Error(`PDF file not found at ${localPath}. It may have been deleted.`);
        }

        // Fetch the doc to get originalFileName and folder information
        const doc = await DrawingExtraction.findById(extractionId).lean();
        const originalFileName = doc ? doc.originalFileName : '';
        const folderName = doc ? (doc.folderName || '') : '';
        const storageGatewayPath = doc ? (doc.storageGatewayPath || '') : '';

        // Fetch the project to get clientName
        const Project = require('../models/Project');
        const project = await Project.findById(projectId).lean();
        const clientName = project ? project.clientName : '';

        // ── Step 1+2: Call Python extraction bridge ────────────
        result = await _callPythonBridge(localPath, originalFileName, clientName, folderName, storageGatewayPath, projectId);

        // Cleanup temporary file immediately if we downloaded from GridFS
        if (isTemp && fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
            isTemp = false;
        }

        if (!result.success) {
            throw new Error(result.error || 'Extraction returned failure');
        }

        const { fields, validation, confidence } = result;

        // ── Step 5a.1: Normalize fields ──
        if (fields.drawingNumber) fields.drawingNumber = fields.drawingNumber.toString().trim().toUpperCase();
        if (fields.drawingTitle) fields.drawingTitle = fields.drawingTitle.toString().trim();
        if (fields.revision) fields.revision = fields.revision.toString().trim().toUpperCase();

        // ── Duplicate Detection Check ──
        let newStatus = 'completed';
        try {
            const dwgNum = fields.drawingNumber;
            const rev = (fields.revision || '').trim();
            const date = (fields.date || '').trim();
            const title = (fields.drawingTitle || '').trim();
            
            if (dwgNum) {
                const candidates = await DrawingExtraction.find({
                    projectId,
                    _id: { $ne: extractionId },
                    'extractedFields.drawingNumber': dwgNum,
                    status: { $in: ['completed', 'duplicate_pending'] }
                }).lean();

                for (const candidate of candidates) {
                    const cFields = candidate.extractedFields || {};
                    const cRev = (cFields.revision || '').trim();
                    const cDate = (cFields.date || '').trim();
                    
                    // Normalize undefined/null/empty/0 revisions to a standard empty state
                    const revMatch = (rev === cRev) || 
                                     ((rev === '' || rev === '0') && (cRev === '' || cRev === '0'));
                                     
                    // Helper to normalize and compare dates
                    const parseDate = (d) => {
                        if (!d || !d.trim()) return '';
                        const parsed = new Date(d);
                        return isNaN(parsed.getTime()) ? d.replace(/[\s\W_]+/g, '').toLowerCase() : parsed.getTime();
                    };
                    const dateMatch = parseDate(date) === parseDate(cDate);
                    
                    // Compare revision history (lengths and marks), ignoring completely empty rows
                    const filterHist = (h) => (h || []).filter(r => (r.mark || '').trim() || (r.date || '').trim());
                    const hist = filterHist(fields.revisionHistory);
                    const cHist = filterHist(cFields.revisionHistory);
                    
                    let histMatch = true;
                    if (hist.length !== cHist.length) {
                        histMatch = false;
                    } else {
                        for (let i = 0; i < hist.length; i++) {
                            const m1 = (hist[i].mark || '').trim().replace(/[\s\W_]+/g, '').toLowerCase();
                            const m2 = (cHist[i].mark || '').trim().replace(/[\s\W_]+/g, '').toLowerCase();
                            const d1 = parseDate((hist[i].date || '').trim());
                            const d2 = parseDate((cHist[i].date || '').trim());
                            
                            if (m1 !== m2 || d1 !== d2) {
                                histMatch = false;
                                break;
                            }
                        }
                    }

                    if (revMatch && dateMatch && histMatch) {
                        newStatus = 'duplicate_pending';
                        console.log(`[Extraction] Duplicate detected for ${dwgNum} (Rev ${rev}, Date ${date}). Marking as duplicate_pending.`);
                        break;
                    }
                }
            }
        } catch (err) {
            console.error('[Extraction] Error checking for duplicate:', err.message);
        }

        // ── Step 5a: Update MongoDB record ────────────────────
        const processingTimeMs = Date.now() - start;

        const updatedDoc = await DrawingExtraction.findByIdAndUpdate(
            extractionId,
            {
                status: newStatus,
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

        // ── Step 5b.1: Parent -> Children Description Propagation ──
        if (fields.drawingTitle && fields.drawingTitle !== 'DELETED') {
            try {
                const { root: parentRoot, suffix } = getParentDrawingRoot(fields.drawingNumber || updatedDoc.originalFileName);
                if (!suffix && parentRoot) {
                    const childFilter = {
                        projectId,
                        _id: { $ne: extractionId },
                        'extractedFields.drawingNumber': new RegExp(`^${parentRoot}[A-Za-z]$`, 'i'),
                        'extractedFields.drawingTitle': { $in: ['', null] },
                        status: 'completed'
                    };
                    const res = await DrawingExtraction.updateMany(childFilter, {
                        $set: {
                            'extractedFields.drawingTitle': fields.drawingTitle,
                            'extractedFields.drawingDescription': fields.drawingTitle
                        }
                    });
                    if (res.modifiedCount > 0) {
                        console.log(`[Parent Inheritance] Propagated description "${fields.drawingTitle}" from parent "${parentRoot}" to ${res.modifiedCount} child drawing(s).`);
                    }
                }
            } catch (propErr) {
                console.warn('[Parent Inheritance] Child propagation warning:', propErr.message);
            }
        }

        // ── Step 5c: Ensure approx count matches local reality ──────
        try {
            const Project = require('../models/Project');
            const uniqueSheets = await DrawingExtraction.distinct('extractedFields.drawingNumber', {
                projectId,
                status: 'completed',
                'extractedFields.drawingNumber': { $nin: [null, ""] }
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
            try { fs.unlinkSync(localPath); } catch (_) { }
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

async function _callPythonBridge(pdfPath, originalFileName = '', clientName = '', folderName = '', storageGatewayPath = '', projectId = null) {
    try {
        const fileName = originalFileName || path.basename(pdfPath);
        
        // Read the file and prepare form data for FastAPI upload
        const fileData = fs.readFileSync(pdfPath);
        const fileBlob = new Blob([fileData], { type: 'application/pdf' });
        const formData = new FormData();
        formData.append('files', fileBlob, fileName);
        formData.append('client_name', clientName || '');
        const folderToCheck = [folderName, storageGatewayPath].filter(Boolean).join('/');
        if (folderToCheck) {
            formData.append('folder_name', folderToCheck);
        }

        const aiPort = process.env.AI_SERVICE_PORT || '8085';
        console.log(`[AI API] Sending ${fileName} to AI model at http://localhost:${aiPort}/upload`);

        let response;
        let lastErr;
        const maxRetries = 6;
        const retryDelayMs = 2000;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                response = await fetch(`http://localhost:${aiPort}/upload`, {
                    method: 'POST',
                    body: formData,
                    headers: {
                        'X-Internal-Api-Key': process.env.AI_SERVICE_INTERNAL_KEY || 'default_dev_key'
                    },
                    signal: AbortSignal.timeout(120000) // 2-minute timeout
                });
                
                if (response.ok) {
                    break;
                } else {
                    throw new Error(`AI API returned status ${response.status}`);
                }
            } catch (err) {
                lastErr = err;
                console.warn(`[AI Bridge] Attempt ${attempt}/${maxRetries} failed: ${err.message}. Retrying in ${retryDelayMs / 1000}s...`);
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                }
            }
        }

        if (!response || !response.ok) {
            throw new Error(`AI API request failed after ${maxRetries} attempts. Last error: ${lastErr ? lastErr.message : 'Unknown'}`);
        }

        const results = await response.json();
        console.log(`[AI API Response] Looking for key "${fileName}" in results:`, JSON.stringify(results));
        
        // results is a dict with filename as key
        const aiData = results[fileName];
        
        if (!aiData || aiData.error) {
            return {
                success: false,
                error: (aiData && aiData.error) ? aiData.error : 'AI Extraction failed or returned empty',
                fields: {},
                validation: {},
                confidence: 0
            };
        }

        // Client specific handling for Rast Iron Works
        const clientClean = (clientName || '').toLowerCase().replace(/[\s\-_]/g, '');
        const isRastiron = clientClean.includes('rastiron') || clientClean.includes('rast');

        // Check for Erection Sheets folder
        const pathToCheck = [folderName, storageGatewayPath, fileName].filter(Boolean).join(' / ');
        const isErection = /erection/i.test(pathToCheck) || /\b(e[\s-_]*sheets?|e[\s-_]*drawings?|e[\s-_]*plans?|esheets?|edrawings?)\b/i.test(pathToCheck);

        let finalDescription = aiData.drawing_description || '';

        if (isRastiron) {
            if (isErection) {
                // Rule 1: Erection sheet files - preserve title block description if present, do not clear
                let cleanDwgDesc = (aiData.drawing_description || '').trim().replace(/^[\s\.\:\-]+/, '').trim();
                if (cleanDwgDesc && !['NONE', 'N/A', '.', 'DESCRIPTION', 'DESCRIPTON'].includes(cleanDwgDesc.toUpperCase())) {
                    finalDescription = cleanDwgDesc;
                } else {
                    finalDescription = '';
                }
            } else if (aiData.is_deleted || aiData.bom_empty || (finalDescription || '').toUpperCase() === 'DELETED') {
                // Rule 2: If the bill of materials box is empty, the drawing description should be shown as DELETED.
                console.log(`[Rastiron Rule 2] Empty Bill of Materials detected for "${fileName}". Description set to DELETED.`);
                finalDescription = 'DELETED';
            } else if (aiData.has_bom === false) {
                // Rule 3: If there is no bill of materials box entirely:
                // If it is a variant child drawing (e.g. B9A, B9B, B3A), inherit description from base parent (e.g. B9, B3).
                if (!finalDescription && projectId) {
                    const dwgCandidate = aiData.drawing_no || fileName;
                    const { root: parentRoot, suffix } = getParentDrawingRoot(dwgCandidate);
                    if (suffix && parentRoot) {
                        try {
                            const parentDoc = await DrawingExtraction.findOne({
                                projectId,
                                'extractedFields.drawingNumber': new RegExp(`^${parentRoot}$`, 'i'),
                                'extractedFields.drawingTitle': { $nin: ['', null, 'DELETED'] },
                                status: 'completed'
                            }).lean();
                            if (parentDoc && parentDoc.extractedFields && parentDoc.extractedFields.drawingTitle) {
                                finalDescription = parentDoc.extractedFields.drawingTitle;
                                console.log(`[Rastiron Rule 3 / Parent Inheritance] "${fileName}" inherited description "${finalDescription}" from base parent "${parentRoot}".`);
                            }
                        } catch (pErr) {
                            console.warn('[Parent Inheritance] Lookup failed:', pErr.message);
                        }
                    }
                }
                if (!finalDescription) {
                    console.log(`[Rastiron Rule 3] No Bill of Materials box detected for "${fileName}". Description left empty.`);
                    finalDescription = '';
                }
            }
        }

function cleanRemarks(text) {
    if (!text) return '';
    let s = String(text).trim();
    s = s.replace(/^(?:[xX*\-.\s]+|[vV]\s+)(?=[A-Z0-9])/, '').trim();
    let changed = true;
    while (changed) {
        const orig = s;
        // 1. Field labels like 'DETAILED BY :', 'CHECKED BY :', 'BY :'
        s = s.replace(/^(?:[A-Za-z\s'’]{1,20}\bBY\s*[:\-])\s*/i, '').trim();
        // 2. Standard column headers
        s = s.replace(/^(?:DATE|CHKD|DWN|REV(?:ISION)?(?:\s*#|\s*\d+)?|MARK|NO|SHEET|TITLE)\s*[:\-]\s*(?:[A-Za-z0-9]{1,4}\b(?!\s*[-/.]|\s*[A-Z]{3,})\s*)?/i, '').trim();
        // 3. Initials followed immediately by a date: 'RBS 05-11' -> '05-11'
        s = s.replace(/^[A-Za-z0-9]{1,4}\s+(?=\d{1,2}\s*[-/.]\d{1,2})/, '').trim();
        // 4. Date at start (MM-DD, MM/DD/YYYY, etc.)
        s = s.replace(/^\d{1,2}\s*[-/.]\s*\d{1,2}(?:\s*[-/.]\s*(?:20\d{2}|19\d{2}|\d{2}))?\s*/, '').trim();
        // 5. Standalone initials or mark with colon: 'RBS :', '0 :', 'E :'
        s = s.replace(/^[A-Za-z0-9]{1,4}\s*:\s*/, '').trim();
        // 6. Initials or mark followed by remark text (strip 2-4 letter initials if not a protected remark word)
        const protectedWords = new Set([
            'FOR', 'ISSUED', 'REVISED', 'PER', 'AS', 'NEW', 'ADD', 'ALL', 'HOLD',
            'VOID', 'GENERAL', 'MEMBER', 'BEAM', 'COLUMN', 'STAIR', 'BASE', 'CHANGE',
            'RELEASED', 'APPROVED', 'PRELIMINARY', 'SUBMITTED', 'BID', 'RECORD',
            'FINAL', 'NOTE', 'SEE', 'REF', 'RFI', 'SK', 'CO', 'TENDER', 'PERMIT',
            'DESIGN', 'FIELD', 'SHOP', 'IFC', 'IFA', 'IFF', 'IFI', 'IFB', 'BULLETIN',
            'ADDENDUM', 'COMMENTS', 'ARCHITECT', 'ENGINEER', 'CORRECTION', 'REDESIGN'
        ]);
        const mStart = s.match(/^([A-Za-z0-9]{1,4})\s+([A-Za-z].+)$/);
        if (mStart && !protectedWords.has(mStart[1].toUpperCase())) {
            s = mStart[2].trim();
        }
        // 7. Initials followed by a colon
        s = s.replace(/^[A-Za-z0-9]{1,4}\s*:\s*/, '').trim();
        // 8. Leading punctuation
        s = s.replace(/^[:.\-/\s]+/, '').trim();
        changed = (s !== orig);
    }
    s = s.replace(/\s+\b(?:(?:DRAWN|CHECKED|DETAILED|APP'?D?|CHKD|DWN)\s+BY|DRAWN|CHKD|DWN|DATE|REV\s*#)\b\s*[:\-]?(?:\s+[A-Za-z0-9]{1,4})?\s*$/i, '').trim();
    s = s.replace(/[:.\-/\s]+$/, '').trim();
    s = s.replace(/\s+/, ' ').trim();
    if (!/[A-Za-z]/.test(s)) return '';
    const shortAllowed = new Set(['BID', 'ADD', 'NEW', 'REV', 'IFA', 'IFC', 'IFF', 'IFI', 'IFB', 'RFI', 'FOR', 'PER', 'HOLD', 'VOID']);
    if (s.length <= 3 && !shortAllowed.has(s.toUpperCase())) return '';
    if (/\bBY\s*[:\-]?$/i.test(s)) return '';
    return s;
}

        // Map AI output to the fields expected by the rest of the pipeline
        const rawRemarks = cleanRemarks(aiData.latest_revision ? aiData.latest_revision.remarks : '');
        let cleanLatestRev = '0';
        if (aiData.latest_revision && aiData.latest_revision.rev) {
            let sRev = String(aiData.latest_revision.rev).trim().replace(/^rev[\s\-_]*/i, '').trim();
            sRev = sRev.replace(/[^A-Za-z0-9]/g, '').trim().toUpperCase();
            if (sRev && sRev.length <= 4) {
                cleanLatestRev = sRev;
            }
        }
        const fields = {
            drawingNumber: aiData.drawing_no || '',
            drawingTitle: finalDescription, 
            description: '',
            drawingDescription: finalDescription,
            revision: cleanLatestRev,
            date: aiData.latest_revision ? aiData.latest_revision.date : '',
            scale: '',
            clientName: clientName || '',
            projectName: aiData.project_no || '',
            remarks: rawRemarks,
            revisionHistory: (aiData.revisions || []).map(r => ({
                mark: (r.rev && String(r.rev).replace(/[^A-Za-z0-9]/g, '').trim()) || '0',
                date: r.date,
                remarks: cleanRemarks(r.remarks)
            }))
        };

        const validation = {
            drawingNumberValid: !!fields.drawingNumber,
            revisionValid: !!fields.revision,
            dateValid: !!fields.date,
            warnings: []
        };

        return {
            success: true,
            fields,
            validation,
            confidence: 0.95 // YOLO model confidence placeholder
        };

    } catch (err) {
        console.error('[AI Bridge] Error calling AI service:', err.message);
        return {
            success: false,
            error: err.message,
            fields: {},
            validation: {},
            confidence: 0
        };
    }
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
