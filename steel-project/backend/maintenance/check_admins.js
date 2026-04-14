const mongoose = require('mongoose');
async function run() {
    try {
        await mongoose.connect('mongodb://localhost:27017/steel_dms');
        const admins = await mongoose.connection.db.collection('admins').find({}).toArray();
        console.log('ADMINS:', JSON.stringify(admins.map(a => ({ u: a.username, id: a._id.toString() }))));

        const extractions = await mongoose.connection.db.collection('drawing_extractions').find({}).toArray();
        const adminCounts = {};
        extractions.forEach(e => {
            const aId = e.createdByAdminId.toString();
            adminCounts[aId] = (adminCounts[aId] || 0) + 1;
        });
        console.log('EXTRACTION_ADMIN_COUNTS:', JSON.stringify(adminCounts));

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
run();
