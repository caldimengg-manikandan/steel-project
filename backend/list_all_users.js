const mongoose = require('mongoose');
const Admin = require('./src/models/Admin');
const User = require('./src/models/User');
const dotenv = require('dotenv');

dotenv.config();

async function run() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        
        console.log('--- ADMINS ---');
        const admins = await Admin.find({});
        admins.forEach(a => console.log(`[Admin] Username: "${a.username}" | Email: "${a.email}"`));

        console.log('--- USERS ---');
        const users = await User.find({});
        users.forEach(u => console.log(`[User] Username: "${u.username}" | Email: "${u.email}"`));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

run();
