/**
 * ============================================================
 * AI Service Manager
 * ============================================================
 * Manages the lifecycle of the Python AiExtraction (FastAPI) service.
 * Spawns the process, pipes logs, and handles shutdown.
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let aiProcess = null;

/**
 * Kills any orphaned Python AI processes left over from a previous run.
 * This is critical on hosted servers: when PM2 restarts Node.js, the old
 * Python child process becomes an orphan still listening on the AI port.
 * Without killing it, the new Node.js process can't bind to that port.
 */
function killOrphanedAiProcesses() {
    try {
        if (process.platform === 'win32') {
            // Windows: find and kill by script name
            execSync('taskkill /F /FI "WINDOWTITLE eq api.py" /T 2>nul', { stdio: 'ignore' });
        } else {
            // Linux/macOS: kill any process running api.py
            execSync('pkill -f "AiExtraction/api.py" || true', { stdio: 'ignore' });
        }
        console.log('[AI_SERVICE] Cleaned up any orphaned AI processes.');
    } catch (e) {
        // It's fine if nothing was found to kill
    }
}

/**
 * Starts the AI Extraction service (Python FastAPI)
 */
function startAiService() {
    if (process.env.AI_SERVICE_ENABLED === 'false') {
        console.log('[AI_SERVICE] AI Service is disabled via .env');
        return;
    }

    const aiDir = path.join(__dirname, '../../AiExtraction');
    const apiScript = path.join(aiDir, 'api.py');

    // Check if script exists
    if (!fs.existsSync(apiScript)) {
        console.warn(`[AI_SERVICE] ✗ Warning: api.py not found at ${apiScript}`);
        return;
    }

    // Kill any orphaned processes from a previous deployment before starting fresh
    killOrphanedAiProcesses();

    // Determine Python binary
    const pythonBin = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'py' : 'python3');
    const args = [apiScript];

    console.log(`[AI_SERVICE] Starting AI service with: ${pythonBin} ${args.join(' ')}`);
    console.log(`[AI_SERVICE] Working directory: ${aiDir}`);

    aiProcess = spawn(pythonBin, args, {
        cwd: aiDir,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['inherit', 'pipe', 'pipe']
    });

    aiProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach(line => {
            if (line.trim()) {
                console.log(`[AI_PYTHON] ${line.trim()}`);
            }
        });
    });

    aiProcess.stderr.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach(line => {
            if (line.trim()) {
                console.warn(`[AI_PYTHON_ERR] ${line.trim()}`);
            }
        });
    });

    aiProcess.on('close', (code) => {
        console.log(`[AI_SERVICE] AI service process exited with code ${code}`);
        aiProcess = null;
    });

    aiProcess.on('error', (err) => {
        console.error('[AI_SERVICE] Failed to start AI service:', err.message);
    });

    // Cleanup on parent exit
    process.on('exit', stopAiService);
    process.on('SIGINT', () => {
        stopAiService();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        stopAiService();
        process.exit(0);
    });
}

/**
 * Stops the AI Extraction service
 */
function stopAiService() {
    if (aiProcess) {
        console.log('[AI_SERVICE] Stopping AI service...');
        aiProcess.kill('SIGTERM');
        aiProcess = null;
    }
}

module.exports = { startAiService, stopAiService };
