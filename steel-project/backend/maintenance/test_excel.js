const { appendToProjectExcel } = require('./src/services/excelService');
const mongoose = require('mongoose');

async function run() {
    const projectId = 'test_perf_project';
    console.log('Testing Excel performance: appending 50 rows...');
    const start = Date.now();

    for (let i = 0; i < 50; i++) {
        const rowStart = Date.now();
        await appendToProjectExcel(projectId, {
            drawingNumber: `DWG-${i}`,
            drawingTitle: `Title ${i}`,
            revision: '0',
            date: '2026-02-24',
            remarks: 'Stress test'
        });
        console.log(`Row ${i} took ${Date.now() - rowStart}ms`);
    }

    console.log(`Total time for 50 rows: ${Date.now() - start}ms`);
    process.exit(0);
}
run();
