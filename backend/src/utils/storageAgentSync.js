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
                // 1. Save locally first (make it persistent in case storage gateway is disabled)
                const tempDir = path.join(__dirname, '../../uploads', 'steel-dms-uploads');
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
                            if (req.fileIndex === undefined) req.fileIndex = 0;
                            const currentIndex = req.fileIndex++;
                            const pathArray = Array.isArray(req.body.paths) ? req.body.paths : (req.body.paths ? [req.body.paths] : []);
                            const relativePath = pathArray[currentIndex] || file.originalname;

                            const projectName = req.scopedProject?.name || 'UnknownProject';
                            const safeProjectName = projectName.replace(/[^a-zA-Z0-9 _-]/g, '_');
                            // e.g. Projects/MyProject/Extraction/SubFolder
                            let targetDir = `Projects/${safeProjectName}/${folderPrefix}`;
                            const subDir = path.dirname(relativePath).replace(/\\\\/g, '/');
                            if (subDir && subDir !== '.') {
                                targetDir = `${targetDir}/${subDir}`;
                            }
                            targetDir = targetDir.replace(/\/+/g, '/').replace(/\/$/, '').replace(/\/\.$/, '');
                            
                            console.log(`[StorageSync] Uploading ${file.originalname} to Windows Server -> ${targetDir}`);
                            
                            const buffer = fs.readFileSync(localPath);
                            await storageGateway.uploadFile(targetDir, file.originalname, buffer);
                            
                            fileInfo.storageGatewayPath = `${targetDir}/${file.originalname}`;
                            console.log(`[StorageSync] Upload complete: ${fileInfo.storageGatewayPath}`);
                        } catch (err) {
                            console.warn('[StorageSync] Storage Gateway upload notice:', err.message);
                            // Keep upload alive on persistent disk storage if gateway agent is offline
                        }
                    }

                    // 3. Fail-safe GridFS backup for HTTP viewing (never blocks upload if DB quota locked)
                    try {
                        const gridfs = require('./gridfs');
                        const bucket = gridfs.getBucket();
                        if (bucket) {
                            const uploadStream = bucket.openUploadStream(uniqueFilename, {
                                contentType: file.mimetype,
                                metadata: { originalName: file.originalname }
                            });
                            const readStream = fs.createReadStream(localPath);
                            readStream.pipe(uploadStream);
                            
                            await new Promise((resolve) => {
                                uploadStream.on('finish', () => {
                                    fileInfo.gridFsFileId = uploadStream.id.toString();
                                    resolve();
                                });
                                uploadStream.on('error', (gerr) => {
                                    console.warn('[StorageSync] Non-fatal GridFS upload skipped:', gerr.message);
                                    resolve();
                                });
                            });
                            console.log(`[StorageSync] Uploaded to GridFS as fallback backup: ${fileInfo.gridFsFileId || 'skipped'}`);
                        }
                    } catch (err) {
                        console.warn('[StorageSync] GridFS backup skipped:', err.message);
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
