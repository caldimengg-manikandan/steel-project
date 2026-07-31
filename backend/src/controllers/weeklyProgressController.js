const WeeklyProgress = require('../models/WeeklyProgress');
const Transmittal = require('../models/Transmittal');
const RfiExtraction = require('../models/RfiExtraction');
const Project = require('../models/Project');
const SystemSettings = require('../models/SystemSettings');
const DrawingExtraction = require('../models/DrawingExtraction');
const ChangeOrder = require('../models/ChangeOrder');
const { attachProjectStats } = require('../services/projectStatsService');
const mongoose = require('mongoose');
const exceljs = require('exceljs');
const path = require('path');
const fs = require('fs');

const TEMPLATE_PATH = path.join(__dirname, '../templates/weekly_report_template.xlsx');

async function getAutoFetchedTransmittals(projectId) {
    const rawTransmittals = await Transmittal.find({ projectId }).sort({ createdAt: -1 });
    const transmittals = rawTransmittals.map(t => t.toObject ? t.toObject() : t);

    try {
        const pendingTargets = await DrawingExtraction.aggregate([
            { $match: { projectId: new mongoose.Types.ObjectId(projectId), targetTransmittalNumber: { $ne: null } } },
            { $group: { _id: '$targetTransmittalNumber', count: { $sum: 1 }, sequences: { $push: '$sequences' }, categories: { $addToSet: '$category' } } }
        ]);

        const existingNumbers = new Set(transmittals.map(t => t.transmittalNumber));
        
        const categoryMap = {};
        for (const target of pendingTargets) {
            let appFab = '';
            const cats = (target.categories || []).filter(c => c);
            if (cats.length > 0) {
                appFab = cats.join(', ');
            }
            categoryMap[target._id] = appFab;
        }

        transmittals.forEach(t => {
            t.appFab = categoryMap[t.transmittalNumber] || '';
        });

        for (const target of pendingTargets) {
            const currentCount = target._id;
            if (!existingNumbers.has(currentCount)) {
                const pendingSeqs = new Set();
                target.sequences.forEach(seqArr => {
                    if (Array.isArray(seqArr)) {
                        seqArr.forEach(s => pendingSeqs.add(s));
                    }
                });
                transmittals.push({
                    _id: `pending-${currentCount}`,
                    projectId,
                    transmittalNumber: currentCount,
                    drawings: new Array(target.count).fill({}),
                    newCount: target.count,
                    revisedCount: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    isPending: true,
                    sequences: Array.from(pendingSeqs),
                    appFab: categoryMap[currentCount] || ''
                });
            }
        }
    } catch (e) { console.error('[WeeklyProgress] Failed to load pending targets:', e); }

    transmittals.sort((a, b) => b.transmittalNumber - a.transmittalNumber);
    return transmittals;
}

exports.getReportsByProject = async (req, res) => {
    try {
        const { projectId } = req.params;
        const reports = await WeeklyProgress.find({ projectId }).sort({ weekStartDate: -1 });
        res.json({ success: true, reports });
    } catch (error) {
        console.error('Error fetching weekly reports:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch weekly reports' });
    }
};

