const mongoose = require('mongoose');
async function listAll() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const db = mongoose.connection.db;
    const ps = await db.collection('projects').find({}).toArray();
    ps.forEach(p => console.log(' - "' + p.name + '" [' + p._id + '] count:' + p.transmittalCount));
    await mongoose.disconnect();
    process.exit(0);
}
listAll();
