require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const db = mongoose.connection.db;
    const docs = await db.collection('drawing_extractions').find({}).sort({createdAt: -1}).limit(20).toArray();
    console.log(JSON.stringify(docs.map(d => ({
        name: d.originalFileName,
        status: d.status,
        dwg: d.extractedFields?.drawingNumber,
        rev: d.extractedFields?.revision,
        date: d.extractedFields?.date
    })), null, 2));
    process.exit(0);
});
