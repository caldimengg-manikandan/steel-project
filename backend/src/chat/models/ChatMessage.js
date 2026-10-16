/**
 * ============================================================
 * Chat Module: ChatMessage Model
 * ============================================================
 * Individual message belonging to a Conversation.
 * Supports rich text, attachments, read-receipts, and audit trail.
 */
const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
    {
        conversationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Conversation',
            required: true,
            index: true,
        },
        adminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admin',
            required: true,
            index: true,
        },
        senderId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        senderModel: {
            type: String,
            enum: ['User', 'Admin'],
            default: 'User',
        },
        senderName: {
            type: String,
            default: '',
        },
        content: {
            type: String,
            trim: true,
            default: '',
            maxlength: 10000,
        },
        attachments: [
            {
                filename: { type: String, required: true },
                originalName: { type: String, default: '' },
                url: { type: String, required: true },
                size: { type: Number, default: 0 },
                mimetype: { type: String, default: '' },
            }
        ],
        readBy: [
            {
                userId: { type: mongoose.Schema.Types.ObjectId, required: true },
                readAt: { type: Date, default: Date.now },
            }
        ],
        status: {
            type: String,
            enum: ['sent', 'delivered', 'read'],
            default: 'sent',
        },
    },
    {
        timestamps: true,
        collection: 'chat_messages',
    }
);

chatMessageSchema.index({ conversationId: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
