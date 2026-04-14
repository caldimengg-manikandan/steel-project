const mongoose = require('mongoose');
const Admin = require('./src/models/Admin');
const User = require('./src/models/User');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');

dotenv.config();

async function run() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected.');

        const username = 'admin2';
        const newPassword = 'password123';

        // 1. Check in Admins
        let admin = await Admin.findOne({ username: username.toLowerCase() });
        if (admin) {
            console.log(`Found Admin account: ${admin.username}. Resetting password to "${newPassword}"...`);
            // We set password_hash directly because the pre-save hook handles hashing if we pass it to password_hash field
            // Actually the hook is on 'password_hash' field in matches this.password_hash
            // Let's just update it.
            const salt = await bcrypt.genSalt(12);
            const hash = await bcrypt.hash(newPassword, salt);
            await Admin.updateOne({ _id: admin._id }, { $set: { password_hash: hash } });
            console.log('Admin password reset successfully.');
        } else {
            console.log('No Admin found with that username. Checking Users...');
            let user = await User.findOne({ username: username.toLowerCase() });
            if (user) {
                console.log(`Found User account: ${user.username}. Resetting password to "${newPassword}"...`);
                const salt = await bcrypt.genSalt(12);
                const hash = await bcrypt.hash(newPassword, salt);
                await User.updateOne({ _id: user._id }, { $set: { password_hash: hash } });
                console.log('User password reset successfully.');
            } else {
                console.log('No user or admin found with that username.');
            }
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

run();
