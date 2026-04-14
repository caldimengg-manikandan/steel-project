const mongoose = require('mongoose');
async function run() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const stuck = await mongoose.connection.db.collection('drawing_extractions').find({
        status: { $in: ['processing', 'queued'] }
    }).toArray();

    console.log(`Found ${stuck.length} items in non-terminal states.`);

    if (stuck.length > 0) {
        console.log('Resetting them to queued to force a fresh extraction run...');
        await mongoose.connection.db.collection('drawing_extractions').updateMany(
            { status: { $in: ['processing', 'queued'] } },
            { $set: { status: 'queued' } }
        );
    }

    process.exit(0);
}
run();
