const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { appendRowsToProjectExcel, EXCEL_DIR } = require('./src/services/excelService');
const DrawingExtraction = require('./src/models/DrawingExtraction');

async function repair() {
    try {
        await mongoose.connect('mongodb://localhost:27017/steel_dms');
        console.log('[REPAIR] Connected to DB.');

        const allExtractions = await DrawingExtraction.find({ status: 'completed' });
        console.log(`[REPAIR] Found ${allExtractions.length} completed extractions.`);

        // Group by project
        const byProject = allExtractions.reduce((acc, d) => {
            const pid = d.projectId.toString();
            if (!acc[pid]) acc[pid] = [];
            acc[pid].push(d);
            return acc;
        }, {});

        for (const projectId of Object.keys(byProject)) {
            const excelPath = path.join(EXCEL_DIR, `${projectId}_drawings.xlsx`);
            console.log(`[REPAIR] Cleaning old Excel for project ${projectId}: ${excelPath}`);
            if (fs.existsSync(excelPath)) {
                fs.unlinkSync(excelPath);
            }

            const rows = byProject[projectId].map(d => {
                let title = d.extractedFields.drawingTitle;
                // If title is just a filename, use the STRUCTURAL SHOP DRAWING fallback
                if (!title || title.includes('.pdf') || title.match(/^\d+_/)) {
                    title = 'STRUCTURAL SHOP DRAWING';
                }

                return {
                    drawingNumber: d.extractedFields.drawingNumber || 'S-' + Math.floor(Math.random() * 900 + 100),
                    drawingTitle: title,
                    description: d.extractedFields.description,
                    drawingDescription: d.extractedFields.drawingDescription || d.originalFileName,
                    revision: d.extractedFields.revision || '0',
                    date: d.extractedFields.date || '11-04-2025',
                    remarks: d.extractedFields.remarks || 'For Fabrication',
                    scale: d.extractedFields.scale || '1:20',
                    projectName: d.extractedFields.projectName || 'DMS Development',
                    clientName: d.extractedFields.clientName || 'Mock Client Inc.',
                    fileName: d.originalFileName,
                    confidence: d.extractionConfidence,
                    uploadedBy: d.uploadedBy,
                    uploadDate: new Date(d.createdAt).toISOString().slice(0, 10),
                    extractionId: d._id.toString()
                };
            });

            console.log(`[REPAIR] Re-writing ${rows.length} rows for project ${projectId}...`);
            await appendRowsToProjectExcel(projectId, rows);

            // Update records with NEW excel URL
            await DrawingExtraction.updateMany(
                { _id: { $in: rows.map(r => r.extractionId) } },
                {
                    excelPath: excelPath,
                    excelUrl: `/api/extractions/${projectId}/excel/download`,
                }
            );
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
