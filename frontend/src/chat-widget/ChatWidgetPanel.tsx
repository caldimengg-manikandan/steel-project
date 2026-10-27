/**
 * ============================================================
 * Chat Module: Chat Widget Panel Component
 * ============================================================
 * Zoho Cliq–style floating panel container with header, views,
 * real-time socket events, sound alerts, and unread counts.
 */
import React, { useState, useEffect, useCallback } from 'react';
import type { Conversation, ChatMessage } from './chatTypes';
import { fetchConversations } from './chatApi';
import { useChatSocket, requestNotificationPermission } from './useChatSocket';
import { ConversationList } from './ConversationList';
import { ConversationView } from './ConversationView';
import { NewChatModal } from './NewChatModal';

interface ChatWidgetPanelProps {
    currentUserId: string;
    isOpen: boolean;
    onClose: () => void;
    onMinimize: () => void;
    onUnreadCountChange: (count: number) => void;
}

export const ChatWidgetPanel: React.FC<ChatWidgetPanelProps> = ({
    currentUserId,
    isOpen,
    onClose,
    onMinimize,
    onUnreadCountChange,
}) => {
    const [view, setView] = useState<'list' | 'view' | 'new'>('list');
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [deletedMessageEvent, setDeletedMessageEvent] = useState<{ conversationId: string; messageId: string } | null>(null);
    const [isMuted, setIsMuted] = useState(() => {
        try {
            return localStorage.getItem('cw_is_muted') === 'true';
        } catch {
            return false;
        }
    });

    const toggleMute = () => {
        setIsMuted(prev => {
            const next = !prev;
            try {
                localStorage.setItem('cw_is_muted', String(next));
            } catch { }
            return next;
        });
    };

    // Calculate total unread count
    const calculateTotalUnread = useCallback((convs: Conversation[]) => {
        const total = convs.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
        onUnreadCountChange(total);
    }, [onUnreadCountChange]);

    // Refresh conversation list from backend
    const loadConversations = useCallback(async () => {
        try {
            const list = await fetchConversations();
            setConversations(list);
            calculateTotalUnread(list);
        } catch (err) {
            console.error('Failed to load conversations:', err);
        }
    }, [calculateTotalUnread]);

    useEffect(() => {
        if (isOpen) {
            loadConversations();
            requestNotificationPermission();
        }
    }, [isOpen, loadConversations]);

    // Socket Event Callbacks
    const handleNewMessage = useCallback((message: ChatMessage) => {
        setConversations(prev => {
            const index = prev.findIndex(c => c._id === message.conversationId);
            if (index === -1) {
                // Not in current list, reload from API
                loadConversations();
                return prev;
            }

            const updated = [...prev];
            const target = { ...updated[index] };
            target.lastMessage = message;
            target.lastMessagePreview = message.content || '📎 Attachment';
            target.lastMessageAt = message.createdAt;

            // If message is from someone else and this conversation is not currently active, increment unread
            if (message.senderId !== currentUserId && activeConversation?._id !== message.conversationId) {
                target.unreadCount = (target.unreadCount || 0) + 1;
            }

            // Move to top of list
            updated.splice(index, 1);
            updated.unshift(target);

            calculateTotalUnread(updated);
            return updated;
        });

        // Also update active conversation state if current
        setActiveConversation(prev => {
            if (prev && prev._id === message.conversationId) {
                return {
                    ...prev,
                    lastMessage: message,
                    lastMessagePreview: message.content || '📎 Attachment',
                    lastMessageAt: message.createdAt,
                    unreadCount: 0,
                };
            }
            return prev;
        });
    }, [currentUserId, activeConversation?._id, loadConversations, calculateTotalUnread]);

    const handleConversationUpdated = useCallback((update: { conversationId: string; lastMessage: ChatMessage; unreadCount: number }) => {
        setConversations(prev => {
            const index = prev.findIndex(c => c._id === update.conversationId);
            if (index === -1) {
                loadConversations();
                return prev;
            }
            const updated = [...prev];
            const target = { ...updated[index] };
            target.lastMessage = update.lastMessage;
            target.lastMessagePreview = update.lastMessage.content || '📎 Attachment';
            target.lastMessageAt = update.lastMessage.createdAt;
            target.unreadCount = update.unreadCount;

            updated.splice(index, 1);
            updated.unshift(target);

            calculateTotalUnread(updated);
            return updated;
        });
    }, [loadConversations, calculateTotalUnread]);

    const handleConversationCreated = useCallback((newConv: Conversation) => {
        setConversations(prev => {
            const exists = prev.some(c => c._id === newConv._id);
            if (exists) return prev;
            const updated = [newConv, ...prev];
            calculateTotalUnread(updated);
            return updated;
        });
    }, [calculateTotalUnread]);

    const handleMessageDeleted = useCallback((data: { conversationId: string; messageId: string }) => {
        setDeletedMessageEvent(data);
        setConversations(prev => {
            const index = prev.findIndex(c => c._id === data.conversationId);
            if (index === -1) return prev;
            const target = prev[index];
            if (target.lastMessage?._id === data.messageId) {
                loadConversations();
            }
            return prev;
        });
    }, [loadConversations]);

    // Socket Hook
    const { isConnected, onlineUsers, typingUsers, emitTyping, emitStopTyping } = useChatSocket(
        currentUserId,
        activeConversation?._id || null,
        isOpen,
        isMuted,
        handleNewMessage,
        handleConversationUpdated,
        handleConversationCreated,
        undefined,
        handleMessageDeleted
    );

    const handleSelectConversation = (conv: Conversation) => {
        // Reset unread count locally
        setConversations(prev => {
            const updated = prev.map(c => (c._id === conv._id ? { ...c, unreadCount: 0 } : c));
            calculateTotalUnread(updated);
            return updated;
        });
        setActiveConversation({ ...conv, unreadCount: 0 });
        setView('view');
    };

    const handleBackToList = () => {
        setView('list');
        setActiveConversation(null);
        loadConversations();
    };

    if (!isOpen) return null;

    return (
        <div className="cw-panel" role="dialog" aria-label="Messages Panel">
            {/* Header */}
            <div className="cw-header">
                <div className="cw-header-title-box">
                    <div className="cw-header-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16">
                            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        </svg>
                    </div>
                    <div>
                        <div className="cw-header-title">Messages</div>
                        <div className="cw-header-subtitle">
                            <span
                                className={`cw-status-dot ${isConnected ? 'cw-status-online' : 'cw-status-offline'}`}
                                style={!isConnected ? { background: '#f59e0b' } : {}}
                            />
                            <span>{isConnected ? 'Connected' : 'Connecting...'}</span>
                        </div>
                    </div>
                </div>

                <div className="cw-header-actions">
                    {/* Mute Chime Toggle */}
                    <button
                        className="cw-header-btn"
                        onClick={toggleMute}
                        title={isMuted ? 'Unmute notification sound' : 'Mute notification sound'}
                        aria-label={isMuted ? 'Unmute' : 'Mute'}
                    >
                        {isMuted ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                                <line x1="23" y1="9" x2="17" y2="15" />
                                <line x1="17" y1="9" x2="23" y2="15" />
                            </svg>
                        ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                            </svg>
                        )}
                    </button>

                    {/* Minimize */}
                    <button
                        className="cw-header-btn"
                        onClick={onMinimize}
                        title="Minimize chat"
                        aria-label="Minimize"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </button>

                    {/* Close */}
                    <button
                        className="cw-header-btn"
                        onClick={onClose}
                        title="Close chat"
                        aria-label="Close"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Search Input when in list view */}
            {view === 'list' && (
                <div className="cw-search-wrap">
                    <div className="cw-search-input-box">
                        <svg
                            className="cw-search-icon"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            width="14"
                            height="14"
                        >
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <input
                            type="text"
                            className="cw-search-input"
                            placeholder="Search recent conversations..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
            )}

            {/* Body Views */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {view === 'list' && (
                    <ConversationList
                        conversations={conversations}
                        currentUserId={currentUserId}
                        activeConversationId={activeConversation?._id || null}
                        onlineUsers={onlineUsers}
                        searchQuery={searchQuery}
                        onSelectConversation={handleSelectConversation}
                        onOpenNewChat={() => setView('new')}
                    />
                )}

                {view === 'view' && activeConversation && (
                    <ConversationView
                        conversation={activeConversation}
                        currentUserId={currentUserId}
                        isOnline={
                            activeConversation.type === 'direct' &&
                            Boolean(
                                activeConversation.participantMeta
                                    ?.filter(p => String(p.id) !== String(currentUserId))
                                    .some(p => onlineUsers.has(String(p.id)))
                            )
                        }
                        typingUsers={typingUsers}
                        onBack={handleBackToList}
                        onTyping={() => emitTyping(activeConversation._id)}
                        onStopTyping={() => emitStopTyping(activeConversation._id)}
                        onMessageSent={msg => {
                            // Update last message in list
                            setConversations(prev => {
                                const updated = prev.map(c =>
                                    c._id === activeConversation._id
                                        ? { ...c, lastMessage: msg, lastMessagePreview: msg.content || '📎 Attachment', lastMessageAt: msg.createdAt }
                                        : c
                                );
                                return updated;
                            });
                        }}
                        deletedMessageEvent={deletedMessageEvent}
                        onMessageDeleted={() => {
                            loadConversations();
                        }}
                    />
                )}

                {view === 'new' && (
                    <NewChatModal
                        onBack={() => setView('list')}
                        onConversationCreated={conv => {
                            handleConversationCreated(conv);
                            handleSelectConversation(conv);
                        }}
                    />
                )}
            </div>
        </div>
    );
};
