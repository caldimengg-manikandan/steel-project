/**
 * ============================================================
 * Chat Module: API Client
 * ============================================================
 */
import type { Conversation, ChatMessage, PeerUser, ChatAttachment } from './chatTypes';

const BASE = import.meta.env.VITE_API_URL || '/steel/api';

export async function getSocketToken(): Promise<string> {
    try {
        const res = await fetch(`${BASE}/chat/token`, {
            credentials: 'include',
            headers: getAuthHeaders(),
        });
        if (res.ok) {
            const data = await res.json();
            if (data.token) {
                localStorage.setItem('token', data.token);
                return data.token;
            }
        }
    } catch (e) {
        console.warn('[Chat] Could not fetch fresh socket token:', e);
    }
    return localStorage.getItem('token') || '';
}

function getAuthHeaders(isJson = true): HeadersInit {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {};
    if (isJson) {
        headers['Content-Type'] = 'application/json';
    }
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
        let errMsg = 'Chat request failed';
        try {
            const data = await res.json();
            errMsg = data.error || errMsg;
        } catch { }
        throw new Error(errMsg);
    }
    return res.json();
}

export async function fetchConversations(): Promise<Conversation[]> {
    const res = await fetch(`${BASE}/chat/conversations`, {
        credentials: 'include',
        headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ success: boolean; conversations: Conversation[] }>(res);
    return data.conversations || [];
}

export async function createConversation(payload: {
    type: 'direct' | 'group';
    participantIds: string[];
    name?: string;
}): Promise<Conversation> {
    const res = await fetch(`${BASE}/chat/conversations`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
    });
    const data = await handleResponse<{ success: boolean; conversation: Conversation }>(res);
    return data.conversation;
}

export async function fetchMessages(
    conversationId: string,
    before?: string
): Promise<{ messages: ChatMessage[]; hasMore: boolean; oldestCursor: string | null }> {
    const url = new URL(`${window.location.origin}${BASE}/chat/conversations/${conversationId}/messages`);
    url.searchParams.set('limit', '30');
    if (before) {
        url.searchParams.set('before', before);
    }

    const res = await fetch(url.toString(), {
        credentials: 'include',
        headers: getAuthHeaders(),
    });
    return handleResponse<{ success: boolean; messages: ChatMessage[]; hasMore: boolean; oldestCursor: string | null }>(res);
}

export async function sendMessage(
    conversationId: string,
    payload: { content: string; attachments?: ChatAttachment[] }
): Promise<ChatMessage> {
    const res = await fetch(`${BASE}/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
    });
    const data = await handleResponse<{ success: boolean; message: ChatMessage }>(res);
    return data.message;
}

export async function markAsRead(conversationId: string): Promise<void> {
    const res = await fetch(`${BASE}/chat/conversations/${conversationId}/read`, {
        method: 'PATCH',
        credentials: 'include',
        headers: getAuthHeaders(),
    });
    await handleResponse<{ success: boolean }>(res);
}

export async function searchUsers(q = ''): Promise<PeerUser[]> {
    const url = new URL(`${window.location.origin}${BASE}/chat/users`);
    if (q) url.searchParams.set('q', q);

    const res = await fetch(url.toString(), {
        credentials: 'include',
        headers: getAuthHeaders(),
    });
    const data = await handleResponse<{ success: boolean; users: PeerUser[] }>(res);
    return data.users || [];
}

export async function uploadAttachment(file: File): Promise<ChatAttachment> {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${BASE}/chat/upload`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(false),
        body: formData,
    });
    const data = await handleResponse<{ success: boolean; attachment: ChatAttachment }>(res);
    return data.attachment;
}
