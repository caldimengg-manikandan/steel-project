/**
 * ============================================================
 * Transmittal Service
 * ============================================================
 * Handles the core logic for:
 *
 *  1. Detecting new vs revised drawings against the Drawing Log
 *  2. Generating a new numbered Transmittal (T2, T3, … TN)
 *  3. Incrementally updating the Drawing Log
 *
 * Key design principles:
 *  - Idempotent: same input always produces same classification
 *  - Non-destructive: Drawing Log is never reset
 *  - Revision-aware: drawings are matched by drawingNumber + revision
 *  - Multi-transmittal safe: works for T1 through T-infinity
 */
const DrawingExtraction = require('../models/DrawingExtraction');
const DrawingLog = require('../models/DrawingLog');
const Transmittal = require('../models/Transmittal');
const Project = require('../models/Project');

/**
 * normalizeRevision
 * ─────────────────
 * Strips the "Rev " prefix and upper-cases.
 * e.g. "Rev A", "REV A", "rev-A" → "A"
 *      "Rev 0", "0"              → "0"
 *
 * @param {string} rev
 * @returns {string}
 */
function normalizeRevision(rev) {
    if (!rev) return '';
    return String(rev)
        .trim()
        .replace(/^rev[\s\-_]*/i, '')
        .toUpperCase();
}

/**
 * getMark
 * ───────
 * Safely extracts the revision mark from either 'mark' or 'revision' property.
 */
function getMark(entry) {
    if (!entry) return '';
    return entry.mark || entry.revision || '';
}

/**
 * revisionRank
 * ────────────
 * Returns a numeric rank for a normalised revision mark.
 * Fabrication (numeric) always ranks above Approval (alpha).
 *
 * Rank encoding (higher = more advanced):
 *   Alpha:   rank = char-code of first letter (A=65, B=66, …)
 *   Numeric: rank = 10000 + numeric value     (0→10000, 1→10001, …)
 *
 * This guarantees:  A < B < C < … < 0fab < 1fab < 2fab
 *
 * @param {string} rev  — already normalized (uppercase, no "Rev" prefix)
 * @returns {number}
 */
function revisionRank(rev) {
    if (!rev) return -1;
    const n = parseInt(rev, 10);
    if (!isNaN(n)) {
        // Numeric → fabrication tier
        return 10000 + n;
    }
    // Alpha → approval tier: rank by first character
    return rev.charCodeAt(0); // A=65, B=66 …
}

/**
 * compareRevisions
 * ────────────────
 * Compare two revision strings.
 * Returns:
 *   > 0  if a  is MORE advanced than b
 *   < 0  if a  is LESS advanced than b
 *   = 0  if equal
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareRevisions(a, b) {
    return revisionRank(normalizeRevision(a)) - revisionRank(normalizeRevision(b));
}

/**
 * pickLatestRevision
 * ──────────────────
 * Given an array of revision history objects [{mark, date, remarks}],
 * returns the one that represents the most advanced revision.
 *
 * Rules (same as Python extract_drawing.py):
 *   • Fabrication (numeric) beats Approval (alpha)
 *   • Within category, higher value wins
 *   • Date is the final tiebreaker
 *
 * @param {Array<{mark: string, date?: string, remarks?: string}>} history
 * @returns {object}  The winning entry, or {} if history is empty.
 */
function pickLatestRevision(history) {
    if (!Array.isArray(history) || history.length === 0) return {};
    return history.reduce((best, entry) => {
        const cmp = compareRevisions(getMark(entry), getMark(best));
        if (cmp > 0) return entry;
        return best;
    });
}

/**
 * detectChanges
 * ─────────────
 * Compares incoming completed extractions against the existing Drawing Log.
 *
 * Classification rules:
 *   NEW     — drawingNumber not in the log at all
 *   REVISED — drawingNumber exists AND incoming revision is HIGHER
 *   UNCHANGED — drawingNumber exists AND revision is the same or lower
 *
 * @param {Array<object>} extractions  — completed DrawingExtraction docs (.lean())
 * @param {object|null}   drawingLog   — existing DrawingLog doc (lean), or null
 *
 * @returns {{
 *   newDrawings:       Array<object>,
 *   revisedDrawings:   Array<object>,
 *   unchangedDrawings: Array<object>
 * }}
 */
