const mongoose = require('mongoose');
const fs = require('fs');

async function debug() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const db = mongoose.connection.db;

    let output = '';

    const projects = await db.collection('projects').find({}).toArray();
    output += '--- PROJECTS ---\n';
    projects.forEach(p => {
        output += `- ID: ${p._id}, Name: ${p.name}, Count: ${p.transmittalCount}\n`;
    });

    const transmittals = await db.collection('transmittals').find({}).toArray();
    output += '\n--- ALL TRANSMITTALS ---\n';
    transmittals.forEach(t => {
        output += `- ProjectID: ${t.projectId}, Transmittal #: ${t.transmittalNumber}, New: ${t.newCount}, ID: ${t._id}\n`;
    });

    const extractions = await db.collection('drawing_extractions').aggregate([
        { $group: { _id: { projectId: "$projectId", transNum: "$targetTransmittalNumber" }, count: { $sum: 1 } } }
    ]).toArray();
    output += '\n--- EXTRACTIONS GROUPED BY PROJECT AND TRANSMITTAL ---\n';
    extractions.forEach(e => {
        output += `- ProjectID: ${e._id.projectId}, TransNum: ${e._id.transNum}, Count: ${e.count}\n`;
    });

    fs.writeFileSync('c:/Users/vibhu/steel-project/backend/debug_output.txt', output);
    console.log('Output written to debug_output.txt');
    await mongoose.disconnect();
}
debug();
