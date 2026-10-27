import { BASE, fetchWithAuth, handleResponse } from './apiClient';

export interface Team {
    _id: string;
    id: string;
    name: string;
    project_manager?: any;
    assistant_project_manager?: any;
    lead: any;
    members: any[];
    users?: any[];
    createdAt: string;
}

export async function adminCreateTeam(payload: {
    name: string;
    project_manager?: string;
    assistant_project_manager?: string;
    lead: string[];
    members: string[];
}) {
    const res = await fetchWithAuth(`${BASE}/admin/teams`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return handleResponse(res);
}

export async function adminListTeams() {
    const res = await fetchWithAuth(`${BASE}/admin/teams`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    });
    return handleResponse(res);
}

export async function adminDeleteTeam(id: string) {
    const res = await fetchWithAuth(`${BASE}/admin/teams/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    });
    return handleResponse(res);
}

export async function adminUpdateTeam(id: string, payload: {
    name: string;
    project_manager?: string;
    assistant_project_manager?: string;
    lead: string[];
    members: string[];
}) {
    const res = await fetchWithAuth(`${BASE}/admin/teams/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return handleResponse(res);
}
