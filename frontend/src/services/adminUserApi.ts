import type { AuthUser, User } from '../types';

const BASE = import.meta.env.VITE_API_URL || '/api';

function authHeaders(): Record<string, string> {
    const stored = sessionStorage.getItem('sdms_user');
    if (!stored) return {};
    const user: AuthUser = JSON.parse(stored);
    return {
        'Authorization': `Bearer ${user.token || ''}`,
        'Content-Type': 'application/json',
    };
}

async function handleResponse(res: Response) {
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'API Request failed');
    }
    return res.json();
}

/**
 * List all users belonging to this admin
 */
export async function adminListUsers(): Promise<{ users: User[] }> {
    const res = await fetch(`${BASE}/admin/users`, {
        headers: authHeaders(),
    });
    return handleResponse(res);
}

/**
 * Create a new user
 */
export async function adminCreateUser(data: {
    username: string;
    email: string;
    password: string;
    displayName?: string;
}): Promise<{ user: User }> {
    const res = await fetch(`${BASE}/admin/users`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(data),
    });
    return handleResponse(res);
}

/**
 * Update user status or details
 */
export async function adminUpdateUser(userId: string, data: Partial<User> & { password?: string }): Promise<{ user: User }> {
    const res = await fetch(`${BASE}/admin/users/${userId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(data),
    });
    return handleResponse(res);
}

/**
 * Delete a user
 */
export async function adminDeleteUser(userId: string): Promise<{ message: string }> {
    const res = await fetch(`${BASE}/admin/users/${userId}`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

/**
 * Get headers for multipart/form-data (exclude Content-Type)
 */
function authMultipartHeaders(): Record<string, string> {
    const stored = sessionStorage.getItem('sdms_user');
    if (!stored) return {};
    const user: AuthUser = JSON.parse(stored);
    return {
        'Authorization': `Bearer ${user.token || ''}`,
    };
}

/**
 * Bulk create users via Excel
 */
export async function adminBulkCreateUsers(file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${BASE}/admin/users/bulk`, {
        method: 'POST',
        headers: authMultipartHeaders(),
        body: formData,
    });
    return handleResponse(res);
}

/**
 * Get dashboard stats
 */
export async function adminGetDashboardStats(): Promise<any> {
    const res = await fetch(`${BASE}/admin/dashboard/stats`, {
        headers: authHeaders(),
    });
    return handleResponse(res);
}
/**
 * Get aggregated reports data
 */
export async function adminGetReportsData(days: number = 30): Promise<any> {
    const res = await fetch(`${BASE}/admin/reports?days=${days}`, {
        headers: authHeaders(),
    });
    return handleResponse(res);
}
