const mongoose = require('mongoose');
const DrawingExtraction = require('./src/models/DrawingExtraction');

async function run() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    console.log('--- QUEUE DEBUG ---');

    const all = await DrawingExtraction.find({});
    console.log(`Total Extractions in DB: ${all.length}`);

    const grouped = all.reduce((acc, d) => {
        acc[d.status] = (acc[d.status] || 0) + 1;
        return acc;
    }, {});
    console.log('Status counts:', JSON.stringify(grouped, null, 2));

    const stuck = all.filter(d => d.status === 'processing');
    if (stuck.length > 0) {
        console.log('Stuck IDS:', stuck.map(d => d._id));
        console.log('Stuck Filenames:', stuck.map(d => d.originalFileName));

        // Let's check updatedAt to see if they are active
        const now = Date.now();
        stuck.forEach(d => {
            const ageSec = (now - new Date(d.updatedAt).getTime()) / 1000;
            console.log(`ID: ${d._id} | File: ${d.originalFileName} | Last Update: ${ageSec.toFixed(1)}s ago`);
        });
    }

    process.exit(0);
}
run();
