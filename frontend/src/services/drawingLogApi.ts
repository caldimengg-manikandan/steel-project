import { BASE, fetchWithAuth } from './apiClient';

export const fetchDrawingLogProjects = async () => {
    const res = await fetchWithAuth(`${BASE}/drawing-log/projects`, {
        credentials: 'include'
    });
    if (!res.ok) throw new Error('Failed to fetch drawing log projects');
    return res.json();
};

export const fetchDrawingLog = async (projectId: string) => {
    const res = await fetchWithAuth(`${BASE}/drawing-log/${projectId}`, {
        credentials: 'include'
    });
    if (!res.ok) {
        if (res.status === 404) {
            throw new Error('Drawing Log not found. A transmittal must be generated first.');
        }
        throw new Error('Failed to fetch drawing log');
    }
    return res.json();
};

export const getDrawingLogDownloadUrl = (projectId: string) => {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    return `${BASE}/drawing-log/${projectId}/download${token ? `?token=${encodeURIComponent(token)}` : ''}`;
};
