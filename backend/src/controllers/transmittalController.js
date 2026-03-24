/**
 * ============================================================
 * Transmittal Controller
 * ============================================================
 * Handles:
 *
 *  POST   /api/transmittals/:projectId/generate
 *    — Detect changes, generate new transmittal, update Drawing Log
 *
 *  GET    /api/transmittals/:projectId
 *    — List all transmittals for a project
 *
 *  GET    /api/transmittals/:projectId/:transmittalId
 *    — Get a single transmittal by ID
 *
 *  GET    /api/transmittals/:projectId/drawing-log
 *    — Get the Drawing Log for a project
 *
 *  GET    /api/transmittals/:projectId/drawing-log/excel
 *    — Download Drawing Log as Excel
 *
 *  GET    /api/transmittals/:projectId/:transmittalId/excel
 *    — Download a specific Transmittal as Excel
 *
 * Security: all routes enforce admin-scope via middleware.
 */
const mongoose = require('mongoose');
const {
    generateTransmittal,
    getTransmittals,
    getDrawingLog,
    detectChanges,
} = require('../services/transmittalService');
const DrawingExtraction = require('../models/DrawingExtraction');
const Transmittal = require('../models/Transmittal');
const DrawingLog = require('../models/DrawingLog');
const Project = require('../models/Project');
const { generateTransmittalExcel, generateDrawingLogExcel } = require('../services/transmittalExcelService');

/**
 * POST /api/transmittals/:projectId/generate
 *
 * Body (optional):
 *   { extractionIds: string[] }  — if provided, only these extractions are
 *                                  considered for THIS transmittal.
 *                                  Useful for selective transmittal generation.
 *
 * Behaviour:
 *   - If no extractionIds provided → uses ALL completed extractions for the project
 *   - Runs change detection against the existing Drawing Log
 *   - Creates a new Transmittal record
 *   - Incrementally updates the Drawing Log
 *   - Returns the new transmittal + summary
 */
exports.generateTransmittal = async (req, res) => {
    const { projectId } = req.params;
    const adminId = req.principal.adminId;
    const { extractionIds, targetTransmittalNumber: bodyTargetNum } = req.body;

    // ── Determine which transmittal numbers to process ──────
    // If a specific number is requested, only process that one.
    // Otherwise, find all pending groups (extractions with targetTransmittalNumber set).
    let targetNumbers = [];

    if (bodyTargetNum != null) {
        targetNumbers = [parseInt(bodyTargetNum, 10)];
    } else if (extractionIds && extractionIds.length > 0) {
        // Specific extractions provided → get their unique target numbers
        const exts = await DrawingExtraction.find({ _id: { $in: extractionIds }, projectId }).select('targetTransmittalNumber').lean();
        const nums = [...new Set(exts.map(e => e.targetTransmittalNumber).filter(n => n != null))];
        targetNumbers = nums.length > 0 ? nums : [null]; // null = auto-increment
    } else {
        // No filter: find ALL pending transmittal number groups for this project
        const pending = await DrawingExtraction.aggregate([
            { $match: { projectId: new mongoose.Types.ObjectId(projectId), status: 'completed', targetTransmittalNumber: { $ne: null } } },
            { $group: { _id: '$targetTransmittalNumber' } },
            { $sort: { _id: 1 } }
        ]);
        targetNumbers = pending.map(p => p._id);
        // If no pending extractions with target numbers, fall back to auto-increment
        if (targetNumbers.length === 0) targetNumbers = [null];
    }

    const results = [];
    let lastResult = null;

    for (const targetNum of targetNumbers) {
        const result = await generateTransmittal(
            projectId,
            adminId,
            extractionIds && extractionIds.length > 0 ? extractionIds : null,
            targetNum
        );
        lastResult = result;
        if (result.transmittal) {
            results.push(result);
        }
    }

    if (results.length === 0) {
        return res.status(200).json({
            message: lastResult?.summary?.message || 'No new or revised drawings detected. Transmittal not generated.',
            transmittal: null,
            summary: lastResult?.summary,
        });
    }

    const transmittalNums = results.map(r => `TR-${String(r.summary.transmittalNumber).padStart(3, '0')}`).join(', ');
    res.status(201).json({
        message: `${transmittalNums} generated successfully.`,
        transmittal: results[results.length - 1].transmittal,
        drawingLog: results[results.length - 1].drawingLog,
        summary: results[results.length - 1].summary,
        allResults: results.map(r => r.summary),
    });
};


/**
 * GET /api/transmittals/:projectId
 * List all transmittals for a project (newest first).
 * Now includes "In-Flight" transmittals that are processing but not yet finalized.
 */
