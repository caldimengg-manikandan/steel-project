const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { runExtractionPipeline } = require('../src/services/extractionService');
const DrawingExtraction = require('../src/models/DrawingExtraction');

async function run() {
    try {
        const mongoUri = process.env.MONGO_URI;
        if (!mongoUri) {
            console.error('MONGO_URI is not defined in the environment variables.');
            process.exit(1);
        }

        console.log('[REPROCESS] Connecting to MongoDB...');
        await mongoose.connect(mongoUri);
        console.log('[REPROCESS] Connected to MongoDB.');

        // Find failed extractions
        const failedDocs = await DrawingExtraction.find({ status: 'failed' });
        console.log(`[REPROCESS] Found ${failedDocs.length} failed extractions.`);

        if (failedDocs.length === 0) {
            console.log('[REPROCESS] No failed extractions to reprocess.');
            process.exit(0);
        }

        for (const doc of failedDocs) {
            const fileRef = doc.oneDriveFileId || doc.fileUrl || doc.gridFsFileId;
            if (!fileRef) {
                console.warn(`[REPROCESS] Skipping ${doc.originalFileName} (${doc._id}) - missing file reference.`);
                continue;
            }

            console.log(`[REPROCESS] Reprocessing ${doc.originalFileName} (${doc._id}) with fileRef: ${fileRef}`);
            
            // Trigger extraction pipeline (wait for each to complete or run concurrently)
            try {
                await runExtractionPipeline(
                    doc._id.toString(),
                    fileRef.toString(),
                    doc.projectId.toString(),
                    doc.targetTransmittalNumber
                );
                console.log(`[REPROCESS] Started reprocessing for ${doc.originalFileName}`);
            } catch (err) {
                console.error(`[REPROCESS] Failed to trigger reprocessing for ${doc.originalFileName}:`, err.message);
            }
        }

        // Wait a bit to let processes run, then disconnect
        console.log('[REPROCESS] Reprocessing tasks triggered. Waiting 30 seconds for them to finish processing...');
        await new Promise(resolve => setTimeout(resolve, 30000));
        
    } catch (err) {
        console.error('[REPROCESS] Global error:', err.message);
    } finally {
        await mongoose.disconnect();
        console.log('[REPROCESS] Disconnected from MongoDB.');
        process.exit(0);
    }
}

run();
