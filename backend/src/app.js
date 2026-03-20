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

// Routes
const authRoutes = require('./routes/authRoutes');
const adminUserRoutes = require('./routes/adminUserRoutes');
const adminProjectRoutes = require('./routes/adminProjectRoutes');
const adminDashboardRoutes = require('./routes/adminDashboardRoutes');
const adminReportsRoutes = require('./routes/adminReportsRoutes');
const userProjectRoutes = require('./routes/userProjectRoutes');
const extractionRoutes = require('./routes/extractionRoutes');
const transmittalRoutes = require('./routes/transmittalRoutes');
const rfiRoutes = require('./routes/rfiRoutes');

// Error handler
const { errorHandler } = require('./middleware/errorHandler');

// ── App setup ─────────────────────────────────────────────
const app = express();

app.use(helmet());
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
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
app.use('/api/user/projects', userProjectRoutes);
// Nested: /api/extractions/:projectId
app.use('/api/extractions/:projectId', extractionRoutes);
// Nested: /api/transmittals/:projectId
app.use('/api/transmittals/:projectId', transmittalRoutes);
// Nested: /api/rfis/:projectId
app.use('/api/rfis/:projectId', rfiRoutes);

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

// ── Start server ───────────────────────────────────────────
const PORT = process.env.PORT || 5000;

connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`\n[SERVER] Steel Detailing DMS API running on http://localhost:${PORT}`);
        console.log(`[SERVER] Environment: ${process.env.NODE_ENV || 'development'}\n`);
    });
}).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});

module.exports = app;

// Backend server trigger restart (port freed)
