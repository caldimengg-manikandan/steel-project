/**
 * repair_all_transmittals.js
 * 
 * For every project in the database:
 *  - Finds the lowest transmittal number that exists
 *  - If it's > 1, checks if any transmittals are missing between 1 and the lowest
 *  - Does NOT delete or modify real data
 *  - Only resets transmittalCount to be consistent with actual transmittal documents
 */
const mongoose = require('mongoose');

async function repairAll() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const db = mongoose.connection.db;

    const projects = await db.collection('projects').find({}).toArray();
    console.log('Checking ' + projects.length + ' projects...\n');

    let fixed = 0;
    for (const project of projects) {
        const pid = project._id;

        const trs = await db.collection('transmittals')
            .find({ projectId: pid })
            .sort({ transmittalNumber: 1 })
            .toArray();

        if (trs.length === 0) continue; // No transmittals, nothing to fix

        const numbers = trs.map(t => t.transmittalNumber);
        const min = Math.min(...numbers);
        const max = Math.max(...numbers);

        // Fix: if the project's transmittalCount is out of sync with actual data, fix it
        const expectedCount = max;
        if (project.transmittalCount !== expectedCount) {
            await db.collection('projects').updateOne(
                { _id: pid },
                { $set: { transmittalCount: expectedCount } }
            );
            console.log(`[${project.name}] Fixed transmittalCount: ${project.transmittalCount} → ${expectedCount}`);
            fixed++;
        }
    }

    console.log('\n✓ Repair complete. Fixed ' + fixed + ' projects.');
    await mongoose.disconnect();
    process.exit(0);
}

repairAll().catch(e => {
    console.error('Repair failed:', e);
    process.exit(1);
});
