const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DrawingLog = require('../src/models/DrawingLog');
const DrawingExtraction = require('../src/models/DrawingExtraction');
const Project = require('../src/models/Project');

async function syncDrawings() {
    console.log('[SyncDrawings] Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);

    const projectId = '6ace16ea737f04dfc95054be'; // 2121 VIRGINIA AVENUE
    const project = await Project.findById(projectId).lean();
    if (!project) {
        console.error('Project not found');
        process.exit(1);
    }

    const log = await DrawingLog.findOne({ projectId }).lean();
    if (!log || !log.drawings || log.drawings.length === 0) {
        console.error('DrawingLog not found or empty');
        process.exit(1);
    }

    console.log(`[SyncDrawings] Found ${log.drawings.length} drawings in DrawingLog for "${project.name}"`);

    const tempDir = path.join(__dirname, '../uploads/temp');
    const tempFiles = fs.readdirSync(tempDir);

    const baseStorage = path.join(__dirname, '../uploads/storage/Projects');
    const folderVariants = [
        path.join(baseStorage, '2121 VIRGINIA AVENUE'),
        path.join(baseStorage, '2121_VIRGINIA_AVENUE'),
    ];

    // Ensure subdirectories exist for each variant
    for (const projectDir of folderVariants) {
        fs.mkdirSync(path.join(projectDir, 'Detail Sheets'), { recursive: true });
        fs.mkdirSync(path.join(projectDir, 'E-Sheets'), { recursive: true });
        fs.mkdirSync(path.join(projectDir, 'Drawings'), { recursive: true });
        fs.mkdirSync(path.join(projectDir, 'Logs'), { recursive: true });
    }

    let copiedCount = 0;
    let extractionCount = 0;

    for (const d of log.drawings) {
        // e.g. drawingNumber: "07C1001_0.pdf" or "07FR1000"
        let cleanName = d.drawingNumber.trim();
        if (!cleanName.endsWith('.pdf')) {
            cleanName += '.pdf';
        }

        // Match against files in tempDir
        const dNum = d.drawingNumber.replace(/\.pdf$/i, '').toLowerCase();
        // Sort files by timestamp descending to get the latest
        const matches = tempFiles
            .filter(f => f.toLowerCase().includes(dNum) && f.endsWith('.pdf'))
            .sort((a, b) => {
                const tsA = parseInt(a.split('-')[0]) || 0;
                const tsB = parseInt(b.split('-')[0]) || 0;
                return tsB - tsA;
            });

        if (matches.length === 0) {
            console.warn(`[SyncDrawings] No temp file match for drawing ${d.drawingNumber}`);
            continue;
        }

        const sourceFile = matches[0];
        const sourcePath = path.join(tempDir, sourceFile);

        const isESheet = /^(se|e)[\d\-_]/i.test(d.drawingNumber) || /erection/i.test(d.folderName || d.drawingTitle || '');
        const subFolder = isESheet ? 'E-Sheets' : 'Detail Sheets';
        const folderName = isESheet ? 'ERECTION SHEET' : 'DETAIL SHEET';

        // Read source buffer
        const buffer = fs.readFileSync(sourcePath);

        // Copy into all variant directories
        for (const projectDir of folderVariants) {
            const destSub = path.join(projectDir, subFolder, cleanName);
            const destDrawings = path.join(projectDir, 'Drawings', cleanName);
            fs.writeFileSync(destSub, buffer);
            fs.writeFileSync(destDrawings, buffer);
        }

        copiedCount++;

        // Upsert DrawingExtraction document in MongoDB
        const storageGatewayPath = `Projects/${project.name}/${subFolder}/${cleanName}`;
        const existingExt = await DrawingExtraction.findOne({
            projectId,
            originalFileName: cleanName
        });

        if (!existingExt) {
            await DrawingExtraction.create({
                projectId,
                createdByAdminId: project.createdByAdminId,
                originalFileName: cleanName,
                fileUrl: sourcePath,
                storageGatewayPath,
                folderName,
                fileSize: buffer.length,
                uploadedBy: 'admin1',
                targetTransmittalNumber: d.firstTransmittalNo || 2,
                sequences: ['General'],
                uploadPurpose: 'Fabrication',
                status: 'completed',
                extractionConfidence: 0.95,
                extractedFields: {
                    drawingNumber: d.drawingNumber.replace(/\.pdf$/i, '').replace(/_[a-zA-Z0-9]+$/, ''),
                    drawingTitle: d.drawingTitle || cleanName,
                    drawingDescription: d.description || d.drawingTitle || '',
                    revision: d.currentRevision || '0',
                    date: d.lastUpdated ? new Date(d.lastUpdated).toLocaleDateString() : 'Sep 29, 2026',
                    remarks: d.revisionHistory?.[0]?.remarks || 'ISSUED FOR FABRICATION',
                    clientName: project.clientName || 'IronFab',
                    projectName: project.name,
                    revisionHistory: d.revisionHistory?.map(rh => ({
                        mark: rh.revision || '0',
                        date: rh.date || 'Sep 29, 2026',
                        remarks: rh.remarks || ''
                    })) || []
                },
                validationResult: {
                    drawingNumberValid: true,
                    revisionValid: true,
                    dateValid: true,
                    warnings: []
                }
            });
            extractionCount++;
        }
    }

    console.log(`[SyncDrawings] Successfully synced ${copiedCount} files to server storage!`);
    console.log(`[SyncDrawings] Created ${extractionCount} DrawingExtraction records in MongoDB!`);

    await mongoose.disconnect();
    console.log('[SyncDrawings] Done!');
}

syncDrawings().catch(err => {
    console.error('[SyncDrawings] Error:', err);
    process.exit(1);
});
