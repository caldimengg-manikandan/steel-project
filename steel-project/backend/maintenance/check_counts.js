const mongoose = require('mongoose');

mongoose.connect('mongodb://127.0.0.1:27017/steel_dms').then(async () => {
    const DrawingExtraction = require('./src/models/DrawingExtraction');
    const totalCount = await DrawingExtraction.countDocuments();
    const completedCount = await DrawingExtraction.countDocuments({ status: 'completed' });
    const failedCount = await DrawingExtraction.countDocuments({ status: 'failed' });
    const grouped = await DrawingExtraction.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    console.log(`Total: ${totalCount}, Completed: ${completedCount}, Failed: ${failedCount}`);
    console.log(grouped);
    process.exit(0);
});
