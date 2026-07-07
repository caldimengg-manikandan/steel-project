import type { AuthUser } from '../types';

const BASE = import.meta.env.VITE_API_URL || '/steel/api';

function authHeaders(): Record<string, string> {
    const stored = sessionStorage.getItem('sdms_user');
    if (!stored) return {};
    const user: AuthUser = JSON.parse(stored);
    return {
        'Authorization': `Bearer ${user.token || ''}`,
        'Content-Type': 'application/json',
    };
}

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

export interface FileEntry {
    name: string;
    type: 'directory' | 'file';
    size: number | null;
    modified: string;
}

/**
 * List files and directories at a specific path
 */
export async function browseFiles(path: string = ''): Promise<{ path: string; entries: FileEntry[]; count: number }> {
    const params = new URLSearchParams();
    if (path) params.append('path', path);

    const res = await fetch(`${BASE}/files/browse?${params.toString()}`, {
        headers: authHeaders(),
    });
    return handleResponse(res);
}

/**
 * Get info for a specific file
 */
export async function getFileInfo(path: string): Promise<FileEntry> {
    const params = new URLSearchParams();
    params.append('path', path);

    const res = await fetch(`${BASE}/files/info?${params.toString()}`, {
        headers: authHeaders(),
    });
    return handleResponse(res);
}

/**
 * Search files by name
 */
export async function searchFiles(query: string, path: string = ''): Promise<{ results: FileEntry[]; count: number; truncated: boolean }> {
    const params = new URLSearchParams();
    params.append('q', query);
    if (path) params.append('path', path);

    const res = await fetch(`${BASE}/files/search?${params.toString()}`, {
        headers: authHeaders(),
    });
    return handleResponse(res);
}

/**
 * Upload multiple files to a target path
 */
export async function uploadFiles(files: File[], targetPath: string = ''): Promise<{ message: string; results: any[] }> {
    const stored = sessionStorage.getItem('sdms_user');
    const token = stored ? JSON.parse(stored).token : '';

    const formData = new FormData();
    if (targetPath) {
        formData.append('targetPath', targetPath);
    }
    files.forEach(f => formData.append('files', f));

    const res = await fetch(`${BASE}/files/upload`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`
        },
        body: formData,
    });
    return handleResponse(res);
}

/**
 * Delete a file or directory
 */
export async function deleteFile(path: string): Promise<{ message: string; path: string }> {
    const params = new URLSearchParams();
    params.append('path', path);

    const res = await fetch(`${BASE}/files/remove?${params.toString()}`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

/**
 * Helper to download a file in the browser
 */
export async function downloadFile(path: string): Promise<void> {
    const stored = sessionStorage.getItem('sdms_user');
    const token = stored ? JSON.parse(stored).token : '';

    const params = new URLSearchParams();
    params.append('path', path);
    // Add token so the server can authorize from query param if needed, OR we can fetch() and blob()
    params.append('token', token);

    // Let's use fetch/blob approach so we can handle headers if needed, OR just open URL.
    // The backend `verifyToken` allows req.query.token.

    // We could open a new tab, but using fetch -> blob is better for keeping the user on the same page 
    // and catching errors if it fails.
    const res = await fetch(`${BASE}/files/download?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Failed to download file');
    }

    // Extract filename from disposition or path
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : path.split('/').pop() || 'download';

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
}

/**
 * Upload an entire folder to a project, preserving directory structure.
 * The backend will:
 *  1. Store all files on the Windows server mirroring the folder structure.
 *  2. Auto-detect PDFs under Drawings/Detail sheets & Drawings/E-Sheets.
 *  3. Queue those PDFs for AI extraction linked to the transmittalNumber.
 */
export async function uploadFolder(
    projectId: string,
    files: File[],
    transmittalNumber: number | null | undefined,
    sequences: string[] | undefined,
    onProgress?: (progress: { loaded: number; total: number; percentage: number; speed: number }) => void
): Promise<{
    message: string;
    storedCount: number;
    drawingsQueued: number;
    extractionIds: string[];
    transmittalNumber: number | null;
    failedCount: number;
    results?: Array<{ name: string; path: string; status: 'stored' | 'failed'; error?: string }>;
    drawings?: Array<{ name: string; folder: string; id: string }>;
}> {
    return new Promise((resolve, reject) => {
        const stored = sessionStorage.getItem('sdms_user');
        const token = stored ? JSON.parse(stored).token : '';

        const formData = new FormData();
        files.forEach(file => {
            formData.append('files', file, file.name);
            const relativePath = (file as any).webkitRelativePath || file.name;
            formData.append('paths', relativePath);
        });

        if (transmittalNumber != null) {
            formData.append('transmittalNumber', String(transmittalNumber));
        }
        if (sequences && sequences.length > 0) {
            sequences.forEach(s => formData.append('sequences', s));
        }

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${BASE}/admin/projects/${String(projectId)}/upload-folder`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        let lastLoaded = 0;
        let lastTime = Date.now();

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && onProgress) {
                const now = Date.now();
                const elapsedSeconds = (now - lastTime) / 1000;
                
                let speed = 0;
                if (elapsedSeconds > 0) {
                    const loadedDiff = event.loaded - lastLoaded;
                    speed = loadedDiff / elapsedSeconds; // bytes per second
                }

                // Update tracker values for next tick
                lastLoaded = event.loaded;
                lastTime = now;

                const percentage = Math.round((event.loaded / event.total) * 100);
                onProgress({
                    loaded: event.loaded,
                    total: event.total,
                    percentage,
                    speed,
                });
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    resolve(JSON.parse(xhr.responseText));
                } catch (e) {
                    reject(new Error('Malformed response from server'));
                }
            } else {
                try {
                    const err = JSON.parse(xhr.responseText);
                    reject(new Error(err.error || xhr.statusText));
                } catch {
                    reject(new Error(`API Request failed (${xhr.status})`));
                }
            }
        };

        xhr.onerror = () => {
            reject(new Error('Network error occurred'));
        };

        xhr.send(formData);
    });
}

