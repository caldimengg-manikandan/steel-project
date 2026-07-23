const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const AGENT_URL = (process.env.STORAGE_AGENT_URL || '').replace(/\/+$/, '');
const AGENT_API_KEY = process.env.STORAGE_AGENT_API_KEY || '';
const STORAGE_ENABLED = process.env.STORAGE_ENABLED !== 'false';

const FALLBACK_DIR = path.join(__dirname, '../../uploads/storage_fallback');

function isEnabled() {
    return STORAGE_ENABLED && !!AGENT_URL;
}

async function validateRoot() {
    if (!isEnabled()) {
        if (!fs.existsSync(FALLBACK_DIR)) {
            fs.mkdirSync(FALLBACK_DIR, { recursive: true });
        }
        return { ok: true, skipped: true, storageRoot: FALLBACK_DIR };
    }
    // ... cloudflare validation
    return { ok: true, skipped: true };
}

// Just map everything to local filesystem if !isEnabled
async function listDirectory(relativePath = '') {
    if (!isEnabled()) {
        const fullPath = path.join(FALLBACK_DIR, relativePath);
        if (!fs.existsSync(fullPath)) return [];
        const items = await fs.promises.readdir(fullPath, { withFileTypes: true });
        const entries = [];
        for (const item of items) {
            const stats = await fs.promises.stat(path.join(fullPath, item.name));
            entries.push({
                name: item.name,
                type: item.isDirectory() ? 'directory' : 'file',
                size: stats.size,
                modified: stats.mtime.toISOString(),
            });
        }
        return entries;
    }
}
