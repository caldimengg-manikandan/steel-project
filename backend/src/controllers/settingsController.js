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
    // Never expose SMTP password to frontend
    const safeSettings = settings.toObject();
    if (safeSettings.smtpPass) safeSettings.smtpPass = '••••••••';
    res.json(safeSettings);
};

/**
 * Update System Settings (excluding logo and email)
 */
exports.updateSettings = async (req, res) => {
    let settings = await SystemSettings.findOne();
    if (!settings) {
        settings = new SystemSettings();
    }

    const { 
        timezone, dateFormat, emailNotifications, weeklyProgresss, weeklyProgressDay, weeklyProgressTime, darkMode,
        twoFactor, rfiAutoNumber, activityLogging, moduleProjects, moduleRfi, moduleReports
    } = req.body;

    if (timezone !== undefined) settings.timezone = timezone;
    if (dateFormat !== undefined) settings.dateFormat = dateFormat;
    if (emailNotifications !== undefined) settings.emailNotifications = emailNotifications;
    if (weeklyProgresss !== undefined) settings.weeklyProgresss = weeklyProgresss;
    if (weeklyProgressDay !== undefined) settings.weeklyProgressDay = weeklyProgressDay;
    if (weeklyProgressTime !== undefined) settings.weeklyProgressTime = weeklyProgressTime;
    if (darkMode !== undefined) settings.darkMode = darkMode;
    if (twoFactor !== undefined) settings.twoFactor = twoFactor;
    if (rfiAutoNumber !== undefined) settings.rfiAutoNumber = rfiAutoNumber;
    if (activityLogging !== undefined) settings.activityLogging = activityLogging;
    if (moduleProjects !== undefined) settings.moduleProjects = moduleProjects;
    if (moduleRfi !== undefined) settings.moduleRfi = moduleRfi;
    if (moduleReports !== undefined) settings.moduleReports = moduleReports;

    if (req.user && req.user._id) {
        settings.updatedBy = req.user._id;
    }
    await settings.save();
    
    // Trigger scheduler update
    try {
        const { initWeeklyProgressScheduler } = require('../services/schedulerService');
        initWeeklyProgressScheduler();
    } catch (err) {
        console.error('[Scheduler] Failed to reload scheduler:', err.message);
    }
    
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

    const relativePath = `/uploads/system/${req.file.filename}`;
    
    if (settings.logoPath) {
        const oldFile = path.join(__dirname, '../../', settings.logoPath);
        if (fs.existsSync(oldFile)) {
            try { fs.unlinkSync(oldFile); } catch (e) { console.error('Failed to delete old logo:', e); }
        }
    }

    settings.logoPath = relativePath;
    await settings.save();

    const username = req.user ? req.user.username : 'Admin';
    await logActivity(username, 'Config', 'Company logo updated');

    res.json({ message: 'Logo uploaded successfully', logoPath: relativePath });
};

/**
 * Update Email / SMTP Settings
 */
exports.updateEmailSettings = async (req, res) => {
    try {
        let settings = await SystemSettings.findOne();
        if (!settings) settings = new SystemSettings();

        const {
            emailEnabled, smtpHost, smtpPort, smtpUser, smtpPass, smtpFromName,
            superAdminEmails, projectManagerEmails, teamLeadEmails
        } = req.body;

        if (emailEnabled !== undefined) settings.emailEnabled = emailEnabled;
        if (smtpHost !== undefined) settings.smtpHost = smtpHost;
        if (smtpPort !== undefined) settings.smtpPort = Number(smtpPort);
        if (smtpUser !== undefined) settings.smtpUser = smtpUser;
        // Only update password if a real value (not masked) is provided
        if (smtpPass !== undefined && smtpPass !== '••••••••' && smtpPass !== '') {
            settings.smtpPass = smtpPass;
        }
        if (smtpFromName !== undefined) settings.smtpFromName = smtpFromName;
        if (superAdminEmails !== undefined) settings.superAdminEmails = superAdminEmails;
        if (projectManagerEmails !== undefined) settings.projectManagerEmails = projectManagerEmails;
        if (teamLeadEmails !== undefined) settings.teamLeadEmails = teamLeadEmails;

        if (req.user && req.user._id) {
            settings.updatedBy = req.user._id;
        }
        await settings.save();

        const username = req.user ? req.user.username : 'Admin';
        await logActivity(username, 'Config', 'Email settings updated');

        const safeSettings = settings.toObject();
        if (safeSettings.smtpPass) safeSettings.smtpPass = '••••••••';
        res.json({ message: 'Email settings saved successfully', settings: safeSettings });
    } catch (err) {
        console.error('updateEmailSettings error:', err);
        res.status(500).json({ error: 'Failed to save email settings' });
    }
};

/**
 * Test Email Connection (sends a test email using current SMTP settings)
 */
exports.testEmailSettings = async (req, res) => {
    try {
        let nodemailer;
        try {
            nodemailer = require('nodemailer');
        } catch (e) {
            return res.status(500).json({ error: 'nodemailer is not installed. Run: npm install nodemailer in the backend folder.' });
        }

        const settings = await SystemSettings.findOne();
        if (!settings || !settings.smtpHost || !settings.smtpUser) {
            return res.status(400).json({ error: 'SMTP settings are not configured.' });
        }

        const transporter = nodemailer.createTransport({
            host: settings.smtpHost,
            port: settings.smtpPort || 587,
            secure: settings.smtpPort === 465,
            auth: {
                user: settings.smtpUser,
                pass: settings.smtpPass
            }
        });

        const testEmail = req.body.testEmail || settings.smtpUser;

        await transporter.sendMail({
            from: `"${settings.smtpFromName || 'Steel Project'}" <${settings.smtpUser}>`,
            to: testEmail,
            subject: 'Steel Project – Email Test',
            html: `<p>This is a test email from your <strong>Steel Project</strong> system.</p>
                   <p>Your SMTP configuration is working correctly.</p>`
        });

        res.json({ message: `Test email sent successfully to ${testEmail}` });
    } catch (err) {
        console.error('testEmailSettings error:', err);
        res.status(500).json({ error: err.message || 'Failed to send test email. Check your SMTP settings.' });
    }
};

exports.testSchedulerEmail = async (req, res) => {
    try {
        const { sendProjectStatusEmail } = require('../services/schedulerService');
        await sendProjectStatusEmail();
        res.json({ success: true, message: 'Project status summary report email triggered successfully.' });
    } catch (err) {
        console.error('testSchedulerEmail error:', err);
        res.status(500).json({ success: false, error: err.message || 'Failed to trigger test scheduler email' });
    }
};

