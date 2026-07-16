const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const storageGateway = require('./storageGateway');

/**
 * ============================================================
 * Storage Gateway Sync Engine (Multer Storage)
 * ============================================================
 * Replaces the old OneDrive bridge.
 * 1. Saves uploaded file to local temp directory (so Python scripts can read it).
 * 2. Uploads file to the physical Windows Server Drive via Storage Gateway.
 * 3. Returns the storageGatewayPath in the file metadata.
 */

function createStorageAgentSync(folderPrefix) {
    return {
        _handleFile: async function (req, file, cb) {
            try {
                // 1. Save locally first
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
                        id: uniqueFilename,
                        filename: uniqueFilename,
                        path: localPath, 
                        originalname: file.originalname,
                        mimetype: file.mimetype,
                        size: fileSize,
                    };

                    // 2. Upload to Storage Gateway
                    if (storageGateway.isEnabled()) {
                        try {
                            const projectName = req.scopedProject?.name || 'UnknownProject';
                            const safeProjectName = projectName.replace(/[^a-zA-Z0-9 _-]/g, '_');
                            // e.g. Projects/MyProject/Extraction
                            const targetDir = `Projects/${safeProjectName}/${folderPrefix}`;
                            
                            console.log(`[StorageSync] Uploading ${file.originalname} to Windows Server -> ${targetDir}`);
                            
                            const buffer = fs.readFileSync(localPath);
                            await storageGateway.uploadFile(targetDir, file.originalname, buffer);
                            
                            fileInfo.storageGatewayPath = `${targetDir}/${file.originalname}`;
                            console.log(`[StorageSync] Upload complete: ${fileInfo.storageGatewayPath}`);
                        } catch (err) {
                            console.error('[StorageSync] Failed to upload to Storage Gateway:', err.message);
                            // Storage Gateway is optional — if it's unreachable (e.g. Windows agent offline),
                            // we warn and continue. The file is saved locally so AI extraction still works.
                            // The file simply won't be synced to the Windows drive this time.
                            console.warn('[StorageSync] Continuing without Storage Gateway sync. File is saved locally.');
                        }
                    }

                    cb(null, fileInfo);
                });
            } catch (err) {
                cb(err);
            }
        },

        _removeFile: async function (req, file, cb) {
            try {
                if (file.path && fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
                
                if (file.storageGatewayPath && storageGateway.isEnabled()) {
                    await storageGateway.deleteFile(file.storageGatewayPath);
                }
                cb(null);
            } catch (err) {
                cb(err);
            }
        }
    };
}

module.exports = createStorageAgentSync;
