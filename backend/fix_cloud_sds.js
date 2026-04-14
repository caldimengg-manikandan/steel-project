require('dotenv').config();
const mongoose = require('mongoose');

async function fixCloudSDS() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const db = mongoose.connection.db;

        const project = await db.collection('projects').findOne({ name: 'sds' });
        if (!project) throw new Error('Project sds not found in cloud!');
        const projectId = project._id;
        const adminId = project.createdByAdminId;

        console.log('--- Fixing Cloud Project: SDS (ID:', projectId, ') ---');

        // 1. Get Extractions
        const tr1Extractions = await db.collection('drawing_extractions').find({ 
            projectId, targetTransmittalNumber: 1 
        }).toArray();
        const tr2Extractions = await db.collection('drawing_extractions').find({ 
            projectId, targetTransmittalNumber: 2 
        }).toArray();

        console.log('Cloud TR-1 Extractions:', tr1Extractions.length);
        console.log('Cloud TR-2 Extractions:', tr2Extractions.length);

        if (tr1Extractions.length === 0 && tr2Extractions.length === 0) {
            console.log('ERROR: No drawing extractions found for SDS project in cloud!');
            await mongoose.disconnect();
            return;
        }

        // 2. Clear out any existing/corrupted transmittal records for this project ID
        await db.collection('transmittals').deleteMany({ projectId });
        console.log('Cleared existing transmittal records for this ID.');

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
            console.log('✓ Created TR-001 in Cloud.');
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
            console.log('✓ Created TR-002 in Cloud.');
        }

        // 5. Create Drawing Log
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
        console.log('✓ Re-built Cloud Drawing Log with', logEntries.length, 'entries.');

        // 6. Project Counter
        await db.collection('projects').updateOne(
            { _id: projectId },
            { $set: { transmittalCount: 2 } }
        );
        console.log('✓ Updated project transmittalCount to 2.');

        await mongoose.disconnect();
        console.log('\n--- CLOUD FIX SUCCESSFUL ---');
    } catch (err) {
        console.error('FAILED:', err.message);
    }
}
fixCloudSDS();
