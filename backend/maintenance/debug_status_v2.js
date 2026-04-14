const mongoose = require('mongoose');
async function run() {
    try {
        await mongoose.connect('mongodb://localhost:27017/steel_dms');
        const stats = await mongoose.connection.db.collection('drawing_extractions').aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]).toArray();
        console.log('STATS:', JSON.stringify(stats));

        const processing = await mongoose.connection.db.collection('drawing_extractions').find({ status: { $in: ['processing', 'queued'] } }).toArray();
        console.log('ACTIVE:', JSON.stringify(processing.map(p => ({ n: p.originalFileName, s: p.status }))));

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
run();
