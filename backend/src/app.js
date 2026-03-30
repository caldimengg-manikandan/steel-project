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

// Error handler
const { errorHandler } = require('./middleware/errorHandler');

// ── App setup ─────────────────────────────────────────────
const app = express();

if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

const allowedOrigins = [
    'https://steel-dms-frontend.onrender.com',
    // 'https://steel-dms-frontend.onrender.com/',
    'http://localhost:5173'
];

app.use(helmet());
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json());

const path = require('path');

// ── API Routes ─────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/admin/projects', adminProjectRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/admin/reports', adminReportsRoutes);
app.use('/api/admin/clients', adminClientRoutes);
app.use('/api/user/projects', userProjectRoutes);
// Nested: /api/extractions, /api/transmittals, /api/rfis
app.use('/api/extractions', extractionRoutes);
app.use('/api/transmittals', transmittalRoutes);
app.use('/api/rfis', rfiRoutes);

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

// ── Auto-seeding logic ──────────────────────────────────────
async function ensureDefaultAdmin() {
    try {
        let admin = await Admin.findOne({ username: 'admin1' });
        if (!admin) {
            console.log('[DB] Seeding default admin account...');
            admin = await Admin.create({
                username: 'admin1',
                email: 'admin1@steeldetailing.com',
                password_hash: 'Admin1@2026',
                displayName: 'Default Admin',
            });
        } else {
            console.log('[DB] Admin1 exists, resetting password for safety...');
            admin.password_hash = 'Admin1@2026';
            await admin.save();
        }
        console.log(`[DB] Account READY: admin1 / Admin1@2026`);
        
        const userExists = await User.findOne({ username: 'theja' });
        if (!userExists) {
            await User.create({
                username: 'theja',
                email: 'theja@firm1.com',
                password_hash: 'pass@1234',
                adminId: admin._id,
            });
            console.log(`[DB] Created: theja / pass@1234`);
        }
    } catch (err) {
        console.warn('[DB] Skip auto-seed check:', err.message);
    }
}

// ── Start server ───────────────────────────────────────────
const PORT = process.env.PORT || 5000;

connectDB().then(async () => {
    initGridFS();
    await ensureDefaultAdmin();
    app.listen(PORT, () => {
        console.log(`\n[SERVER] Steel Detailing DMS API running on http://localhost:${PORT}`);
        console.log(`[SERVER] Environment: ${process.env.NODE_ENV || 'development'}\n`);
    });
}).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});

module.exports = app;
