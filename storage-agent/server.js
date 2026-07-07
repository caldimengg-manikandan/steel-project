/**
 * ============================================================
 * Steel DMS — Storage Agent
 * ============================================================
 * A secure, lightweight Express server that runs on the Windows
 * server and serves files from the local storage drive.
 *
 * The cloud-hosted Steel DMS app calls this agent over HTTPS
 * (via Cloudflare Tunnel) to browse, download, upload, and
 * manage files.
 *
 * Security Layers:
 *   1. HTTPS/TLS (via Cloudflare Tunnel)
 *   2. IP Whitelist (optional)
 *   3. API Key Authentication (required)
 *   4. Rate Limiting (100 req/min)
 *   5. Helmet (HTTP security headers)
 *   6. Path Sanitization (prevents directory traversal)
 *   7. File Type Restrictions (blocks dangerous extensions)
 *   8. Read-Only Mode (optional)
 *   9. Audit Logging (every access logged to file)
 *
 * Usage:
 *   1. Copy .env.example to .env and configure
 *   2. npm install
 *   3. npm start
 * ============================================================
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');

// ── Configuration ──────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 4500;
const STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT || 'E:\\Storage');
const API_KEY = process.env.API_KEY || '';
const READ_ONLY = process.env.READ_ONLY === 'true';
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB, 10) || 500;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const ALLOWED_IPS = (process.env.ALLOWED_IPS || '')
    .split(',')
    .map(ip => ip.trim())
    .filter(Boolean);

const BLOCKED_EXTENSIONS = (process.env.BLOCKED_EXTENSIONS || '.exe,.bat,.cmd,.ps1,.vbs,.msi,.dll,.sys,.com,.scr')
    .split(',')
    .map(ext => ext.trim().toLowerCase())
    .filter(Boolean);

// ── Validate configuration at startup ──────────────────────
function validateConfig() {
    const errors = [];

    if (!API_KEY || API_KEY === 'CHANGE_ME_run_npm_run_generate-key') {
        errors.push('API_KEY is not set. Run "npm run generate-key" and update .env');
    }

    if (!fs.existsSync(STORAGE_ROOT)) {
        errors.push(`STORAGE_ROOT "${STORAGE_ROOT}" does not exist`);
    } else {
        try {
            const stat = fs.statSync(STORAGE_ROOT);
            if (!stat.isDirectory()) {
                errors.push(`STORAGE_ROOT "${STORAGE_ROOT}" is not a directory`);
            }
            // Test read access
            fs.readdirSync(STORAGE_ROOT);
        } catch (err) {
            errors.push(`STORAGE_ROOT "${STORAGE_ROOT}" is not accessible: ${err.message}`);
        }
    }

    return errors;
}

// ── Audit Logger ───────────────────────────────────────────
const AUDIT_LOG_PATH = path.join(__dirname, 'audit.log');

function auditLog(action, requestPath, ip, extra = '') {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${action}] IP=${ip} PATH="${requestPath}" ${extra}\n`;
    fs.appendFile(AUDIT_LOG_PATH, line, (err) => {
        if (err) console.error('[Audit] Write error:', err.message);
    });
}

// ══════════════════════════════════════════════════════════
// SECURITY LAYER 6: Path Sanitization
// ══════════════════════════════════════════════════════════

/**
 * Resolves a user-supplied path against STORAGE_ROOT.
 * Throws if the resolved path escapes the root.
 */
function sanitizePath(userPath) {
    if (!userPath || typeof userPath !== 'string') {
        return STORAGE_ROOT;
    }

    // Normalize and clean
    let cleaned = userPath
        .replace(/\\/g, '/')       // unify separators
        .replace(/^\/+/, '')        // strip leading /
        .replace(/\0/g, '');        // strip null bytes

    const resolved = path.resolve(STORAGE_ROOT, cleaned);
    const rel = path.relative(STORAGE_ROOT, resolved);

    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error('Access denied: path escapes storage root.');
    }

    return path.normalize(resolved);
}

