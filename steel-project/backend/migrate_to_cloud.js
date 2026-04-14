require('dotenv').config();
const mongoose = require('mongoose');

async function migrate() {
    const LOCAL_URI = 'mongodb://localhost:27017/steel_dms';
    const CLOUD_URI = process.env.MONGO_URI;

    console.log('--- MIGRATION START: Local -> Cloud ---');
    console.log('Source:', LOCAL_URI);
    console.log('Dest:', CLOUD_URI.split('@')[1]); // Hide password

    try {
        // 1. Connect to Local
        const localConn = await mongoose.createConnection(LOCAL_URI).asPromise();
        console.log('CONNECTED TO LOCAL');

        // 2. Connect to Cloud
        const cloudConn = await mongoose.createConnection(CLOUD_URI).asPromise();
        console.log('CONNECTED TO CLOUD');

        const collections = [
            'projects',
            'transmittals',
            'drawing_extractions',
            'drawing_logs',
            'change_orders',
            'rfiextractions',
            'users',
            'admins'
        ];

        for (const colName of collections) {
            console.log(`\nMigrating collection: ${colName}...`);
            const localCol = localConn.db.collection(colName);
            const cloudCol = cloudConn.db.collection(colName);

            const docs = await localCol.find({}).toArray();
            if (docs.length === 0) {
                console.log(`  - Skipping (empty)`);
                continue;
            }

            console.log(`  - Found ${docs.length} documents on local.`);
            
            // Delete existing on cloud to prevent duplicates (Caution!)
            await cloudCol.deleteMany({});
            console.log(`  - Cleared existing on cloud.`);

            // Batch insert
            await cloudCol.insertMany(docs);
            console.log(`  - DONE: Inserted ${docs.length} documents.`);
        }

        await localConn.close();
        await cloudConn.close();
        console.log('\n--- MIGRATION SUCCESS! ---');
        console.log('Everything from your local machine has been moved to the cloud.');
    } catch (err) {
        console.error('Migration failed:', err.message);
    }
}
migrate();
