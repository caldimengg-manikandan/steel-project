const mongoose = require('mongoose');
require('dotenv').config();

const SystemSettingsSchema = new mongoose.Schema({
    logoPath: String,
});

const SystemSettings = mongoose.model('SystemSettings', SystemSettingsSchema);

async function check() {
    await mongoose.connect(process.env.MONGO_URI);
    const settings = await SystemSettings.findOne();
    console.log('Current Settings:', JSON.stringify(settings, null, 2));
    await mongoose.disconnect();
}

check();
