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

function getErrorStatus(err) {
    const msg = err.message || '';
    if (msg.includes('Access denied')) return 403;
    if (msg.includes('not found')) return 404;
    if (msg.includes('Cannot reach Storage Agent') || msg.includes('fetch failed') || msg.includes('timeout')) return 504;
    return 400;
}

const DrawingExtraction = require('../models/DrawingExtraction');
const RfiExtraction = require('../models/RfiExtraction');
const CdrfiExtraction = require('../models/CdrfiExtraction');

/**
 * GET /api/files/browse?path=<relativePath>
 * ──────────────────────────────────────────
 * List directory contents at the given path on the storage drive.
 */
exports.browse = async (req, res) => {
    try {
        const requestedPath = req.query.path || '';
        let entries = [];
        let agentBrowseFailed = false;
        try {
            entries = await storageGateway.listDirectory(requestedPath);
        } catch(err) {
            agentBrowseFailed = true;
            console.warn('[FileGateway] Storage Agent browse failed, falling back to DB:', err.message);
        }

        // Database Fallback: ONLY reconstruct folder view from Extraction records
        // IF the Storage Agent is offline, disconnected, or threw an error.
        if (agentBrowseFailed && requestedPath) {
            const pathRegex = new RegExp('^' + requestedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/');
            const [drawingDocs, rfiDocs, cdrfiDocs] = await Promise.all([
                DrawingExtraction.find({ storageGatewayPath: { $regex: pathRegex } }).lean(),
                RfiExtraction.find({ storageGatewayPath: { $regex: pathRegex } }).lean(),
                CdrfiExtraction.find({ storageGatewayPath: { $regex: pathRegex } }).lean()
            ]);
            
            const dbEntriesMap = {};
            entries.forEach(e => { dbEntriesMap[e.name] = e; });
            
            const mergeDocs = (docs) => {
                docs.forEach(d => {
                    if (!d.storageGatewayPath) return;
                    const relPath = d.storageGatewayPath.replace(requestedPath + '/', '');
                    if (!relPath || relPath.startsWith('/')) return;
                    
                    const parts = relPath.split('/');
                    const name = parts[0];
                    const isFile = parts.length === 1;

                    if (!dbEntriesMap[name]) {
                        dbEntriesMap[name] = {
                            name: name,
                            type: isFile ? 'file' : 'directory',
                            size: isFile ? (d.fileSize || 0) : null,
                            modified: (d.createdAt || new Date()).toISOString(),
                            uploadedBy: d.uploadedBy
                        };
                    }
                });
            };
            
            mergeDocs(drawingDocs);
            mergeDocs(rfiDocs);
            mergeDocs(cdrfiDocs);
            
            entries = Object.values(dbEntriesMap);
        }

        // Fetch uploadedBy usernames from DB for file items that don't have it yet
        const fileNames = entries.filter(e => e.type !== 'directory' && !e.uploadedBy).map(e => e.name);
        if (fileNames.length > 0) {
            const [drawingDocs, rfiDocs, cdrfiDocs] = await Promise.all([
                DrawingExtraction.find({ originalFileName: { $in: fileNames } }).select('originalFileName uploadedBy').lean(),
                RfiExtraction.find({ originalFileName: { $in: fileNames } }).select('originalFileName uploadedBy').lean(),
                CdrfiExtraction.find({ originalFileName: { $in: fileNames } }).select('originalFileName uploadedBy').lean(),
            ]);

            const userMap = {};
            drawingDocs.forEach(d => { userMap[d.originalFileName] = d.uploadedBy; });
            rfiDocs.forEach(r => { userMap[r.originalFileName] = r.uploadedBy; });
            cdrfiDocs.forEach(c => { userMap[c.originalFileName] = c.uploadedBy; });

            entries.forEach(e => {
                if (e.type !== 'directory' && !e.uploadedBy && userMap[e.name]) {
                    e.uploadedBy = userMap[e.name];
                }
            });
        }

        // Filter out leftover test folders from testing sessions
        entries = entries.filter(e => 
            !e.name.startsWith('test_delete') && 
            !e.name.startsWith('test_folder') && 
            !e.name.startsWith('test_nested')
        );

        // Filter out paths that have been deleted so they never reappear in the UI
        try {
            const DeletedStoragePath = require('../models/DeletedStoragePath');
            const deletedDocs = await DeletedStoragePath.find({}).select('path').lean();
            if (deletedDocs && deletedDocs.length > 0) {
                const deletedSet = new Set(
                    deletedDocs.map(d => d.path.toLowerCase().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, ''))
                );
                const reqNorm = (requestedPath || '').toLowerCase().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');

                entries = entries.filter(e => {
                    const itemNorm = reqNorm ? `${reqNorm}/${e.name.toLowerCase()}` : e.name.toLowerCase();
                    if (deletedSet.has(itemNorm)) return false;
                    for (const del of deletedSet) {
                        if (itemNorm.startsWith(del + '/')) return false;
                    }
                    return true;
                });
            }
        } catch (filterErr) {
            console.warn('[FileGateway] Error filtering deleted paths in browse:', filterErr.message);
        }

        res.json({
            path: requestedPath || '/',
            entries,
            count: entries.length,
        });
    } catch (err) {
        console.error('[FileGateway] Browse error:', err.message);
        res.status(getErrorStatus(err)).json({ error: err.message });
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
        res.status(getErrorStatus(err)).json({ error: err.message });
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
        res.status(getErrorStatus(err)).json({ error: err.message });
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
// Helper function to check if a file is a Transmittal or Drawing Log file
function isLogFile(filename) {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    return lower.includes('transmittal') || lower.includes('drawing_log') || lower.includes('drawing log') || lower.includes('master_log') || lower.includes('master log');
}

// Helper function to sanitize targetDir so non-log files are never placed inside /Logs
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

exports.upload = async (req, res) => {
    try {
        const targetDir = req.body.targetPath || '';

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded.' });
        }

        const results = [];

        for (const file of req.files) {
            try {
                const finalTargetDir = sanitizeUploadTargetDir(targetDir, file.originalname);
                const result = await storageGateway.uploadFile(
                    finalTargetDir,
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

        res.status(failCount === results.length ? getErrorStatus(new Error(results[0]?.error || 'Upload failed')) : 201).json({
            message: `${successCount} file(s) saved, ${failCount} failed.`,
            results,
        });
    } catch (err) {
        console.error('[FileGateway] Upload error:', err.message);
        res.status(getErrorStatus(err)).json({ error: err.message });
    }
};

/**
 * DELETE /api/files/remove?path=<relativePath>
 * ──────────────────────────────────────────────
 * Delete a file or folder from the storage drive. Admin-only.
 * Also cleans up any matching DrawingExtraction records in the DB.
 */
exports.remove = async (req, res) => {
    try {
        if (!req.query.path) {
            return res.status(400).json({ error: 'path query parameter is required.' });
        }

        const deletedPath = req.query.path;

        // Delete from remote storage server (try/catch to avoid blocking DB cleanup on storage errors)
        let storageError = null;
        try {
            await storageGateway.deleteFile(deletedPath);
        } catch (sErr) {
            console.warn(`[FileGateway] Storage server delete warning for "${deletedPath}":`, sErr.message);
            storageError = sErr;
        }

        // Clean up matching DrawingExtraction records from the database
        // This covers single-file deletes, subfolder deletes, and root project folder deletes
        try {
            const DrawingExtraction = require('../models/DrawingExtraction');
            const DrawingLog = require('../models/DrawingLog');
            const Transmittal = require('../models/Transmittal');
            const RfiExtraction = require('../models/RfiExtraction');
            const CdrfiExtraction = require('../models/CdrfiExtraction');
            const Project = require('../models/Project');

            const cleanPath = deletedPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
            const altPath = cleanPath.includes('_') ? cleanPath.replace(/_/g, ' ') : cleanPath.replace(/ /g, '_');
            const pathParts = cleanPath.split('/').filter(Boolean);

            const searchConditions = [
                { storageGatewayPath: cleanPath },
                { storageGatewayPath: { $regex: `^${cleanPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`, $options: 'i' } }
            ];
            if (altPath !== cleanPath) {
                searchConditions.push(
                    { storageGatewayPath: altPath },
                    { storageGatewayPath: { $regex: `^${altPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`, $options: 'i' } }
                );
            }

            // If deleting a specific file (e.g. filename.pdf)
            const fileName = pathParts[pathParts.length - 1];
            if (fileName && fileName.includes('.')) {
                searchConditions.push({ originalFileName: new RegExp(`^${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
            }

            let proj = null;
            let folderPathInProject = cleanPath;
            let isProjectRoot = false;

            // If deleting under or the entire project folder: Projects/<ProjectName>
            if (pathParts.length >= 2 && pathParts[0].toLowerCase() === 'projects') {
                const projName = pathParts[1].replace(/_/g, ' ');
                proj = await Project.findOne({
                    $or: [
                        { name: new RegExp(`^${projName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
                        { name: new RegExp(`^${pathParts[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
                    ]
                }).lean();

                isProjectRoot = pathParts.length === 2;
                folderPathInProject = isProjectRoot ? `Project Root Folder (${cleanPath})` : pathParts.slice(2).join('/');

                if (proj && isProjectRoot) {
                    searchConditions.push({ projectId: proj._id });
                }
            } else if (pathParts.length >= 1) {
                const projName = pathParts[0].replace(/_/g, ' ');
                proj = await Project.findOne({
                    $or: [
                        { name: new RegExp(`^${projName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
                        { name: new RegExp(`^${pathParts[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
                    ]
                }).lean();
                if (proj) {
                    isProjectRoot = pathParts.length === 1;
                    folderPathInProject = isProjectRoot ? `Project Root Folder (${cleanPath})` : pathParts.slice(1).join('/');
                    if (isProjectRoot) {
                        searchConditions.push({ projectId: proj._id });
                    }
                }
            }

            // 1. Identify affected drawings before deletion for DrawingLog cleanup
            const matchingExts = await DrawingExtraction.find({ $or: searchConditions })
                .select('extractedFields.drawingNumber originalFileName')
                .lean();
            const deletedDrawingNumbers = matchingExts.map(e => e.extractedFields?.drawingNumber).filter(Boolean);
            const deletedFileNames = matchingExts.map(e => e.originalFileName).filter(Boolean);
            if (fileName && fileName.includes('.')) {
                deletedFileNames.push(fileName);
            }

            // 2. Delete matching extractions across all types
            const deleteResult = await DrawingExtraction.deleteMany({ $or: searchConditions });
            await RfiExtraction.deleteMany({ $or: searchConditions }).catch(() => {});
            await CdrfiExtraction.deleteMany({ $or: searchConditions }).catch(() => {});

            // 3. Clean up DrawingLog, Transmittals, and Project counters
            if (proj) {
                if (isProjectRoot) {
                    // Full project folder deleted -> wipe DrawingLog and Transmittals
                    await DrawingLog.deleteMany({ projectId: proj._id }).catch(() => {});
                    await Transmittal.deleteMany({ projectId: proj._id }).catch(() => {});
                    await Project.findByIdAndUpdate(proj._id, { drawingCount: 0, approximateDrawingsCount: 0, transmittalCount: 0 });
                    console.log(`[FileGateway] Full project root deleted for "${proj.name}". Wiped DrawingLog and Transmittals.`);
                } else {
                    // Subfolder or files deleted -> remove affected drawings from DrawingLog
                    const pullOr = [];
                    if (deletedDrawingNumbers.length > 0) {
                        pullOr.push({ drawingNumber: { $in: deletedDrawingNumbers } });
                    }
                    if (deletedFileNames.length > 0) {
                        pullOr.push({ originalFileName: { $in: deletedFileNames } });
                    }
                    if (pullOr.length > 0) {
                        await DrawingLog.updateMany(
                            { projectId: proj._id },
                            { $pull: { drawings: { $or: pullOr } } }
                        ).catch(e => console.warn('[FileGateway] Error updating DrawingLog:', e.message));
                    }

                    // If a specific transmittal Excel file in Logs/ was deleted (e.g. TR-001_Transmittal.xlsx)
                    const trMatch = fileName && fileName.match(/TR-?(\d+)/i);
                    if (trMatch) {
                        const trNum = parseInt(trMatch[1], 10);
                        await Transmittal.deleteMany({ projectId: proj._id, transmittalNumber: trNum }).catch(() => {});
                        console.log(`[FileGateway] Removed Transmittal #${trNum} matching deleted Excel log.`);
                    }

                    // Recalculate remaining project drawing count
                    const remainingCount = await DrawingExtraction.countDocuments({ projectId: proj._id, status: 'completed' });
                    await Project.findByIdAndUpdate(proj._id, { drawingCount: remainingCount, approximateDrawingsCount: remainingCount });
                    console.log(`[FileGateway] Updated Project "${proj.name}" drawing count to ${remainingCount}.`);
                }
            }

            // Send automated email alert strictly to that particular team (PM, APM, Team Lead)
            if (proj) {
                try {
                    const User = require('../models/User');
                    const { sendFolderDeletionAlert } = require('../services/emailService');
                    let userDoc = null;
                    if (req.principal?.id && req.principal.id !== 'viewer') {
                        userDoc = await User.findById(req.principal.id).select('displayName email role username').lean();
                    }
                    const deletedBy = {
                        username: req.principal?.username || 'Unknown',
                        displayName: userDoc?.displayName || req.principal?.username || 'User',
                        email: req.principal?.email || userDoc?.email || '',
                        role: req.principal?.role || 'user'
                    };

                    sendFolderDeletionAlert({
                        project: proj,
                        deletedItemPath: folderPathInProject,
                        deletedBy,
                        isProjectDeletion: isProjectRoot
                    }).catch(mailErr => {
                        console.error('[FileGateway] Email notification error:', mailErr.message);
                    });
                } catch (emailErr) {
                    console.error('[FileGateway] Error preparing email alert:', emailErr.message);
                }
            }
        } catch (dbErr) {
            console.error('[FileGateway] DB cleanup warning:', dbErr.message);
        }

        // Record in DeletedStoragePath so it is permanently filtered out of project storage
        try {
            const DeletedStoragePath = require('../models/DeletedStoragePath');
            const cleanPath = deletedPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
            const altPath = cleanPath.includes('_') ? cleanPath.replace(/_/g, ' ') : cleanPath.replace(/ /g, '_');
            await DeletedStoragePath.updateOne(
                { path: cleanPath },
                { $set: { path: cleanPath, deletedAt: new Date(), deletedBy: req.principal?.username || 'user' } },
                { upsert: true }
            );
            if (altPath !== cleanPath) {
                await DeletedStoragePath.updateOne(
                    { path: altPath },
                    { $set: { path: altPath, deletedAt: new Date(), deletedBy: req.principal?.username || 'user' } },
                    { upsert: true }
                );
            }
        } catch (delPathErr) {
            console.warn('[FileGateway] Error saving DeletedStoragePath:', delPathErr.message);
        }

        res.json({
            message: 'File deleted successfully.',
            path: deletedPath,
        });
    } catch (err) {
        console.error('[FileGateway] Delete error:', err.message);
        res.status(getErrorStatus(err)).json({ error: err.message });
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
        res.status(getErrorStatus(err)).json({ error: err.message });
    }
};
