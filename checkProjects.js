const mongoose = require('mongoose');
const Project = require('./backend/src/models/Project');
require('dotenv').config({ path: './backend/.env' });

async function checkProjects() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/steel-dms');
    const projects = await Project.find({}, 'name status rawStatus');
    console.log('Projects:', projects);
    process.exit(0);
}
checkProjects();
