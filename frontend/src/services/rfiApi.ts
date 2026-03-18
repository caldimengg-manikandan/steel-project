/**
 * RFI API Service (Frontend)
 * Wraps all backend RFI endpoints.
 */

const BASE = import.meta.env.VITE_API_URL || '/api';

// ── Auth token helper — matches extractionApi.ts exactly ──
function getToken(): string {
    try {
        const u = sessionStorage.getItem('sdms_user');
        return u ? JSON.parse(u).token ?? '' : '';
    } catch {
        return '';
    }
}

function authHeaders(): Record<string, string> {
    const tok = getToken();
    return tok ? { Authorization: `Bearer ${tok}` } : {};
}

export const uploadRfiDrawing = async (projectId: string, files: File[], localSavePath?: string) => {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    if (localSavePath) formData.append('localSavePath', localSavePath);

    const res = await fetch(`${BASE}/rfis/${projectId}/upload`, {
        method: 'POST',
        headers: { ...authHeaders() },
        body: formData,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
    }
    return res.json();
};

export const listRfiExtractions = async (projectId: string) => {
    const res = await fetch(`${BASE}/rfis/${projectId}`, {
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to list RFIs');
    }
    return res.json();
};

export const getRfiExcelDownloadUrl = (projectId: string, extractionId?: string, baseUrl?: string): string => {
    const tok = getToken();
    let url = `${BASE}/rfis/${projectId}/excel/download?token=${tok}`;
    if (extractionId) {
        url += `&extractionId=${extractionId}`;
    }
    if (baseUrl && baseUrl.trim()) {
        url += `&baseUrl=${encodeURIComponent(baseUrl.trim())}`;
    }
    return url;
};

export const deleteRfiExtraction = async (projectId: string, extractionId: string) => {
    const res = await fetch(`${BASE}/rfis/${projectId}/${extractionId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to delete');
    }
    return res.json();
};

export const updateRfiResponse = async (
    projectId: string,
    extractionId: string,
    rfiIndex: number,
    response: string,
    remarks: string
) => {
    const res = await fetch(`${BASE}/rfis/${projectId}/${extractionId}/response/${rfiIndex}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ response, remarks }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save response');
    }
    return res.json();
};

export const updateRfiStatus = async (
    projectId: string,
    extractionId: string,
    rfiIndex: number,
    status: 'OPEN' | 'CLOSED'
) => {
    const res = await fetch(`${BASE}/rfis/${projectId}/${extractionId}/status/${rfiIndex}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update status');
    }
    return res.json();
};

export const uploadRfiResponseAttachment = async (
    projectId: string,
    extractionId: string,
    rfiIndex: number,
    file: File
) => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${BASE}/rfis/${projectId}/${extractionId}/response/${rfiIndex}/attachment`, {
        method: 'POST',
        headers: { ...authHeaders() },
        body: formData,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to upload response attachment');
    }
    return res.json();
};
