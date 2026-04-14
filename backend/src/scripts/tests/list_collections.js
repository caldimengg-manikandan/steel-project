const mongoose = require('mongoose');
require('dotenv').config();

async function listCollections() {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/steel_dms');
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('Collections:', collections.map(c => c.name));
    process.exit(0);
}

listCollections();
