const SystemSettings = require('../models/SystemSettings');
const path = require('path');
const fs = require('fs');
const { logActivity } = require('../utils/logger');

/**
 * Get System Settings
 */
exports.getSettings = async (req, res) => {
    let settings = await SystemSettings.findOne();
    if (!settings) {
        settings = await SystemSettings.create({});
    }
    res.json(settings);
};

/**
 * Update System Settings (excluding logo)
 */
exports.updateSettings = async (req, res) => {
    let settings = await SystemSettings.findOne();
    if (!settings) {
        settings = new SystemSettings();
    }

    const { 
        timezone, dateFormat, emailNotifications, weeklyProgresss, darkMode,
        twoFactor, rfiAutoNumber, activityLogging, moduleProjects, moduleRfi, moduleReports
    } = req.body;

    if (timezone !== undefined) settings.timezone = timezone;
    if (dateFormat !== undefined) settings.dateFormat = dateFormat;
    if (emailNotifications !== undefined) settings.emailNotifications = emailNotifications;
    if (weeklyProgresss !== undefined) settings.weeklyProgresss = weeklyProgresss;
    if (darkMode !== undefined) settings.darkMode = darkMode;
    if (twoFactor !== undefined) settings.twoFactor = twoFactor;
    if (rfiAutoNumber !== undefined) settings.rfiAutoNumber = rfiAutoNumber;
    if (activityLogging !== undefined) settings.activityLogging = activityLogging;
    if (moduleProjects !== undefined) settings.moduleProjects = moduleProjects;
    if (moduleRfi !== undefined) settings.moduleRfi = moduleRfi;
    if (moduleReports !== undefined) settings.moduleReports = moduleReports;

    await settings.save();
    
    // Log the activity
    const username = req.user ? req.user.username : 'Admin';
    await logActivity(username, 'Config', 'System settings updated');
    
    res.json(settings);
};

/**
 * Upload Logo
 */
exports.uploadLogo = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    let settings = await SystemSettings.findOne();
    if (!settings) {
        settings = new SystemSettings();
    }

    // New path: /uploads/system/logo_timestamp.ext
    const relativePath = `/uploads/system/${req.file.filename}`;
    
    // Optional: Delete old logo file if it exists
    if (settings.logoPath) {
        const oldFile = path.join(__dirname, '../../', settings.logoPath);
        if (fs.existsSync(oldFile)) {
            try { fs.unlinkSync(oldFile); } catch (e) { console.error('Failed to delete old logo:', e); }
        }
    }

    settings.logoPath = relativePath;
    await settings.save();

    // Log the activity
    const username = req.user ? req.user.username : 'Admin';
    await logActivity(username, 'Config', 'Company logo updated');

    res.json({ message: 'Logo uploaded successfully', logoPath: relativePath });
};
