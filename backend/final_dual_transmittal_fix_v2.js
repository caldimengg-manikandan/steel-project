const mongoose = require('mongoose');

async function fix() {
    try {
        await mongoose.connect('mongodb://localhost:27017/steel_dms');
        const db = mongoose.connection.db;

        const projectId = new mongoose.Types.ObjectId('69bd358ee076089d2d34a4ca');
        const project = await db.collection('projects').findOne({ _id: projectId });
        const adminId = project.createdByAdminId;

        console.log('--- Project: sds ---');

        // 1. Get Extractions
        const tr1Extractions = await db.collection('drawing_extractions').find({ 
            projectId, targetTransmittalNumber: 1 
        }).toArray();
        const tr2Extractions = await db.collection('drawing_extractions').find({ 
            projectId, targetTransmittalNumber: 2 
        }).toArray();

        console.log('TR-1 Extractions Count:', tr1Extractions.length);
        console.log('TR-2 Extractions Count:', tr2Extractions.length);

        if (tr1Extractions.length === 0 && tr2Extractions.length === 0) {
            console.log('❌ No extractions found for sds!');
            await mongoose.disconnect();
            return;
        }

        // 2. Clear out any existing mislabeled transmittal records for this project
        await db.collection('transmittals').deleteMany({ projectId });
        console.log('Deleted existing transmittal records');

        const today = new Date();

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
                createdAt: tr1Extractions[0].createdAt || today,
                updatedAt: today
            });
            console.log('✓ Created TR-1 record');
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
                createdAt: tr2Extractions[0].createdAt || today,
                updatedAt: today
            });
            console.log('✓ Created TR-2 record');
        }

        // 5. Create Drawing Log
        // We combine all drawings from TR1 and TR2
        const allExtractions = [...tr1Extractions, ...tr2Extractions];
        const logEntries = allExtractions.map(ext => {
            const f = ext.extractedFields || {};
            const transNum = ext.targetTransmittalNumber || 1;
            return {
                drawingNumber: (f.drawingNumber || '').trim(),
                drawingTitle: f.drawingTitle || f.drawingDescription || ext.originalFileName || '',
                description: f.description || '',
                folderName: ext.folderName || '',
                originalFileName: ext.originalFileName || '',
                currentRevision: f.revision || '',
                revisionHistory: [
                    {
                        revision: f.revision || '',
                        date: f.date || '',
                        transmittalNo: transNum,
                        remarks: f.remarks || '',
                        recordedAt: ext.createdAt || today
                    }
                ],
                firstTransmittalNo: transNum,
                lastUpdated: today
            };
        });

        await db.collection('drawing_logs').deleteMany({ projectId });
        await db.collection('drawing_logs').insertOne({
            projectId,
            createdByAdminId: adminId,
            drawings: logEntries,
            lastTransmittalNo: 2,
            createdAt: today,
            updatedAt: today
        });
        console.log('✓ Created Drawing Log with', logEntries.length, 'drawings');

        // 6. Correct Project Counter
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
