/**
 * ============================================================
 * Chat Module: Conversation List Component
 * ============================================================
 */
import React from 'react';
import type { Conversation } from './chatTypes';

interface ConversationListProps {
    conversations: Conversation[];
    currentUserId: string;
    activeConversationId: string | null;
    onlineUsers: Set<string>;
    searchQuery: string;
    onSelectConversation: (conversation: Conversation) => void;
    onOpenNewChat: () => void;
}

function getInitials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
}

function formatChatTime(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
    }

    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export const ConversationList: React.FC<ConversationListProps> = ({
    conversations,
    currentUserId,
    activeConversationId,
    onlineUsers,
    searchQuery,
    onSelectConversation,
    onOpenNewChat,
}) => {
    // Filter by search query
    const filtered = conversations.filter(conv => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();

        if (conv.type === 'group' && conv.name?.toLowerCase().includes(q)) {
            return true;
        }

        const peer = conv.participantMeta?.find(p => p.id !== currentUserId);
        if (peer && (peer.displayName?.toLowerCase().includes(q) || peer.username?.toLowerCase().includes(q))) {
            return true;
        }

        if (conv.lastMessagePreview?.toLowerCase().includes(q)) {
            return true;
        }

        return false;
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Action Toolbar */}
            <div className="cw-toolbar">
                <span className="cw-toolbar-label">Conversations</span>
                <button
                    className="cw-new-chat-btn"
                    onClick={onOpenNewChat}
                    title="Start a new direct or group chat"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="13" height="13">
                        <path d="M12 5v14M5 12h14" />
                    </svg>
                    New Chat
                </button>
            </div>

            {/* List */}
            <div className="cw-conv-list">
                {filtered.length === 0 ? (
                    <div className="cw-empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="36" height="36">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                        <div className="cw-empty-title">
                            {searchQuery ? 'No matching chats' : 'No conversations yet'}
                        </div>
                        <div className="cw-empty-sub">
                            {searchQuery
                                ? 'Try searching for a colleague by name or email'
                                : 'Start a chat to collaborate with your team'}
                        </div>
                        {!searchQuery && (
                            <button
                                className="cw-btn-primary"
                                style={{ marginTop: '8px' }}
                                onClick={onOpenNewChat}
                            >
                                Start New Chat
                            </button>
                        )}
                    </div>
                ) : (
                    filtered.map(conv => {
                        const isGroup = conv.type === 'group';
                        const peer = conv.participantMeta?.find(p => String(p.id) !== String(currentUserId));
                        const title = isGroup
                            ? (conv.name || 'Group Chat')
                            : (peer?.displayName || peer?.username || 'Colleague');
                        const isPeerOnline = !isGroup && peer ? onlineUsers.has(String(peer.id)) : false;
                        const initials = getInitials(title);
                        const isActive = conv._id === activeConversationId;
                        const unread = conv.unreadCount || 0;

                        return (
                            <div
                                key={conv._id}
                                className={`cw-conv-item ${isActive ? 'active' : ''}`}
                                onClick={() => onSelectConversation(conv)}
                            >
                                <div className="cw-avatar-wrap">
                                    <div
                                        className="cw-avatar"
                                        style={{
                                            background: isGroup ? '#e0e7ff' : '#f1f5f9',
                                            color: isGroup ? '#4338ca' : '#1e293b',
                                        }}
                                    >
                                        {isGroup ? (
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                                <circle cx="9" cy="7" r="4" />
                                                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                                            </svg>
                                        ) : (
                                            initials
                                        )}
                                    </div>
                                    {!isGroup && (
                                        <span
                                            className={`cw-avatar-presence ${
                                                isPeerOnline ? 'cw-status-online' : 'cw-status-offline'
                                            }`}
                                        />
                                    )}
                                </div>

                                <div className="cw-conv-meta">
                                    <div className="cw-conv-row1">
                                        <div className="cw-conv-name" title={title}>
                                            {title}
                                        </div>
                                        <div className="cw-conv-time">
                                            {formatChatTime(conv.lastMessageAt || conv.updatedAt)}
                                        </div>
                                    </div>

                                    <div className="cw-conv-row2">
                                        <div className="cw-conv-preview">
                                            {conv.lastMessagePreview || 'No messages yet'}
                                        </div>
                                        {unread > 0 && (
                                            <span className="cw-conv-unread">
                                                {unread > 99 ? '99+' : unread}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};
