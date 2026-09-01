require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');

const Project = require('../src/models/Project');
const Transmittal = require('../src/models/Transmittal');
const DrawingLog = require('../src/models/DrawingLog');
const DrawingExtraction = require('../src/models/DrawingExtraction');
const { generateTransmittal, getDrawingLog } = require('../src/services/transmittalService');

async function rebuild() {
    await connectDB();
    console.log('[Rebuild] DB Connected.');

    const projects = await Project.find().lean();

    for (const project of projects) {
        const projectId = project._id.toString();
        const extractions = await DrawingExtraction.find({ projectId, status: 'completed' }).lean();

        if (extractions.length === 0) continue;

        console.log(`\n========================================`);
        console.log(`Rebuilding Project: ${project.name} (${projectId})`);
        console.log(`Found ${extractions.length} completed extractions.`);

        // Find all distinct targetTransmittalNumbers
        const targetNums = [...new Set(extractions.map(e => e.targetTransmittalNumber).filter(n => n != null))].sort((a, b) => a - b);

        if (targetNums.length === 0) {
            targetNums.push(1);
        }

        // Reset existing Transmittal and DrawingLog documents for clean rebuild
        await Transmittal.deleteMany({ projectId });
        await DrawingLog.deleteMany({ projectId });
        await Project.findByIdAndUpdate(projectId, { transmittalCount: 0 });

        const adminId = project.createdByAdminId || extractions[0]?.createdByAdminId;

        for (const targetNum of targetNums) {
            console.log(`  -> Processing Transmittal TR-${targetNum}...`);
            try {
                const res = await generateTransmittal(projectId, adminId, null, targetNum);
                console.log(`     Generated TR-${targetNum}: newCount=${res.summary.newCount}, revisedCount=${res.summary.revisedCount}, unchangedCount=${res.summary.unchangedCount}, totalDrawings=${res.transmittal?.drawings?.length}`);
            } catch (err) {
                console.error(`     Error generating TR-${targetNum}:`, err.message);
            }
        }

        const log = await getDrawingLog(projectId);
        console.log(`  -> Final Drawing Log contains ${log?.drawings?.length || 0} master drawings.`);
    }

    console.log('\n[Rebuild] Finished rebuilding transmittals and drawing logs.');
    await mongoose.disconnect();
}

rebuild().catch(err => {
    console.error('[Rebuild] Fatal error:', err);
    process.exit(1);
});