exports.listTransmittals = async (req, res) => {
    const { projectId } = req.params;
    const adminId = req.principal.adminId;

    let transmittals = await getTransmittals(projectId);

    // ── Include In-Flight Transmittals ────────────────────
    // Find all targeted transmittal numbers in extractions that haven't been generated yet.
    try {
        const pendingTargets = await DrawingExtraction.aggregate([
            { $match: { projectId: new mongoose.Types.ObjectId(projectId), targetTransmittalNumber: { $ne: null } } },
            { $group: { _id: '$targetTransmittalNumber', count: { $sum: 1 }, sequences: { $push: '$sequences' } } }
        ]);

        const existingNumbers = new Set(transmittals.map(t => t.transmittalNumber));

        for (const target of pendingTargets) {
            const currentCount = target._id;
            if (!existingNumbers.has(currentCount)) {
                
                const pendingSeqs = new Set();
                target.sequences.forEach(seqArray => {
                    if (seqArray && Array.isArray(seqArray)) {
                        seqArray.forEach(s => pendingSeqs.add(s));
                    }
                });

                // Add virtual placeholder
                transmittals.unshift({
                    _id: `pending-${currentCount}`,
                    transmittalNumber: currentCount,
                    newCount: target.count,
                    revisedCount: 0,
                    createdAt: new Date(),
                    isPending: true,
                    sequences: Array.from(pendingSeqs),
                });
            }
        }
    } catch (e) { console.error('[ListTransmittals] Failed to load pending targets:', e); }

    // Sort by transmittalNumber descending
    transmittals.sort((a, b) => b.transmittalNumber - a.transmittalNumber);

    res.json({ count: transmittals.length, transmittals });
};

/**
 * GET /api/transmittals/:projectId/:transmittalId
 * Get a single transmittal.
 */
exports.getTransmittal = async (req, res) => {
    const { projectId, transmittalId } = req.params;
    const adminId = req.principal.adminId;

    const transmittal = await Transmittal.findOne({
        _id: transmittalId,
        projectId,
    }).lean();

    if (!transmittal) {
        return res.status(404).json({ error: 'Transmittal not found.' });
    }

    res.json({ transmittal });
};

/**
 * GET /api/transmittals/:projectId/drawing-log
 * Get the Drawing Log for a project.
 */
exports.getDrawingLog = async (req, res) => {
    const { projectId } = req.params;
    const adminId = req.principal.adminId;

    const log = await getDrawingLog(projectId);

    if (!log) {
        return res.status(404).json({
            error: 'Drawing Log not found. Please generate a transmittal first.',
        });
    }

    res.json({ drawingLog: log });
};

/**
 * GET /api/transmittals/:projectId/drawing-log/excel
 * Download the Drawing Log as an Excel file.
 */
exports.downloadDrawingLogExcel = async (req, res) => {
    const { projectId } = req.params;
    const adminId = req.principal.adminId;

    const log = await getDrawingLog(projectId);

    if (!log || !log.drawings || log.drawings.length === 0) {
        return res.status(404).json({ error: 'Drawing Log is empty or not found.' });
    }

    const project = await Project.findById(projectId).lean();
    const projectDetails = {
        projectName: project ? project.name : 'Project',
        clientName: project ? project.clientName : 'CLIENT',
    };

    const { buffer, filename } = await generateDrawingLogExcel(log, projectDetails);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
};

/**
 * GET /api/transmittals/:projectId/:transmittalId/excel
 * Download a specific Transmittal as an Excel file.
 */
exports.downloadTransmittalExcel = async (req, res) => {
    const { projectId, transmittalId } = req.params;
    const adminId = req.principal.adminId;

    const transmittal = await Transmittal.findOne({
        _id: transmittalId,
        projectId,
    }).lean();

    if (!transmittal) {
        return res.status(404).json({ error: 'Transmittal not found.' });
    }

    const project = await Project.findById(projectId).lean();
    const projectDetails = {
        projectName: project ? project.name : 'Project',
        clientName: project ? project.clientName : 'CLIENT',
        transmittalNo: transmittal.transmittalNumber,
    };

    const { buffer, filename } = await generateTransmittalExcel(transmittal, projectDetails);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
};

/**
 * GET /api/transmittals/:projectId/preview-changes
 */
exports.previewChanges = async (req, res) => {
    const { projectId } = req.params;
    const adminId = req.principal.adminId;
    const { extractionIds } = req.body;

    const { getDrawingLog, detectChanges } = require('../services/transmittalService');

    const filter = { projectId, status: 'completed' };
    if (extractionIds?.length > 0) filter._id = { $in: extractionIds };

    const extractions = await DrawingExtraction.find(filter).lean();
    const log = await getDrawingLog(projectId);
    const { newDrawings, revisedDrawings, unchangedDrawings } = detectChanges(extractions, log);

    res.json({
        newCount: newDrawings.length,
        revisedCount: revisedDrawings.length,
        unchangedCount: unchangedDrawings.length,
        newDrawings: newDrawings.map(e => ({
            drawingNumber: e.extractedFields?.drawingNumber || '',
            revision: e.extractedFields?.revision || '',
            title: e.extractedFields?.drawingTitle || e.originalFileName,
        })),
        revisedDrawings: revisedDrawings.map(e => ({
            drawingNumber: e.extractedFields?.drawingNumber || '',
            revision: e.extractedFields?.revision || '',
            previousRevision: e._previousRevision || '',
            title: e.extractedFields?.drawingTitle || e.originalFileName,
        })),
    });
};

/**
 * DELETE /api/transmittals/:projectId/:transmittalId
 * Delete a transmittal record.
 */
exports.deleteTransmittal = async (req, res) => {
    const { projectId, transmittalId } = req.params;
    const adminId = req.principal.adminId;

    const doc = await Transmittal.findOneAndDelete({
        _id: transmittalId,
        projectId,
    });

    if (!doc) {
        return res.status(404).json({ error: 'Transmittal not found.' });
    }

    res.json({ message: `Transmittal TR-${String(doc.transmittalNumber).padStart(3, '0')} deleted.` });
};
