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

    const [localProjects, users, externalResult] = await Promise.all([
        Project.find(filter).sort({ updatedAt: -1 }),
        User.find(userFilter).sort({ createdAt: -1 }),
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

    // Only include local projects (which now have external data merged when name matches)
    const combinedAll = mappedLocal;

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

    const getOriginalCategory = (p) => {
        if (!p.rawStatus) return p.status || 'active';
        const s = p.rawStatus.toLowerCase();
        if (s.includes('hold') || s.includes('pause') || s.includes('stop')) return 'on_hold';
        if (s.includes('complete') || s.includes('finish') && !s.includes('not')) return 'completed';
        if (s.includes('archiv')) return 'archived';
        return 'in_progress';
    };

    const uniqueClients = new Set(
        combinedAll.map(p => (p.clientName || '').trim()).filter(Boolean)
    );
    const totalClients = uniqueClients.size;

    res.json({
        totalClients,
        totalProjects: combinedAll.length,
        activeProjects: combinedAll.filter(p => getOriginalCategory(p) === 'in_progress').length,
        onHoldProjects: combinedAll.filter(p => getOriginalCategory(p) === 'on_hold').length,
        completedProjects: combinedAll.filter(p => getOriginalCategory(p) === 'completed').length,
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
