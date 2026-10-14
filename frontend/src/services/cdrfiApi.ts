/**
 * CDRFI API Service (Frontend)
 * Wraps all backend CDRFI endpoints.
 */

const BASE = import.meta.env.VITE_API_URL || '/steel/api';

const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

export const uploadCdrfiDrawing = async (projectId: string, files: File[], localSavePath?: string, sequences?: string[]) => {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    if (localSavePath) formData.append('localSavePath', localSavePath);
    if (sequences && sequences.length > 0) {
        sequences.forEach(s => formData.append('sequences', s));
    }

    const res = await fetch(`${BASE}/cdrfis/${String(projectId)}/upload`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...getAuthHeaders() },
        body: formData,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        let errDetails = 'Upload failed';
        try {
            const parsed = JSON.parse(text);
            errDetails = parsed.error || parsed.message || `Error ${res.status}`;
        } catch (e) {
            errDetails = `HTTP ${res.status}: ${res.statusText || 'Server Error'}`;
        }
        throw new Error(errDetails);
    }
    return res.json();
};

export const listCdrfiExtractions = async (projectId: string) => {
    const res = await fetch(`${BASE}/cdrfis/${String(projectId)}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to list CDRFIs');
    }
    return res.json();
};

export const getCdrfiExcelDownloadUrl = (projectId: string, extractionId?: string, baseUrl?: string, status?: string): string => {
    let url = `${BASE}/cdrfis/${String(projectId)}/excel/download`;
    const params = [];
    if (extractionId) params.push(`extractionId=${String(extractionId)}`);
    if (baseUrl && baseUrl.trim()) params.push(`baseUrl=${encodeURIComponent(baseUrl.trim())}`);
    if (status) params.push(`status=${status}`);
    
    if (params.length > 0) {
        url += '?' + params.join('&');
    }
    return url;
};

export const deleteCdrfiExtraction = async (projectId: string, extractionId: string) => {
    const res = await fetch(`${BASE}/cdrfis/${String(projectId)}/${String(extractionId)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to delete');
    }
    return res.json();
};

export const updateCdrfiResponse = async (
    projectId: string,
    extractionId: string,
    rfiIndex: number,
    response: string,
    remarks: string,
    clientRfiNumber?: string
) => {
    const res = await fetch(`${BASE}/cdrfis/${String(projectId)}/${String(extractionId)}/response/${rfiIndex}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ response, remarks, clientRfiNumber }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save response');
    }
    return res.json();
};

export const updateCdrfiStatus = async (
    projectId: string,
    extractionId: string,
    rfiIndex: number,
    status: 'OPEN' | 'CLOSED'
) => {
    const res = await fetch(`${BASE}/cdrfis/${String(projectId)}/${String(extractionId)}/status/${rfiIndex}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ status }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update status');
    }
    return res.json();
};

export const uploadCdrfiResponseAttachment = async (
    projectId: string,
    extractionId: string,
    rfiIndex: number,
    file: File
) => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${BASE}/cdrfis/${String(projectId)}/${String(extractionId)}/response/${rfiIndex}/attachment`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to upload response attachment');
    }
    return res.json();
};

export const getCdrfiViewPdfUrl = (projectId: string, extractionId: string): string => {
    return `${BASE}/cdrfis/${String(projectId)}/${String(extractionId)}/view.pdf`;
};
