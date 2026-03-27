const Project = require('../models/Project');
const User = require('../models/User');
const Client = require('../models/Client');
const DrawingExtraction = require('../models/DrawingExtraction');
const { attachProjectStats } = require('../services/projectStatsService');

/**
 * GET /api/admin/stats
 * Aggregated stats for the admin dashboard.
 */
async function getAdminStats(req, res) {
    const adminId = req.principal.adminId;

    const [projects, users, totalClients] = await Promise.all([
        Project.find({ createdByAdminId: adminId }).sort({ updatedAt: -1 }),
        User.find({ adminId }).sort({ createdAt: -1 }),
        Client.countDocuments({ createdByAdminId: adminId })
    ]);

    const projectIds = projects.map(p => p._id);

    const totalDrawings = await DrawingExtraction.countDocuments({ createdByAdminId: adminId, status: 'completed' });

    // Use common service for stats to ensure consistency
    const recentProjectsWithStats = await attachProjectStats(projects.slice(0, 5));
    const recentProjects = recentProjectsWithStats;

    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.status === 'active').length;

    // Aggregated Sequence Stats
    let totalSequences = 0;
    let completedSequences = 0;

    projects.forEach(p => {
        if (p.sequences && Array.isArray(p.sequences)) {
            totalSequences += p.sequences.length;
            completedSequences += p.sequences.filter(s => s.status === 'Completed').length;
        }
    });

    const delayedTasks = [];
    projects.forEach(p => {
        if (p.sequences && Array.isArray(p.sequences)) {
            p.sequences.forEach(s => {
                const targetDate = s.approvalDate || s.deadline;
                if (s.status !== 'Completed' && targetDate && new Date(targetDate) < new Date()) {
                    delayedTasks.push({
                        projId: p._id,
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
        totalProjects: projects.length,
        activeProjects: projects.filter(p => p.status === 'active').length,
        onHoldProjects: projects.filter(p => p.status === 'on_hold').length,
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
