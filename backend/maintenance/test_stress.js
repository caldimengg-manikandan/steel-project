const mongoose = require('mongoose');
const { runExtractionPipeline } = require('./src/services/extractionService');
const DrawingExtraction = require('./src/models/DrawingExtraction');

async function run() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const projectId = new mongoose.Types.ObjectId('699d6214de7334aa73755445a');
    const adminId = new mongoose.Types.ObjectId('699d1f294d7710a3ad235945');

    console.log('Starting stress test: 100 drawings');
    const start = Date.now();

    const docs = [];
    for (let i = 0; i < 100; i++) {
        docs.push({
            projectId,
            createdByAdminId: adminId,
            originalFileName: `stress_test_${i}.pdf`,
            fileUrl: 'fake_path.pdf',
            fileSize: 1000,
            uploadedBy: 'stress_tester',
            status: 'queued'
        });
    }

    const saved = await DrawingExtraction.insertMany(docs);
    console.log(`Inserted 100 docs in ${Date.now() - start}ms`);

    const promises = saved.map(doc => runExtractionPipeline(doc._id.toString(), doc.fileUrl, projectId));

    // We can't easily wait for all because they are fire-and-forget in the service
    // But we can poll the DB
    let completed = 0;
    while (completed < 100) {
        completed = await DrawingExtraction.countDocuments({
            _id: { $in: saved.map(d => d._id) },
            status: 'completed'
        });
        console.log(`Progress: ${completed}/100`);
        if (completed < 100) await new Promise(r => setTimeout(r, 500));
    }

    console.log(`Total time for 100 mocks: ${Date.now() - start}ms`);
    process.exit(0);
}
run();
