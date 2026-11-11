/**
 * ============================================================
 * GridFS Storage Engine Utility (Custom Implementation)
 * ============================================================
 * We implement a custom storage engine for Multer to manage GridFS.
 * This bypasses version mismatch bugs in 'multer-gridfs-storage'.
 */
const mongoose = require('mongoose');
const crypto = require('crypto');
const path = require('path');

let gfs;
let bucket;

/**
 * initGridFS
 * Must be called after the main mongoose connection is open.
 */
function initGridFS() {
    const conn = mongoose.connection;
    bucket = new mongoose.mongo.GridFSBucket(conn.db, {
        bucketName: 'uploads'
    });
    gfs = bucket;
    console.log('[GridFS] Custom storage engine initialized: "uploads"');
}

/**
 * Custom Multer Storage Engine for GridFS
 * Implements _handleFile and _removeFile as required by Multer.
 */
const storage = {
    _handleFile: function (req, file, cb) {
        // Wait for bucket or fail
        if (!bucket) {
            return cb(new Error('GridFS bucket not initialized yet. Please wait.'));
        }

        crypto.randomBytes(16, (err, buf) => {
            if (err) return cb(err);

            const filename = buf.toString('hex') + path.extname(file.originalname);
            const uploadStream = bucket.openUploadStream(filename, {
                contentType: file.mimetype,
                metadata: {
                    originalName: file.originalname,
                    projectId: req.params.projectId,
                    adminId: req.principal ? req.principal.adminId : null,
                    type: file.fieldname // e.g. "drawings" or "rfis"
                }
            });

            file.stream.pipe(uploadStream);

            uploadStream.on('error', (error) => {
                console.error('[GridFS] Upload error:', error);
                cb(error);
            });

            uploadStream.on('finish', () => {
                // Return information to Multer so it attaches it to req.files
                cb(null, {
                    id: uploadStream.id,
                    filename: filename,
                    metadata: uploadStream.options.metadata
                });
            });
        });
    },

    _removeFile: function (req, file, cb) {
        if (!bucket) return cb(null);
        bucket.delete(file.id, cb);
    }
};

/**
 * ensureStorageQuota
 * ───────────────────
 * Caps uploads.chunks size at maxAllowedMB (default 200 MB).
 * If total GridFS files exceed this limit, oldest files and their chunks
 * are automatically deleted to prevent Atlas quota crashes.
 */
async function ensureStorageQuota(maxAllowedMB = 200) {
    try {
        const conn = mongoose.connection;
        if (!conn || !conn.db) return;
        const db = conn.db;

        const maxBytes = maxAllowedMB * 1024 * 1024;
        const files = await db.collection('uploads.files').find({}).sort({ uploadDate: 1 }).toArray();
        let totalBytes = files.reduce((sum, f) => sum + (f.length || 0), 0);

        if (totalBytes <= maxBytes) {
            return; // Within safe quota
        }

        console.log(`[GridFS Quota Guard] Usage (${(totalBytes / (1024 * 1024)).toFixed(1)} MB) exceeds ${maxAllowedMB} MB. Pruning oldest chunks...`);

        const targetBytes = (maxAllowedMB * 0.5) * 1024 * 1024; // Prune down to 50%
        const idsToDelete = [];
        let bytesToPrune = totalBytes - targetBytes;
        let prunedBytes = 0;

        for (const file of files) {
            if (prunedBytes >= bytesToPrune) break;
            idsToDelete.push(file._id);
            prunedBytes += (file.length || 0);
        }

        if (idsToDelete.length > 0) {
            const batchSize = 100;
            for (let i = 0; i < idsToDelete.length; i += batchSize) {
                const batch = idsToDelete.slice(i, i + batchSize);
                await db.collection('uploads.chunks').deleteMany({ files_id: { $in: batch } }).catch(() => {});
            }
            await db.collection('uploads.files').deleteMany({ _id: { $in: idsToDelete } }).catch(() => {});
            console.log(`[GridFS Quota Guard] Cleaned up ${idsToDelete.length} oldest file(s) (${(prunedBytes / (1024 * 1024)).toFixed(1)} MB freed).`);
        }
    } catch (err) {
        console.warn('[GridFS Quota Guard] Pruning warning:', err.message);
    }
}

module.exports = {
    initGridFS,
    getGridFS: () => gfs,
    getBucket: () => bucket,
    ensureStorageQuota,
    storage
};
