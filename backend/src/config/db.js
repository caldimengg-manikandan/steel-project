const mongoose = require('mongoose');

async function connectDB() {
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/steel_dms';
    try {
        await mongoose.connect(uri);
        console.log(`[DB] MongoDB connected → ${mongoose.connection.host}`);
    } catch (err) {
        console.error('[DB] Connection failed:', err.message);
        process.exit(1);
    }
}

module.exports = connectDB;
