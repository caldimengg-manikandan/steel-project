/**
 * ============================================================
 * Middleware: Error Handler
 * ============================================================
 */

function errorHandler(err, req, res, next) {
    console.error('[ERROR]', err.message);
    if (process.env.NODE_ENV === 'development' && err.stack) {
        console.error(err.stack);
    }

    // CORS errors
    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({
            error: 'Access denied by CORS policy. Please ensure your frontend origin is allowed in the backend configuration.',
            origin: req.headers.origin
        });
    }

    // Mongoose validation errors
    if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors).map((e) => e.message);
        return res.status(400).json({ error: 'Validation failed: ' + messages.join(', '), details: messages });
    }

    // Mongoose duplicate key (unique index violation)
    if (err.code === 11000) {
        const field = Object.keys(err.keyValue || {}).join(', ');
        return res.status(409).json({
            error: `Duplicate value for field: ${field}. It already exists in your admin scope.`,
        });
    }

    // Default
    res.status(err.status || 500).json({
        error: err.message || 'Internal server error.',
    });
}

module.exports = { errorHandler };
