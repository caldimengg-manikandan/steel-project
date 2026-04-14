const mongoose = require('mongoose');
require('dotenv').config();
const DrawingExtraction = require('./src/models/DrawingExtraction');
const Project = require('./src/models/Project');

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    // Search for ANY status (failed, queued, etc) in the last 15 min
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
    const recent = await DrawingExtraction.find({ createdAt: { $gte: fifteenMinAgo } }).populate('projectId').sort({ createdAt: -1 }).lean();
    if (recent.length === 0) {
        console.log('No extractions found in the last 15 minutes across any project.');
    } else {
        recent.forEach(r => {
            console.log(`Project: ${r.projectId ? r.projectId.name : 'Unknown'}, File: ${r.originalFileName}, TN: ${r.targetTransmittalNumber}, Status: ${r.status}, CreatedAt: ${r.createdAt}`);
        });
    }
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
