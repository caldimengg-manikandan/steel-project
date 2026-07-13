const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rclone = require('./rcloneOneDrive');

/**
 * ============================================================
 * OneDrive Storage Engine Utility (Rclone + Bridge Implementation)
 * ============================================================
 * Implements a "Bridge" storage strategy using Rclone:
 *  1. Primary: Save to local 'uploads/temp' (Fast & Reliable Bridge)
 *  2. Secondary: Attempt background upload to OneDrive via Rclone
 */

// Placeholder for compatibility if needed elsewhere, but Rclone doesn't need init
async function initOneDrive() {
    return true; 
}

/**
 * Custom Multer Storage Engine (Bridge Strategy)
 */
const storage = {
    _handleFile: async function (req, file, cb) {
        try {
            // STEP 1: Always save to local "Bridge" folder first for speed
            // Use os.tmpdir() for hosted environments where project folders are read-only
            const os = require('os');
            const tempDir = path.join(os.tmpdir(), 'steel-dms-uploads');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            const uniqueFilename = `${crypto.randomUUID()}${path.extname(file.originalname)}`;
            const localPath = path.join(tempDir, uniqueFilename);
            const outStream = fs.createWriteStream(localPath);

            file.stream.pipe(outStream);

            outStream.on('error', (err) => cb(err));
            
            outStream.on('finish', async () => {
                const fileSize = outStream.bytesWritten;
                const fileInfo = {
                    id: uniqueFilename, // Used as the key for rclone
                    filename: uniqueFilename,
                    path: localPath,
                    isLocal: true, // Mark as bridge file
                    originalname: file.originalname,
                    mimetype: file.mimetype,
                    size: fileSize,
                    oneDriveFileId: uniqueFilename // We use the filename as the ID for Rclone paths
                };

                // STEP 2: Background attempt to OneDrive (Non-blocking Bridge) - use Rclone
                console.log(`[Bridge] Syncing ${file.originalname} to OneDrive via Rclone...`);
                rclone.uploadFile(localPath, uniqueFilename)
                    .then(() => {
                        console.log(`[Bridge] Rclone sync complete: ${uniqueFilename}`);
                    })
                    .catch(err => console.warn('[Bridge] Rclone sync deferred:', err.message));

                cb(null, fileInfo);
            });
        } catch (err) {
            cb(err);
        }
    },

    _removeFile: async function (req, file, cb) {
        try {
            // Remove local bridge file
            if (file.path && fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
            // Remove from OneDrive via Rclone
            if (file.oneDriveFileId) {
                await rclone.deleteFile(file.oneDriveFileId);
            }
            cb(null);
        } catch (err) {
            cb(err);
        }
    }
};

/**
 * Downloads/Streams a file (from Local Bridge or OneDrive)
 */
async function downloadFile(fileId, destPath) {
    // Determine if fileId is an absolute path or just a filename
    const isAbsolute = path.isAbsolute(fileId);
    const os = require('os');
    const fileName = isAbsolute ? path.basename(fileId) : fileId;
    const localAttempt = isAbsolute ? fileId : path.join(os.tmpdir(), 'steel-dms-uploads', fileName);

    console.log(`[OneDrive] Download request for: ${fileId} -> ${destPath}`);
    console.log(`[OneDrive] Checking local bridge: ${localAttempt}`);

    // Check local bridge first
    if (fs.existsSync(localAttempt)) {
        if (localAttempt !== destPath) {
            fs.copyFileSync(localAttempt, destPath);
        }
        return destPath;
    }

    // Fallback to OneDrive via Rclone copyto
    const { exec } = require('child_process');
    const folder = process.env.ONEDRIVE_FOLDER_PATH || 'SteelDMS_Uploads';
    const RCLONE_BIN = (process.platform === 'win32' && fs.existsSync(path.join(process.cwd(), 'rclone.exe'))) 
        ? `"${path.join(process.cwd(), 'rclone.exe')}"` 
        : 'rclone';
    
    console.log(`[OneDrive] Not in bridge. Fetching from OneDrive: ${folder}/${fileName}`);
    
    return new Promise((resolve, reject) => {
        exec(`${RCLONE_BIN} copyto "onedrive:${folder}/${fileName}" "${destPath}"`, (error, stdout, stderr) => {
            if (error) {
                console.error(`[OneDrive] Rclone fetch failed: ${stderr}`);
                return reject(new Error('File not found in Bridge or OneDrive'));
            }
            resolve(destPath);
        });
    });
}

module.exports = {
    initOneDrive,
    storage,
    downloadFile,
    getGraphClient: () => null // Deprecated Graph API client
};
