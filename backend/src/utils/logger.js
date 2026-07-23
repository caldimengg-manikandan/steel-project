const ActivityLog = require('../models/ActivityLog');

/**
 * Utility to log system activity
 * 
 * @param {String} user - User identifier (username, email, or "System")
 * @param {String} module - The module where the event occurred (e.g., 'Config', 'Projects')
 * @param {String} event - Description of the event
 */
const logActivity = async (user, module, event) => {
    try {
        const log = new ActivityLog({
            user: user || 'System',
            module,
            event
        });
        await log.save();
    } catch (error) {
        console.error('[Logger Error] Failed to save activity log:', error);
    }
};

module.exports = {
    logActivity
};