// ══════════════════════════════════════════════════════════
// SECURITY LAYER 7: File Type Restrictions
// ══════════════════════════════════════════════════════════

function isBlockedExtension(filename) {
    const ext = path.extname(filename).toLowerCase();
    return BLOCKED_EXTENSIONS.includes(ext);
}

// ── MIME type lookup ───────────────────────────────────────
const MIME_MAP = {
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.dwg': 'application/acad',
    '.dxf': 'application/dxf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.7z': 'application/x-7z-compressed',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.xml': 'application/xml',
};

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_MAP[ext] || 'application/octet-stream';
}

// ══════════════════════════════════════════════════════════
// EXPRESS APP SETUP
// ══════════════════════════════════════════════════════════

const app = express();

// ── SECURITY LAYER 5: Helmet ──────────────────────────────
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────
app.use(cors({
    origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map(o => o.trim()),
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key'],
}));

// ── JSON body parsing ─────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ── Request logging ───────────────────────────────────────
app.use(morgan(':date[iso] :method :url :status :res[content-length] - :response-time ms'));

// ══════════════════════════════════════════════════════════
// SECURITY LAYER 2: IP Whitelist
// ══════════════════════════════════════════════════════════

function ipWhitelist(req, res, next) {
    if (ALLOWED_IPS.length === 0) {
        return next(); // No whitelist configured — skip
    }

    // Get client IP (accounting for proxies like Cloudflare)
    const clientIp = req.headers['cf-connecting-ip']
        || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.ip
        || req.connection.remoteAddress;

    if (!ALLOWED_IPS.includes(clientIp)) {
        auditLog('BLOCKED_IP', req.url, clientIp);
        return res.status(403).json({ error: 'IP address not allowed.' });
    }

    next();
}

// ══════════════════════════════════════════════════════════
// SECURITY LAYER 3: API Key Authentication
// ══════════════════════════════════════════════════════════

function apiKeyAuth(req, res, next) {
    const providedKey = req.headers['x-api-key'];

    if (!providedKey || !API_KEY) {
        auditLog('AUTH_FAILED', req.url, req.ip, 'No API key provided');
        return res.status(401).json({ error: 'API key required.' });
    }

    // Constant-time comparison to prevent timing attacks
    const keyBuffer = Buffer.from(API_KEY);
    const providedBuffer = Buffer.from(providedKey);

    if (keyBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(keyBuffer, providedBuffer)) {
        auditLog('AUTH_FAILED', req.url, req.ip, 'Invalid API key');
        return res.status(401).json({ error: 'Invalid API key.' });
    }

    next();
}

// ══════════════════════════════════════════════════════════
// SECURITY LAYER 4: Rate Limiting
// ══════════════════════════════════════════════════════════

const limiter = rateLimit({
    windowMs: 60 * 1000,   // 1 minute
    max: 100,               // 100 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again later.' },
    handler: (req, res, next, options) => {
        auditLog('RATE_LIMITED', req.url, req.ip);
        res.status(429).json(options.message);
    },
});

// ══════════════════════════════════════════════════════════
// SECURITY LAYER 8: Read-Only Guard
// ══════════════════════════════════════════════════════════

function readOnlyGuard(req, res, next) {
    if (READ_ONLY) {
        auditLog('READ_ONLY_BLOCKED', req.url, req.ip, req.method);
        return res.status(403).json({ error: 'Server is in read-only mode.' });
    }
    next();
}

// ── Apply global middleware ───────────────────────────────
// Health check is exempt from auth (for monitoring)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        agent: 'steel-dms-storage-agent',
        storageRoot: STORAGE_ROOT,
        readOnly: READ_ONLY,
        timestamp: new Date().toISOString(),
    });
});

// All other routes require IP whitelist + API key + rate limit
app.use(ipWhitelist, apiKeyAuth, limiter);

