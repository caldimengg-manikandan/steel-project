/**
 * Centralized API Client with automatic JWT Bearer token attachment and credentials handling.
 */

const BASE = import.meta.env.VITE_API_URL || '/steel/api';

export function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    return {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...extraHeaders,
    };
}

export function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    const headers = new Headers(options.headers || {});
    if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    return fetch(url, {
        ...options,
        credentials: options.credentials || 'include',
        headers,
    });
}

export async function handleResponse<T = any>(res: Response): Promise<T> {
    const text = await res.text();
    let data: any;
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        if (!res.ok) throw new Error(`API Error ${res.status}: ${text || res.statusText}`);
        throw new Error('Malformed JSON response from server');
    }

    if (!res.ok) {
        throw new Error(data.error || data.message || `API Request failed (${res.status})`);
    }
    return data as T;
}

export { BASE };
