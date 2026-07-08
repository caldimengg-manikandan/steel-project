const mongoose = require('mongoose');

const systemSettingsSchema = new mongoose.Schema({
    timezone: { type: String, default: 'Asia/Kolkata' },
    dateFormat: { type: String, default: 'DD/MM/YYYY' },
    emailNotifications: { type: Boolean, default: true },
    weeklyReports: { type: Boolean, default: false },
    darkMode: { type: Boolean, default: false },
    twoFactor: { type: Boolean, default: false },
    rfiAutoNumber: { type: Boolean, default: true },
    activityLogging: { type: Boolean, default: true },
    moduleProjects: { type: Boolean, default: true },
    moduleRfi: { type: Boolean, default: true },
    moduleReports: { type: Boolean, default: true },
    logoPath: { type: String, default: '' }, // Path to the uploaded logo
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
}, { timestamps: true });

module.exports = mongoose.model('SystemSettings', systemSettingsSchema);
