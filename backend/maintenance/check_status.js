const mongoose = require('mongoose');
async function run() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const statuses = await mongoose.connection.db.collection('drawing_extractions').aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
    ]).toArray();
    console.log('Current Status Breakdown:', statuses);

    if (statuses.find(s => s._id === 'completed')) {
        const samples = await mongoose.connection.db.collection('drawing_extractions').find({ status: 'completed' }).limit(2).toArray();
        samples.forEach(s => console.log(`File: ${s.originalFileName} | Title: ${s.extractedFields.drawingTitle}`));
    }

    process.exit(0);
}
run();
