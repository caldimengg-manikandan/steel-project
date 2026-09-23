const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });
mongoose.connect(process.env.MONGO_URI).then(async () => {
    const DrawingExtraction = require('./src/models/DrawingExtraction');
    const DrawingLog = require('./src/models/DrawingLog');

    const targetProjectId = '6ab2472593001f54e84a9758';

    // 1. Find extractions in the target project that are missing data
    const targetExtractions = await DrawingExtraction.find({ projectId: targetProjectId });
    let updatedCount = 0;

    for (const ex of targetExtractions) {
        const num = ex.extractedFields.drawingNumber;
        const hasBadData = !ex.extractedFields.drawingTitle || !ex.extractedFields.revisionHistory || ex.extractedFields.revisionHistory.length === 0;

        if (num && hasBadData) {
            // Find a GOOD extraction from ANY other project
            const goodEx = await DrawingExtraction.findOne({
                'extractedFields.drawingNumber': num,
                'extractedFields.drawingTitle': { $ne: '' },
                'extractedFields.revisionHistory.0': { $exists: true }
            }).sort({ createdAt: -1 });

            if (goodEx) {
                console.log('Found good data for ' + num);
                // Update the extraction
                ex.extractedFields.drawingTitle = goodEx.extractedFields.drawingTitle;
                ex.extractedFields.drawingDescription = goodEx.extractedFields.drawingDescription;
                ex.extractedFields.revisionHistory = goodEx.extractedFields.revisionHistory;
                ex.extractedFields.revision = goodEx.extractedFields.revision;
                ex.extractedFields.date = goodEx.extractedFields.date;
                ex.extractedFields.remarks = goodEx.extractedFields.remarks;
                ex.markModified('extractedFields');
                await ex.save();
                updatedCount++;
            }
        }
    }
    console.log('Updated ' + updatedCount + ' extractions in the database.');

    // 2. Also clear the cached DrawingLog so it rebuilds!
    await DrawingLog.deleteOne({ projectId: targetProjectId });
    console.log('Cleared cached DrawingLog to force a rebuild.');

    process.exit(0);
}).catch(console.error);
