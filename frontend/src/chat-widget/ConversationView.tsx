/**
 * ============================================================
 * Chat Module: Conversation View Component
 * ============================================================
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { Conversation, ChatMessage, ChatAttachment } from './chatTypes';
import { fetchMessages, sendMessage, markAsRead, deleteMessage } from './chatApi';
import { MessageInput } from './MessageInput';

interface ConversationViewProps {
    conversation: Conversation;
    currentUserId: string;
    isOnline: boolean;
    typingUsers: string[];
    onBack: () => void;
    onTyping: () => void;
    onStopTyping: () => void;
    onMessageSent?: (msg: ChatMessage) => void;
    onMessageDeleted?: (messageId: string) => void;
    deletedMessageEvent?: { conversationId: string; messageId: string } | null;
}

function formatMsgTime(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateSeparator(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return 'Today';

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function isImageMime(mime: string, filename: string): boolean {
    if (mime?.startsWith('image/')) return true;
    return /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff)$/i.test(filename);
}

function getFileTypeBadge(filename: string): { label: string; className: string } {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') return { label: 'PDF', className: 'cw-badge-pdf' };
    if (['xls', 'xlsx', 'csv', 'xlsm', 'xlsb'].includes(ext)) return { label: ext.toUpperCase(), className: 'cw-badge-xls' };
    if (['doc', 'docx', 'rtf'].includes(ext)) return { label: ext.toUpperCase(), className: 'cw-badge-doc' };
    if (['ppt', 'pptx'].includes(ext)) return { label: ext.toUpperCase(), className: 'cw-badge-ppt' };
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return { label: ext.toUpperCase(), className: 'cw-badge-zip' };
    if (['dwg', 'dxf', 'dwf', 'ifc'].includes(ext)) return { label: ext.toUpperCase(), className: 'cw-badge-cad' };
    return { label: ext ? ext.toUpperCase() : 'FILE', className: 'cw-badge-file' };
}

function formatFileSize(bytes: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ConversationView: React.FC<ConversationViewProps> = ({
    conversation,
    currentUserId,
    isOnline,
    typingUsers,
    onBack,
    onTyping,
    onStopTyping,
    onMessageSent,
    onMessageDeleted,
    deletedMessageEvent,
}) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingOlder, setIsLoadingOlder] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [oldestCursor, setOldestCursor] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const streamRef = useRef<HTMLDivElement>(null);
    const isAtBottomRef = useRef(true);

    const isGroup = conversation.type === 'group';
    const peer = conversation.participantMeta?.find(p => String(p.id) !== String(currentUserId));
    const title = isGroup ? (conversation.name || 'Group Chat') : (peer?.displayName || peer?.username || 'Chat');

    // Scroll helpers
    const scrollToBottom = useCallback((smooth = true) => {
        if (streamRef.current) {
            streamRef.current.scrollTo({
                top: streamRef.current.scrollHeight,
                behavior: smooth ? 'smooth' : 'auto',
            });
        }
    }, []);

    const handleScroll = () => {
        if (!streamRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = streamRef.current;
        isAtBottomRef.current = scrollHeight - (scrollTop + clientHeight) < 50;
    };

    // Load initial messages and mark conversation as read
    useEffect(() => {
        let isMounted = true;
        setIsLoading(true);

        fetchMessages(conversation._id)
            .then(data => {
                if (!isMounted) return;
                setMessages(data.messages);
                setHasMore(data.hasMore);
                setOldestCursor(data.oldestCursor);
                setIsLoading(false);
                setTimeout(() => scrollToBottom(false), 50);
            })
            .catch(err => {
                console.error('Failed to load messages:', err);
                if (isMounted) setIsLoading(false);
            });

        // Mark as read
        markAsRead(conversation._id).catch(() => {});

        return () => {
            isMounted = false;
        };
    }, [conversation._id, scrollToBottom]);

    // Handle new incoming message dispatched via parent/socket
    useEffect(() => {
        // If message is for this conversation and last message isn't already in list
        if (conversation.lastMessage && !messages.some(m => m._id === conversation.lastMessage?._id)) {
            setMessages(prev => [...prev, conversation.lastMessage!]);
            if (isAtBottomRef.current) {
                setTimeout(() => scrollToBottom(true), 50);
            }
            markAsRead(conversation._id).catch(() => {});
        }
    }, [conversation.lastMessage, conversation._id, scrollToBottom]);

    // Handle real-time message deletion from socket
    useEffect(() => {
        if (deletedMessageEvent && deletedMessageEvent.conversationId === conversation._id) {
            setMessages(prev => prev.map(m => m._id === deletedMessageEvent.messageId ? {
                ...m,
                isDeleted: true,
                content: 'This message was deleted',
                attachments: [],
            } : m));
        }
    }, [deletedMessageEvent, conversation._id]);

    const handleLoadOlder = async () => {
        if (!oldestCursor || isLoadingOlder) return;
        setIsLoadingOlder(true);

        const currentScrollHeight = streamRef.current?.scrollHeight || 0;

        try {
            const data = await fetchMessages(conversation._id, oldestCursor);
            setMessages(prev => [...data.messages, ...prev]);
            setHasMore(data.hasMore);
            setOldestCursor(data.oldestCursor);

            // Preserve scroll position
            setTimeout(() => {
                if (streamRef.current) {
                    const newScrollHeight = streamRef.current.scrollHeight;
                    streamRef.current.scrollTop = newScrollHeight - currentScrollHeight;
                }
            }, 30);
        } catch (err) {
            console.error('Failed to load older messages:', err);
        } finally {
            setIsLoadingOlder(false);
        }
    };

    const handleSend = async (content: string, attachments: ChatAttachment[]) => {
        const newMsg = await sendMessage(conversation._id, { content, attachments });
        setMessages(prev => [...prev, newMsg]);
        setTimeout(() => scrollToBottom(true), 50);
        if (onMessageSent) onMessageSent(newMsg);
    };

    const handleDeleteMessage = async (msgId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm('Delete this message for everyone?')) return;
        setDeletingId(msgId);
        try {
            await deleteMessage(conversation._id, msgId);
            setMessages(prev => prev.map(m => m._id === msgId ? {
                ...m,
                isDeleted: true,
                content: 'This message was deleted',
                attachments: [],
            } : m));
            if (onMessageDeleted) onMessageDeleted(msgId);
        } catch (err: any) {
            console.error('Failed to delete message:', err);
            alert(err.message || 'Failed to delete message.');
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="cw-chat-view">
            {/* Header */}
            <div className="cw-chat-view-header">
                <button
                    className="cw-back-btn"
                    onClick={onBack}
                    title="Back to conversations"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                </button>

                <div className="cw-chat-view-info">
                    <div className="cw-chat-view-title">{title}</div>
                    <div className="cw-chat-view-sub">
                        {typingUsers.length > 0 ? (
                            <span style={{ color: 'var(--color-primary, #1e4fd8)', fontWeight: 600 }}>
                                {typingUsers.join(', ')} {typingUsers.length > 1 ? 'are' : 'is'} typing...
                            </span>
                        ) : isGroup ? (
                            <span>{conversation.participantMeta?.length || conversation.participants?.length || 2} members</span>
                        ) : (
                            <>
                                <span className={`cw-status-dot ${isOnline ? 'cw-status-online' : 'cw-status-offline'}`} />
                                <span>{isOnline ? 'Online' : 'Offline'}</span>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Message Stream */}
            <div
                className="cw-messages-stream"
                ref={streamRef}
                onScroll={handleScroll}
            >
                {hasMore && (
                    <button
                        className="cw-load-older-btn"
                        onClick={handleLoadOlder}
                        disabled={isLoadingOlder}
                    >
                        {isLoadingOlder ? 'Loading older...' : '↑ Load older messages'}
                    </button>
                )}

                {isLoading ? (
                    <div className="cw-empty-state">
                        <div className="cw-typing-dots">
                            <span className="cw-typing-dot" />
                            <span className="cw-typing-dot" />
                            <span className="cw-typing-dot" />
                        </div>
                    </div>
                ) : messages.length === 0 ? (
                    <div className="cw-empty-state">
                        <div className="cw-empty-title">No messages yet</div>
                        <div className="cw-empty-sub">Say hello to start the conversation!</div>
                    </div>
                ) : (
                    messages.map((msg, index) => {
                        const isOutgoing = String(msg.senderId) === String(currentUserId);
                        const prevMsg = messages[index - 1];
                        const showDate = !prevMsg || new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();
                        const isRead = isOutgoing && msg.readBy?.some(r => String(r.userId) !== String(currentUserId));

                        if (msg.isDeleted) {
                            return (
                                <React.Fragment key={msg._id || index}>
                                    {showDate && (
                                        <div className="cw-date-divider">
                                            {formatDateSeparator(msg.createdAt)}
                                        </div>
                                    )}
                                    <div className={`cw-msg-row ${isOutgoing ? 'cw-outgoing' : 'cw-incoming'}`}>
                                        {!isOutgoing && isGroup && (
                                            <div className="cw-msg-sender-name">
                                                {msg.senderName}
                                            </div>
                                        )}
                                        <div className="cw-msg-bubble-wrap">
                                            <div className="cw-msg-bubble cw-msg-bubble-deleted">
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" style={{ opacity: 0.7, flexShrink: 0 }}>
                                                    <circle cx="12" cy="12" r="10" />
                                                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                                </svg>
                                                <span>This message was deleted</span>
                                            </div>
                                        </div>
                                        <div className="cw-msg-footer">
                                            <span>{formatMsgTime(msg.createdAt)}</span>
                                        </div>
                                    </div>
                                </React.Fragment>
                            );
                        }

                        return (
                            <React.Fragment key={msg._id || index}>
                                {showDate && (
                                    <div className="cw-date-divider">
                                        {formatDateSeparator(msg.createdAt)}
                                    </div>
                                )}

                                <div className={`cw-msg-row ${isOutgoing ? 'cw-outgoing' : 'cw-incoming'}`}>
                                    {!isOutgoing && isGroup && (
                                        <div className="cw-msg-sender-name">
                                            {msg.senderName}
                                        </div>
                                    )}
                                    <div className="cw-msg-bubble-wrap">
                                        <div className="cw-msg-bubble">
                                            {msg.content && <div style={{ marginBottom: msg.attachments?.length ? 6 : 0 }}>{msg.content}</div>}

                                            {/* Attachments */}
                                            {msg.attachments?.map((att, attIdx) => {
                                                const isImg = isImageMime(att.mimetype, att.filename);
                                                const backendOrigin = window.location.hostname === 'localhost' ? 'http://localhost:5000' : window.location.origin;
                                                const fileUrl = att.url?.startsWith('http') ? att.url : `${backendOrigin}${att.url}`;

                                                if (isImg) {
                                                    return (
                                                        <a
                                                            key={attIdx}
                                                            href={fileUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ display: 'block' }}
                                                        >
                                                            <img
                                                                src={fileUrl}
                                                                alt={att.originalName || att.filename}
                                                                className="cw-attachment-img"
                                                            />
                                                        </a>
                                                    );
                                                }

                                                const badge = getFileTypeBadge(att.originalName || att.filename);
                                                return (
                                                    <a
                                                        key={attIdx}
                                                        href={fileUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="cw-attachment-card"
                                                        title={`Open ${att.originalName || att.filename}`}
                                                    >
                                                        <span className={`cw-attach-badge ${badge.className}`}>{badge.label}</span>
                                                        <span style={{ fontSize: '12px', fontWeight: 600, maxWidth: '170px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {att.originalName || att.filename}
                                                        </span>
                                                        {att.size > 0 && (
                                                            <span style={{ fontSize: '10.5px', opacity: 0.75 }}>
                                                                ({formatFileSize(att.size)})
                                                            </span>
                                                        )}
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" style={{ marginLeft: 'auto', opacity: 0.7, flexShrink: 0 }}>
                                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                            <polyline points="7 10 12 15 17 10" />
                                                            <line x1="12" y1="15" x2="12" y2="3" />
                                                        </svg>
                                                    </a>
                                                );
                                            })}
                                        </div>

                                        {isOutgoing && (
                                            <button
                                                type="button"
                                                className="cw-msg-delete-btn"
                                                title="Delete message for everyone"
                                                onClick={(e) => handleDeleteMessage(msg._id, e)}
                                                disabled={deletingId === msg._id}
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                                                    <polyline points="3 6 5 6 21 6" />
                                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>

                                    <div className="cw-msg-footer">
                                        <span>{formatMsgTime(msg.createdAt)}</span>
                                        {isOutgoing && (
                                            <span className={isRead ? 'cw-read-check' : ''}>
                                                {isRead ? '✓✓' : '✓'}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </React.Fragment>
                        );
                    })
                )}
            </div>

            {/* Typing Indicator */}
            {typingUsers.length > 0 && (
                <div className="cw-typing-indicator">
                    <div className="cw-typing-dots">
                        <span className="cw-typing-dot" />
                        <span className="cw-typing-dot" />
                        <span className="cw-typing-dot" />
                    </div>
                    <span>{typingUsers.join(', ')} typing...</span>
                </div>
            )}

            {/* Input Bar */}
            <MessageInput
                onSendMessage={handleSend}
                onTyping={onTyping}
                onStopTyping={onStopTyping}
                disabled={isLoading}
            />
        </div>
    );
};
