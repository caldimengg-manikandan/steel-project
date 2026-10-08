const mongoose = require('mongoose');
const DrawingExtraction = require('./src/models/DrawingExtraction');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
    try {
        const result = await DrawingExtraction.updateMany(
            { targetTransmittalNumber: 47, status: 'failed' },
            { $set: { status: 'completed' } }
        );
        console.log(`Updated ${result.modifiedCount} failed extractions to completed.`);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        process.exit(0);
    }
});
