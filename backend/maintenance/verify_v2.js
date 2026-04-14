const mongoose = require('mongoose');
async function run() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const statuses = await mongoose.connection.db.collection('drawing_extractions').aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
    ]).toArray();
    console.log('Status Breakdown:', statuses);

    const samples = await mongoose.connection.db.collection('drawing_extractions').find({ status: 'completed' }).limit(10).toArray();
    samples.forEach(s => {
        console.log(`File: ${s.originalFileName} | Dwg: ${s.extractedFields.drawingNumber} | Title: ${s.extractedFields.drawingTitle} | Rev: ${s.extractedFields.revision} | Date: ${s.extractedFields.date}`);
    });

    process.exit(0);
}
run();
