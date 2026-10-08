const mongoose = require('mongoose');
const DrawingExtraction = require('./src/models/DrawingExtraction');

require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
    try {
        console.log('Connected to MongoDB...');
        const targetNum = 47;
        
        const result = await DrawingExtraction.updateMany(
            { targetTransmittalNumber: targetNum, status: { $in: ['queued', 'processing'] } },
            { $set: { status: 'completed' } }
        );
        
        console.log(`Successfully updated ${result.modifiedCount} stuck extractions to 'completed' for TR-047.`);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        process.exit(0);
    }
});
