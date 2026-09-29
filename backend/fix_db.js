const mongoose = require('mongoose');
require('dotenv').config({path: './.env'});
mongoose.connect(process.env.MONGO_URI).then(async () => {
    console.log('Connected to MongoDB');
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    for (const c of collections) {
        const cStats = await db.command({ collStats: c.name });
        console.log(`Collection ${c.name}: ${(cStats.size / 1024 / 1024).toFixed(2)} MB`);
    }
    process.exit(0);
}).catch(console.error);
