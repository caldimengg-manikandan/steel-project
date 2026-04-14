const mongoose = require('mongoose');
async function run() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const stats = await mongoose.connection.db.collection('drawing_extractions').aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
    ]).toArray();
    console.log('STATS:', JSON.stringify(stats));
    process.exit(0);
}
run();
