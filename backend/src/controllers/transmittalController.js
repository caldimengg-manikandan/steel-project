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
    const { extractionIds } = req.body;

    const result = await generateTransmittal(
        projectId,
        adminId,
        extractionIds && extractionIds.length > 0 ? extractionIds : null
    );

    if (!result.transmittal) {
        // Nothing changed — no transmittal created
        return res.status(200).json({
            message: result.summary.message,
            transmittal: null,
            summary: result.summary,
        });
    }

    res.status(201).json({
        message: `Transmittal TR-${String(result.summary.transmittalNumber).padStart(3, '0')} generated successfully.`,
        transmittal: result.transmittal,
        drawingLog: result.drawingLog,
        summary: result.summary,
    });
};

/**
 * GET /api/transmittals/:projectId
 * List all transmittals for a project (newest first).
 */
exports.listTransmittals = async (req, res) => {
    const { projectId } = req.params;
    const adminId = req.principal.adminId;

    const transmittals = await getTransmittals(projectId, adminId);
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
        createdByAdminId: adminId,
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

    const log = await getDrawingLog(projectId, adminId);

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

    const log = await getDrawingLog(projectId, adminId);

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
        createdByAdminId: adminId,
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

    const filter = { projectId, createdByAdminId: adminId, status: 'completed' };
    if (extractionIds?.length > 0) filter._id = { $in: extractionIds };

    const extractions = await DrawingExtraction.find(filter).lean();
    const log = await getDrawingLog(projectId, adminId);
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
        createdByAdminId: adminId,
    });

    if (!doc) {
        return res.status(404).json({ error: 'Transmittal not found.' });
    }

    res.json({ message: `Transmittal TR-${String(doc.transmittalNumber).padStart(3, '0')} deleted.` });
};
