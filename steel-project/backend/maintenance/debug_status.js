const mongoose = require('mongoose');
async function run() {
    try {
        await mongoose.connect('mongodb://localhost:27017/steel_dms');
        const stats = await mongoose.connection.db.collection('drawing_extractions').aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]).toArray();
        console.log('STATS_JSON:', JSON.stringify(stats));

        const processing = await mongoose.connection.db.collection('drawing_extractions').find({ status: 'processing' }).toArray();
        console.log('PROCESSING_JSON:', JSON.stringify(processing.map(p => p.originalFileName)));

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
run();
