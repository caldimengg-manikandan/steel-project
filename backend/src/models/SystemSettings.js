const mongoose = require('mongoose');

const systemSettingsSchema = new mongoose.Schema({
    timezone: { type: String, default: 'Asia/Kolkata' },
    dateFormat: { type: String, default: 'DD/MM/YYYY' },
    emailNotifications: { type: Boolean, default: true },
    weeklyProgresss: { type: Boolean, default: false },
    darkMode: { type: Boolean, default: false },
    twoFactor: { type: Boolean, default: false },
    rfiAutoNumber: { type: Boolean, default: true },
    activityLogging: { type: Boolean, default: true },
    moduleProjects: { type: Boolean, default: true },
    moduleRfi: { type: Boolean, default: true },
    moduleReports: { type: Boolean, default: true },
    logoPath: { type: String, default: '' },

    // Email / SMTP configuration
    emailEnabled: { type: Boolean, default: false },
    smtpHost: { type: String, default: '' },
    smtpPort: { type: Number, default: 587 },
    smtpUser: { type: String, default: '' },       // sender email address
    smtpPass: { type: String, default: '' },       // app password / SMTP password
    smtpFromName: { type: String, default: 'Steel Project' },

    // Recipient lists by role (array of email strings)
    superAdminEmails: { type: [String], default: [] },
    projectManagerEmails: { type: [String], default: [] },
    teamLeadEmails: { type: [String], default: [] },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
}, { timestamps: true });

module.exports = mongoose.model('SystemSettings', systemSettingsSchema);

