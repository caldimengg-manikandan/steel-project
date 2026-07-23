const ActivityLog = require('../models/ActivityLog');

exports.getLogs = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const skip = parseInt(req.query.skip) || 0;

        const logs = await ActivityLog.find()
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit);

        const total = await ActivityLog.countDocuments();

        res.json({
            logs,
            total,
            limit,
            skip
        });
    } catch (error) {
        console.error('[Activity Log Controller] getLogs error:', error);
        res.status(500).json({ error: 'Failed to fetch activity logs' });
    }
};
