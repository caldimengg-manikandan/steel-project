const mongoose = require('mongoose');
const DrawingExtraction = require('./src/models/DrawingExtraction');
const { appendRowsToProjectExcel } = require('./src/services/excelService');
const fs = require('fs');
const path = require('path');

async function repair() {
    try {
        await mongoose.connect('mongodb://localhost:27017/steel_dms');
        console.log('[REPAIR] Regenerating Excels...');

        const all = await DrawingExtraction.find({ status: 'completed' });

        // Group by project
        const byProject = all.reduce((acc, d) => {
            const pid = d.projectId.toString();
            if (!acc[pid]) acc[pid] = [];
            acc[pid].push(d);
            return acc;
        }, {});

        for (const projectId of Object.keys(byProject)) {
            const excelDir = path.join(__dirname, 'uploads', 'excel');
            const excelPath = path.join(excelDir, `${projectId}_drawings.xlsx`);
            if (fs.existsSync(excelPath)) fs.unlinkSync(excelPath);

            const rows = byProject[projectId].map((d, index) => ({
                slNo: index + 1,
                drawingNumber: d.extractedFields.drawingNumber,
                drawingTitle: d.extractedFields.drawingTitle,
                revision: d.extractedFields.revision,
                date: d.extractedFields.date,
                remarks: d.extractedFields.remarks,
                fileName: d.originalFileName
            }));

            console.log(`[REPAIR] Writing ${rows.length} rows for project ${projectId}...`);
            await appendRowsToProjectExcel(projectId, rows);
        }

        console.log('[REPAIR] Excel files regenerated successfully.');
    } catch (err) {
        console.error('[REPAIR] Error:', err);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}
repair();
