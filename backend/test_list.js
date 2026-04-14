require('dotenv').config();
const mongoose = require('mongoose');
const Transmittal = require('./src/models/Transmittal');

async function test() {
    await mongoose.connect(process.env.MONGO_URI);
    const p = await mongoose.connection.db.collection('projects').findOne({ name: 'maryland' });
    const adminId = '699d1f294d7710a3ad235945';
    
    console.log('Querying for Project:', p.name, 'Admin:', adminId);
    
    const results = await Transmittal.find({ 
        projectId: p._id, 
        createdByAdminId: new mongoose.Types.ObjectId(adminId) 
    }).sort({ transmittalNumber: -1 }).lean();
    
    console.log('Count:', results.length);
    console.log('List:', results.map(r => ({ num: r.transmittalNumber, id: r._id, new: r.newCount })));
    await mongoose.disconnect();
}
test();