exports.getReportDraft = async (req, res) => {
    try {
        const { projectId, reportId } = req.params;
        let report = null;
        if (reportId !== 'dummy') {
            report = await WeeklyProgress.findById(reportId);
            if (!report) {
                return res.status(404).json({ success: false, error: 'Report not found' });
            }
        }
        
        // Fetch auto-fetch data concurrently
        const [transmittalsResult, rfisResult, cdrfisResult] = await Promise.allSettled([
            getAutoFetchedTransmittals(projectId),
            RfiExtraction.find({ projectId }),
            ChangeOrder.find({ projectId })
        ]);

        const transmittals = transmittalsResult.status === 'fulfilled' ? transmittalsResult.value : [];
        const rfiExtractions = rfisResult.status === 'fulfilled' ? rfisResult.value : [];
        const rawCdrfis = cdrfisResult.status === 'fulfilled' ? cdrfisResult.value : [];
        
        const cdrfis = rawCdrfis.map(co => ({
            id: co.coNumber,
            status: co.status,
            description: co.description,
            amount: co.amount,
            createdAt: co.createdAt
        }));
        
        // Flatten RFIs from extractions
        const rfis = [];
        rfiExtractions.forEach(ext => {
            if (ext.rfis && Array.isArray(ext.rfis)) {
                ext.rfis.forEach(rfi => {
                    rfis.push({
                        ...rfi.toObject(),
                        originalFileName: ext.originalFileName,
                        sentDate: ext.createdAt
                    });
                });
            }
        });

        let fabricationStats = '';
        let approvalStats = '';
        let corStats = { total: 0, approved: 0, completed: 0, pending: 0 };
        let projectDetails = null;
        try {
            const project = await Project.findById(projectId);
            if (project) {
                projectDetails = {
                    projectName: project.name || '',
                    clientName: project.clientName || '',
                    clientAddress: project.location || '',
                    clientProjectManager: project.contactPerson ? project.contactPerson.name : ''
                };
                const statsArr = await attachProjectStats([project.toObject()]);
                if (statsArr && statsArr.length > 0) {
                    const s = statsArr[0];
                    const seqTotal = s.sequences ? s.sequences.length : 0;
                    const seqDone = s.sequences ? s.sequences.filter(seq => seq.status === 'Completed').length : 0;
                    fabricationStats = `Fabrication: ${s.fabricationCount || 0} drawings (${s.fabricationPercentage || 0}%)\nSequences: ${seqDone}/${seqTotal} done`;
                    approvalStats = `Approval: ${s.approvalCount || 0} drawings (${s.approvalPercentage || 0}%)`;
                    corStats = {
                        total: s.corStatus?.totalCORItems ?? s.totalCO ?? 0,
                        approved: s.corStatus?.statusSummary?.Approved ?? s.approvedCO ?? 0,
                        completed: s.corStatus?.statusSummary?.Completed ?? s.workCompletedCO ?? 0,
                        pending: s.corStatus?.statusSummary?.Submitted ?? s.pendingCO ?? 0
                    };
                }
            }
        } catch (e) {
            console.warn('Could not fetch project stats for auto-fill', e);
        }

        res.json({
            success: true,
            report,
            autoFetch: {
                transmittals,
                rfis,
                cdrfis,
                fabricationStats,
                approvalStats,
                corStats,
                projectDetails
            }
        });
    } catch (error) {
        console.error('Error fetching report draft:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch report draft', details: error.message, stack: error.stack });
    }
};

exports.saveReportDraft = async (req, res) => {
    try {
        const { projectId } = req.params;
        const { 
            reportId, 
            weekStartDate, 
            summaryData, 
            sowData, 
            scheduleData, 
            transmittalData, 
            corData,
            corStats,
            status 
        } = req.body;

        let report;
        
        if (reportId) {
            report = await WeeklyProgress.findByIdAndUpdate(
                reportId,
                { weekStartDate, summaryData, sowData, scheduleData, transmittalData, corData, corStats, status },
                { new: true }
            );
        } else {
            // Check if one exists for the week
            report = await WeeklyProgress.findOneAndUpdate(
                { projectId, weekStartDate },
                { summaryData, sowData, scheduleData, transmittalData, corData, corStats, status: status || 'Draft' },
                { new: true, upsert: true }
            );
        }

        res.json({ success: true, report });
    } catch (error) {
        console.error('Error saving report draft:', error);
        res.status(500).json({ success: false, error: 'Failed to save report draft' });
    }
};

