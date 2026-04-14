require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('./src/models/Admin');

async function check() {
    await mongoose.connect(process.env.MONGO_URI);
    const admin = await Admin.findOne({ username: 'admin1' }).select('+password_hash');
    if (!admin) {
        console.log('Admin1 not found');
    } else {
        console.log('Admin1 found');
        const valid = await admin.matchPassword('Admin1@2026');
        console.log('Password valid:', valid);
    }
    await mongoose.disconnect();
}

check();
