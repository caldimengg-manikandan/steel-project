/**
 * ============================================================
 * Express Application Entry Point
 * ============================================================
 */
require('express-async-errors');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');

// Models (for auto-seeding)
const Admin = require('./models/Admin');
const User = require('./models/User');

// Routes
const authRoutes = require('./routes/authRoutes');
const { initGridFS } = require('./utils/gridfs');
const adminUserRoutes = require('./routes/adminUserRoutes');
const adminProjectRoutes = require('./routes/adminProjectRoutes');
const adminDashboardRoutes = require('./routes/adminDashboardRoutes');
const adminReportsRoutes = require('./routes/adminReportsRoutes');
const adminClientRoutes = require('./routes/adminClientRoutes');
const userProjectRoutes = require('./routes/userProjectRoutes');
const extractionRoutes = require('./routes/extractionRoutes');
const transmittalRoutes = require('./routes/transmittalRoutes');
const rfiRoutes = require('./routes/rfiRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const fileGatewayRoutes = require('./routes/fileGatewayRoutes');
const activityLogRoutes = require('./routes/activityLogRoutes');

// Error handler
const { errorHandler } = require('./middleware/errorHandler');

const allowedOrigins = [
    'https://steel-dms-frontend.onrender.com',
    'https://steel-project-iota.vercel.app',
    'http://localhost:5174',
    'http://localhost:5173',
    'http://localhost:3000'
];

if (process.env.CORS_ORIGIN) {
    process.env.CORS_ORIGIN.split(',').forEach(origin => {
        const o = origin.trim();
        if (o && !allowedOrigins.includes(o)) {
            allowedOrigins.push(o);
        }
    });
}
console.log('[DEBUG] Allowed Origins:', allowedOrigins);

// ── App setup ─────────────────────────────────────────────
const app = express();

if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);
        
        const isAllowed = allowedOrigins.some(o => {
            // Exact match
            if (o === origin) return true;
            // Match without trailing slash
            if (o.replace(/\/$/, '') === origin.replace(/\/$/, '')) return true;
            // Strict match required
            return false;
        });

        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "unsafe-none" }
}));
app.use(cookieParser());
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Debugging log (Remove after fixing)
app.use((req, res, next) => {
    console.log(`[API_DEBUG] ${req.method} ${req.originalUrl}`);
    next();
});

const path = require('path');

// ── API Routes ─────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/admin/projects', adminProjectRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/admin/reports', adminReportsRoutes);
app.use('/api/admin/clients', adminClientRoutes);
app.use('/api/user/projects', userProjectRoutes);
// Nested: /api/extractions/:projectId, /api/transmittals/:projectId, /api/rfis/:projectId
app.use('/api/extractions/:projectId', extractionRoutes);
app.use('/api/transmittals/:projectId', transmittalRoutes);
app.use('/api/rfis/:projectId', rfiRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/files', fileGatewayRoutes);
app.use('/api/admin/activity-logs', activityLogRoutes);
app.use('/api/weekly-report', require('./routes/weeklyProgressRoutes'));
app.use('/api/rfi-report', require('./routes/rfiReportRoutes'));
app.use('/api/error-log', require('./routes/errorLogRoutes'));
app.use('/api/drawing-log', require('./routes/drawingLogRoutes'));
// ── Serve uploaded files (PDFs, Excel) ─────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── Health check ───────────────────────────────────────────
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── 404 ────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
});

// ── Global error handler ───────────────────────────────────
app.use(errorHandler);

// ── Auto-seeding logic removed ───────────────────────────────

// ── Start server ───────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const { startAiService } = require('./utils/aiServiceManager');

connectDB().then(async () => {
    initGridFS();
    
    // Validate remote Storage Agent connectivity safely
    try {
        const storageGateway = require('./utils/storageGateway');
        const storageCheck = await storageGateway.validateRoot();
        if (storageCheck.skipped) {
            console.log('[Storage] Gateway disabled (STORAGE_ENABLED=false)');
        } else if (storageCheck.ok) {
            console.log(`[Storage] Agent connected: ${storageGateway.AGENT_URL}`);
            if (storageCheck.storageRoot) console.log(`[Storage] Remote root: ${storageCheck.storageRoot}`);
            if (storageCheck.readOnly) console.log('[Storage] Agent is in READ-ONLY mode');
        } else {
            console.warn(`[Storage] WARNING: ${storageCheck.error}`);
            console.warn('[Storage] File gateway API will return errors until the agent is reachable.');
        }
    } catch (storageErr) {
        console.warn('[Storage] Gateway check skipped/failed:', storageErr.message);
    }

    // Start AI service automatically
    try {
        startAiService();
    } catch (aiErr) {
        console.warn('[AI] Failed to auto-start AI service:', aiErr.message);
    }

    // Start Weekly Progress Summary cron job
    try {
        const { initWeeklyProgressScheduler } = require('./services/schedulerService');
        initWeeklyProgressScheduler();
    } catch (err) {
        console.error('[Scheduler] Failed to initialize scheduler on startup:', err.message);
    }

    const server = app.listen(PORT, async () => {
        console.log(`\n[SERVER] Steel Detailing DMS API running on http://localhost:${PORT}`);
        console.log(`[SERVER] Environment: ${process.env.NODE_ENV || 'development'}\n`);
        
        try {
            let admin1 = await Admin.findOne({ username: 'admin1' });
            if (admin1) {
                admin1.password_hash = 'Admin1@2026';
                await admin1.save();
                console.log('[AUTH] admin1 password forcefully reset to Admin1@2026 for recovery.');
            } else {
                admin1 = await Admin.create({
                    username: 'admin1',
                    email: 'admin1@steeldetailing.com',
                    password_hash: 'Admin1@2026',
                    displayName: 'System Admin',
                    role: 'admin',
                    status: 'active'
                });
                console.log('[AUTH] admin1 account recreated with default password Admin1@2026.');
            }
        } catch(err) {
            console.error('[AUTH] Failed to verify admin1 on startup:', err.message);
        }
    });
    server.timeout = 1800000;
    server.headersTimeout = 1800000;
    server.keepAliveTimeout = 1800000;
}).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});

module.exports = app; // Trigger restart to reload AI service with dynamic model loading support
