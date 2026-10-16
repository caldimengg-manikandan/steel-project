/**
 * ============================================================
 * Chat Module: Chat Controller
 * ============================================================
 */
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const ChatMessage = require('../models/ChatMessage');
const User = require('../../models/User');
const Admin = require('../../models/Admin');
const { getSocketIO } = require('../socket/chatSocket');

// Simple in-memory rate limiter per user (max 15 messages per 5 seconds)
const userMessageRateMap = new Map();

function checkRateLimit(userId) {
    const now = Date.now();
    const timestamps = userMessageRateMap.get(userId) || [];
    const recent = timestamps.filter(t => now - t < 5000);
    if (recent.length >= 15) {
        return false;
    }
    recent.push(now);
    userMessageRateMap.set(userId, recent);
    return true;
}

// Basic HTML sanitization to prevent stored XSS
function sanitizeText(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Helper to fetch and resolve user details for participant IDs
 */
async function resolveParticipants(participantIds, adminId) {
    const pIds = participantIds.map(id => (typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id));

    const [users, admins] = await Promise.all([
        User.find({ _id: { $in: pIds }, adminId }, 'username displayName email role division').lean(),
        Admin.find({ _id: { $in: pIds } }, 'username displayName email role').lean(),
    ]);

    const metaList = [];
    for (const u of users) {
        metaList.push({
            id: u._id,
            userModel: 'User',
            username: u.username,
            displayName: u.displayName || u.username,
            role: u.role || 'user',
            email: u.email || '',
        });
    }
    for (const a of admins) {
        metaList.push({
            id: a._id,
            userModel: 'Admin',
            username: a.username,
            displayName: a.displayName || a.username,
            role: 'admin',
            email: a.email || '',
        });
    }

    return metaList;
}

/**
 * List all conversations for the authenticated user
 * GET /api/chat/conversations
 */
exports.listConversations = async (req, res) => {
    const userId = req.principal.id;
    const adminId = req.principal.adminId;

    const conversations = await Conversation.find({
        adminId: new mongoose.Types.ObjectId(adminId),
        participants: new mongoose.Types.ObjectId(userId),
    })
        .populate('lastMessage')
        .sort({ lastMessageAt: -1 })
        .lean();

    // Map unread count for current user
    const formatted = conversations.map(c => {
        const unreadMap = c.unreadCounts || {};
        const unread = unreadMap[userId] || 0;
        return {
            ...c,
            unreadCount: unread,
        };
    });

    res.json({ success: true, conversations: formatted });
};

/**
 * Create a new conversation (Direct or Group)
 * POST /api/chat/conversations
 */
exports.createConversation = async (req, res) => {
    const currentUserId = req.principal.id;
    const adminId = req.principal.adminId;
    const { type = 'direct', participantIds = [], name = '' } = req.body;

    if (!Array.isArray(participantIds) || participantIds.length === 0) {
        return res.status(400).json({ error: 'At least one participant is required.' });
    }

    // Always include current user as participant
    const uniqueIds = Array.from(new Set([currentUserId, ...participantIds]));

    if (type === 'direct') {
        if (uniqueIds.length !== 2) {
            return res.status(400).json({ error: 'Direct conversation must have exactly two participants.' });
        }

        // Check if direct conversation already exists between these two users
        const existing = await Conversation.findOne({
            type: 'direct',
            adminId: new mongoose.Types.ObjectId(adminId),
            participants: { $all: uniqueIds.map(id => new mongoose.Types.ObjectId(id)), $size: 2 },
        })
            .populate('lastMessage')
            .lean();

        if (existing) {
            const unread = (existing.unreadCounts || {})[currentUserId] || 0;
            return res.json({ success: true, conversation: { ...existing, unreadCount: unread } });
        }
    }

    if (type === 'group' && !name.trim()) {
        return res.status(400).json({ error: 'Group conversations require a name.' });
    }

    // Resolve participant metadata
    const participantMeta = await resolveParticipants(uniqueIds, adminId);
    if (participantMeta.length < uniqueIds.length) {
        // Some participants could not be found under this tenant
        // Still proceed with found participants if valid
    }

    const conversation = await Conversation.create({
        type,
        name: type === 'group' ? name.trim() : '',
        participants: uniqueIds.map(id => new mongoose.Types.ObjectId(id)),
        participantMeta,
        adminId: new mongoose.Types.ObjectId(adminId),
        lastMessageAt: new Date(),
        unreadCounts: {},
    });

    const populated = await Conversation.findById(conversation._id).lean();

    // Notify participants via socket
    try {
        const io = getSocketIO();
        if (io) {
            uniqueIds.forEach(pId => {
                io.to(`user:${pId}`).emit('conversation_created', populated);
            });
        }
    } catch (e) {
        console.error('[Chat] Failed to emit socket notification:', e.message);
    }

    res.status(201).json({ success: true, conversation: { ...populated, unreadCount: 0 } });
};

/**
 * Fetch paginated messages for a conversation
 * GET /api/chat/conversations/:id/messages
 */
exports.getMessages = async (req, res) => {
    const userId = req.principal.id;
    const conversationId = req.params.id;
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const before = req.query.before; // ISO timestamp or messageId

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return res.status(400).json({ error: 'Invalid conversation ID' });
    }

    const conversation = await Conversation.findById(conversationId).lean();
    if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
    }

    // Verify caller is a participant
    const isParticipant = conversation.participants.some(p => p.toString() === userId);
    if (!isParticipant) {
        return res.status(403).json({ error: 'Access denied to this conversation.' });
    }

    const query = { conversationId: new mongoose.Types.ObjectId(conversationId) };
    if (before) {
        if (mongoose.Types.ObjectId.isValid(before)) {
            const beforeMsg = await ChatMessage.findById(before).lean();
            if (beforeMsg) query.createdAt = { $lt: beforeMsg.createdAt };
        } else if (!isNaN(Date.parse(before))) {
            query.createdAt = { $lt: new Date(before) };
        }
    }

    const messages = await ChatMessage.find(query)
        .sort({ createdAt: -1 })
        .limit(limit + 1)
        .lean();

    const hasMore = messages.length > limit;
    const resultList = hasMore ? messages.slice(0, limit) : messages;

    // Return in ascending (chronological) order for chat stream
    resultList.reverse();

    res.json({
        success: true,
        messages: resultList,
        hasMore,
        oldestCursor: resultList.length > 0 ? resultList[0]._id : null,
    });
};

