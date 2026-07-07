import type { Client } from '../types';

const BASE = import.meta.env.VITE_API_URL || '/steel/api';



async function handleResponse(res: Response) {
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'API Request failed');
    }
    return res.json();
}

export async function adminListClients(): Promise<{ count: number; clients: Client[] }> {
    const res = await fetch(`${BASE}/admin/clients`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse(res);
}

export async function adminCreateClient(data: { name: string; contacts: any[] }): Promise<{ client: Client }> {
    const res = await fetch(`${BASE}/admin/clients`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return handleResponse(res);
}

export async function adminUpdateClient(clientId: string, data: any): Promise<{ client: Client }> {
    const res = await fetch(`${BASE}/admin/clients/${String(clientId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return handleResponse(res);
}

export async function adminDeleteClient(clientId: string): Promise<{ message: string }> {
    const res = await fetch(`${BASE}/admin/clients/${String(clientId)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse(res);
}

export async function adminBulkCreateClients(file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    
    // For FormData, we must NOT set Content-Type: application/json. 
    // fetch will automatically set Content-Type: multipart/form-data with proper boundaries.
    
    const res = await fetch(`${BASE}/admin/clients/bulk`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
    });
    return handleResponse(res);
}