// ══════════════════════════════════════════════════════════
// API ENDPOINTS
// ══════════════════════════════════════════════════════════

/**
 * GET /browse?path=<relativePath>
 * List directory contents.
 */
app.get('/browse', async (req, res) => {
    try {
        const dirPath = sanitizePath(req.query.path || '');

        const stat = await fsPromises.stat(dirPath);
        if (!stat.isDirectory()) {
            return res.status(400).json({ error: 'Path is not a directory.' });
        }

        const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
        const results = [];

        for (const entry of entries) {
            // Skip blocked file types
            if (entry.isFile() && isBlockedExtension(entry.name)) continue;

            try {
                const entryPath = path.join(dirPath, entry.name);
                const entryStat = await fsPromises.stat(entryPath);
                results.push({
                    name: entry.name,
                    type: entry.isDirectory() ? 'directory' : 'file',
                    size: entry.isDirectory() ? null : entryStat.size,
                    modified: entryStat.mtime.toISOString(),
                });
            } catch {
                // Skip inaccessible entries
            }
        }

        // Sort: directories first, then files
        results.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

        auditLog('BROWSE', req.query.path || '/', req.ip, `${results.length} entries`);

        res.json({
            path: req.query.path || '/',
            entries: results,
            count: results.length,
        });
    } catch (err) {
        if (err.message.includes('Access denied')) {
            return res.status(403).json({ error: err.message });
        }
        if (err.code === 'ENOENT') {
            return res.status(404).json({ error: 'Directory not found.' });
        }
        console.error('[Browse] Error:', err.message);
        res.status(500).json({ error: 'Failed to browse directory.' });
    }
});

/**
 * GET /info?path=<relativePath>
 * Get file metadata.
 */
app.get('/info', async (req, res) => {
    try {
        if (!req.query.path) {
            return res.status(400).json({ error: 'path query parameter is required.' });
        }

        const filePath = sanitizePath(req.query.path);
        const stat = await fsPromises.stat(filePath);

        if (!stat.isFile()) {
            return res.status(400).json({ error: 'Path is not a file.' });
        }

        const fileName = path.basename(filePath);
        if (isBlockedExtension(fileName)) {
            return res.status(403).json({ error: 'This file type is not allowed.' });
        }

        auditLog('INFO', req.query.path, req.ip);

        res.json({
            name: fileName,
            size: stat.size,
            mimeType: getMimeType(filePath),
            modified: stat.mtime.toISOString(),
            created: stat.birthtime.toISOString(),
        });
    } catch (err) {
        if (err.message.includes('Access denied')) {
            return res.status(403).json({ error: err.message });
        }
        if (err.code === 'ENOENT') {
            return res.status(404).json({ error: 'File not found.' });
        }
        console.error('[Info] Error:', err.message);
        res.status(500).json({ error: 'Failed to get file info.' });
    }
});

/**
 * GET /download?path=<relativePath>&disposition=inline|attachment
 * Stream a file to the client.
 */
app.get('/download', async (req, res) => {
    try {
        if (!req.query.path) {
            return res.status(400).json({ error: 'path query parameter is required.' });
        }

        const filePath = sanitizePath(req.query.path);
        const stat = await fsPromises.stat(filePath);

        if (!stat.isFile()) {
            return res.status(400).json({ error: 'Path is not a file.' });
        }

        const fileName = path.basename(filePath);
        if (isBlockedExtension(fileName)) {
            return res.status(403).json({ error: 'This file type is not allowed.' });
        }

        const mimeType = getMimeType(filePath);

        // Determine content disposition
        const inlineTypes = [
            'application/pdf',
            'image/png', 'image/jpeg', 'image/gif', 'image/bmp',
            'text/plain', 'text/csv',
        ];

        const forceDisposition = req.query.disposition;
        let disposition;
        if (forceDisposition === 'attachment') {
            disposition = 'attachment';
        } else if (forceDisposition === 'inline' || inlineTypes.includes(mimeType)) {
            disposition = 'inline';
        } else {
            disposition = 'attachment';
        }

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Length', stat.size);

        auditLog('DOWNLOAD', req.query.path, req.ip, `${stat.size} bytes`);

        const stream = fs.createReadStream(filePath);
        stream.on('error', (err) => {
            console.error('[Download] Stream error:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to stream file.' });
            }
        });
        stream.pipe(res);
    } catch (err) {
        if (err.message.includes('Access denied')) {
            return res.status(403).json({ error: err.message });
        }
        if (err.code === 'ENOENT') {
            return res.status(404).json({ error: 'File not found.' });
        }
        console.error('[Download] Error:', err.message);
        res.status(500).json({ error: 'Failed to download file.' });
    }
});

