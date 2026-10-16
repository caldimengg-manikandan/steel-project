/**
 * ============================================================
 * Chat Module: Conversation Model
 * ============================================================
 * Represents a direct (1-to-1) or group conversation.
 * Strictly scoped by adminId to guarantee multi-tenant isolation.
 */
const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ['direct', 'group'],
            default: 'direct',
            required: true,
        },
        name: {
            type: String,
            trim: true,
            default: '',
        },
        participants: [
            {
                type: mongoose.Schema.Types.ObjectId,
                required: true,
            }
        ],
        // Cached participant info for quick rendering without multi-collection joins
        participantMeta: [
            {
                id: { type: mongoose.Schema.Types.ObjectId, required: true },
                userModel: { type: String, enum: ['User', 'Admin'], default: 'User' },
                username: { type: String, default: '' },
                displayName: { type: String, default: '' },
                role: { type: String, default: 'user' },
                email: { type: String, default: '' },
            }
        ],
        adminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admin',
            required: true,
            index: true,
        },
        lastMessage: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ChatMessage',
            default: null,
        },
        lastMessagePreview: {
            type: String,
            default: '',
        },
        lastMessageAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        unreadCounts: {
            type: Map,
            of: Number,
            default: {},
        },
    },
    {
        timestamps: true,
        collection: 'chat_conversations',
    }
);

conversationSchema.index({ adminId: 1, participants: 1 });
conversationSchema.index({ participants: 1, lastMessageAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
