const Project = require('../models/Project');
const DrawingExtraction = require('../models/DrawingExtraction');
const DrawingLog = require('../models/DrawingLog');
const { getDrawingLog } = require('../services/transmittalService');
const { generateDrawingLogExcel } = require('../services/transmittalExcelService');
const SystemSettings = require('../models/SystemSettings');

/**
 * GET /api/drawing-log/projects
 * Fetches all projects that have drawings extracted.
 */
exports.getProjectsWithDrawings = async (req, res) => {
    try {
        // Find distinct project IDs in DrawingExtraction
        const projectIds = await DrawingExtraction.distinct('projectId');
        
        // Fetch full project details for those IDs
        const projects = await Project.find({ _id: { $in: projectIds } }).sort({ createdAt: -1 }).lean();
        
        res.json({ count: projects.length, projects });
    } catch (err) {
        console.error('[DrawingLog] Error fetching projects:', err);
        res.status(500).json({ error: 'Failed to fetch projects with drawing logs' });
    }
};

/**
 * GET /api/drawing-log/:projectId
 * Fetches the drawing log data for a specific project.
 */
exports.getDrawingLog = async (req, res) => {
    try {
        const { projectId } = req.params;
        
        // Use the existing transmittal service to fetch the Drawing Log
        const log = await getDrawingLog(projectId);
        
        if (!log) {
            return res.status(404).json({ error: 'Drawing Log not found. A transmittal may need to be generated first.' });
        }
        
        res.json({ drawingLog: log });
    } catch (err) {
        console.error('[DrawingLog] Error fetching drawing log:', err);
        res.status(500).json({ error: 'Failed to fetch drawing log' });
    }
};

/**
 * GET /api/drawing-log/:projectId/download
 * Downloads the drawing log as Excel (same as in Project module).
 */
exports.downloadDrawingLogExcel = async (req, res) => {
    try {
        const { projectId } = req.params;

        const log = await getDrawingLog(projectId);
        if (!log) {
            return res.status(404).send('Drawing Log not found. Generate a transmittal first.');
        }

        const project = await Project.findById(projectId).lean();
        const settings = await SystemSettings.findOne().lean();

        const projectDetails = {
            projectName: project ? project.name : 'Project',
            clientName: project ? project.clientName : 'CLIENT',
        };

        const { buffer, filename } = await generateDrawingLogExcel(log, projectDetails, settings?.logoPath);

        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        console.error('[DrawingLog] Error downloading excel:', err);
        res.status(500).send('Failed to generate drawing log excel.');
    }
};
