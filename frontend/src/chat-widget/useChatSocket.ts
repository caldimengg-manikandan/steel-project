/**
 * ============================================================
 * Chat Module: Socket.IO & Notification Hook
 * ============================================================
 * Single socket connection per user session.
 * Manages presence, typing events, audio chime, and desktop alerts.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ChatMessage, Conversation } from './chatTypes';
import { getSocketToken } from './chatApi';

// Web Audio API Synthesized Chime (zero external asset dependency)
export function playChatChime() {
    try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        // Two-tone pleasant ping
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08); // A5

        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.32);
    } catch { }
}

export function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }
}

export function showDesktopNotification(title: string, body: string) {
    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            new Notification(title, { body, silent: true });
        } catch { }
    }
}

let globalSocket: Socket | null = null;

export function useChatSocket(
    userId: string | undefined,
    currentConversationId: string | null,
    isPanelOpen: boolean,
    isMuted: boolean,
    onNewMessage?: (message: ChatMessage) => void,
    onConversationUpdated?: (update: { conversationId: string; lastMessage: ChatMessage; unreadCount: number }) => void,
    onConversationCreated?: (conv: Conversation) => void,
    onMessagesRead?: (data: { conversationId: string; readerId: string }) => void
) {
    const [isConnected, setIsConnected] = useState(false);
    const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
    const [typingUsers, setTypingUsers] = useState<{ [conversationId: string]: string[] }>({});

    const currentConvRef = useRef(currentConversationId);
    currentConvRef.current = currentConversationId;

    const isPanelOpenRef = useRef(isPanelOpen);
    isPanelOpenRef.current = isPanelOpen;

    const isMutedRef = useRef(isMuted);
    isMutedRef.current = isMuted;

    useEffect(() => {
        if (!userId) {
            if (globalSocket) {
                globalSocket.disconnect();
                globalSocket = null;
            }
            setIsConnected(false);
            return;
        }

        let isMounted = true;

        function handlePresence({ userId: targetUserId, status }: { userId: string; status: 'online' | 'offline' }) {
            setOnlineUsers(prev => {
                const next = new Set(prev);
                if (status === 'online') {
                    next.add(targetUserId);
                } else {
                    next.delete(targetUserId);
                }
                return next;
            });
        }

        function handleTyping({ conversationId, username }: { conversationId: string; userId: string; username: string }) {
            setTypingUsers(prev => {
                const list = prev[conversationId] || [];
                if (!list.includes(username)) {
                    return { ...prev, [conversationId]: [...list, username] };
                }
                return prev;
            });
        }

        function handleStopTyping({ conversationId, userId: stoppedUserId }: { conversationId: string; userId: string }) {
            setTypingUsers(prev => {
                const list = prev[conversationId] || [];
                return { ...prev, [conversationId]: list.filter(u => u !== stoppedUserId) };
            });
        }

        function handleNewMessage(message: ChatMessage) {
            const isFromOther = message.senderId !== userId;
            const isCurrentConv = currentConvRef.current === message.conversationId;

            if (isFromOther) {
                if (!isMutedRef.current) {
                    playChatChime();
                }

                if (!isPanelOpenRef.current || !isCurrentConv || document.hidden) {
                    showDesktopNotification(
                        `Message from ${message.senderName}`,
                        message.content || 'Sent an attachment'
                    );
                }
            }

            if (onNewMessage) onNewMessage(message);
        }

        function handleConvUpdate(update: { conversationId: string; lastMessage: ChatMessage; unreadCount: number }) {
            if (onConversationUpdated) onConversationUpdated(update);
        }

        function handleConvCreated(conv: Conversation) {
            if (onConversationCreated) onConversationCreated(conv);
        }

        function handleRead(data: { conversationId: string; readerId: string }) {
            if (onMessagesRead) onMessagesRead(data);
        }

        function handleConnect() {
            setIsConnected(true);
            globalSocket?.emit('get_online_users', (onlineIds: string[]) => {
                if (Array.isArray(onlineIds)) {
                    setOnlineUsers(new Set(onlineIds));
                }
            });
        }

        function handleDisconnect() {
            setIsConnected(false);
        }

        async function handleConnectError(err: Error) {
            console.warn('[ChatSocket] Connect error:', err.message);
            setIsConnected(false);
            if (err.message && err.message.toLowerCase().includes('authentication')) {
                const freshToken = await getSocketToken();
                if (freshToken && globalSocket?.auth) {
                    globalSocket.auth = { token: freshToken };
                    globalSocket.connect();
                }
            }
        }

        async function init() {
            let token = localStorage.getItem('token') || '';
            if (!token) {
                token = await getSocketToken();
            }

            if (!isMounted) return;

            const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;

            if (!globalSocket) {
                globalSocket = io(socketUrl, {
                    path: '/socket.io',
                    transports: ['websocket', 'polling'],
                    auth: { token },
                    query: { token },
                    withCredentials: true,
                    reconnection: true,
                    reconnectionAttempts: 25,
                    reconnectionDelay: 1000,
                });
            } else if (token && globalSocket.auth) {
                globalSocket.auth = { token };
                if (!globalSocket.connected) {
                    globalSocket.connect();
                }
            }

            const socket = globalSocket;
            socket.on('connect', handleConnect);
            socket.on('disconnect', handleDisconnect);
            socket.on('connect_error', handleConnectError);
            socket.on('user_presence', handlePresence);
            socket.on('user_typing', handleTyping);
            socket.on('user_stopped_typing', handleStopTyping);
            socket.on('new_message', handleNewMessage);
            socket.on('conversation_updated', handleConvUpdate);
            socket.on('conversation_created', handleConvCreated);
            socket.on('messages_read', handleRead);

            if (socket.connected) {
                handleConnect();
            }
        }

        init();

        return () => {
            isMounted = false;
            if (globalSocket) {
                globalSocket.off('connect', handleConnect);
                globalSocket.off('disconnect', handleDisconnect);
                globalSocket.off('connect_error', handleConnectError);
                globalSocket.off('user_presence', handlePresence);
                globalSocket.off('user_typing', handleTyping);
                globalSocket.off('user_stopped_typing', handleStopTyping);
                globalSocket.off('new_message', handleNewMessage);
                globalSocket.off('conversation_updated', handleConvUpdate);
                globalSocket.off('conversation_created', handleConvCreated);
                globalSocket.off('messages_read', handleRead);
            }
        };
    }, [userId]);

    // Room join/leave for active conversation
    useEffect(() => {
        if (!globalSocket || !currentConversationId) return;

        globalSocket.emit('join_conversation', { conversationId: currentConversationId });

        return () => {
            globalSocket?.emit('leave_conversation', { conversationId: currentConversationId });
        };
    }, [currentConversationId]);

    const emitTyping = useCallback((conversationId: string) => {
        if (globalSocket?.connected) {
            globalSocket.emit('typing', { conversationId });
        }
    }, []);

    const emitStopTyping = useCallback((conversationId: string) => {
        if (globalSocket?.connected) {
            globalSocket.emit('stop_typing', { conversationId });
        }
    }, []);

    return {
        isConnected,
        onlineUsers,
        typingUsers: currentConversationId ? (typingUsers[currentConversationId] || []) : [],
        emitTyping,
        emitStopTyping,
    };
}
