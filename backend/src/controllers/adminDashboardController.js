const Project = require('../models/Project');
const User = require('../models/User');
const DrawingExtraction = require('../models/DrawingExtraction');

/**
 * GET /api/admin/stats
 * Aggregated stats for the admin dashboard.
 */
async function getAdminStats(req, res) {
    const adminId = req.principal.adminId;

    const [projects, users] = await Promise.all([
        Project.find({ createdByAdminId: adminId }).sort({ updatedAt: -1 }),
        User.find({ adminId }).sort({ createdAt: -1 })
    ]);

    const projectIds = projects.map(p => p._id);

    // Batch-count completed drawings per project, categorized by type
    const counts = await DrawingExtraction.aggregate([
        { $match: { projectId: { $in: projectIds }, status: 'completed' } },
        {
            $group: {
                _id: '$projectId',
                count: { $sum: 1 },
                approvalCount: {
                    $sum: {
                        $cond: [
                            {
                                $or: [
                                    { $regexMatch: { input: { $ifNull: ["$extractedFields.revision", ""] }, regex: "^(rev\\s*)?[a-z]", options: "i" } },
                                    { $regexMatch: { input: { $ifNull: ["$extractedFields.remarks", ""] }, regex: "approved|approval", options: "i" } },
                                    { $regexMatch: { input: { $ifNull: ["$extractedFields.description", ""] }, regex: "approved|approval", options: "i" } }
                                ]
                            },
                            1, 0
                        ]
                    }
                },
                fabricationCount: {
                    $sum: {
                        $cond: [
                            { $regexMatch: { input: { $ifNull: ["$extractedFields.revision", ""] }, regex: "^(rev\\s*)?[0-9]", options: "i" } },
                            1, 0
                        ]
                    }
                }
            }
        },
    ]);

    const countMap = {};
    let totalDrawings = 0;
    counts.forEach((c) => {
        countMap[c._id.toString()] = {
            total: c.count,
            approvalCount: c.approvalCount,
            fabricationCount: c.fabricationCount
        };
        totalDrawings += c.count;
    });

    const recentProjects = projects.slice(0, 5).map(p => {
        const stats = countMap[p._id.toString()] || { total: 0, approvalCount: 0, fabricationCount: 0 };
        const approx = p.approximateDrawingsCount || 0;
        
        let approvalPercentage = 0;
        let fabricationPercentage = 0;
        if (approx > 0) {
            approvalPercentage = Math.round((stats.approvalCount / approx) * 100);
            fabricationPercentage = Math.round((stats.fabricationCount / approx) * 100);
        }

        return {
            ...p.toObject(),
            drawingCount: stats.total,
            approvalCount: stats.approvalCount,
            fabricationCount: stats.fabricationCount,
            approvalPercentage,
            fabricationPercentage,
        };
    });

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

    res.json({
        totalProjects: projects.length,
        activeProjects: projects.filter(p => p.status === 'active').length,
        onHoldProjects: projects.filter(p => p.status === 'on_hold').length,
        totalUsers,
        activeUsers,
        totalDrawings,
        recentProjects,
        recentUsers: users.slice(0, 5),
        totalSequences,
        completedSequences
    });
}

module.exports = { getAdminStats };
