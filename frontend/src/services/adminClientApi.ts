import type { Client } from '../types';

const BASE = import.meta.env.VITE_API_URL || 'https://steel-dms-backend.onrender.com/api';

function authHeaders(): Record<string, string> {
    const stored = sessionStorage.getItem('sdms_user');
    const user = stored ? JSON.parse(stored) : null;
    return {
        'Authorization': `Bearer ${user?.token || ''}`,
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

export async function adminListClients(): Promise<{ count: number; clients: Client[] }> {
    const res = await fetch(`${BASE}/admin/clients`, {
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export async function adminCreateClient(data: { name: string; contacts: any[] }): Promise<{ client: Client }> {
    const res = await fetch(`${BASE}/admin/clients`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(data),
    });
    return handleResponse(res);
}

export async function adminUpdateClient(clientId: string, data: any): Promise<{ client: Client }> {
    const res = await fetch(`${BASE}/admin/clients/${clientId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(data),
    });
    return handleResponse(res);
}

export async function adminDeleteClient(clientId: string): Promise<{ message: string }> {
    const res = await fetch(`${BASE}/admin/clients/${clientId}`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export async function adminBulkCreateClients(file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    
    // For FormData, we must NOT set Content-Type: application/json. 
    // fetch will automatically set Content-Type: multipart/form-data with proper boundaries.
    const stored = sessionStorage.getItem('sdms_user');
    const user = stored ? JSON.parse(stored) : null;
    
    const res = await fetch(`${BASE}/admin/clients/bulk`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${user?.token || ''}`
        },
        body: formData,
    });
    return handleResponse(res);
}
