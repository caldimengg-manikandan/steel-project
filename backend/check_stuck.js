const mongoose = require('mongoose');
const DrawingExtraction = require('./src/models/DrawingExtraction');

require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
    try {
        console.log('Connected to MongoDB...');
        const targetNum = 47;
        
        const counts = await DrawingExtraction.aggregate([
            { $match: { targetTransmittalNumber: targetNum } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]);
        console.log(`Status counts for TR-047:`, counts);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        process.exit(0);
    }
});
