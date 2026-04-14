const mongoose = require('mongoose');
require('dotenv').config();
const { runExtractionPipeline } = require('./src/services/extractionService');
const DrawingExtraction = require('./src/models/DrawingExtraction');

async function repair() {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/steel_dms');
        console.log('[REPAIR] Connected to DB.');

        // Reset all records to queued and clear errors
        await DrawingExtraction.updateMany({}, {
            $set: { status: 'queued', errorMessage: '' }
        });

        const docs = await DrawingExtraction.find({});
        console.log(`[REPAIR] Found ${docs.length} drawings to re-process.`);

        for (const doc of docs) {
            console.log(`[REPAIR] Starting ${doc.originalFileName}...`);
            try {
                await runExtractionPipeline(doc._id.toString(), doc.fileUrl, doc.projectId.toString());
                console.log(`[REPAIR] ✓ ${doc.originalFileName} SUCCESS`);
            } catch (err) {
                console.error(`[REPAIR] ✗ ${doc.originalFileName} FAILED:`, err.message);
            }
        }

        console.log('[REPAIR] All tasks finished.');
    } catch (err) {
        console.error('[REPAIR] Global Error:', err.message);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

repair();
