const path = require('path');
const fs = require('fs');

/**
 * Returns a valid python binary path.
 * On Linux / VPS environments, ignores Windows 'py' and auto-detects
 * virtual environments or falls back to 'python3'.
 */
function getPythonBin() {
    let bin = process.env.PYTHON_BIN;
    // On Linux / non-Windows, 'py' does not exist
    if (process.platform !== 'win32' && bin === 'py') {
        bin = null;
    }

    // Check virtual environment on VPS / server first if on Linux
    if (process.platform !== 'win32') {
        const venvPaths = [
            path.join(__dirname, '../../AiExtraction/.venv/bin/python'),
            path.join(__dirname, '../../AiExtraction/.venv/bin/python3'),
            '/var/www/steel-project/backend/AiExtraction/.venv/bin/python',
            '/var/www/steel-project/backend/AiExtraction/.venv/bin/python3'
        ];
        for (const vp of venvPaths) {
            if (fs.existsSync(vp)) {
                return vp;
            }
        }
    }

    if (bin) {
        return bin;
    }

    return process.platform === 'win32' ? 'py' : 'python3';
}

module.exports = { getPythonBin };
