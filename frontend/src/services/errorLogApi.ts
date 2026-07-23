export const API_BASE = import.meta.env.VITE_API_URL || '/steel/api';

const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
};

export async function fetchErrorLogs() {
    const res = await fetch(`${API_BASE}/error-log`, { headers: getAuthHeaders() });
    return res.json();
}

export async function saveErrorLogs(logs: any[], addedByRole?: string, addedByName?: string) {
    const res = await fetch(`${API_BASE}/error-log`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ logs, addedByRole, addedByName }),
        credentials: 'include'
    });
    return res.json();
}

export function getErrorLogDownloadUrl() {
    return `${API_BASE}/error-log/download`;
}
