import type { Client } from '../types';
import { BASE, fetchWithAuth, handleResponse } from './apiClient';

export async function adminListClients(): Promise<{ count: number; clients: Client[] }> {
    const res = await fetchWithAuth(`${BASE}/admin/clients`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse(res);
}

export async function adminCreateClient(data: { name: string; contacts: any[] }): Promise<{ client: Client }> {
    const res = await fetchWithAuth(`${BASE}/admin/clients`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return handleResponse(res);
}

export async function adminUpdateClient(clientId: string, data: any): Promise<{ client: Client }> {
    const res = await fetchWithAuth(`${BASE}/admin/clients/${String(clientId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return handleResponse(res);
}

export async function adminDeleteClient(clientId: string): Promise<{ message: string }> {
    const res = await fetchWithAuth(`${BASE}/admin/clients/${String(clientId)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse(res);
}

export async function adminBulkCreateClients(file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    
    const res = await fetchWithAuth(`${BASE}/admin/clients/bulk`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
    });
    return handleResponse(res);
}
