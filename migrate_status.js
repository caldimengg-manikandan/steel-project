const mongoose = require('mongoose');
const Project = require('./backend/src/models/Project');
require('dotenv').config({ path: './backend/.env' });

async function migrate() {
    try {
        await mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
        console.log('Connected to DB');
        const result = await Project.updateMany({ status: 'active' }, { $set: { status: 'in_progress' } });
        console.log(`Updated ${result.modifiedCount} projects`);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
migrate();
