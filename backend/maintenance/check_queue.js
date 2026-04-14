const mongoose = require('mongoose');

mongoose.connect('mongodb://127.0.0.1:27017/steel_dms').then(async () => {
    const DrawingExtraction = require('./src/models/DrawingExtraction');
    const docs = await DrawingExtraction.find({ status: { $ne: 'completed' } }).lean();
    console.log(`Found ${docs.length} incomplete extractions.`);
    console.log(JSON.stringify(docs, null, 2));
    process.exit(0);
});
