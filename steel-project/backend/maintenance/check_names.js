const mongoose = require('mongoose');
async function run() {
    try {
        await mongoose.connect('mongodb://localhost:27017/steel_dms');
        const extractions = await mongoose.connection.db.collection('drawing_extractions').find({
            projectId: new mongoose.Types.ObjectId('699d6214de7334a733755445a')
        }).toArray();
        console.log('NAMES:', JSON.stringify(extractions.map(e => e.originalFileName)));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
run();
