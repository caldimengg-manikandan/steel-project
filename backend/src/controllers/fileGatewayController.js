/**
 * ============================================================
 * File Gateway Controller
 * ============================================================
 * API Gateway endpoints for browsing, downloading, uploading,
 * and deleting files on the remote Windows storage drive.
 *
 * All access goes through the storageGateway HTTP client which
 * calls the Storage Agent running on the Windows server.
 *
 * Security:
 *   - JWT authentication via middleware (verifyToken)
 *   - Project scope enforcement where applicable
 *   - Path traversal prevention on the agent side
 *   - API key authentication between cloud app and agent
 */
const storageGateway = require('../utils/storageGateway');

/**
 * GET /api/files/browse?path=<relativePath>
 * ──────────────────────────────────────────
 * List directory contents at the given path on the storage drive.
 */
exports.browse = async (req, res) => {
    try {
        const requestedPath = req.query.path || '';
        const entries = await storageGateway.listDirectory(requestedPath);

        res.json({
            path: requestedPath || '/',
            entries,
            count: entries.length,
        });
    } catch (err) {
        console.error('[FileGateway] Browse error:', err.message);
        const status = err.message.includes('Access denied') ? 403
            : err.message.includes('not found') ? 404 : 502;
        res.status(status).json({ error: err.message });
    }
};

/**
 * GET /api/files/info?path=<relativePath>
 * ────────────────────────────────────────
 * Get metadata about a single file.
 */
exports.info = async (req, res) => {
    try {
        if (!req.query.path) {
            return res.status(400).json({ error: 'path query parameter is required.' });
        }

        const fileInfo = await storageGateway.getFileInfo(req.query.path);
        res.json(fileInfo);
    } catch (err) {
        console.error('[FileGateway] Info error:', err.message);
        const status = err.message.includes('Access denied') ? 403
            : err.message.includes('not found') ? 404 : 502;
        res.status(status).json({ error: err.message });
    }
};

/**
 * GET /api/files/download?path=<relativePath>
 * ─────────────────────────────────────────────
 * Proxy-stream a file from the storage agent to the client.
 */
exports.download = async (req, res) => {
    try {
        if (!req.query.path) {
            return res.status(400).json({ error: 'path query parameter is required.' });
        }

        const { stream, contentType, contentLength, contentDisposition } =
            await storageGateway.getFileStream(req.query.path);

        // Forward headers from the agent
        if (contentType) res.setHeader('Content-Type', contentType);
        if (contentLength) res.setHeader('Content-Length', contentLength);
        if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition);

        stream.on('error', (err) => {
            console.error('[FileGateway] Stream error:', err.message);
            if (!res.headersSent) {
                res.status(502).json({ error: 'Failed to stream file from storage.' });
            }
        });

        stream.pipe(res);
    } catch (err) {
        console.error('[FileGateway] Download error:', err.message);
        const status = err.message.includes('Access denied') ? 403
            : err.message.includes('not found') ? 404 : 502;
        res.status(status).json({ error: err.message });
    }
};

/**
 * POST /api/files/upload
 * ───────────────────────
 * Upload file(s) to the storage drive via the agent.
 *
 * Body (multipart/form-data):
 *   - files: the file(s) to upload
 *   - targetPath: relative directory path to save into
 */
exports.upload = async (req, res) => {
    try {
        const targetDir = req.body.targetPath || '';

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded.' });
        }

        const results = [];

        for (const file of req.files) {
            try {
                const result = await storageGateway.uploadFile(
                    targetDir,
                    file.originalname,
                    file.buffer
                );
                results.push({
                    name: file.originalname,
                    size: file.size,
                    status: 'saved',
                });
            } catch (fileErr) {
                console.error(`[FileGateway] Upload error for ${file.originalname}:`, fileErr.message);
                results.push({
                    name: file.originalname,
                    status: 'failed',
                    error: fileErr.message,
                });
            }
        }

        const successCount = results.filter(r => r.status === 'saved').length;
        const failCount = results.filter(r => r.status === 'failed').length;

        res.status(failCount === results.length ? 502 : 201).json({
            message: `${successCount} file(s) saved, ${failCount} failed.`,
            results,
        });
    } catch (err) {
        console.error('[FileGateway] Upload error:', err.message);
        res.status(502).json({ error: err.message });
    }
};

/**
 * DELETE /api/files/remove?path=<relativePath>
 * ──────────────────────────────────────────────
 * Delete a file from the storage drive. Admin-only.
 */
exports.remove = async (req, res) => {
    try {
        if (!req.query.path) {
            return res.status(400).json({ error: 'path query parameter is required.' });
        }

        await storageGateway.deleteFile(req.query.path);

        res.json({
            message: 'File deleted successfully.',
            path: req.query.path,
        });
    } catch (err) {
        console.error('[FileGateway] Delete error:', err.message);
        const status = err.message.includes('Access denied') ? 403
            : err.message.includes('not found') ? 404 : 502;
        res.status(status).json({ error: err.message });
    }
};

/**
 * GET /api/files/search?q=<query>&path=<relativePath>
 * ─────────────────────────────────────────────────────
 * Search for files by name on the storage drive.
 */
exports.search = async (req, res) => {
    try {
        const query = (req.query.q || '').trim();
        const searchRoot = req.query.path || '';

        if (!query || query.length < 2) {
            return res.status(400).json({ error: 'Search query must be at least 2 characters.' });
        }

        const result = await storageGateway.searchFiles(query, searchRoot);
        res.json(result);
    } catch (err) {
        console.error('[FileGateway] Search error:', err.message);
        res.status(502).json({ error: err.message });
    }
};
