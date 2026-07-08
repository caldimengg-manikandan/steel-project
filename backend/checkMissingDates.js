require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI);
const DrawingExtraction = require('./src/models/DrawingExtraction');
const db = mongoose.connection;
db.once('open', async () => {
    const docs = await DrawingExtraction.find({ originalFileName: { $in: ['07B1001_B.pdf', '07C1000_B.pdf', '07M1009_A.pdf'] } });
    console.log(docs.map(d => ({file: d.originalFileName, date: d.createdAt})));
    process.exit(0);
});
