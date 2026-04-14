const mongoose = require('mongoose');
const { runExtractionPipeline } = require('./src/services/extractionService');
const DrawingExtraction = require('./src/models/DrawingExtraction');

async function repair() {
    try {
        await mongoose.connect('mongodb://localhost:27017/steel_dms');
        console.log('[REPAIR] Connected to DB.');

        // 1. Reset all records
        await DrawingExtraction.updateMany({}, {
            $set: {
                status: 'queued',
                errorMessage: '',
                extractedFields: {}
            }
        });

        const docs = await DrawingExtraction.find({});
        console.log(`[REPAIR] Re-processing ${docs.length} drawings...`);

        // Process in small batches of 5 to be safe
        const BATCH_SIZE = 5;
        for (let i = 0; i < docs.length; i += BATCH_SIZE) {
            const batch = docs.slice(i, i + BATCH_SIZE);
            console.log(`[REPAIR] Processing batch ${i / BATCH_SIZE + 1}...`);
            await Promise.all(batch.map(doc =>
                runExtractionPipeline(doc._id.toString(), doc.fileUrl, doc.projectId.toString())
            ));
            // Wait for items to mostly finish before next batch
            await new Promise(r => setTimeout(r, 5000));
        }

        console.log('[REPAIR] All tasks initiated.');
    } catch (err) {
        console.error('[REPAIR] Error:', err.message);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

repair();
