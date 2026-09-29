require('dotenv').config();
const mongoose = require('mongoose');
const { calculateSowProgress } = require('./src/utils/sowCalculator');
const Project = require('./src/models/Project');
const { attachProjectStats } = require('./src/services/projectStatsService');

async function check() {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/steel-project');
    const projects = await Project.find({}).lean();
    const p = projects.find(proj => proj.scopeOfWork && proj.scopeOfWork.length > 0);
    
    if (!p) {
        console.log('No project found with SOW');
        process.exit(0);
    }
    
    console.log('--- DB Data ---');
    console.log('Project:', p.name);
    console.log('SOW Length:', p.scopeOfWork.length);
    console.log(JSON.stringify(p.scopeOfWork, null, 2));

    const result = calculateSowProgress(p.scopeOfWork);
    console.log('\n--- calculateSowProgress Result ---');
    console.log(JSON.stringify(result, null, 2));

    const withStats = await attachProjectStats([p]);
    console.log('\n--- API Output (attachProjectStats) ---');
    console.log('Approval %:', withStats[0].approvalPercentage);
    console.log('Fabrication %:', withStats[0].fabricationPercentage);

    process.exit(0);
}
check().catch(console.error);
