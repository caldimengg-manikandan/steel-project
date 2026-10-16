const mongoose = require('mongoose');
require('dotenv').config();
const Project = require('../src/models/Project');
const Transmittal = require('../src/models/Transmittal');
const DrawingLog = require('../src/models/DrawingLog');
const DrawingExtraction = require('../src/models/DrawingExtraction');

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    const projects = await Project.find({}, 'name _id clientName').lean();
    console.log('Total Projects:', projects.length);
    
    for (const p of projects) {
        const transmittals = await Transmittal.find({ projectId: p._id }, 'transmittalNumber isVoided drawings').lean();
        const logs = await DrawingLog.find({ projectId: p._id }, 'lastTransmittalNo drawings').lean();
        const extractionsCount = await DrawingExtraction.countDocuments({ projectId: p._id });
        console.log(`\nProject: ${p.name} (${p._id})`);
        console.log(`  Extractions: ${extractionsCount}`);
        console.log(`  Transmittals: ${transmittals.map(t => 'TR#' + t.transmittalNumber + ' (' + (t.drawings?.length || 0) + ' dwgs, voided: ' + t.isVoided + ')').join(', ')}`);
        console.log(`  DrawingLog: ${logs.map(l => 'lastTR: ' + l.lastTransmittalNo + ', dwgs: ' + (l.drawings?.length || 0)).join(', ')}`);
    }
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
