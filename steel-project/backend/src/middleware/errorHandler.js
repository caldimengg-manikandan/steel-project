/**
 * ============================================================
 * Middleware: Error Handler
 * ============================================================
 */

function errorHandler(err, req, res, next) {
    console.error('[ERROR]', err.message);

    // Mongoose validation errors
    if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors).map((e) => e.message);
        return res.status(400).json({ error: 'Validation failed.', details: messages });
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
