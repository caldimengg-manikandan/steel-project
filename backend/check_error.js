const mongoose = require('mongoose');
const DrawingExtraction = require('./src/models/DrawingExtraction');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
    try {
        const failed = await DrawingExtraction.find({ targetTransmittalNumber: 47, status: 'failed' }).limit(1);
        if (failed.length > 0) {
            console.log('Error message of failed extraction:', failed[0].errorMessage);
        } else {
            console.log('No failed extractions found.');
        }
    } catch (e) {
        console.error('Error:', e);
    } finally {
        process.exit(0);
    }
});
