const API_URL = import.meta.env.VITE_API_URL || '';

export const fetchDrawingLogProjects = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/drawing-log/projects`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    if (!res.ok) throw new Error('Failed to fetch drawing log projects');
    return res.json();
};

export const fetchDrawingLog = async (projectId: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/drawing-log/${projectId}`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
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
    return `${API_URL}/api/drawing-log/${projectId}/download?token=${localStorage.getItem('token')}`;
};
