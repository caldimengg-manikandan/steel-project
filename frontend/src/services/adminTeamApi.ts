const BASE = import.meta.env.VITE_API_URL || '/steel/api';

async function handleResponse(res: Response) {
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'API Request failed');
    }
    return res.json();
}

export interface Team {
    _id: string;
    id: string;
    name: string;
    lead: any;
    members: any[];
    createdAt: string;
}

export async function adminCreateTeam(payload: { name: string; lead: string[]; members: string[] }) {
    const res = await fetch(`${BASE}/admin/teams`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return handleResponse(res);
}

export async function adminListTeams() {
    const res = await fetch(`${BASE}/admin/teams`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    });
    return handleResponse(res);
}

export async function adminDeleteTeam(id: string) {
    const res = await fetch(`${BASE}/admin/teams/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    });
    return handleResponse(res);
}

export async function adminUpdateTeam(id: string, payload: { name: string; lead: string[]; members: string[] }) {
    const res = await fetch(`${BASE}/admin/teams/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return handleResponse(res);
}
