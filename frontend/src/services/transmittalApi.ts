const BASE = import.meta.env.VITE_API_URL || 'https://steel-dms-backend.onrender.com/api';

function getToken(): string {
    try {
        const u = sessionStorage.getItem('sdms_user');
        return u ? JSON.parse(u).token ?? '' : '';
    } catch {
        return '';
    }
}

async function handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
}

export async function generateTransmittal(projectId: string, extractionIds?: string[], targetTransmittalNumber?: number) {
    const token = getToken();
    const res = await fetch(`${BASE}/transmittals/${projectId}/generate`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ extractionIds: extractionIds || [], targetTransmittalNumber })
    });
    return handleResponse<any>(res);
}

export async function listTransmittals(projectId: string) {
    const token = getToken();
    const res = await fetch(`${BASE}/transmittals/${projectId}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return handleResponse<any>(res);
}

export async function previewTransmittal(projectId: string, extractionIds?: string[], targetTransmittalNumber?: number) {
    const token = getToken();
    const res = await fetch(`${BASE}/transmittals/${projectId}/preview-changes`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ extractionIds: extractionIds || [], targetTransmittalNumber })
    });
    return handleResponse<any>(res);
}

export function getTransmittalExcelUrl(projectId: string, transmittalId: string): string {
    const t = getToken();
    return `${BASE}/transmittals/${projectId}/${transmittalId}/excel?token=${encodeURIComponent(t)}`;
}

export function getDrawingLogExcelUrl(projectId: string): string {
    const t = getToken();
    return `${BASE}/transmittals/${projectId}/drawing-log/excel?token=${encodeURIComponent(t)}`;
}

export async function deleteTransmittal(projectId: string, transmittalId: string) {
    const token = getToken();
    const res = await fetch(`${BASE}/transmittals/${projectId}/${transmittalId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
    });
    return handleResponse<any>(res);
}
