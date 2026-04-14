const mongoose = require('mongoose');
async function run() {
    try {
        await mongoose.connect('mongodb://localhost:27017/steel_dms');
        const count = await mongoose.connection.db.collection('drawing_extractions').countDocuments({});
        console.log('TOTAL_EXTRACTIONS:', count);

        const all = await mongoose.connection.db.collection('drawing_extractions').find({}).toArray();
        console.log('DETAILS:', JSON.stringify(all.map(d => ({
            name: d.originalFileName,
            status: d.status,
            proj: d.projectId,
            admin: d.createdByAdminId
        })), null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
run();