/**
 * Send a message
 * POST /api/chat/conversations/:id/messages
 */
exports.sendMessage = async (req, res) => {
    const userId = req.principal.id;
    const adminId = req.principal.adminId;
    const conversationId = req.params.id;
    const { content = '', attachments = [] } = req.body;

    if (!checkRateLimit(userId)) {
        return res.status(429).json({ error: 'Too many messages. Please slow down.' });
    }

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return res.status(400).json({ error: 'Invalid conversation ID' });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
    }

    const isParticipant = conversation.participants.some(p => p.toString() === userId);
    if (!isParticipant) {
        return res.status(403).json({ error: 'Access denied to this conversation.' });
    }

    if (!content.trim() && (!attachments || attachments.length === 0)) {
        return res.status(400).json({ error: 'Message cannot be empty.' });
    }

    const sanitizedContent = sanitizeText(content.trim());
    const senderName = req.principal.username || 'User';

    const message = await ChatMessage.create({
        conversationId: conversation._id,
        adminId: new mongoose.Types.ObjectId(adminId),
        senderId: new mongoose.Types.ObjectId(userId),
        senderModel: req.principal.role === 'admin' ? 'Admin' : 'User',
        senderName,
        content: sanitizedContent,
        attachments: Array.isArray(attachments) ? attachments : [],
        readBy: [{ userId: new mongoose.Types.ObjectId(userId), readAt: new Date() }],
        status: 'sent',
    });

    // Update conversation metadata and increment unread counts for all other participants
    const unreadMap = conversation.unreadCounts || new Map();
    conversation.participants.forEach(pId => {
        const pIdStr = pId.toString();
        if (pIdStr !== userId) {
            const currentCount = unreadMap.get(pIdStr) || 0;
            unreadMap.set(pIdStr, currentCount + 1);
        }
    });

    const preview = sanitizedContent || (attachments.length > 0 ? `📎 ${attachments[0].filename || 'Attachment'}` : '');
    conversation.lastMessage = message._id;
    conversation.lastMessagePreview = preview;
    conversation.lastMessageAt = message.createdAt;
    conversation.unreadCounts = unreadMap;
    await conversation.save();

    const messageObj = message.toObject();

    // Broadcast message to conversation room and to participant user rooms
    try {
        const io = getSocketIO();
        if (io) {
            io.to(`conversation:${conversationId}`).emit('new_message', messageObj);

            conversation.participants.forEach(pId => {
                const pIdStr = pId.toString();
                if (pIdStr !== userId) {
                    io.to(`user:${pIdStr}`).emit('conversation_updated', {
                        conversationId: conversation._id,
                        lastMessage: messageObj,
                        unreadCount: unreadMap.get(pIdStr) || 1,
                    });
                }
            });
        }
    } catch (e) {
        console.error('[Chat] Socket broadcast failed:', e.message);
    }

    res.status(201).json({ success: true, message: messageObj });
};

