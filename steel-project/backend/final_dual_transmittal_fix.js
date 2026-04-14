const mongoose = require('mongoose');

async function fix() {
    try {
        await mongoose.connect('mongodb://localhost:27017/steel_dms');
        const db = mongoose.connection.db;

        const projectId = new mongoose.Types.ObjectId('69bd358ee076089d2d34a4ca');
        const project = await db.collection('projects').findOne({ _id: projectId });
        const adminId = project.createdByAdminId;

        console.log('--- Project: sds ---');
        console.log('Project current transmittalCount:', project.transmittalCount);

        // 1. Get Extractions
        const tr1Extractions = await db.collection('drawing_extractions').find({ 
            projectId, targetTransmittalNumber: 1 
        }).toArray();
        const tr2Extractions = await db.collection('drawing_extractions').find({ 
            projectId, targetTransmittalNumber: 2 
        }).toArray();

        console.log('TR-1 Extractions Count:', tr1Extractions.length);
        console.log('TR-2 Extractions Count:', tr2Extractions.length);

        // 2. Clear out any existing mislabeled transmittal records for this project
        // So we can re-create them cleanly based on actual extractions.
        const deleted = await db.collection('transmittals').deleteMany({ projectId });
        console.log('Deleted existing transmittal records:', deleted.deletedCount);

        // 3. Create TR-1 record (100 drawings)
        if (tr1Extractions.length > 0) {
            const tr1Drawings = tr1Extractions.map(ext => {
                const f = ext.extractedFields || {};
                return {
                    extractionId: ext._id,
                    drawingNumber: f.drawingNumber || '',
                    drawingTitle: f.drawingTitle || f.drawingDescription || ext.originalFileName || '',
                    revision: f.revision || '',
                    date: f.date || '',
                    remarks: f.remarks || '',
                    folderName: ext.folderName || '',
                    originalFileName: ext.originalFileName || '',
                    changeType: 'new',
                    previousRevision: '',
                };
            });

            await db.collection('transmittals').insertOne({
                projectId,
                createdByAdminId: adminId,
                transmittalNumber: 1,
                drawings: tr1Drawings,
                newCount: tr1Drawings.length,
                revisedCount: 0,
                createdAt: tr1Extractions[0].createdAt || new Date(),
                updatedAt: new Date()
            });
            console.log('✓ Created TR-1 record with', tr1Drawings.length, 'drawings');
        }

        // 4. Create TR-2 record (306 drawings)
        if (tr2Extractions.length > 0) {
            const tr2Drawings = tr2Extractions.map(ext => {
                const f = ext.extractedFields || {};
                return {
                    extractionId: ext._id,
                    drawingNumber: f.drawingNumber || '',
                    drawingTitle: f.drawingTitle || f.drawingDescription || ext.originalFileName || '',
                    revision: f.revision || '',
                    date: f.date || '',
                    remarks: f.remarks || '',
                    folderName: ext.folderName || '',
                    originalFileName: ext.originalFileName || '',
                    changeType: 'new',
                    previousRevision: '',
                };
            });

            await db.collection('transmittals').insertOne({
                projectId,
                createdByAdminId: adminId,
                transmittalNumber: 2,
                drawings: tr2Drawings,
                newCount: tr2Drawings.length,
                revisedCount: 0,
                createdAt: tr2Extractions[0].createdAt || new Date(),
                updatedAt: new Date()
            });
            console.log('✓ Created TR-2 record with', tr2Drawings.length, 'drawings');
        }

        // 5. Correct Project Counter
        await db.collection('projects').updateOne(
            { _id: projectId },
            { $set: { transmittalCount: 2 } }
        );
        console.log('✓ Updated project transmittalCount to 2');

        await mongoose.disconnect();
        console.log('\n--- SUCCESS ---');
    } catch (err) {
        console.error(err);
    }
}
fix();