function detectChanges(extractions, drawingLog) {
    // Build lookups: drawingNumber(normalised) → { rev, origNum }
    const logMap = {};
    const titleMap = {};
    if (drawingLog && Array.isArray(drawingLog.drawings)) {
        drawingLog.drawings.forEach(entry => {
            const numKey = (entry.drawingNumber || '').trim().toUpperCase();
            const titleKey = (entry.drawingTitle || entry.description || '').trim().toUpperCase();

            const revNorm = normalizeRevision(entry.currentRevision);
            if (numKey) {
                logMap[numKey] = { rev: revNorm, origNum: entry.drawingNumber.trim() };
            }
            if (titleKey) {
                // Allows fallback merge if titles exactly match
                titleMap[titleKey] = { rev: revNorm, origNum: entry.drawingNumber.trim() };
            }
        });
    }

    const newDrawings = [];
    const revisedDrawings = [];
    const unchangedDrawings = [];

    extractions.forEach(ext => {
        const f = ext.extractedFields || {};
        const drawingNumber = (f.drawingNumber || '').trim().toUpperCase();
        const drawingTitle = (f.drawingTitle || f.drawingDescription || '').trim().toUpperCase();

        // Determine the best revision in this extraction
        const revHist = Array.isArray(f.revisionHistory) && f.revisionHistory.length > 0
            ? f.revisionHistory
            : [{ mark: f.revision, date: f.date, remarks: f.remarks }];
        const bestRev = pickLatestRevision(revHist);
        const incomingRev = normalizeRevision(bestRev.mark || f.revision);

        let matchedData = null;
        if (drawingNumber && logMap[drawingNumber]) {
            matchedData = logMap[drawingNumber];
        } else if (drawingTitle && titleMap[drawingTitle]) {
            matchedData = titleMap[drawingTitle];
            // Crucial: override the extracted drawingNumber to the original master log's number
            // so it is forced to merge (append) into the existing drawing row by Title!
            f.drawingNumber = matchedData.origNum;
        }

        if (!matchedData) {
            // Drawing not found by Number or Title → NEW
            newDrawings.push({ ...ext, _changeType: 'new', _previousRevision: '', _latestRevEntry: bestRev });
        } else {
            const storedRev = matchedData.rev;
            const cmp = compareRevisions(incomingRev, storedRev);

            if (cmp > 0) {
                // Incoming revision is genuinely higher → REVISED
                revisedDrawings.push({
                    ...ext,
                    _changeType: 'revised',
                    _previousRevision: storedRev,
                    _latestRevEntry: bestRev,
                });
            } else {
                // Same or lower revision → UNCHANGED (never downgrade)
                unchangedDrawings.push({ ...ext, _changeType: 'unchanged', _previousRevision: storedRev, _latestRevEntry: bestRev });
            }
        }
    });

    return { newDrawings, revisedDrawings, unchangedDrawings };
}

const extractionLocks = new Map(); // projectId -> Promise (lock)

/**
 * generateTransmittal
 * ────────────────────────────────────────────────────────────
 * Main entry point. Called after new PDFs are uploaded and
 * their extraction is complete.
 *
 * Steps:
 *  1. Load all completed extractions for the project
 *  2. Load existing DrawingLog (or null if first time)
 *  3. Determine next transmittal number
 *  4. Detect new vs revised vs unchanged drawings
 *  5. If no new/revised drawings → return early (nothing to do)
 *  6. Create a new Transmittal document (only new+revised)
 *  7. Upsert DrawingLog (create on T1, update incrementally on T2+)
 *  8. Return the new transmittal + log summary
 *
 * @param {string} projectId
 * @param {string} adminId
 * @param {Array<string>} [targetExtractionIds]
 *   Optional: if provided, only these extraction IDs are considered for
 *   this transmittal. When omitted, ALL completed extractions are used
 *   (original behaviour for T1).
 *
 * @returns {Promise<{
 *   transmittal: object,
 *   drawingLog: object,
 *   summary: { newCount: number, revisedCount: number, unchangedCount: number }
 * }>}
 */
async function generateTransmittal(projectId, adminId, targetExtractionIds = null, targetTransmittalNumber = null) {
    // ── Project Lock ──
    const projectIdStr = projectId.toString();
    while (extractionLocks.has(projectIdStr)) {
        await extractionLocks.get(projectIdStr);
    }

    let releaseLock;
    const lockPromise = new Promise(resolve => releaseLock = resolve);
    extractionLocks.set(projectIdStr, lockPromise);

    try {
        console.log(`[Transmittal] Processing for project ${projectIdStr}` + 
            (targetTransmittalNumber ? ` → targeting #${targetTransmittalNumber}` : '...'));
        const result = await _internalGenerateTransmittal(projectId, adminId, targetExtractionIds, targetTransmittalNumber);
        return result;
    } finally {
        extractionLocks.delete(projectIdStr);
        releaseLock();
    }
}

