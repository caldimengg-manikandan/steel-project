const mongoose = require('mongoose');
async function run() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const extractions = await mongoose.connection.db.collection('drawing_extractions').find({}).toArray();
    extractions.forEach(e => {
        console.log(`'${e.originalFileName}' | ${e.originalFileName.length} | ${e.status}`);
    });
    process.exit(0);
}
run();
