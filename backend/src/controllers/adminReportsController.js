const Project = require('../models/Project');
const RfiExtraction = require('../models/RfiExtraction');
const DrawingExtraction = require('../models/DrawingExtraction');
const User = require('../models/User');
const { attachProjectStats } = require('../services/projectStatsService');

/**
 * GET /api/admin/reports
 * Returns LIVE data for reports and analytics dashboard.
 * Supports date filtering via ?days=7,30 or custom range.
 */
async function getReportsData(req, res) {
    try {
        const adminId = req.principal.adminId;
        const days = parseInt(req.query.days) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Fetch all projects for this admin, sorted by most recent activity
        const rawProjects = await Project.find({ createdByAdminId: adminId }).populate('clientId').sort({ updatedAt: -1 }).lean();
        
        // Attach dynamic stats (drawingCount, openRfiCount, etc.)
        const projects = await attachProjectStats(rawProjects);
        const projectIds = projects.map(p => p._id);

        // 1. Calculate Overview Totals by summing cached Project fields
        let totalDrw = 0;
        let totalOpenRfi = 0;
        let totalClosedRfi = 0;
        let totalDel = 0;

        projects.forEach(p => {
            totalDrw += (p.drawingCount || 0);
            totalOpenRfi += (p.openRfiCount || 0);
            totalClosedRfi += (p.closedRfiCount || 0);
            
            // Delayed tasks = current sequences that have missed their deadline
            if (p.sequences && Array.isArray(p.sequences)) {
                totalDel += p.sequences.filter(s => {
                    const targetDate = s.approvalDate || s.deadline;
                    return s.status !== 'Completed' && targetDate && new Date(targetDate) < new Date();
                }).length;
            }
        });

        // 2. Project Progress Data (for Bar Chart)
        // Return up to 15 projects for the chart
        const chartProjects = projects.slice(0, 15).map(p => {
            return {
                id: p._id.toString(),
                name: p.name,
                approval: p.approvalPercentage || 0,
                fabrication: p.fabricationPercentage || 0,
                rfi: p.openRfiCount || 0
            };
        });

        res.json({
            overview: {
                totalProjects: projects.length,
                activeRfis: totalOpenRfi,
                totalDrawings: totalDrw,
                delayedTasks: totalDel
            },
            projectProgress: chartProjects,
            projects: projects.map(p => ({ 
                id: p._id.toString(), 
                name: p.name,
                clientName: p.clientId ? p.clientId.name : 'Unknown',
                status: p.status || 'active',
                approvalPercentage: p.approvalPercentage || 0,
                fabricationPercentage: p.fabricationPercentage || 0,
                drawingCount: p.drawingCount || 0,
                openRfiCount: p.openRfiCount || 0,
                sequences: p.sequences || []
            }))
        });
    } catch (err) {
        console.error('[AdminReportsController] error:', err);
        res.status(500).json({ error: 'Failed to fetch reports data.' });
    }
}

module.exports = { getReportsData };
