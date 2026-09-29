/**
 * ============================================================
 * Directory Bootstrap & Permission Utility
 * ============================================================
 * Automatically creates all required upload directories with
 * read/write/execute permissions (0o775) on application startup.
 * Prevents "ENOENT" or "EACCES" errors in hosted Linux environments
 * (e.g. /var/www/steel-project/uploads/mail-attachments).
 */
const fs = require('fs');
const path = require('path');

function ensureDirectory(dirPath) {
    if (!dirPath) return;
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true, mode: 0o775 });
            console.log(`[InitDirs] Created directory: ${dirPath}`);
        }
        // Apply 775 (rwxrwxr-x) permissions on POSIX / Linux servers
        if (process.platform !== 'win32') {
            try {
                fs.chmodSync(dirPath, 0o775);
            } catch {
                // Ignore if process runs as non-root / non-owner
            }
        }
    } catch (err) {
        console.warn(`[InitDirs] Warning initializing directory "${dirPath}":`, err.message);
    }
}

function initUploadDirectories() {
    // 1. Backend uploads: <repo>/backend/uploads
    const backendUploads = path.resolve(__dirname, '../../uploads');

    // 2. Project root uploads: <repo>/uploads (e.g. /var/www/steel-project/uploads)
    const rootUploads = path.resolve(__dirname, '../../../uploads');

    // 3. Custom path from env if specified
    const envUploads = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : null;

    const baseDirs = [backendUploads, rootUploads];
    if (envUploads && !baseDirs.includes(envUploads)) {
        baseDirs.push(envUploads);
    }

    const subDirs = [
        'mail-attachments',
        'temp',
        'excel',
        'system',
        'storage',
        'steel-dms-uploads',
        'storage_fallback',
        'drawings',
        'rfis',
    ];

    for (const base of baseDirs) {
        ensureDirectory(base);
        for (const sub of subDirs) {
            ensureDirectory(path.join(base, sub));
        }
    }
}

module.exports = {
    ensureDirectory,
    initUploadDirectories,
};
