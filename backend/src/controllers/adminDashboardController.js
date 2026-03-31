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
    const [projects, users, totalClients] = await Promise.all([
        Project.find({}).sort({ updatedAt: -1 }),
        User.find({}).sort({ createdAt: -1 }),
        Client.countDocuments({})
    ]);

    const projectIds = projects.map(p => p._id);

    const totalDrawings = await DrawingExtraction.countDocuments({ status: 'completed' });

    // Use common service for stats to ensure consistency
    const recentProjectsWithStats = await attachProjectStats(projects.slice(0, 10));
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
                            projId: p._id.toString(),
                        projName: p.name,
                        seqName: s.name,
                        deadline: targetDate,
                        status: s.status
                    });
                }
            });
        }
    });

    // Group by Client for frontend bar graph
    const clientMap = projects.reduce((acc, p) => {
        const client = p.clientName || 'Other';
        if (!acc[client]) {
            acc[client] = { name: client, total: 0, active: 0, on_hold: 0, completed: 0, archived: 0 };
        }
        acc[client].total++;
        if (p.status in acc[client]) {
            acc[client][p.status]++;
        }
        return acc;
    }, {});
    const projectsByClient = Object.values(clientMap).sort((a, b) => b.total - a.total);

    res.json({
        totalClients,
        projectsByClient,
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
