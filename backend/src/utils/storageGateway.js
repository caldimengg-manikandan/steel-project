/**
 * ============================================================
 * Storage Gateway — Hybrid Client (Remote Agent + Local Disk)
 * ============================================================
 * When STORAGE_AGENT_URL is set (e.g. http://<windows-ip>:4500 or tunnel),
 * this module communicates over HTTP with the Storage Agent running on
 * the Windows Server to manage files on I:\storage\projects directly.
 *
 * If STORAGE_AGENT_URL is not set or set to 'local', it falls back to
 * local server disk storage (backend/uploads/storage) for development.
 * ============================================================
 */
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { Readable } = require('stream');

// ── Configuration ──────────────────────────────────────────
const AGENT_URL = (process.env.STORAGE_AGENT_URL || '').replace(/\/+$/, '');
const AGENT_API_KEY = process.env.STORAGE_AGENT_API_KEY || '';
const STORAGE_ENABLED = process.env.STORAGE_ENABLED !== 'false';

// Local uploads folder fallback
const STORAGE_DIR = path.join(__dirname, '../../uploads/storage');
if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function isRemoteAgent() {
    return STORAGE_ENABLED && Boolean(AGENT_URL && AGENT_URL !== 'local');
}

function isEnabled() {
    return STORAGE_ENABLED;
}

function getTimeoutSignal(ms) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(ms);
    }
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
}

const MIME_MAP = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
};

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_MAP[ext] || 'application/octet-stream';
}

function getLocalPath(relativePath) {
    if (!relativePath) return STORAGE_DIR;
    const safePath = relativePath.replace(/\.\./g, '').replace(/^[\/\\]+/, '');
    const directPath = path.join(STORAGE_DIR, safePath);
    if (fs.existsSync(directPath)) return directPath;

    const alt1 = path.join(STORAGE_DIR, safePath.replace(/_/g, ' '));
    if (fs.existsSync(alt1)) return alt1;

    const alt2 = path.join(STORAGE_DIR, safePath.replace(/ /g, '_'));
    if (fs.existsSync(alt2)) return alt2;

    return directPath;
}

async function agentFetch(endpoint, options = {}) {
    const url = `${AGENT_URL}${endpoint}`;
    const timeoutMs = options.timeoutMs || 8000;
    const signal = options.signal || getTimeoutSignal(timeoutMs);
    const start = Date.now();

    console.log(`[StorageGateway] agentFetch START -> ${options.method || 'GET'} ${url} (timeout: ${timeoutMs}ms)`);

    const headers = {
        'X-API-Key': AGENT_API_KEY,
        ...(options.headers || {}),
    };

    try {
        const response = await fetch(url, {
            ...options,
            headers,
            signal,
        });

        const duration = Date.now() - start;
        console.log(`[StorageGateway] agentFetch SUCCESS -> ${options.method || 'GET'} ${url} HTTP ${response.status} (${duration}ms)`);
        return response;
    } catch (err) {
        const duration = Date.now() - start;
        console.error(`[StorageGateway] agentFetch ERROR -> ${options.method || 'GET'} ${url} after ${duration}ms:`, err.message);
        throw err;
    }
}

async function validateRoot() {
    if (!STORAGE_ENABLED) {
        return { ok: true, skipped: true };
    }

    if (isRemoteAgent()) {
        try {
            const response = await fetch(`${AGENT_URL}/health`, {
                method: 'GET',
                signal: getTimeoutSignal(10000),
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
                error: `Cannot reach Storage Agent at ${AGENT_URL}: ${err.message}`,
            };
        }
    }

    return { ok: true, storageRoot: STORAGE_DIR, readOnly: false };
}

async function listDirectory(relativePath = '') {
    if (isRemoteAgent()) {
        const response = await agentFetch(`/browse?path=${encodeURIComponent(relativePath)}`);
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(err.error || `Failed to browse: HTTP ${response.status}`);
        }
        const data = await response.json();
        return data.entries || [];
    }

    const dirPath = getLocalPath(relativePath);
    try {
        const dirents = await fsPromises.readdir(dirPath, { withFileTypes: true });
        const entries = [];
        for (const dirent of dirents) {
            const fullPath = path.join(dirPath, dirent.name);
            try {
                const stat = await fsPromises.stat(fullPath);
                entries.push({
                    name: dirent.name,
                    type: dirent.isDirectory() ? 'directory' : 'file',
                    size: dirent.isFile() ? stat.size : null,
                    modified: stat.mtime.toISOString(),
                });
            } catch {
                // Ignore stat errors for individual files
            }
        }
        return entries;
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
}

async function fileExists(relativePath) {
    if (isRemoteAgent()) {
        try {
            const response = await agentFetch(`/info?path=${encodeURIComponent(relativePath)}`);
            return response.ok;
        } catch {
            return false;
        }
    }
    try {
        await fsPromises.stat(getLocalPath(relativePath));
        return true;
    } catch {
        return false;
    }
}

async function getFileInfo(relativePath) {
    if (isRemoteAgent()) {
        const response = await agentFetch(`/info?path=${encodeURIComponent(relativePath)}`);
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(err.error || `Failed to get info: HTTP ${response.status}`);
        }
        return response.json();
    }

    const filePath = getLocalPath(relativePath);
    try {
        const stat = await fsPromises.stat(filePath);
        return {
            name: path.basename(filePath),
            size: stat.size,
            mimeType: getMimeType(filePath),
            modified: stat.mtime.toISOString(),
            created: stat.birthtime.toISOString(),
        };
    } catch (err) {
        throw new Error(`Failed to get info: ${err.message}`);
    }
}

