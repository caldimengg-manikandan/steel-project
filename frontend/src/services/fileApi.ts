

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
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
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
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
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
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse(res);
}

/**
 * Upload multiple files to a target path
 */
export async function uploadFiles(files: File[], targetPath: string = ''): Promise<{ message: string; results: any[] }> {
    const formData = new FormData();
    if (targetPath) {
        formData.append('targetPath', targetPath);
    }
    files.forEach(f => formData.append('files', f));

    const res = await fetch(`${BASE}/files/upload`, {
        method: 'POST',
        credentials: 'include',
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
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse(res);
}

/**
 * Helper to download a file in the browser
 */
export async function downloadFile(path: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('path', path);

    // Let's use fetch/blob approach so we can handle headers if needed, OR just open URL.

    // We could open a new tab, but using fetch -> blob is better for keeping the user on the same page 
    // and catching errors if it fails.
    const res = await fetch(`${BASE}/files/download?path=${encodeURIComponent(path)}`, {
        credentials: 'include',
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
