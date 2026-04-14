const mongoose = require('mongoose');
const { runExtractionPipeline } = require('./src/services/extractionService');
const DrawingExtraction = require('./src/models/DrawingExtraction');
const fs = require('fs');
const path = require('path');

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

        // 2. Clear old Excels to avoid appending to "wrong" data
        const excelDir = path.join(__dirname, 'storage', 'excels');
        if (fs.existsSync(excelDir)) {
            const files = fs.readdirSync(excelDir);
            for (const f of files) {
                if (f.endsWith('.xlsx')) {
                    fs.unlinkSync(path.join(excelDir, f));
                    console.log(`[REPAIR] Deleted old excel: ${f}`);
                }
            }
        }

        const docs = await DrawingExtraction.find({});
        console.log(`[REPAIR] Re-processing ${docs.length} drawings with V2 Parser...`);

        // Process in batches
        const BATCH_SIZE = 10;
        for (let i = 0; i < docs.length; i += BATCH_SIZE) {
            const batch = docs.slice(i, i + BATCH_SIZE);
            console.log(`[REPAIR] Batch ${i / BATCH_SIZE + 1}...`);
            await Promise.all(batch.map(doc =>
                runExtractionPipeline(doc._id.toString(), doc.fileUrl, doc.projectId.toString())
            ));
            await new Promise(r => setTimeout(r, 3000));
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
