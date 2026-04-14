const mongoose = require('mongoose');
async function run() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const admins = await mongoose.connection.db.collection('admins').find({}).toArray();
    console.log('--- ADMINS ---');
    admins.forEach(a => console.log(`${a.username}: ${a._id}`));

    const extractions = await mongoose.connection.db.collection('drawing_extractions').find({}).toArray();
    const ac = {};
    extractions.forEach(e => {
        const id = e.createdByAdminId.toString();
        ac[id] = (ac[id] || 0) + 1;
    });
    console.log('--- EXTRACTION ADMIN COUNTS ---');
    Object.keys(ac).forEach(k => console.log(`${k}: ${ac[k]}`));
    process.exit(0);
}
run();
