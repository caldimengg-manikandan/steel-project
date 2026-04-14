const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Rclone OneDrive Utility
 * Handles file operations using rclone CLI for robust cloud storage.
 */

const RCLONE_REMOTE = 'onedrive:';
const ONEDRIVE_FOLDER = process.env.ONEDRIVE_FOLDER_PATH || 'SteelDMS_Uploads';

/**
 * Uploads a file to OneDrive using rclone copy
 * @param {string} localPath - Path to local file
 * @param {string} remoteName - Filename on OneDrive
 * @returns {Promise<boolean>}
 */
async function uploadFile(localPath, remoteName) {
    return new Promise((resolve, reject) => {
        const remotePath = `${RCLONE_REMOTE}${ONEDRIVE_FOLDER}/${remoteName}`;
        console.log(`[Rclone] Uploading ${localPath} to ${remotePath}...`);
        
        // Use copy instead of move to keep the bridge file for a while if needed by storage engine
        exec(`rclone copy "${localPath}" "${RCLONE_REMOTE}${ONEDRIVE_FOLDER}"`, (error, stdout, stderr) => {
            if (error) {
                console.error(`[Rclone] Upload failed: ${stderr}`);
                return reject(error);
            }
            console.log(`[Rclone] Upload successful: ${remoteName}`);
            resolve(true);
        });
    });
}

/**
 * Streams a file from OneDrive using rclone cat
 * @param {string} remoteName - Filename on OneDrive
 * @param {object} res - Express response object to stream into
 */
function streamFile(remoteName, res) {
    const remotePath = `${RCLONE_REMOTE}${ONEDRIVE_FOLDER}/${remoteName}`;
    console.log(`[Rclone] Reading stream: ${remotePath}`);
    
    const rclone = spawn('rclone', ['cat', remotePath]);

    rclone.stdout.pipe(res);

    rclone.stderr.on('data', (data) => {
        console.error(`[Rclone Stream Error]: ${data}`);
    });

    rclone.on('close', (code) => {
        if (code !== 0) {
            console.error(`[Rclone] Stream process exited with code ${code}`);
            if (!res.headersSent) {
                res.status(500).send('Error streaming from OneDrive');
            }
        }
    });
}

/**
 * Deletes a file from OneDrive
 * @param {string} remoteName - Filename on OneDrive
 */
async function deleteFile(remoteName) {
    return new Promise((resolve, reject) => {
        const remotePath = `${RCLONE_REMOTE}${ONEDRIVE_FOLDER}/${remoteName}`;
        console.log(`[Rclone] Deleting ${remotePath}...`);
        
        exec(`rclone delete "${remotePath}"`, (error, stdout, stderr) => {
            if (error) {
                console.error(`[Rclone] Delete failed: ${stderr}`);
                return reject(error);
            }
            resolve(true);
        });
    });
}

/**
 * Checks if a file exists on OneDrive
 * @param {string} remoteName 
 * @returns {Promise<boolean>}
 */
async function fileExists(remoteName) {
    return new Promise((resolve) => {
        const remotePath = `${RCLONE_REMOTE}${ONEDRIVE_FOLDER}/${remoteName}`;
        exec(`rclone lsjson "${remotePath}"`, (error, stdout, stderr) => {
            if (error || !stdout || stdout.trim() === '[]') {
                return resolve(false);
            }
            resolve(true);
        });
    });
}

module.exports = {
    uploadFile,
    streamFile,
    deleteFile,
    fileExists
};
