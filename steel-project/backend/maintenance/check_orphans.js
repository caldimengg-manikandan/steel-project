const mongoose = require('mongoose');
async function run() {
    try {
        await mongoose.connect('mongodb://localhost:27017/steel_dms');
        const projects = await mongoose.connection.db.collection('projects').find({}).toArray();
        const projectIds = new Set(projects.map(p => p._id.toString()));
        console.log('Project Count:', projects.length);

        const extractions = await mongoose.connection.db.collection('drawing_extractions').find({}).toArray();
        const counts = {};
        let orphaned = 0;

        extractions.forEach(e => {
            const pId = e.projectId.toString();
            counts[pId] = (counts[pId] || 0) + 1;
            if (!projectIds.has(pId)) {
                orphaned++;
            }
        });

        console.log('Orphaned Extractions:', orphaned);
        console.log('Counts per Project:', JSON.stringify(counts));

        // Print names of projects
        projects.forEach(p => {
            console.log(`- Project ${p._id}: ${p.name} (${counts[p._id.toString()] || 0} items)`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
run();
