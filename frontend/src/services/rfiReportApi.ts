const BASE = import.meta.env.VITE_API_URL || '/steel/api';

async function handleResponse(res: Response) {
    const text = await res.text();
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch (e) {
        if (!res.ok) throw new Error(`API Error ${res.status}: ${text || res.statusText}`);
        throw new Error('Malformed JSON response from server');
    }

    if (!res.ok) {
        throw new Error(data.error || data.message || `API Request failed (${res.status})`);
    }
    return data;
}

export const fetchRfiReports = async (projectId: string) => {
    const res = await fetch(`${BASE}/rfi-report/${projectId}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse(res);
};

export const fetchRfiReportDraft = async (projectId: string, reportId: string) => {
    const res = await fetch(`${BASE}/rfi-report/${projectId}/draft/${reportId}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse(res);
};

export const saveRfiReportDraft = async (projectId: string, data: any) => {
    const res = await fetch(`${BASE}/rfi-report/${projectId}/draft`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return handleResponse(res);
};

export const submitRfiReport = async (projectId: string, reportId: string, data?: any) => {
    const res = await fetch(`${BASE}/rfi-report/${projectId}/submit/${reportId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {}),
    });
    return handleResponse(res);
};

export const deleteRfiReport = async (reportId: string) => {
    const res = await fetch(`${BASE}/rfi-report/${reportId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse(res);
};

export const getRfiReportDownloadUrl = (projectId: string, reportId: string) => {
    return `${BASE}/rfi-report/${projectId}/download/${reportId}`;
};
