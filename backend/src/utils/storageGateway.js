/**
 * ============================================================
 * Storage Gateway — HTTP Client (Cloud-Side)
 * ============================================================
 * This module runs in the cloud-hosted Steel DMS backend.
 * Instead of accessing the filesystem directly, it makes
 * HTTP requests to the Storage Agent running on the
 * Windows server (via Cloudflare Tunnel).
 *
 * Same API surface as the original local version —
 * the controller/routes don't need to change.
 *
 * Configuration (from .env):
 *   STORAGE_AGENT_URL  — The agent's URL (Cloudflare Tunnel URL)
 *   STORAGE_AGENT_API_KEY — Shared secret for auth
 *   STORAGE_ENABLED — true/false
 * ============================================================
 */
const { Readable } = require('stream');

// ── Configuration ──────────────────────────────────────────
const AGENT_URL = (process.env.STORAGE_AGENT_URL || '').replace(/\/+$/, '');
const AGENT_API_KEY = process.env.STORAGE_AGENT_API_KEY || '';
const STORAGE_ENABLED = process.env.STORAGE_ENABLED !== 'false';

/**
 * isEnabled
 * ─────────
 * Returns whether the storage gateway is active.
 */
function isEnabled() {
    return STORAGE_ENABLED && !!AGENT_URL;
}

/**
 * validateRoot
 * ────────────
 * Checks connectivity to the remote Storage Agent.
 * Called at server startup.
 *
 * @returns {Promise<{ ok: boolean, error?: string, skipped?: boolean }>}
 */
async function validateRoot() {
    if (!STORAGE_ENABLED) {
        return { ok: true, skipped: true };
    }

    if (!AGENT_URL) {
        return { ok: false, error: 'STORAGE_AGENT_URL is not configured in .env' };
    }

    if (!AGENT_API_KEY) {
        return { ok: false, error: 'STORAGE_AGENT_API_KEY is not configured in .env' };
    }

    try {
        const response = await fetch(`${AGENT_URL}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(10000), // 10s timeout
        });

        if (!response.ok) {
            return { ok: false, error: `Agent health check returned HTTP ${response.status}` };
        }

        const data = await response.json();
        return {
            ok: true,
            storageRoot: data.storageRoot,
            readOnly: data.readOnly,
        };
    } catch (err) {
        return {
            ok: false,
            error: `Cannot reach Storage Agent at ${AGENT_URL}: ${err.message}`
        };
    }
}

/**
 * Internal helper: make an authenticated request to the agent.
 */
async function agentFetch(endpoint, options = {}) {
    const url = `${AGENT_URL}${endpoint}`;

    const headers = {
        'X-API-Key': AGENT_API_KEY,
        ...(options.headers || {}),
    };

    const response = await fetch(url, {
        ...options,
        headers,
        signal: options.signal || AbortSignal.timeout(30000), // 30s default timeout
    });

    return response;
}

/**
 * listDirectory
 * ──────────────
 * Lists the contents of a directory on the remote storage.
 *
 * @param {string} relativePath
 * @returns {Promise<Array<{ name, type, size, modified }>>}
 */
async function listDirectory(relativePath = '') {
    const response = await agentFetch(`/browse?path=${encodeURIComponent(relativePath)}`);

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(err.error || `Failed to browse: HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.entries || [];
}

/**
 * fileExists
 * ──────────
 * Checks whether a file exists on the remote storage.
 *
 * @param {string} relativePath
 * @returns {Promise<boolean>}
 */
async function fileExists(relativePath) {
    try {
        const response = await agentFetch(`/info?path=${encodeURIComponent(relativePath)}`);
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * getFileInfo
 * ───────────
 * Returns metadata about a file on the remote storage.
 *
 * @param {string} relativePath
 * @returns {Promise<{ name, size, mimeType, modified, created }>}
 */
async function getFileInfo(relativePath) {
    const response = await agentFetch(`/info?path=${encodeURIComponent(relativePath)}`);

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(err.error || `Failed to get info: HTTP ${response.status}`);
    }

    return response.json();
}

/**
 * getFileStream
 * ──────────────
 * Returns a readable stream for a file from the remote storage.
 * This proxies the download from the agent.
 *
 * @param {string} relativePath
 * @returns {Promise<{ stream: ReadableStream, headers: Object }>}
 */
async function getFileStream(relativePath) {
    const response = await agentFetch(
        `/download?path=${encodeURIComponent(relativePath)}`,
        { signal: AbortSignal.timeout(300000) } // 5 min timeout for large files
    );

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(err.error || `Failed to download: HTTP ${response.status}`);
    }

    return {
        stream: Readable.fromWeb(response.body),
        contentType: response.headers.get('content-type') || 'application/octet-stream',
        contentLength: response.headers.get('content-length'),
        contentDisposition: response.headers.get('content-disposition'),
    };
}

/**
 * searchFiles
 * ────────────
 * Search for files by name on the remote storage.
 *
 * @param {string} query — Search term
 * @param {string} searchRoot — Directory to search within
 * @returns {Promise<{ results, count, truncated }>}
 */
async function searchFiles(query, searchRoot = '') {
    const params = new URLSearchParams({ q: query });
    if (searchRoot) params.set('path', searchRoot);

    const response = await agentFetch(`/search?${params.toString()}`);

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(err.error || `Search failed: HTTP ${response.status}`);
    }

    return response.json();
}

/**
 * uploadFile
 * ──────────
 * Upload a file to the remote storage.
 *
 * @param {string} targetDir — Target directory on the storage
 * @param {string} filename — Name of the file
 * @param {Buffer} buffer — File contents
 * @returns {Promise<Object>}
 */
async function uploadFile(targetDir, filename, buffer) {
    // Build multipart form data manually using the built-in FormData
    const formData = new FormData();
    formData.append('targetPath', targetDir);
    formData.append('files', new Blob([buffer]), filename);

    const response = await agentFetch('/upload', {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(300000), // 5 min for large uploads
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(err.error || `Upload failed: HTTP ${response.status}`);
    }

    return response.json();
}

/**
 * deleteFile
 * ──────────
 * Delete a file from the remote storage.
 *
 * @param {string} relativePath
 * @returns {Promise<boolean>}
 */
async function deleteFile(relativePath) {
    const response = await agentFetch(
        `/delete?path=${encodeURIComponent(relativePath)}`,
        { method: 'DELETE' }
    );

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(err.error || `Delete failed: HTTP ${response.status}`);
    }

    return true;
}

module.exports = {
    AGENT_URL,
    isEnabled,
    validateRoot,
    listDirectory,
    fileExists,
    getFileInfo,
    getFileStream,
    searchFiles,
    uploadFile,
    deleteFile,
};
