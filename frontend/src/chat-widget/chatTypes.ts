/**
 * ============================================================
 * Chat Module: TypeScript Type Definitions
 * ============================================================
 */

export interface ChatParticipantMeta {
    id: string;
    userModel: 'User' | 'Admin';
    username: string;
    displayName: string;
    role: string;
    email: string;
}

export interface ChatAttachment {
    filename: string;
    originalName?: string;
    url: string;
    size: number;
    mimetype: string;
}

export interface ChatMessage {
    _id: string;
    conversationId: string;
    adminId: string;
    senderId: string;
    senderModel: 'User' | 'Admin';
    senderName: string;
    content: string;
    attachments: ChatAttachment[];
    readBy: { userId: string; readAt: string }[];
    status: 'sent' | 'delivered' | 'read';
    isDeleted?: boolean;
    deletedAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface Conversation {
    _id: string;
    type: 'direct' | 'group';
    name?: string;
    participants: string[];
    participantMeta: ChatParticipantMeta[];
    adminId: string;
    lastMessage?: ChatMessage | null;
    lastMessagePreview?: string;
    lastMessageAt: string;
    unreadCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface PeerUser {
    id: string;
    username: string;
    displayName: string;
    email: string;
    role: string;
    division: string;
    employeeId: string;
    userModel: 'User' | 'Admin';
    isOnline?: boolean;
}
