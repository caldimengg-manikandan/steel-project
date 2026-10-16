/**
 * ============================================================
 * Chat Module Entry Point
 * ============================================================
 * Provides clean exports for mounting into backend Express app.
 */
const router = require('./routes/chatRoutes');
const { initSocket, getSocketIO, isUserOnline } = require('./socket/chatSocket');

module.exports = {
    router,
    initSocket,
    getSocketIO,
    isUserOnline,
};