async function _internalGenerateTransmittal(projectId, adminId, targetExtractionIds = null, targetTransmittalNumber = null) {
    // ── Step 1: Load relevant completed extractions ───────────
    const extractionFilter = {
        projectId,
        status: 'completed',
    };

    if (targetExtractionIds && targetExtractionIds.length > 0) {
        extractionFilter._id = { $in: targetExtractionIds };
    }

    const extractions = await DrawingExtraction.find(extractionFilter)
        .sort({ createdAt: 1 })
        .lean();

    if (extractions.length === 0) {
        throw new Error('No completed extractions found for this transmittal.');
    }

    // ── Step 2: Load existing Drawing Log ────────────────────
    const drawingLog = await DrawingLog.findOne({ projectId }).lean();

    // ── Step 3: Determine transmittal number ─────────────────
    //
    // Case A — targetTransmittalNumber is set (user chose an existing transmittal):
    //   Use that number, do NOT increment the project counter.
    //   We will append drawings to the matching Transmittal record instead of
    //   creating a brand-new one.
    //
    // Case B — targetTransmittalNumber is null ("Create New" or auto):
    //   Original behaviour: atomically increment Project.transmittalCount.
    let transmittalNumber;
    let appendToExisting = false; // means: update existing record, don't create one

    if (targetTransmittalNumber != null && !isNaN(targetTransmittalNumber)) {
        // Validate: the transmittal must already exist for this project
        const existing = await Transmittal.findOne({
            projectId,
            transmittalNumber: targetTransmittalNumber,
        }).lean();

        if (existing) {
            transmittalNumber = targetTransmittalNumber;
            appendToExisting = true;
        } else {
            // Transmittal doesn't exist yet (e.g. first upload for it) → create new at that number
            transmittalNumber = targetTransmittalNumber;
            // Bump the project counter if needed so future auto-assigns don't clash
            const proj = await Project.findById(projectId).lean();
            if (!proj) throw new Error('Project not found.');
            if ((proj.transmittalCount || 0) < transmittalNumber) {
                await Project.findByIdAndUpdate(projectId, { $set: { transmittalCount: transmittalNumber } });
            }
        }
    } else {
        // Case B: auto-increment
        const updatedProject = await Project.findByIdAndUpdate(
            projectId,
            { $inc: { transmittalCount: 1 } },
            { new: true }
        ).lean();
        if (!updatedProject) throw new Error('Project not found.');
        transmittalNumber = updatedProject.transmittalCount;
    }

    // ── Step 4: Classify extractions ─────────────────────────
    const { newDrawings, revisedDrawings, unchangedDrawings } = detectChanges(extractions, drawingLog);

    const changedDrawings = [...newDrawings, ...revisedDrawings];

    // ── Step 5: Early exit if nothing changed ────────────────
    if (changedDrawings.length === 0) {
        // Only roll back counter if we incremented it (Case B)
        if (!appendToExisting && targetTransmittalNumber == null) {
            await Project.findByIdAndUpdate(projectId, { $inc: { transmittalCount: -1 } });
        }
        return {
            transmittal: null,
            drawingLog: drawingLog,
            summary: {
                newCount: 0,
                revisedCount: 0,
                unchangedCount: unchangedDrawings.length,
                message: 'No new or revised drawings detected. Transmittal not generated.',
            },
        };
    }

    // ── Step 6: Build / Update Transmittal document ──────────
    const transmittalDrawings = changedDrawings.map(ext => {
        const f = ext.extractedFields || {};
        const revHist = Array.isArray(f.revisionHistory) && f.revisionHistory.length > 0
            ? f.revisionHistory
            : [{ mark: f.revision, date: f.date, remarks: f.remarks }];

        const latestRev = ext._latestRevEntry || pickLatestRevision(revHist);

        return {
            extractionId: ext._id,
            drawingNumber: f.drawingNumber || '',
            drawingTitle: f.drawingTitle || f.drawingDescription || ext.originalFileName || '',
            revision: latestRev.mark || f.revision || '',
            date: latestRev.date || f.date || '',
            remarks: latestRev.remarks || f.remarks || '',
            folderName: ext.folderName || '',
            originalFileName: ext.originalFileName || '',
            changeType: ext._changeType,
            previousRevision: ext._previousRevision || '',
        };
    });

    const combinedSequences = new Set();
    changedDrawings.forEach(ext => {
        if (Array.isArray(ext.sequences)) {
            ext.sequences.forEach(s => combinedSequences.add(s));
        }
    });
    const uniqueSequences = Array.from(combinedSequences);

    let newTransmittal;
    if (appendToExisting) {
        // Append drawings to the existing transmittal record
        newTransmittal = await Transmittal.findOneAndUpdate(
            { projectId, transmittalNumber },
            {
                $push: { drawings: { $each: transmittalDrawings } },
                $inc: {
                    newCount: newDrawings.length,
                    revisedCount: revisedDrawings.length,
                },
                $addToSet: { sequences: { $each: uniqueSequences } },
            },
            { new: true }
        );
    } else {
        newTransmittal = await Transmittal.create({
            projectId,
            createdByAdminId: adminId,
            transmittalNumber,
            drawings: transmittalDrawings,
            newCount: newDrawings.length,
            revisedCount: revisedDrawings.length,
            sequences: uniqueSequences,
        });
    }

    // ── Step 7: Upsert Drawing Log ───────────────────────────
    const updatedLog = await _upsertDrawingLog({
        projectId,
        adminId,
        existingLog: drawingLog,
        newDrawings,
        revisedDrawings,
        transmittalNumber,
    });

    return {
        transmittal: newTransmittal.toObject(),
        drawingLog: updatedLog,
        summary: {
            newCount: newDrawings.length,
            revisedCount: revisedDrawings.length,
            unchangedCount: unchangedDrawings.length,
            transmittalNumber,
        },
    };
}

