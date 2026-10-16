/**
 * ============================================================
 * Chat Module: Socket.IO Server Setup
 * ============================================================
 * Handles real-time messaging, presence tracking, typing events,
 * and room-based authorization.
 */
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Conversation = require('../models/Conversation');
const User = require('../../models/User');
const Admin = require('../../models/Admin');

let ioInstance = null;

// Track active connections: userId (string) -> Set of socket IDs
const userSocketsMap = new Map();

function getSocketIO() {
    return ioInstance;
}

function isUserOnline(userId) {
    const sockets = userSocketsMap.get(String(userId));
    return Boolean(sockets && sockets.size > 0);
}

function initSocket(server) {
    if (ioInstance) {
        return ioInstance;
    }

    const io = new Server(server, {
        path: '/socket.io',
        cors: {
            origin: true, // Allow configured origins from express
            credentials: true,
        },
        transports: ['websocket', 'polling'], // Fallback enabled
        pingTimeout: 30000,
        pingInterval: 25000,
    });

    // Authentication Middleware
    io.use(async (socket, next) => {
        try {
            let token = socket.handshake.auth?.token;

            if (!token && socket.handshake.headers?.authorization) {
                const parts = socket.handshake.headers.authorization.split(' ');
                if (parts.length === 2 && parts[0] === 'Bearer') {
                    token = parts[1];
                }
            }

            if (!token && socket.handshake.headers?.cookie) {
                const match = socket.handshake.headers.cookie.match(/sdms_token=([^;]+)/);
                if (match) token = match[1];
            }

            if (!token && socket.handshake.query?.token) {
                token = socket.handshake.query.token;
            }

            if (!token) {
                return next(new Error('Authentication error: No token provided'));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const userId = decoded.id;

            let userObj = null;
            if (decoded.role === 'admin') {
                const admin = await Admin.findById(userId).select('username displayName role status').lean();
                if (admin && admin.status === 'active') {
                    userObj = {
                        id: admin._id.toString(),
                        username: admin.username,
                        displayName: admin.displayName || admin.username,
                        role: 'admin',
                        adminId: admin._id.toString(),
                    };
                }
            } else {
                const user = await User.findById(userId).select('username displayName role status adminId').lean();
                if (user && user.status === 'active') {
                    userObj = {
                        id: user._id.toString(),
                        username: user.username,
                        displayName: user.displayName || user.username,
                        role: user.role || 'user',
                        adminId: user.adminId ? user.adminId.toString() : user._id.toString(),
                    };
                }
            }

            if (!userObj) {
                return next(new Error('Authentication error: User not active or not found'));
            }

            socket.user = userObj;
            next();
        } catch (err) {
            return next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', socket => {
        const userId = socket.user.id;
        const adminId = socket.user.adminId;

        // Join personal notification room
        socket.join(`user:${userId}`);
        // Join tenant room for global presence within the tenant
        socket.join(`tenant:${adminId}`);

        // Register in active connections map
        if (!userSocketsMap.has(userId)) {
            userSocketsMap.set(userId, new Set());
            // Broadcast that user is online to everyone in their tenant
            socket.to(`tenant:${adminId}`).emit('user_presence', {
                userId,
                status: 'online',
            });
        }
        userSocketsMap.get(userId).add(socket.id);

        // Client requests presence of specific users or all online in tenant
        socket.on('get_online_users', callback => {
            const onlineIds = [];
            for (const [uId, sockSet] of userSocketsMap.entries()) {
                if (sockSet && sockSet.size > 0) {
                    onlineIds.push(uId);
                }
            }
            if (typeof callback === 'function') {
                callback(onlineIds);
            }
        });

        // Join conversation room with membership authorization
        socket.on('join_conversation', async ({ conversationId }) => {
            if (!conversationId) return;

            try {
                const conv = await Conversation.findById(conversationId).select('participants').lean();
                if (!conv) return;

                const isParticipant = conv.participants.some(p => p.toString() === userId);
                if (isParticipant) {
                    socket.join(`conversation:${conversationId}`);
                }
            } catch (err) {
                console.error('[Socket] join_conversation error:', err.message);
            }
        });

        // Leave conversation room
        socket.on('leave_conversation', ({ conversationId }) => {
            if (conversationId) {
                socket.leave(`conversation:${conversationId}`);
            }
        });

        // Typing indicator
        socket.on('typing', ({ conversationId }) => {
            if (!conversationId) return;
            socket.to(`conversation:${conversationId}`).emit('user_typing', {
                conversationId,
                userId,
                username: socket.user.displayName || socket.user.username,
            });
        });

        socket.on('stop_typing', ({ conversationId }) => {
            if (!conversationId) return;
            socket.to(`conversation:${conversationId}`).emit('user_stopped_typing', {
                conversationId,
                userId,
            });
        });

        // Disconnect handling
        socket.on('disconnect', () => {
            const userSockets = userSocketsMap.get(userId);
            if (userSockets) {
                userSockets.delete(socket.id);
                if (userSockets.size === 0) {
                    userSocketsMap.delete(userId);
                    // Broadcast offline to tenant
                    socket.to(`tenant:${adminId}`).emit('user_presence', {
                        userId,
                        status: 'offline',
                    });
                }
            }
        });
    });

    ioInstance = io;
    console.log('[Chat] Socket.IO server initialized successfully.');
    return io;
}

module.exports = {
    initSocket,
    getSocketIO,
    isUserOnline,
};
