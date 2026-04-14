const mongoose = require('mongoose');
require('dotenv').config();
const DrawingExtraction = require('./src/models/DrawingExtraction');
const Project = require('./src/models/Project');

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    const p = await Project.findOne({ name: 'Cleveland' });
    if (!p) { console.log('Cleveland not found'); process.exit(1); }
    
    // Find the 10 most recent drawings for Cleveland that are in TN 1
    const recentTN1 = await DrawingExtraction.find({ 
        projectId: p._id, 
        targetTransmittalNumber: 1 
    }).sort({ createdAt: -1 }).limit(10);
    
    if (recentTN1.length > 0) {
        console.log(`Moving ${recentTN1.length} drawings from TN 1 to TN 7...`);
        const ids = recentTN1.map(d => d._id);
        await DrawingExtraction.updateMany(
            { _id: { $in: ids } },
            { $set: { targetTransmittalNumber: 7 } }
        );
        // Also update project transmittalCount to 7
        await Project.findByIdAndUpdate(p._id, { $set: { transmittalCount: 7 } });
        console.log('Update complete.');
    } else {
        console.log('No drawings found for Cleveland in TN 1 to move.');
    }
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
