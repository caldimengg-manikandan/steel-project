const mongoose = require('mongoose');
const MONGO_URI = 'mongodb://localhost:27017/steel_dms';

async function reset() {
    console.log('Connecting to ' + MONGO_URI + '...');
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;
    
    // 1. Find the project "sds"
    const project = await db.collection('projects').findOne({ name: 'sds' });
    if (!project) {
        console.log('Project "sds" not found.');
        process.exit(1);
    }
    const pid = project._id;
    console.log('--- Resetting Project: ' + project.name + ' (' + pid + ') ---');

    // 2. Delete Transmittals
    const tRef = await db.collection('transmittals').deleteMany({ projectId: pid });
    console.log('✓ Deleted ' + tRef.deletedCount + ' transmittals.');

    // 3. Delete Drawing Logs
    const dlRef = await db.collection('drawing_logs').deleteMany({ projectId: pid });
    console.log('✓ Deleted ' + dlRef.deletedCount + ' drawing logs.');

    // 4. Delete Drawing Extractions
    const deRef = await db.collection('drawing_extractions').deleteMany({ projectId: pid });
    console.log('✓ Deleted ' + deRef.deletedCount + ' drawing extractions.');

    // 5. Reset Counter
    const pRef = await db.collection('projects').updateOne(
        { _id: pid },
        { $set: { transmittalCount: 0 } }
    );
    console.log('✓ Project counter reset to 0.');

    console.log('--- ALL DONE ---');
    await mongoose.disconnect();
    process.exit(0);
}

reset().catch(err => {
    console.error('Reset failed:', err);
    process.exit(1);
});
