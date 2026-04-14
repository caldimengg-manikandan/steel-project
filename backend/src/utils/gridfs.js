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

module.exports = {
    initGridFS,
    getGridFS: () => gfs,
    getBucket: () => bucket,
    storage
};
