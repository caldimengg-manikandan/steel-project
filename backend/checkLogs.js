const mongoose = require('mongoose');
const ActivityLog = require('./src/models/ActivityLog');
require('dotenv').config();

async function check() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/steel-dms');
    const logs = await ActivityLog.find();
    console.log('Logs in DB:', logs);
    process.exit(0);
}
check();