/**
 * Mark a conversation as read
 * PATCH /api/chat/conversations/:id/read
 */
exports.markAsRead = async (req, res) => {
    const userId = req.principal.id;
    const conversationId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return res.status(400).json({ error: 'Invalid conversation ID' });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
    }

    if (conversation.unreadCounts) {
        conversation.unreadCounts.set(userId, 0);
        await conversation.save();
    }

    // Add current user to readBy of recent messages
    await ChatMessage.updateMany(
        {
            conversationId: conversation._id,
            'readBy.userId': { $ne: new mongoose.Types.ObjectId(userId) },
        },
        {
            $addToSet: {
                readBy: { userId: new mongoose.Types.ObjectId(userId), readAt: new Date() },
            },
            $set: { status: 'read' },
        }
    );

    try {
        const io = getSocketIO();
        if (io) {
            io.to(`conversation:${conversationId}`).emit('messages_read', {
                conversationId,
                readerId: userId,
            });
        }
    } catch (e) {
        console.error('[Chat] Socket read broadcast failed:', e.message);
    }

    res.json({ success: true, conversationId, unreadCount: 0 });
};

/**
 * Search users / colleagues in the same tenant to start a conversation with
 * GET /api/chat/users?q=...
 */
exports.searchUsers = async (req, res) => {
    const currentUserId = req.principal.id;
    const adminId = req.principal.adminId;
    const q = (req.query.q || '').trim();

    const regex = new RegExp(q, 'i');

    const userQuery = {
        adminId: new mongoose.Types.ObjectId(adminId),
        status: 'active',
        _id: { $ne: new mongoose.Types.ObjectId(currentUserId) },
    };

    if (q) {
        userQuery.$or = [
            { username: regex },
            { displayName: regex },
            { email: regex },
            { division: regex },
            { role: regex },
        ];
    }

    const users = await User.find(userQuery, 'username displayName email role division employeeId')
        .collation({ locale: 'en', strength: 2 })
        .sort({ displayName: 1, username: 1 })
        .limit(200)
        .lean();

    const results = users.map(u => ({
        id: u._id.toString(),
        username: u.username,
        displayName: u.displayName || u.username,
        email: u.email || '',
        role: u.role || 'user',
        division: u.division || '',
        employeeId: u.employeeId || '',
        userModel: 'User',
    }));

    // If caller is not an admin, include their Admin in the search results
    if (req.principal.role !== 'admin') {
        const admin = await Admin.findById(adminId, 'username displayName email role').lean();
        if (admin && admin._id.toString() !== currentUserId) {
            if (!q || admin.username.match(regex) || (admin.displayName && admin.displayName.match(regex))) {
                results.push({
                    id: admin._id.toString(),
                    username: admin.username,
                    displayName: admin.displayName || 'System Administrator',
                    email: admin.email || '',
                    role: 'admin',
                    division: 'Administration',
                    userModel: 'Admin',
                });
            }
        }
    }

    // Sort all results alphabetically from A to Z
    results.sort((a, b) => {
        const nameA = (a.displayName || a.username || '').trim().toLowerCase();
        const nameB = (b.displayName || b.username || '').trim().toLowerCase();
        return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    });

    res.json({ success: true, users: results });
};

/**
 * Upload an attachment
 * POST /api/chat/upload
 */
exports.uploadAttachment = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    const file = req.file;
    const relativeUrl = `/uploads/chat/${file.filename}`;

    res.json({
        success: true,
        attachment: {
            filename: file.filename,
            originalName: file.originalname,
            url: relativeUrl,
            size: file.size,
            mimetype: file.mimetype,
        },
    });
};
