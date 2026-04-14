require('dotenv').config();
const mongoose = require('mongoose');

async function test() {
    console.log('Testing connection to:', process.env.MONGO_URI);
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('SUCCESS: Connected to MongoDB Atlas!');
        const adminCount = await mongoose.connection.db.collection('admins').countDocuments();
        console.log('Found', adminCount, 'admins in the cloud DB.');
        await mongoose.disconnect();
    } catch (err) {
        console.error('FAILED:', err.message);
    }
}
test();