exports.downloadExcel = async (req, res) => {
    try {
        const { projectId, reportId } = req.params;
        
        let report;
        if (reportId === 'empty') {
            const summaryData = { date: new Date().toLocaleDateString() };
            try {
                const project = await Project.findById(projectId);
                if (project) {
                    summaryData.projectName = project.name || '';
                    summaryData.clientName = project.clientName || '';
                    summaryData.clientAddress = project.location || '';
                    summaryData.clientProjectManager = project.contactPerson ? project.contactPerson.name : '';
                }
            } catch(e) {}
            
            report = {
                summaryData,
                sowData: [],
                scheduleData: [],
                transmittalData: []
            };
        } else {
            report = await WeeklyProgress.findById(reportId);
            if (!report) {
                return res.status(404).json({ success: false, error: 'Report not found' });
            }
        }

        const workbook = await exports.buildWeeklyReportWorkbook(projectId, report);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Weekly_Progress_${report.weekStartDate || new Date().toISOString().split('T')[0]}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Error generating excel:', error);
        res.status(500).json({ success: false, error: 'Failed to generate excel' });
    }
};

exports.buildWeeklyReportWorkbook = async (projectId, report) => {
    if (!fs.existsSync(TEMPLATE_PATH)) {
        throw new Error(`Template not found at ${TEMPLATE_PATH}. Please provide the weekly_report_template.xlsx.`);
    }

    const workbook = new exceljs.Workbook();
    await workbook.xlsx.readFile(TEMPLATE_PATH);

    // Dynamically remove the REF worksheet if it exists in the template
    const refSheet = workbook.getWorksheet('REF') || workbook.getWorksheet('ref');
    if (refSheet) {
        workbook.removeWorksheet(refSheet.id);
    }

    // --- SUMMARY TAB ---
    const summarySheet = workbook.getWorksheet('SUMMARY');
    if (summarySheet && report.summaryData) {
        const data = report.summaryData;
        if (data.date) summarySheet.getCell('D3').value = data.date;
        if (data.projectName) summarySheet.getCell('D4').value = data.projectName;
        if (data.projectNo) summarySheet.getCell('M4').value = data.projectNo;
        if (data.clientName) summarySheet.getCell('D5').value = data.clientName;
        if (data.clientProjectNo) summarySheet.getCell('M5').value = data.clientProjectNo;
        if (data.clientAddress) summarySheet.getCell('D6').value = data.clientAddress;
        if (data.clientProjectManager) summarySheet.getCell('D8').value = data.clientProjectManager;
        if (data.reportCirculatedTo1) summarySheet.getCell('D9').value = data.reportCirculatedTo1;
        if (data.caldimProjectManager) summarySheet.getCell('D10').value = data.caldimProjectManager;
        if (data.reportCirculatedTo2) summarySheet.getCell('D11').value = data.reportCirculatedTo2;
        if (data.projectType) summarySheet.getCell('F14').value = data.projectType;
        if (data.projectDescription) {
            summarySheet.getCell('B15').value = data.projectDescription;
        }
        if (data.projectStatusLastWeek) {
            summarySheet.getCell('B20').value = data.projectStatusLastWeek;
        }
        if (data.overallApprovalStatus) {
            summarySheet.getCell('B25').value = data.overallApprovalStatus;
        }
        if (data.overallFabricationStatus) {
            summarySheet.getCell('B29').value = data.overallFabricationStatus;
        }

        // Handle Logo insertion if available
        try {
            const settings = await SystemSettings.findOne();
            if (settings && settings.companyLogoUrl) {
                // This expects a local path or we skip if it's external and we can't fetch it easily.
                // For now, we will skip logo embedding unless it's a local file.
            }
        } catch (e) {
            console.warn('Could not fetch logo for export', e);
        }
    }

    // --- SOW TAB ---
    const sowSheet = workbook.getWorksheet('SOW');
    if (sowSheet) {
        let sowDataToUse = report.sowData || [];

        if (sowDataToUse.length === 0 || (sowDataToUse.length === 1 && !sowDataToUse[0].description)) {
            sowDataToUse = [
                { sNo: '', description: 'BASE BID', change: '', receivedDate: '', remarks: '' },
                { sNo: '', description: 'STRUCTURAL STEEL:', change: '', receivedDate: '', remarks: '' },
                { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
                { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
                { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
                { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
                { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
                { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
                { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
                { sNo: '', description: 'MISC. STEEL:', change: '', receivedDate: '', remarks: '' },
                { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
                { sNo: '', description: '', change: '', receivedDate: '', remarks: '' }
            ];
        }

        let currentSNo = 1;
        let startRow = 3;
        const styleRow = sowSheet.getRow(startRow);

        sowDataToUse.forEach((sow, index) => {
            const row = sowSheet.getRow(startRow + index);
            if (sow.description === 'BASE BID' || sow.description === 'STRUCTURAL STEEL:' || sow.description === 'MISC. STEEL:') {
                row.getCell(2).value = sow.description;
                row.getCell(2).font = { bold: true };
            } else {
                row.getCell(1).value = currentSNo++;
                row.getCell(2).value = sow.description || '';
                row.getCell(3).value = sow.change || '';
                row.getCell(4).value = sow.receivedDate || '';
                row.getCell(5).value = sow.remarks || '';
            }

            if (styleRow) {
                row.eachCell((cell, colNumber) => {
                    const styleCell = styleRow.getCell(colNumber);
                    if (styleCell) {
                        cell.border = styleCell.border;
                        cell.alignment = styleCell.alignment;
                    }
                });
            }
        });
    }

    // --- SCHEDULE TAB ---
    const scheduleSheet = workbook.getWorksheet('SCHEDULE');
    if (scheduleSheet) {
        let startRow = 3;
        const styleRow = scheduleSheet.getRow(startRow);

        const scheduleDataToUse = report.scheduleData || [];
        scheduleDataToUse.forEach((sched, index) => {
            const row = scheduleSheet.getRow(startRow + index);
            row.getCell(1).value = sched.sNo || '';
            row.getCell(2).value = sched.seqArea || '';
            row.getCell(3).value = sched.status || '';
            row.getCell(4).value = sched.plannedIfaDate || '';
            row.getCell(5).value = sched.actualIfaDate || '';
            row.getCell(6).value = sched.bfaReceivedDate || '';
            row.getCell(7).value = sched.plannedFabDate || '';
            row.getCell(8).value = sched.actualFabDate || '';
            row.getCell(9).value = sched.remarks || '';

            if (styleRow) {
                row.eachCell((cell, colNumber) => {
                    const styleCell = styleRow.getCell(colNumber);
                    if (styleCell) {
                        cell.border = styleCell.border;
                        cell.alignment = styleCell.alignment;
                    }
                });
            }
        });
    }

    // --- COR TAB ---
    const corSheet = workbook.getWorksheet('COR');
    if (corSheet) {
        // Set proper column widths so text isn't cut off
        corSheet.getColumn(1).width = 15;
        corSheet.getColumn(2).width = 15;
        corSheet.getColumn(3).width = 25;
        corSheet.getColumn(4).width = 15;
        corSheet.getColumn(5).width = 15;
        corSheet.getColumn(6).width = 35;

        // Merge row 1 to span A to F so the header background and border extends fully
        try {
            if (corSheet.getCell('A1').isMerged) {
                // If A1 is merged, unmerge it first
                // ExcelJS unMergeCells takes the top-left cell address of the merge
                const mergeRange = corSheet.getCell('A1')._mergeCount ? 'A1' : null;
                // It's safer to just merge on top or unmerge the specific known range A1:D1
                corSheet.unMergeCells('A1:D1');
            }
        } catch(e) {}
        
        try {
            corSheet.mergeCells('A1:F1');
            corSheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
            // Copy bottom border from A1
            corSheet.getCell('A1').border = { bottom: { style: 'medium', color: { argb: 'FF1F4E78' } } };
        } catch(e) {}

        // Center the logo image if possible
        try {
            const images = corSheet.getImages();
            if (images && images.length > 0) {
                const img = images[0];
                if (img.range && img.range.tl && img.range.br) {
                    // C is index 2, E is index 4. To span C to E, tl is 2, br is 5
                    img.range.tl.nativeCol = 2;
                    img.range.br.nativeCol = 5;
                }
            }
        } catch (e) {
            console.warn('Failed to reposition logo', e);
        }

        // Rewrite headers to match the UI
        corSheet.getCell('A2').value = 'COR';
        corSheet.getCell('B2').value = 'DATE';
        corSheet.getCell('C2').value = 'CHANGE REFERENCE';
        corSheet.getCell('D2').value = 'COR AMOUNT';
        corSheet.getCell('E2').value = 'STATUS';
        corSheet.getCell('F2').value = 'DESCRIPTION';

        // Apply style to headers
        for (let i = 1; i <= 6; i++) {
            const cell = corSheet.getRow(2).getCell(i);
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
        }

        let startRow = 3;
        const styleRow = corSheet.getRow(startRow);
        
        let corDataToUse = report.corData || [];
        
        if (corDataToUse.length === 0) {
            try {
                const ChangeOrder = require('../models/ChangeOrder');
                const rawCdrfis = await ChangeOrder.find({ projectId });
                corDataToUse = rawCdrfis.map(co => ({
                    cor: co.coNumber || '',
                    date: co.createdAt ? new Date(co.createdAt).toISOString().split('T')[0] : '',
                    changeReference: '',
                    corAmount: co.amount || '',
                    status: co.status || '',
                    description: co.description || ''
                }));
            } catch (e) {
                console.warn('Could not auto-fetch Change Orders for COR tab', e);
            }
        }
        
        let dataCount = corDataToUse.length;
        
        corDataToUse.forEach((corRow, index) => {
            const row = corSheet.getRow(startRow + index);
            row.getCell(1).value = corRow.cor || '';
            row.getCell(2).value = corRow.date || '';
            row.getCell(3).value = corRow.changeReference || '';
            row.getCell(4).value = corRow.corAmount || '';
            row.getCell(5).value = corRow.status || '';
            row.getCell(6).value = corRow.description || '';
            
            for (let i = 1; i <= 6; i++) {
                const cell = row.getCell(i);
                cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
                cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            }
        });

        // Ensure there are at least 10 empty rows with borders if data is less than 10
        const minRows = Math.max(10, dataCount);
        for (let r = 0; r < minRows; r++) {
            const row = corSheet.getRow(startRow + r);
            for (let i = 1; i <= 6; i++) {
                const cell = row.getCell(i);
                cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
                cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            }
        }
    }

    // --- TRANSMITTAL LOG TAB ---
    const transmittalSheet = workbook.getWorksheet('TRANSMITTAL LOG');
    if (transmittalSheet) {
        let startRow = 3;
        const styleRow = transmittalSheet.getRow(startRow);

        let transmittalsToUse = report.transmittalData || [];
        if (transmittalsToUse.length === 0) {
            transmittalsToUse = await getAutoFetchedTransmittals(projectId);
        }

        transmittalsToUse.forEach((t, index) => {
            const row = transmittalSheet.getRow(startRow + index);
            row.getCell(1).value = index + 1;
            row.getCell(2).value = t.transmittalNo || '';
            row.getCell(3).value = t.date || '';
            row.getCell(4).value = t.appFab || '';
            row.getCell(5).value = t.numberOfSheets || '';
            row.getCell(6).value = t.seqArea || '';
            row.getCell(7).value = t.remarks || '';

            if (styleRow) {
                row.eachCell((cell, colNumber) => {
                    const styleCell = styleRow.getCell(colNumber);
                    if (styleCell) {
                        cell.border = styleCell.border;
                        cell.alignment = styleCell.alignment;
                    }
                });
            }
        });
    }

    
    const rfiSheet = workbook.getWorksheet('RFI LOG');
    if (rfiSheet) {
        workbook.removeWorksheet(rfiSheet.id);
    }

    const cdrfiSheet = workbook.getWorksheet('CDRFI LOG');
    if (cdrfiSheet) {
        workbook.removeWorksheet(cdrfiSheet.id);
    }

    return workbook;
};
