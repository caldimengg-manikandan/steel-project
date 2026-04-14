const mongoose = require('mongoose');
async function run() {
    try {
        await mongoose.connect('mongodb://localhost:27017/steel_dms');
        const projects = await mongoose.connection.db.collection('projects').find({}).toArray();
        console.log('PROJECTS:', JSON.stringify(projects.map(p => ({ n: p.name, id: p._id.toString() }))));

        const extractions = await mongoose.connection.db.collection('drawing_extractions').find({}).toArray();
        console.log('EXTRACTIONS:', JSON.stringify(extractions.map(e => ({ n: e.originalFileName, p: e.projectId.toString(), s: e.status }))));

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
run();
