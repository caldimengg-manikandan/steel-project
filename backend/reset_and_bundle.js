const mongoose = require('mongoose');
const MONGO_URI = 'mongodb://localhost:27017/steel_dms';

async function scan() {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;
    
    const projects = await db.collection('projects').find({}).toArray();
    for (const p of projects) {
        const total = await db.collection('drawing_extractions').countDocuments({ projectId: p._id });
        const comp = await db.collection('drawing_extractions').countDocuments({ projectId: p._id, status: 'completed' });
        const tr = await db.collection('transmittals').countDocuments({ projectId: p._id });
        console.log(` - "${p.name}" [${p._id}] Extractions: ${total} (${comp} comp) | Transmittals: ${tr}`);
    }
    
    await mongoose.disconnect();
    process.exit(0);
}

scan().catch(err => {
    console.error('Scan failed:', err);
    process.exit(1);
});
