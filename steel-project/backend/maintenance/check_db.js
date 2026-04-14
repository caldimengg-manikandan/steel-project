const mongoose = require('mongoose');
async function check() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const stats = await mongoose.connection.db.collection('drawing_extractions').aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]).toArray();
    console.log('Stats:', stats);
    const api_key = process.env.VISION_AGENT_API_KEY;
    console.log('API KEY FOUND:', !!api_key);
    process.exit(0);
}
check();
