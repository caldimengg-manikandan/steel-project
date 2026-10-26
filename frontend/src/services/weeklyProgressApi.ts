import { BASE, fetchWithAuth, handleResponse } from './apiClient';

export const fetchWeeklyProgresss = async (projectId: string) => {
    const res = await fetchWithAuth(`${BASE}/weekly-report/${projectId}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse(res);
};

export const fetchWeeklyProgressDraft = async (projectId: string, reportId: string) => {
    const res = await fetchWithAuth(`${BASE}/weekly-report/${projectId}/${reportId}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse(res);
};

export const saveWeeklyProgressDraft = async (projectId: string, data: any) => {
    const res = await fetchWithAuth(`${BASE}/weekly-report/${projectId}`, {
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
