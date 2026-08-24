/**
 * ============================================================
 * User Projects Controller
 * ============================================================
 * Routes for regular users — scoped to their assigned projects.
 *
 * Routes:
 *   GET /api/user/projects                  — list my assigned projects
 *   GET /api/user/projects/:projectId       — get one assigned project
 *   GET /api/user/projects/:projectId/drawings — get drawings for project
 */
const Project = require('../models/Project');
const Drawing = require('../models/Drawing');
const DrawingExtraction = require('../models/DrawingExtraction');
const { attachProjectStats } = require('../services/projectStatsService');

async function listMyProjects(req, res) {
    const userId = req.principal.id;
    const mongoose = require('mongoose');

    let queryUserId = userId;
    if (mongoose.Types.ObjectId.isValid(userId)) {
        queryUserId = new mongoose.Types.ObjectId(userId);
    }

    const FULL_ACCESS_ROLES = ['admin', 'superadmin', 'project_manager', 'team_lead'];
    const isFullAccess = FULL_ACCESS_ROLES.includes(req.principal.role);

    const query = {
        status: { $ne: 'archived' }
    };

    if (!isFullAccess) {
        query['assignments.userId'] = queryUserId;
    } else {
        // Full access roles of the tenant see all projects created by that tenant
        query['createdByAdminId'] = new mongoose.Types.ObjectId(req.principal.adminId);
    }

    const projects = await Project
        .find(query)
        .sort({ updatedAt: -1 });

    const projectsWithStats = await attachProjectStats(projects);
    const result = projectsWithStats.map(p => {
        const assignment = p.assignments.find(
            (a) => a.userId.toString() === userId
        );
        return {
            ...p,
            myPermission: assignment?.permission ?? 'viewer',
        };
    });

    // ── Fetch Recent Activity ──
    // Get the 10 most recent drawing extractions for these projects
    const projectIds = projects.map(p => p._id);
    const DrawingExtraction = require('../models/DrawingExtraction');
    const RfiExtraction = require('../models/RfiExtraction');

    const [recentDrawings, recentRfis] = await Promise.all([
        DrawingExtraction.find({ projectId: { $in: projectIds } })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean(),
        RfiExtraction.find({ projectId: { $in: projectIds } })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean()
    ]);

    const activity = [
        ...recentDrawings.map(d => ({
            id: d._id,
            type: 'drawing',
            title: d.originalFileName,
            projectName: projects.find(p => p._id.toString() === d.projectId.toString())?.name || 'Unknown',
            status: d.status,
            createdAt: d.createdAt,
            uploadedBy: d.uploadedBy
        })),
        ...recentRfis.map(r => ({
            id: r._id,
            type: 'rfi',
            title: r.originalFileName,
            projectName: projects.find(p => p._id.toString() === r.projectId.toString())?.name || 'Unknown',
            status: r.status,
            createdAt: r.createdAt,
            uploadedBy: r.uploadedBy
        }))
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
     .slice(0, 10);

    res.json({ count: result.length, projects: result, recentActivity: activity });
}

/**
 * GET /api/user/projects/:projectId
 * req.scopedProject pre-loaded by scopeProjectToUser.
 * req.userPermission set by scopeProjectToUser.
 */
async function getMyProject(req, res) {
    const projectWithStats = await attachProjectStats(req.scopedProject);
    res.json({
        project: {
            ...projectWithStats,
            myPermission: req.userPermission,
        },
    });
}

/**
 * GET /api/user/projects/:projectId/drawings
 * Returns drawings for an assigned project.
 */
async function getProjectDrawings(req, res) {
    const project = req.scopedProject;

    const drawings = await Drawing
        .find({ projectId: project._id })
        .sort({ createdAt: -1 });

    res.json({
        count: drawings.length,
        projectName: project.name,
        permission: req.userPermission,
        drawings,
    });
}

/**
 * PATCH /api/user/projects/:projectId/sequences
 * Updates sequence status. Requires 'editor' permission.
 */
async function updateProjectSequences(req, res) {
    const project = req.scopedProject;
    const { sequences, scopeOfWork } = req.body;

    if (!sequences && !scopeOfWork) {
        return res.status(400).json({ error: 'Sequences or scopeOfWork array is required in request body.' });
    }

    if (sequences && Array.isArray(sequences)) {
        project.sequences = sequences.map((s, idx) => ({
            name: (s.name || '').trim() || `Seq ${idx + 1}`,
            status: s.status === 'Completed' ? 'Completed' : 'Not Completed',
            deadline: s.deadline || null,
            approvalDate: s.approvalDate || null,
            fabricationDate: s.fabricationDate || null
        }));
    }
    if (scopeOfWork && Array.isArray(scopeOfWork)) {
        project.scopeOfWork = scopeOfWork.map((s, idx) => ({
            name: (s.name || '').trim() || `SOW ${String(idx + 1).padStart(2, '0')}`,
            percentage: Number(s.percentage) || 0,
            approval: Number(s.approval) || 0,
            fabrication: Number(s.fabrication) || 0,
            status: s.status || 'Yet to Start'
        }));
    }
    await project.save();

    const { attachProjectStats } = require('../services/projectStatsService');
    const projectWithStats = await attachProjectStats(project);

    res.json({ 
        message: 'Project updated successfully.',
        project: {
            ...projectWithStats,
            id: project._id,
            myPermission: req.userPermission
        }
    });
}

module.exports = { listMyProjects, getMyProject, getProjectDrawings, updateProjectSequences };
