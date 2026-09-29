const BASE = import.meta.env.VITE_API_URL || '/steel/api';



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
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ extractionIds: extractionIds || [], targetTransmittalNumber })
    });
    return handleResponse<any>(res);
}

export async function listTransmittals(projectId: string) {
    const res = await fetch(`${BASE}/transmittals/${projectId}`, {
        credentials: 'include'
    });
    return handleResponse<any>(res);
}

export async function previewTransmittal(projectId: string, extractionIds?: string[], targetTransmittalNumber?: number) {
    const res = await fetch(`${BASE}/transmittals/${projectId}/preview-changes`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ extractionIds: extractionIds || [], targetTransmittalNumber })
    });
    return handleResponse<any>(res);
}

export function getTransmittalExcelUrl(projectId: string, transmittalId: string): string {
    return `${BASE}/transmittals/${projectId}/${transmittalId}/excel`;
}

export function getDrawingLogExcelUrl(projectId: string, upToTransmittalNumber?: number): string {
    let url = `${BASE}/transmittals/${projectId}/drawing-log/excel`;
    if (upToTransmittalNumber) {
        url += `?upToTransmittalNumber=${upToTransmittalNumber}`;
    }
    return url;
}

export async function deleteTransmittal(projectId: string, transmittalId: string) {
    const res = await fetch(`${BASE}/transmittals/${projectId}/${transmittalId}`, {
        method: 'DELETE',
        credentials: 'include'
    });
    return handleResponse<any>(res);
}

export async function voidTransmittal(projectId: string, transmittalId: string) {
    const res = await fetch(`${BASE}/transmittals/${projectId}/${transmittalId}/void`, {
        method: 'PUT',
        credentials: 'include'
    });
    return handleResponse<any>(res);
}
