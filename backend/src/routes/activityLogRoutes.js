const express = require('express');
const router = express.Router();
const activityLogController = require('../controllers/activityLogController');
const { verifyToken } = require('../middleware/auth');

// Audit logs are strictly restricted to Superadmin access
const requireSuperAdminAccess = (req, res, next) => {
    const role = req.principal?.role;
    if (role !== 'superadmin' && role !== 'admin') {
        return res.status(403).json({ error: 'Access denied: Audit logs are restricted to Superadmin only.' });
    }
    next();
};

router.get('/', verifyToken, requireSuperAdminAccess, activityLogController.getLogs);

module.exports = router;
