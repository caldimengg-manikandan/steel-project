require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        const db = mongoose.connection.db;
        const docs = await db.collection('drawing_extractions').find({
            originalFileName: 'F-03.04_A.pdf'
        }).toArray();
        console.log(JSON.stringify(docs.map(d => ({
            id: d._id,
            f: d.originalFileName,
            dn: d.extractedFields?.drawingNumber,
            r: d.extractedFields?.revision,
            d: d.extractedFields?.date,
            status: d.status
        })), null, 2));
        process.exit(0);
    });
