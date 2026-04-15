const SystemSettings = require('../models/SystemSettings');
const path = require('path');
const fs = require('fs');

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

    const { timezone, dateFormat, emailNotifications, weeklyReports, darkMode } = req.body;

    if (timezone !== undefined) settings.timezone = timezone;
    if (dateFormat !== undefined) settings.dateFormat = dateFormat;
    if (emailNotifications !== undefined) settings.emailNotifications = emailNotifications;
    if (weeklyReports !== undefined) settings.weeklyReports = weeklyReports;
    if (darkMode !== undefined) settings.darkMode = darkMode;

    await settings.save();
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

    res.json({ message: 'Logo uploaded successfully', logoPath: relativePath });
};
