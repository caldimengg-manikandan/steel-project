const mongoose = require('mongoose');

async function debug() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const db = mongoose.connection.db;
    const projectId = new mongoose.Types.ObjectId('69bd358ee076089d2d34a4ca');

    const status = await db.collection('drawing_extractions').aggregate([
        { $match: { projectId } },
        { $group: { 
            _id: "$targetTransmittalNumber", 
            count: { $sum: 1 }, 
            minDate: { $min: "$createdAt" },
            maxDate: { $max: "$createdAt" }
        } },
        { $sort: { _id: 1 } }
    ]).toArray();

    console.log('--- Drawing Extractions Status ---');
    status.forEach(s => {
        console.log(`TransNum: ${s._id}, Count: ${s.count}, MinDate: ${s.minDate}, MaxDate: ${s.maxDate}`);
    });

    const transmittals = await db.collection('transmittals').find({ projectId }).toArray();
    console.log('\n--- Transmittal Records ---');
    transmittals.forEach(t => {
        console.log(`- ID: ${t._id}, Num: ${t.transmittalNumber}, New: ${t.newCount}, Date: ${t.createdAt}`);
    });

    await mongoose.disconnect();
}
debug();
