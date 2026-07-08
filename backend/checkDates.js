require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection;

db.once('open', async () => {
    const projects = await db.collection('projects').find({}).toArray();
    console.log('\n--- PROJECT DATES ---');
    projects.forEach(p => {
        const created = p.createdAt ? new Date(p.createdAt).toISOString().split('T')[0] : 'No Date';
        const updated = p.updatedAt ? new Date(p.updatedAt).toISOString().split('T')[0] : 'No Date';
        console.log(`Project: ${p.name.substring(0, 15).padEnd(15)} | Created: ${created} | Updated: ${updated}`);
    });
    process.exit(0);
});
