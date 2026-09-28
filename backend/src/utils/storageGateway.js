/**
 * ============================================================
 * Storage Gateway — Local File System Override
 * ============================================================
 * This module was modified to store files directly on the 
 * VPS server's local file system, instead of using an external
 * Windows Storage Agent.
 * ============================================================
 */
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { Readable } = require('stream');

// Use local uploads folder
const STORAGE_DIR = path.join(__dirname, '../../uploads/storage');

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function isEnabled() {
    return true; // Always enabled for local storage
}

async function validateRoot() {
    return { ok: true, storageRoot: STORAGE_DIR, readOnly: false };
}

function getLocalPath(relativePath) {
    if (!relativePath) return STORAGE_DIR;
    
    // Prevent path traversal
    const safePath = relativePath.replace(/\.\./g, '').replace(/^[\/\\]+/, '');
    return path.join(STORAGE_DIR, safePath);
}

async function listDirectory(relativePath = '') {
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
            } catch (err) {
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
    try {
        await fsPromises.stat(getLocalPath(relativePath));
        return true;
    } catch {
        return false;
    }
}

async function getFileInfo(relativePath) {
    const filePath = getLocalPath(relativePath);
    try {
        const stat = await fsPromises.stat(filePath);
        return {
            name: path.basename(filePath),
            size: stat.size,
            mimeType: 'application/octet-stream', // basic default
            modified: stat.mtime.toISOString(),
            created: stat.birthtime.toISOString(),
        };
    } catch (err) {
        throw new Error(`Failed to get info: ${err.message}`);
    }
}

async function getFileStream(relativePath) {
    const filePath = getLocalPath(relativePath);
    try {
        const stat = await fsPromises.stat(filePath);
        const stream = fs.createReadStream(filePath);
        return {
            stream,
            contentType: 'application/octet-stream',
            contentLength: stat.size,
            contentDisposition: `attachment; filename="${path.basename(filePath)}"`,
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
    const dirPath = getLocalPath(finalTargetDir);
    
    await fsPromises.mkdir(dirPath, { recursive: true });
    
    const filePath = path.join(dirPath, filename);
    await fsPromises.writeFile(filePath, buffer);
    
    return { message: 'File saved successfully to local server disk.' };
}

async function deleteFile(relativePath) {
    const targetPath = getLocalPath(relativePath);
    try {
        await fsPromises.rm(targetPath, { recursive: true, force: true });
        return true;
    } catch (err) {
        throw new Error(`Delete failed: ${err.message}`);
    }
}

module.exports = {
    AGENT_URL: 'local',
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