async function getFileStream(relativePath) {
    if (isRemoteAgent()) {
        const response = await agentFetch(
            `/download?path=${encodeURIComponent(relativePath)}&disposition=inline`,
            { timeoutMs: 15000 }
        );

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(err.error || `Failed to download: HTTP ${response.status}`);
        }

        const fileName = path.basename(relativePath);
        const resolvedType = response.headers.get('content-type') || getMimeType(relativePath);

        return {
            stream: Readable.fromWeb(response.body),
            contentType: resolvedType,
            contentLength: response.headers.get('content-length'),
            contentDisposition: response.headers.get('content-disposition') || `inline; filename="${fileName}"`,
        };
    }

    const filePath = getLocalPath(relativePath);
    try {
        const stat = await fsPromises.stat(filePath);
        const stream = fs.createReadStream(filePath);
        const resolvedType = getMimeType(filePath);
        return {
            stream,
            contentType: resolvedType,
            contentLength: stat.size,
            contentDisposition: `inline; filename="${path.basename(filePath)}"`,
        };
    } catch (err) {
        throw new Error(`Failed to download: ${err.message}`);
    }
}

async function _searchRecursive(dir, queryLower, results) {
    const dirents = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
        const fullPath = path.join(dir, dirent.name);
        if (dirent.name.toLowerCase().includes(queryLower)) {
            const stat = await fsPromises.stat(fullPath);
            const relPath = path.relative(STORAGE_DIR, fullPath).replace(/\\/g, '/');
            results.push({
                name: dirent.name,
                path: relPath,
                type: dirent.isDirectory() ? 'directory' : 'file',
                size: dirent.isFile() ? stat.size : null,
                modified: stat.mtime.toISOString(),
            });
        }
        if (dirent.isDirectory()) {
            await _searchRecursive(fullPath, queryLower, results);
        }
    }
}

async function searchFiles(query, searchRoot = '') {
    if (isRemoteAgent()) {
        const params = new URLSearchParams({ q: query });
        if (searchRoot) params.set('path', searchRoot);

        const response = await agentFetch(`/search?${params.toString()}`);
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(err.error || `Search failed: HTTP ${response.status}`);
        }
        return response.json();
    }

    const results = [];
    const rootPath = getLocalPath(searchRoot);
    if (!fs.existsSync(rootPath)) return { results, count: 0 };

    await _searchRecursive(rootPath, query.toLowerCase(), results);
    return { results, count: results.length };
}

function isLogFile(filename) {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    return lower.includes('transmittal') || lower.includes('drawing_log') || lower.includes('drawing log') || lower.includes('master_log') || lower.includes('master log');
}

function sanitizeUploadTargetDir(targetDir, filename) {
    if (!targetDir) return targetDir;
    const cleanDir = targetDir.replace(/\\/g, '/');
    const isLogsDir = /\/Logs($|\/)/i.test(cleanDir) || /^Logs($|\/)/i.test(cleanDir);

    if (isLogsDir && !isLogFile(filename)) {
        let redirected = cleanDir
            .replace(/\/Logs($|\/)/gi, '/')
            .replace(/^Logs($|\/)/gi, '')
            .replace(/\/+/g, '/')
            .replace(/\/$/, '');
        return redirected;
    }
    return targetDir;
}

async function uploadFile(targetDir, filename, buffer) {
    const finalTargetDir = sanitizeUploadTargetDir(targetDir, filename);

    if (isRemoteAgent()) {
        const formData = new FormData();
        formData.append('targetPath', finalTargetDir);
        formData.append('files', new Blob([buffer]), filename);

        const response = await agentFetch('/upload', {
            method: 'POST',
            body: formData,
            signal: getTimeoutSignal(30000), // 30s timeout for large uploads
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(err.error || `Upload to Storage Agent failed: HTTP ${response.status}`);
        }

        console.log(`[StorageGateway] Successfully uploaded "${filename}" to Storage Agent at "${finalTargetDir}"`);
        return response.json();
    }

    // Local Disk Fallback
    const dirPath = getLocalPath(finalTargetDir);
    await fsPromises.mkdir(dirPath, { recursive: true });
    const filePath = path.join(dirPath, filename);
    await fsPromises.writeFile(filePath, buffer);
    console.log(`[StorageGateway] Successfully saved "${filename}" to local disk at "${filePath}"`);
    return { message: 'File saved successfully to local server disk.' };
}

async function deleteFile(relativePath) {
    if (isRemoteAgent()) {
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

    const targetPath = getLocalPath(relativePath);
    try {
        await fsPromises.rm(targetPath, { recursive: true, force: true });
        return true;
    } catch (err) {
        throw new Error(`Delete failed: ${err.message}`);
    }
}

module.exports = {
    AGENT_URL: isRemoteAgent() ? AGENT_URL : 'local',
    isEnabled,
    isRemoteAgent,
    validateRoot,
    listDirectory,
    fileExists,
    getFileInfo,
    getFileStream,
    searchFiles,
    uploadFile,
    deleteFile,
};
