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

export const fetchWeeklyProgresss = async (projectId: string) => {
    const res = await fetch(`${BASE}/weekly-report/${projectId}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse(res);
};

export const fetchWeeklyProgressDraft = async (projectId: string, reportId: string) => {
    const res = await fetch(`${BASE}/weekly-report/${projectId}/${reportId}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse(res);
};

export const saveWeeklyProgressDraft = async (projectId: string, data: any) => {
    const res = await fetch(`${BASE}/weekly-report/${projectId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return handleResponse(res);
};

export const getWeeklyProgressDownloadUrl = (projectId: string, reportId: string) => {
    return `${BASE}/weekly-report/${projectId}/${reportId}/download`;
};
