const mongoose = require('mongoose');
async function run() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    for (const c of collections) {
        const count = await db.collection(c.name).countDocuments({});
        console.log(`${c.name}: ${count}`);
        if (c.name === 'drawing_extractions') {
            const all = await db.collection(c.name).find({}).toArray();
            const s = {};
            all.forEach(x => s[x.status] = (s[x.status] || 0) + 1);
            console.log('Statuses:', s);
        }
    }
    process.exit(0);
}
run();
