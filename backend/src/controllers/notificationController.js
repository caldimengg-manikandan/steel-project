const Notification = require('../models/Notification');

/**
 * GET /api/notifications
 * Fetch latest notifications for the logged-in user.
 */
async function getNotifications(req, res) {
    const userId = req.principal.id;
    const notifications = await Notification.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(20);
    res.json({ notifications });
}

/**
 * PATCH /api/notifications/mark-read
 * Mark all notifications as read for the user.
 */
async function markAllRead(req, res) {
    const userId = req.principal.id;
    await Notification.updateMany({ user: userId, read: false }, { read: true });
    res.json({ message: 'All notifications marked as read' });
}

module.exports = { getNotifications, markAllRead };
