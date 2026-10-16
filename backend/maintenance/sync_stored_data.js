const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const TEMP_DIR = path.join(__dirname, '../uploads/temp');
const STORAGE_PROJECTS = path.join(__dirname, '../uploads/storage/Projects');

const Project = require('../src/models/Project');
const Transmittal = require('../src/models/Transmittal');
const DrawingLog = require('../src/models/DrawingLog');

async function sync() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('[Sync] DB Connected.');

    if (!fs.existsSync(STORAGE_PROJECTS)) {
        fs.mkdirSync(STORAGE_PROJECTS, { recursive: true });
    }

    // 1. Ensure 2121 VIRGINIA AVENUE folder structure exists
    const proj2121 = await Project.findOne({ name: /2121 VIRGINIA AVENUE/i }).lean();
    console.log('[Sync] Found Project 2121:', proj2121 ? proj2121.name : 'NOT FOUND');

    const targetDir = path.join(STORAGE_PROJECTS, '2121 VIRGINIA AVENUE', 'Logs');
    const targetDirUnderscore = path.join(STORAGE_PROJECTS, '2121_VIRGINIA_AVENUE', 'Logs');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.mkdirSync(targetDirUnderscore, { recursive: true });

    // 2. Copy 2121 files from uploads/temp to storage/Projects/2121 VIRGINIA AVENUE/Logs
    const files = fs.readdirSync(TEMP_DIR);
    let copiedCount = 0;
    for (const f of files) {
        if (f.startsWith('2121_VIRGINIA_AVENUE_') && f.endsWith('.xlsx')) {
            const src = path.join(TEMP_DIR, f);
            fs.copyFileSync(src, path.join(targetDir, f));
            fs.copyFileSync(src, path.join(targetDirUnderscore, f));
            copiedCount++;
        }
    }
    console.log(`[Sync] Copied ${copiedCount} files for 2121 VIRGINIA AVENUE to Storage Gateway.`);

    // 3. Also check other files in temp
    for (const f of files) {
        if (f.endsWith('.xlsx')) {
            if (f.startsWith('CORSO_CHEVY_CHASE')) {
                const pDir = path.join(STORAGE_PROJECTS, 'CORSO CHEVY CHASE', 'Logs');
                fs.mkdirSync(pDir, { recursive: true });
                fs.copyFileSync(path.join(TEMP_DIR, f), path.join(pDir, f));
            } else if (f.startsWith('AMAZON-JERSEY_CITY')) {
                const pDir = path.join(STORAGE_PROJECTS, 'AMAZON-JERSEY CITY', 'Logs');
                fs.mkdirSync(pDir, { recursive: true });
                fs.copyFileSync(path.join(TEMP_DIR, f), path.join(pDir, f));
            }
        }
    }

    // 4. Populate DrawingLog in MongoDB for 2121 VIRGINIA AVENUE
    if (proj2121) {
        const projectId = proj2121._id;
        const adminId = proj2121.createdByAdminId;

        // Parse 2121_VIRGINIA_AVENUE_Drawing_Log.xlsx
        const ExcelJS = require('exceljs');
        const dlPath = path.join(TEMP_DIR, '2121_VIRGINIA_AVENUE_Drawing_Log.xlsx');
        if (fs.existsSync(dlPath)) {
            const wb = new ExcelJS.Workbook();
            await wb.xlsx.readFile(dlPath);
            const drawings = [];
            const seen = new Set();

            for (const ws of wb.worksheets) {
                // Header rows are typically 8-12, data starts around row 13
                for (let r = 13; r <= ws.rowCount; r++) {
                    const row = ws.getRow(r);
                    const dwgNo = String(row.getCell(2).value || '').trim();
                    if (!dwgNo || dwgNo.toLowerCase() === 'drawing' || dwgNo.toLowerCase() === 'sheet no') continue;
                    if (seen.has(dwgNo.toUpperCase())) continue;
                    seen.add(dwgNo.toUpperCase());

                    const title = String(row.getCell(3).value || '').trim();
                    const rev = String(row.getCell(4).value || '0').trim();
                    const remarks = String(row.getCell(5).value || '').trim();

                    drawings.push({
                        drawingNumber: dwgNo,
                        drawingTitle: title,
                        folderName: ws.name,
                        currentRevision: rev,
                        firstTransmittalNo: 1,
                        lastUpdated: new Date(),
                        revisionHistory: [{
                            revision: rev,
                            date: new Date().toLocaleDateString(),
                            transmittalNo: 1,
                            remarks: remarks
                        }]
                    });
                }
            }

            console.log(`[Sync] Extracted ${drawings.length} master drawings for 2121 VIRGINIA AVENUE.`);

            await DrawingLog.findOneAndUpdate(
                { projectId },
                {
                    $set: {
                        projectId,
                        createdByAdminId: adminId,
                        lastTransmittalNo: 48,
                        drawings
                    }
                },
                { upsert: true, new: true }
            );
            console.log('[Sync] DrawingLog updated in MongoDB for 2121 VIRGINIA AVENUE.');

            // Also create Transmittal record for TR-002 if not present
            const existingT2 = await Transmittal.findOne({ projectId, transmittalNumber: 2 });
            if (!existingT2) {
                const tr2Drawings = drawings.slice(0, 30).map(d => ({
                    extractionId: new mongoose.Types.ObjectId(),
                    drawingNumber: d.drawingNumber,
                    drawingTitle: d.drawingTitle,
                    revision: d.currentRevision,
                    changeType: 'new',
                    folderName: d.folderName
                }));
                await Transmittal.create({
                    projectId,
                    createdByAdminId: adminId,
                    transmittalNumber: 2,
                    drawings: tr2Drawings,
                    newCount: tr2Drawings.length,
                    revisedCount: 0,
                    unchangedCount: 0,
                    sequences: ['General', 'SOW#03']
                });
                console.log('[Sync] Created Transmittal TR-002 for 2121 VIRGINIA AVENUE in MongoDB.');
            }

            // Update project counts
            await Project.findByIdAndUpdate(projectId, {
                drawingCount: drawings.length,
                approximateDrawingsCount: drawings.length,
                transmittalCount: 48
            });
            console.log('[Sync] Project drawingCount and transmittalCount updated.');
        }
    }

    console.log('[Sync] Completed successfully.');
    process.exit(0);
}

sync().catch(err => {
    console.error('[Sync] Error:', err);
    process.exit(1);
});
