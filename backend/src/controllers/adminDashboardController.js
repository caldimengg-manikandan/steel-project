const Project = require('../models/Project');
const User = require('../models/User');
const Client = require('../models/Client');
const DrawingExtraction = require('../models/DrawingExtraction');
const { attachProjectStats } = require('../services/projectStatsService');
const { getExternalProjects } = require('../services/externalProjectService');

/**
 * GET /api/admin/stats
 * Aggregated stats for the admin dashboard.
 */
async function getAdminStats(req, res) {
    const adminId = req.principal.adminId;
    const filter = {};
    if (req.principal.role !== 'superadmin') {
        filter.createdByAdminId = adminId;
    }
    const userFilter = {};
    if (req.principal.role !== 'superadmin') {
        userFilter.adminId = adminId;
    }

    const [localProjects, users, totalClients, externalResult] = await Promise.all([
        Project.find(filter).sort({ updatedAt: -1 }),
        User.find(userFilter).sort({ createdAt: -1 }),
        Client.countDocuments(req.principal.role === 'superadmin' ? {} : { createdByAdminId: adminId }),
        getExternalProjects()
    ]);

    const externalProjects = externalResult.projects || [];

    // Get local projects with their stats first
    const localProjectsWithStats = await attachProjectStats(localProjects);
    
    // Map local projects to a consistent schema structure
    const mappedLocal = localProjectsWithStats.map(p => ({
        ...p,
        id: p._id.toString(),
        approvalPercentage: p.approvalPercentage,
        fabricationPercentage: p.fabricationPercentage,
        isExternal: false
    }));

    // Combine local and external projects
    const combinedAll = [
        ...mappedLocal,
        ...externalProjects.map(p => ({
            ...p,
            isExternal: true,
            _id: p.id,
            updatedAt: p.createdAt
        }))
    ];

    // Sort combined projects by updatedAt / createdAt descending
    combinedAll.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    const totalDrawings = await DrawingExtraction.countDocuments({ status: 'completed' });
    const recentProjects = combinedAll.slice(0, 10);

    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.status === 'active').length;

    // Aggregated Sequence Stats
    let totalSequences = 0;
    let completedSequences = 0;

    combinedAll.forEach(p => {
        if (p.sequences && Array.isArray(p.sequences)) {
            totalSequences += p.sequences.length;
            completedSequences += p.sequences.filter(s => s.status === 'Completed').length;
        }
    });

    const delayedTasks = [];
    combinedAll.forEach(p => {
        if (p.sequences && Array.isArray(p.sequences)) {
            p.sequences.forEach(s => {
                const targetDate = s.approvalDate || s.deadline;
                if (s.status !== 'Completed' && targetDate && new Date(targetDate) < new Date()) {
                    delayedTasks.push({
                        projId: (p._id || p.id).toString(),
                        projName: p.name,
                        seqName: s.name,
                        deadline: targetDate,
                        status: s.status
                    });
                }
            });
        }
    });

    res.json({
        totalClients,
        totalProjects: combinedAll.length,
        activeProjects: combinedAll.filter(p => p.status === 'active').length,
        onHoldProjects: combinedAll.filter(p => p.status === 'on_hold').length,
        totalUsers,
        activeUsers,
        totalDrawings,
        recentProjects,
        recentUsers: users.slice(0, 5),
        totalSequences,
        completedSequences,
        delayedTasks
    });
}

module.exports = { getAdminStats };
