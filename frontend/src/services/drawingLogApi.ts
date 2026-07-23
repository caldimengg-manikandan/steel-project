const API_URL = import.meta.env.VITE_API_URL || '';

export const fetchDrawingLogProjects = async () => {
    const res = await fetch(`${API_URL}/api/drawing-log/projects`, {
        credentials: 'include'
    });
    if (!res.ok) throw new Error('Failed to fetch drawing log projects');
    return res.json();
};

export const fetchDrawingLog = async (projectId: string) => {
    const res = await fetch(`${API_URL}/api/drawing-log/${projectId}`, {
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
    // Rely on the browser passing the cookie automatically for standard anchor tag downloads.
    return `${API_URL}/api/drawing-log/${projectId}/download`;
};
