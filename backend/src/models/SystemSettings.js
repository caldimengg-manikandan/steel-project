const mongoose = require('mongoose');

const systemSettingsSchema = new mongoose.Schema({
    timezone: { type: String, default: 'Asia/Kolkata' },
    dateFormat: { type: String, default: 'DD/MM/YYYY' },
    emailNotifications: { type: Boolean, default: true },
    weeklyReports: { type: Boolean, default: false },
    darkMode: { type: Boolean, default: false },
    logoPath: { type: String, default: '' }, // Path to the uploaded logo
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
}, { timestamps: true });

module.exports = mongoose.model('SystemSettings', systemSettingsSchema);
