const { MongoClient } = require('mongodb');
require('dotenv').config({ path: './.env' });

// =========================================================
// IMPORTANT: REPLACE THIS WITH YOUR REAL PASSWORD!
// Make sure you remove the < > brackets!
const NEW_MONGO_URI = 'mongodb://vibhurna:SteelDms2026@ac-qumq89a-shard-00-00.5um8e7w.mongodb.net:27017,ac-qumq89a-shard-00-01.5um8e7w.mongodb.net:27017,ac-qumq89a-shard-00-02.5um8e7w.mongodb.net:27017/steel_dms?ssl=true&replicaSet=atlas-woc0xl-shard-0&authSource=admin&retryWrites=true&w=majority';
// =========================================================

const OLD_MONGO_URI = process.env.MONGO_URI;

async function migrateData() {
    console.log('Connecting to OLD database...');
    const oldClient = new MongoClient(OLD_MONGO_URI);
    await oldClient.connect();
    const oldDb = oldClient.db('steel_dms'); // Default DB from old connection string
    console.log('Connected to OLD database successfully.');

    console.log('Connecting to NEW database...');
    const newClient = new MongoClient(NEW_MONGO_URI);
    await newClient.connect();
    const newDb = newClient.db('steel_dms'); // Using same db name
    console.log('Connected to NEW database successfully.');

    const collectionsToCopy = [
        'users', 'admins', 'projects', 'transmittals',
        'drawing_extractions', 'drawing_logs', 'rfiextractions',
        'activitylogs', 'systemsettings', 'clients'
    ];

    for (const collName of collectionsToCopy) {
        console.log(`\n--- Migrating collection: ${collName} ---`);
        const oldColl = oldDb.collection(collName);
        const newColl = newDb.collection(collName);

        const data = await oldColl.find({}).toArray();
        console.log(`Found ${data.length} documents in old ${collName}.`);

        if (data.length > 0) {
            // Drop new collection if it exists to avoid duplicate key errors during migration
            try {
                await newColl.drop();
            } catch(e) { /* ignore if it doesn't exist */ }

            await newColl.insertMany(data);
            console.log(`Successfully inserted ${data.length} documents into new ${collName}.`);
        }
    }

    console.log('\n======================================================');
    console.log('MIGRATION COMPLETE! All your data has been copied.');
    console.log('You can now safely update the MONGO_URI in your .env file!');
    console.log('======================================================');

    await oldClient.close();
    await newClient.close();
    process.exit(0);
}

migrateData().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
