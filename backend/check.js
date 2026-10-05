const mongoose = require('mongoose');
const DrawingExtraction = require('./src/models/DrawingExtraction');
mongoose.connect('mongodb://127.0.0.1:27017/steel_dms').then(async () => {
    const counts = await DrawingExtraction.aggregate([
        { $match: { targetTransmittalNumber: 47 } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    console.log('STATUS COUNTS:', counts);
    process.exit(0);
});
