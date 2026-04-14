const mongoose = require('mongoose');
async function run() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const statuses = await mongoose.connection.db.collection('drawing_extractions').aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
    ]).toArray();
    console.log('Current Status Breakdown:', statuses);

    const processing = await mongoose.connection.db.collection('drawing_extractions').find({ status: 'processing' }).limit(5).toArray();
    processing.forEach(p => {
        const age = (Date.now() - new Date(p.updatedAt)) / 1000;
        console.log(`File: ${p.originalFileName} | ID: ${p._id} | Age: ${age.toFixed(1)}s`);
    });

    process.exit(0);
}
run();
