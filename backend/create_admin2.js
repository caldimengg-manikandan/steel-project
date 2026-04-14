const mongoose = require('mongoose');
const Admin = require('./src/models/Admin');
const dotenv = require('dotenv');

dotenv.config();

async function run() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected.');

        const username = 'admin2';
        const email = 'admin2@firm.com';
        const password = 'password123';

        console.log(`Creating Admin account: ${username}...`);
        
        // We set password_hash directly because the pre-save hook handles hashing
        const newAdmin = new Admin({
            username: username.toLowerCase(),
            email: email,
            password_hash: password, // Pre-save hook hashes it
            displayName: 'Admin 2'
        });

        await newAdmin.save();
        console.log(`Admin ${username} created successfully with password: ${password}`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

run();