/**
 * GET /search?q=<query>&path=<relativePath>
 * Recursive filename search.
 */
app.get('/search', async (req, res) => {
    try {
        const query = (req.query.q || '').toLowerCase().trim();
        const searchRoot = req.query.path || '';

        if (!query || query.length < 2) {
            return res.status(400).json({ error: 'Search query must be at least 2 characters.' });
        }

        const rootPath = sanitizePath(searchRoot);
        const results = [];
        const MAX_RESULTS = 100;

        async function searchDir(dirPath, relPath) {
            if (results.length >= MAX_RESULTS) return;

            try {
                const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

                for (const entry of entries) {
                    if (results.length >= MAX_RESULTS) break;

                    const entryAbsPath = path.join(dirPath, entry.name);
                    const entryRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;

                    // Skip blocked extensions
                    if (entry.isFile() && isBlockedExtension(entry.name)) continue;

                    if (entry.name.toLowerCase().includes(query)) {
                        try {
                            const stat = await fsPromises.stat(entryAbsPath);
                            results.push({
                                name: entry.name,
                                type: entry.isDirectory() ? 'directory' : 'file',
                                size: entry.isDirectory() ? null : stat.size,
                                modified: stat.mtime.toISOString(),
                                path: entryRelPath,
                            });
                        } catch { /* skip */ }
                    }

                    if (entry.isDirectory()) {
                        await searchDir(entryAbsPath, entryRelPath);
                    }
                }
            } catch { /* skip inaccessible directories */ }
        }

        await searchDir(rootPath, searchRoot);

        auditLog('SEARCH', searchRoot || '/', req.ip, `q="${query}" found=${results.length}`);

        res.json({
            query,
            searchRoot: searchRoot || '/',
            results,
            count: results.length,
            truncated: results.length >= MAX_RESULTS,
        });
    } catch (err) {
        console.error('[Search] Error:', err.message);
        res.status(500).json({ error: 'Search failed.' });
    }
});

/**
 * POST /upload
 * Upload file(s) to a target directory.
 * Body (multipart/form-data): files + targetPath
 */
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_UPLOAD_MB * 1024 * 1024,
        files: 50,
    },
});

app.post('/upload', readOnlyGuard, upload.array('files'), async (req, res) => {
    try {
        const targetDir = req.body.targetPath || '';

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded.' });
        }

        const dirPath = sanitizePath(targetDir);
        await fsPromises.mkdir(dirPath, { recursive: true });

        const results = [];

        for (const file of req.files) {
            // Block dangerous file types
            if (isBlockedExtension(file.originalname)) {
                results.push({
                    name: file.originalname,
                    status: 'blocked',
                    error: 'File type not allowed.',
                });
                continue;
            }

            const filePath = path.join(dirPath, file.originalname);

            // Double-check path doesn't escape root
            const normalizedRoot = path.normalize(STORAGE_ROOT);
            if (!path.normalize(filePath).startsWith(normalizedRoot)) {
                results.push({
                    name: file.originalname,
                    status: 'blocked',
                    error: 'Invalid file path.',
                });
                continue;
            }

            try {
                await fsPromises.writeFile(filePath, file.buffer);
                auditLog('UPLOAD', `${targetDir}/${file.originalname}`, req.ip, `${file.size} bytes`);
                results.push({
                    name: file.originalname,
                    size: file.size,
                    path: targetDir ? `${targetDir}/${file.originalname}` : file.originalname,
                    status: 'saved',
                });
            } catch (writeErr) {
                results.push({
                    name: file.originalname,
                    status: 'failed',
                    error: writeErr.message,
                });
            }
        }

        const successCount = results.filter(r => r.status === 'saved').length;
        res.status(successCount > 0 ? 201 : 500).json({
            message: `${successCount} of ${req.files.length} file(s) saved.`,
            results,
        });
    } catch (err) {
        if (err.message.includes('Access denied')) {
            return res.status(403).json({ error: err.message });
        }
        console.error('[Upload] Error:', err.message);
        res.status(500).json({ error: 'Upload failed.' });
    }
});