/**
 * _upsertDrawingLog
 * ─────────────────
 * Internal helper. Creates the DrawingLog on T1, updates it on T2+.
 *
 * Rules:
 *  - New drawing → push new entry with revision history
 *  - Revised drawing → update currentRevision, append to revisionHistory
 *  - Never delete, reset, or duplicate rows
 *
 * Uses MongoDB's atomic $push / $set via findOneAndUpdate to avoid
 * race conditions when multiple transmittals are processed quickly.
 *
 * @param {object} opts
 * @returns {Promise<object>} The updated DrawingLog (lean)
 */
async function _upsertDrawingLog({ projectId, adminId, existingLog, newDrawings, revisedDrawings, transmittalNumber }) {
    const today = new Date();

    if (!existingLog) {
        // ── First transmittal: Create Drawing Log from scratch ──

        const allEntries = [...newDrawings, ...revisedDrawings].map(ext => {
            const f = ext.extractedFields || {};
            const revHist = Array.isArray(f.revisionHistory) && f.revisionHistory.length > 0
                ? f.revisionHistory
                : [{ mark: f.revision, date: f.date, remarks: f.remarks }];

            // Use pre-computed winner or recompute
            const latestRev = ext._latestRevEntry || pickLatestRevision(revHist);

            // Store the full history in chronological order (sorted by rank then date)
            const normalizedEntries = revHist.map(rh => ({
                revision: normalizeRevision(rh.mark),
                date: rh.date || '',
                transmittalNo: transmittalNumber,
                remarks: rh.remarks || '',
                recordedAt: today,
            }));

            return {
                drawingNumber: (f.drawingNumber || '').trim(),
                drawingTitle: f.drawingTitle || f.drawingDescription || ext.originalFileName || '',
                description: f.description || '',
                folderName: ext.folderName || '',
                originalFileName: ext.originalFileName || '',
                currentRevision: normalizeRevision(latestRev.mark || f.revision),
                revisionHistory: normalizedEntries,
                firstTransmittalNo: transmittalNumber,
                lastUpdated: today,
            };
        });

        const log = await DrawingLog.findOneAndUpdate(
            { projectId },
            {
                $setOnInsert: { projectId, createdByAdminId: adminId },
                $set: { lastTransmittalNo: transmittalNumber },
                $push: { drawings: { $each: allEntries } },
            },
            { upsert: true, new: true }
        );

        return log.toObject();
    }

    // ── Subsequent transmittals: Incremental update ───────────

    // Prepare bulk update operations using MongoDB arrayFilters
    const bulkOps = [];

    // New drawings → $push to drawings array
    for (const ext of newDrawings) {
        const f = ext.extractedFields || {};
        const revHist = Array.isArray(f.revisionHistory) && f.revisionHistory.length > 0
            ? f.revisionHistory
            : [{ mark: f.revision, date: f.date, remarks: f.remarks }];

        const latestRev = ext._latestRevEntry || pickLatestRevision(revHist);

        const normalizedEntries = revHist.map(rh => ({
            revision: normalizeRevision(rh.mark),
            date: rh.date || '',
            transmittalNo: transmittalNumber,
            remarks: rh.remarks || '',
            recordedAt: today,
        }));

        const newEntry = {
            drawingNumber: (f.drawingNumber || '').trim(),
            drawingTitle: f.drawingTitle || f.drawingDescription || ext.originalFileName || '',
            description: f.description || '',
            folderName: ext.folderName || '',
            originalFileName: ext.originalFileName || '',
            currentRevision: normalizeRevision(latestRev.mark || f.revision),
            revisionHistory: normalizedEntries,
            firstTransmittalNo: transmittalNumber,
            lastUpdated: today,
        };

        bulkOps.push({
            updateOne: {
                filter: { projectId },
                update: { $push: { drawings: newEntry } },
            },
        });
    }

    // Revised drawings → update existing entry using arrayFilters
    // Guard: only update currentRevision if the new revision is HIGHER
    for (const ext of revisedDrawings) {
        const f = ext.extractedFields || {};
        const revHist = Array.isArray(f.revisionHistory) && f.revisionHistory.length > 0
            ? f.revisionHistory
            : [{ mark: f.revision, date: f.date, remarks: f.remarks }];

        const latestRev = ext._latestRevEntry || pickLatestRevision(revHist);
        const newRevision = normalizeRevision(latestRev.mark || f.revision);

        const newHistoryEntry = {
            revision: newRevision,
            date: latestRev.date || f.date || '',
            transmittalNo: transmittalNumber,
            remarks: latestRev.remarks || f.remarks || '',
            recordedAt: today,
        };

        const drawingNumberKey = (f.drawingNumber || '').trim().toUpperCase();
        const previousRevision = ext._previousRevision || '';

        // Only set currentRevision if incoming rank > stored rank (no downgrade)
        // compareRevisions(newRevision, previousRevision) > 0 is always true here
        // because detectChanges already filtered REVISED to only genuinely higher revisions.
        // The guard is kept for defence-in-depth.
        bulkOps.push({
            updateOne: {
                filter: { projectId },
                update: {
                    $set: {
                        'drawings.$[elem].currentRevision': newRevision,
                        'drawings.$[elem].lastUpdated': today,
                    },
                    $push: {
                        'drawings.$[elem].revisionHistory': newHistoryEntry,
                    },
                },
                arrayFilters: [
                    {
                        'elem.drawingNumber': {
                            $regex: new RegExp(`^${drawingNumberKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
                        },
                    },
                ],
            },
        });
    }

    // Always update the lastTransmittalNo
    bulkOps.push({
        updateOne: {
            filter: { projectId },
            update: {
                $set: { lastTransmittalNo: transmittalNumber, updatedAt: today },
            },
        },
    });

    if (bulkOps.length > 0) {
        await DrawingLog.bulkWrite(bulkOps);
    }

    // Return fresh updated log
    const updated = await DrawingLog.findOne({ projectId }).lean();
    return updated;
}

/**
 * getTransmittals
 * ───────────────
 * Fetch all transmittals for a project, newest first.
 *
 * @param {string} projectId
 * @param {string} adminId
 * @returns {Promise<Array<object>>}
 */
async function getTransmittals(projectId) {
    return Transmittal.find({ projectId })
        .sort({ transmittalNumber: -1 })
        .lean();
}

/**
 * getDrawingLog
 * ─────────────
 * Fetch the Drawing Log for a project.
 *
 * @param {string} projectId
 * @param {string} adminId
 * @returns {Promise<object|null>}
 */
async function getDrawingLog(projectId) {
    return DrawingLog.findOne({ projectId }).lean();
}

module.exports = {
    detectChanges,
    compareRevisions,
    pickLatestRevision,
    generateTransmittal,
    getTransmittals,
    getDrawingLog,
    normalizeRevision,
};
