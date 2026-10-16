const BASE = import.meta.env.VITE_API_URL || '/steel/api';

function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
    const token = localStorage.getItem('token');
    return {
        ...extraHeaders,
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
}

async function handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
}

export async function generateTransmittal(projectId: string, extractionIds?: string[], targetTransmittalNumber?: number) {
    const res = await fetch(`${BASE}/transmittals/${projectId}/generate`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders({
            'Content-Type': 'application/json'
        }),
        body: JSON.stringify({ extractionIds: extractionIds || [], targetTransmittalNumber })
    });
    return handleResponse<any>(res);
}

export async function listTransmittals(projectId: string) {
    const res = await fetch(`${BASE}/transmittals/${projectId}`, {
        credentials: 'include',
        headers: getAuthHeaders()
    });
    return handleResponse<any>(res);
}

export async function previewTransmittal(projectId: string, extractionIds?: string[], targetTransmittalNumber?: number) {
    const res = await fetch(`${BASE}/transmittals/${projectId}/preview-changes`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders({
            'Content-Type': 'application/json'
        }),
        body: JSON.stringify({ extractionIds: extractionIds || [], targetTransmittalNumber })
    });
    return handleResponse<any>(res);
}

export function getTransmittalExcelUrl(projectId: string, transmittalId: string): string {
    const token = localStorage.getItem('token');
    const q = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${BASE}/transmittals/${projectId}/${transmittalId}/excel${q}`;
}

export function getDrawingLogExcelUrl(projectId: string, upToTransmittalNumber?: number): string {
    let url = `${BASE}/transmittals/${projectId}/drawing-log/excel`;
    const params: string[] = [];
    if (upToTransmittalNumber) {
        params.push(`upToTransmittalNumber=${upToTransmittalNumber}`);
    }
    const token = localStorage.getItem('token');
    if (token) {
        params.push(`token=${encodeURIComponent(token)}`);
    }
    if (params.length > 0) {
        url += `?${params.join('&')}`;
    }
    return url;
}

export async function deleteTransmittal(projectId: string, transmittalId: string) {
    const res = await fetch(`${BASE}/transmittals/${projectId}/${transmittalId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders()
    });
    return handleResponse<any>(res);
}

export async function voidTransmittal(projectId: string, transmittalId: string) {
    const res = await fetch(`${BASE}/transmittals/${projectId}/${transmittalId}/void`, {
        method: 'PUT',
        credentials: 'include',
        headers: getAuthHeaders()
    });
    return handleResponse<any>(res);
}