// Multer error handler
app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `File too large. Maximum ${MAX_UPLOAD_MB} MB.` });
    }
    if (err.message) {
        return res.status(400).json({ error: err.message });
    }
    next(err);
});

/**
 * DELETE /delete?path=<relativePath>
 * Delete a file.
 */
app.delete('/delete', readOnlyGuard, async (req, res) => {
    try {
        if (!req.query.path) {
            return res.status(400).json({ error: 'path query parameter is required.' });
        }

        const filePath = sanitizePath(req.query.path);
        const stat = await fsPromises.stat(filePath);

        if (!stat.isFile()) {
            return res.status(400).json({ error: 'Path is not a file. Directory deletion is not allowed.' });
        }

        await fsPromises.unlink(filePath);

        auditLog('DELETE', req.query.path, req.ip);

        res.json({ message: 'File deleted.', path: req.query.path });
    } catch (err) {
        if (err.message.includes('Access denied')) {
            return res.status(403).json({ error: err.message });
        }
        if (err.code === 'ENOENT') {
            return res.status(404).json({ error: 'File not found.' });
        }
        console.error('[Delete] Error:', err.message);
        res.status(500).json({ error: 'Delete failed.' });
    }
});

// ── 404 handler ───────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found.' });
});

// ── Global error handler ──────────────────────────────────
app.use((err, req, res, next) => {
    console.error('[Agent] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
});

// ══════════════════════════════════════════════════════════
// START SERVER
// ══════════════════════════════════════════════════════════

const configErrors = validateConfig();

if (configErrors.length > 0) {
    console.error('\n╔════════════════════════════════════════════╗');
    console.error('║   STORAGE AGENT — CONFIGURATION ERRORS     ║');
    console.error('╠════════════════════════════════════════════╣');
    configErrors.forEach(err => {
        console.error(`║  ✗ ${err}`);
    });
    console.error('╚════════════════════════════════════════════╝\n');
    console.error('Fix the errors above in .env and restart.\n');
    process.exit(1);
}

app.listen(PORT, () => {
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║   STEEL DMS — STORAGE AGENT                ║');
    console.log('╠════════════════════════════════════════════╣');
    console.log(`║  Port:         ${PORT}`);
    console.log(`║  Storage Root: ${STORAGE_ROOT}`);
    console.log(`║  Read-Only:    ${READ_ONLY}`);
    console.log(`║  IP Whitelist: ${ALLOWED_IPS.length > 0 ? ALLOWED_IPS.join(', ') : 'Disabled (all allowed)'}`);
    console.log(`║  Rate Limit:   100 req/min`);
    console.log(`║  Blocked Exts: ${BLOCKED_EXTENSIONS.join(', ')}`);
    console.log(`║  Audit Log:    ${AUDIT_LOG_PATH}`);
    console.log('╚════════════════════════════════════════════╝');
    console.log(`\n[Agent] Ready at http://localhost:${PORT}`);
    console.log('[Agent] Waiting for connections from Steel DMS cloud app...\n');
});
