const mongoose = require('mongoose');

async function debug() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const db = mongoose.connection.db;

    const projects = await db.collection('projects').find({}).toArray();
    console.log('--- PROJECTS ---');
    projects.forEach(p => {
        console.log(`- ID: ${p._id}, Name: ${p.name}, Count: ${p.transmittalCount}`);
    });

    const transmittals = await db.collection('transmittals').find({}).toArray();
    console.log('\n--- ALL TRANSMITTALS ---');
    transmittals.forEach(t => {
        console.log(`- ProjectID: ${t.projectId}, Transmittal #: ${t.transmittalNumber}, New: ${t.newCount}, ID: ${t._id}`);
    });

    // Drawing extractions count per projectId and target transmittal number
    const extractions = await db.collection('drawing_extractions').aggregate([
        { $group: { _id: { projectId: "$projectId", transNum: "$targetTransmittalNumber" }, count: { $sum: 1 } } }
    ]).toArray();
    console.log('\n--- EXTRACTIONS GROUPED BY PROJECT AND TRANSMITTAL ---');
    extractions.forEach(e => {
        console.log(`- ProjectID: ${e._id.projectId}, TransNum: ${e._id.transNum}, Count: ${e.count}`);
    });

    await mongoose.disconnect();
}
debug();
