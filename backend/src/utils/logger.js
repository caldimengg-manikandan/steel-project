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
        const SystemSettings = require('../models/SystemSettings');
        const settings = await SystemSettings.findOne().lean();
        
        // If activity logging is disabled, don't log
        if (settings && settings.activityLogging === false) {
            return;
        }

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
