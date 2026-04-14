const mongoose = require('mongoose');

async function fix() {
    await mongoose.connect('mongodb://localhost:27017/steel_dms');
    const db = mongoose.connection.db;

    const sdsPid = new mongoose.Types.ObjectId('69bd358ee076089d2d34a4ca');
    const project = await db.collection('projects').findOne({ _id: sdsPid });
    const adminId = project.createdByAdminId;
    console.log('sds adminId:', adminId ? adminId.toString() : 'null');

    // Find the orphaned 306-drawing transmittal
    const candidate = await db.collection('transmittals').findOne({ newCount: 306 });
    if (!candidate) {
        console.log('❌ Could not find the 306-drawing transmittal!');
        process.exit(1);
    }
    console.log('Found orphaned transmittal:');
    console.log(' _id:', candidate._id);
    console.log(' projectId:', candidate.projectId ? candidate.projectId.toString() : 'null');
    console.log(' transmittalNumber:', candidate.transmittalNumber);
    console.log(' newCount:', candidate.newCount);
    console.log(' createdByAdminId:', candidate.createdByAdminId ? candidate.createdByAdminId.toString() : 'null');

    // Delete any fake TR-001 I created for sds (with newCount=2)
    const deleted = await db.collection('transmittals').deleteMany({ 
        projectId: sdsPid, 
        newCount: { $in: [2, 0] }
    });
    console.log('✓ Deleted', deleted.deletedCount, 'fake entries');

    // Re-link the 306-drawing transmittal to sds as TR-001
    await db.collection('transmittals').updateOne(
        { _id: candidate._id },
        { 
            $set: { 
                projectId: sdsPid,
                transmittalNumber: 1,
                createdByAdminId: adminId,
            } 
        }
    );
    console.log('✓ Re-linked 306-drawing transmittal to sds as TR-001');

    // Fix project counter
    await db.collection('projects').updateOne({ _id: sdsPid }, { $set: { transmittalCount: 1 } });
    console.log('✓ sds transmittalCount set to 1');

    // Also fix the drawing_extractions to point to sds
    const updated = await db.collection('drawing_extractions').updateMany(
        { targetTransmittalNumber: candidate.transmittalNumber, projectId: candidate.projectId },
        { $set: { projectId: sdsPid } }
    );
    console.log('✓ Linked', updated.modifiedCount, 'drawing extractions to sds');

    console.log('\n--- DONE ---');
    await mongoose.disconnect();
    process.exit(0);
}
fix().catch(e => { console.error(e); process.exit(1); });