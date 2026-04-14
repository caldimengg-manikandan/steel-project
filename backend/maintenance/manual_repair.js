const mongoose = require('mongoose');
const { execSync } = require('child_process');
const path = require('path');

async function run() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const DrawingExtraction = mongoose.model('DrawingExtraction', new mongoose.Schema({
        status: String,
        originalFileName: String,
        fileUrl: String,
        extractedFields: Object,
        extractionConfidence: Number,
        updatedAt: Date
    }, { collection: 'drawing_extractions' }));

    const docs = await DrawingExtraction.find({
        // Focus on potentially wrong ones or just do a fresh sweep
    });

    console.log(`Ready to process ${docs.length} docs manually...`);

    for (const doc of docs) {
        try {
            const pdfPath = path.resolve(__dirname, doc.fileUrl);
            const scriptPath = path.resolve(__dirname, 'src/scripts/extract_drawing.py');

            console.log(`Processing: ${doc.originalFileName}`);
            const output = execSync(`python "${scriptPath}" "${pdfPath}"`, { encoding: 'utf8' });
            const result = JSON.parse(output);

            if (result.success) {
                await DrawingExtraction.updateOne({ _id: doc._id }, {
                    $set: {
                        status: 'completed',
                        extractedFields: result.fields,
                        extractionConfidence: result.confidence,
                        updatedAt: new Date()
                    }
                });
                console.log(`  ✓ Dwg: ${result.fields.drawingNumber} | Title: ${result.fields.drawingTitle}`);
            } else {
                console.error(`  ✗ Error: ${result.error}`);
            }
        } catch (err) {
            console.error(`  ✗ Failed: ${doc.originalFileName} - ${err.message}`);
        }
    }

    process.exit(0);
}
run();
