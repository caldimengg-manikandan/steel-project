const RfiReport = require('../models/RfiReport');
const RfiExtraction = require('../models/RfiExtraction');
const ChangeOrder = require('../models/ChangeOrder');
const Project = require('../models/Project');
const SystemSettings = require('../models/SystemSettings');
const exceljs = require('exceljs');
const path = require('path');
const fs = require('fs');

exports.getRfiReports = async (req, res) => {
    try {
        const { projectId } = req.params;
        const reports = await RfiReport.find({ projectId }).sort({ reportDate: -1 });
        res.json({ success: true, reports });
    } catch (error) {
        console.error('Error fetching RFI reports:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch RFI reports' });
    }
};

exports.getReportDraft = async (req, res) => {
    try {
        const { projectId, reportId } = req.params;
        let report = null;
        if (reportId !== 'dummy') {
            report = await RfiReport.findById(reportId);
            if (!report) {
                return res.status(404).json({ success: false, error: 'Report not found' });
            }
        }
        
        // Fetch auto-fetch data concurrently
        const [rfisResult, cdrfisResult] = await Promise.allSettled([
            RfiExtraction.find({ projectId }),
            ChangeOrder.find({ projectId })
        ]);

        const rfiExtractions = rfisResult.status === 'fulfilled' ? rfisResult.value : [];
        const rawCdrfis = cdrfisResult.status === 'fulfilled' ? cdrfisResult.value : [];
        
        const cdrfis = rawCdrfis.map(co => ({ id: co.coNumber, status: co.status, description: co.description }));
        
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

        res.json({
            success: true,
            report,
            autoFetch: {
                rfis,
                cdrfis
            }
        });
    } catch (error) {
        console.error('Error fetching RFI report draft:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch RFI report draft', details: error.message, stack: error.stack });
    }
};

exports.saveReportDraft = async (req, res) => {
    try {
        const { projectId } = req.params;
        const { 
            reportId, 
            reportDate, 
            cdrfiData,
            rfiData,
            status 
        } = req.body;

        let report;
        
        if (reportId) {
            report = await RfiReport.findByIdAndUpdate(
                reportId,
                { reportDate, cdrfiData, rfiData, status },
                { new: true }
            );
        } else {
            // Check if one exists for the date
            report = await RfiReport.findOneAndUpdate(
                { projectId, reportDate },
                { cdrfiData, rfiData, status: status || 'Draft' },
                { new: true, upsert: true }
            );
        }

        res.json({ success: true, report });
    } catch (error) {
        console.error('Error saving RFI report draft:', error);
        res.status(500).json({ success: false, error: 'Failed to save RFI report draft' });
    }
};

exports.submitReport = async (req, res) => {
    try {
        const { projectId, reportId } = req.params;
        let report;
        
        if (req.body && Object.keys(req.body).length > 0) {
            const { reportDate, cdrfiData, rfiData } = req.body;
            report = await RfiReport.findByIdAndUpdate(
                reportId,
                { reportDate, cdrfiData, rfiData, status: 'Submitted' },
                { new: true }
            );
        } else {
            report = await RfiReport.findByIdAndUpdate(
                reportId,
                { status: 'Submitted' },
                { new: true }
            );
        }
        
        res.json({ success: true, report });
    } catch (error) {
        console.error('Error submitting RFI report:', error);
        res.status(500).json({ success: false, error: 'Failed to submit RFI report' });
    }
};

exports.deleteReport = async (req, res) => {
    try {
        const { reportId } = req.params;
        await RfiReport.findByIdAndDelete(reportId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting RFI report:', error);
        res.status(500).json({ success: false, error: 'Failed to delete RFI report' });
    }
};

exports.downloadExcel = async (req, res) => {
    try {
        const { projectId, reportId } = req.params;
        const project = await Project.findById(projectId);
        if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
        
        let report = null;
        let rfis = [];
        let cdrfis = [];
        
        if (reportId === 'latest') {
            report = await RfiReport.findOne({ projectId }).sort({ reportDate: -1 });
            if (report) {
                rfis = report.rfiData || [];
                cdrfis = report.cdrfiData || [];
            }
        } else if (reportId !== 'dummy') {
            report = await RfiReport.findById(reportId);
            if (report) {
                rfis = report.rfiData || [];
                cdrfis = report.cdrfiData || [];
            }
        }
        
        if (!report) {
            // Fallback to auto-fetched data if report isn't saved yet
            const [rfisResult, cdrfisResult] = await Promise.allSettled([
                RfiExtraction.find({ projectId }),
                ChangeOrder.find({ projectId })
            ]);

            const rfiExtractions = rfisResult.status === 'fulfilled' ? rfisResult.value : [];
            const rawCdrfis = cdrfisResult.status === 'fulfilled' ? cdrfisResult.value : [];
            
            cdrfis = rawCdrfis.map(co => ({ id: co.coNumber, status: co.status, description: co.description }));
            
            rfiExtractions.forEach(ext => {
                if (ext.rfis && Array.isArray(ext.rfis)) {
                    ext.rfis.forEach(rfi => {
                        rfis.push({
                            id: rfi.rfiNumber || '',
                            description: rfi.description || '',
                            status: 'OPEN', // default
                            originalFileName: ext.originalFileName,
                            sentDate: ext.createdAt
                        });
                    });
                }
            });
        }
        const workbook = new exceljs.Workbook();
        const logoPath = path.join(__dirname, '../../../frontend/src/assets/excel_im/excel_img.png');
        let logoImageIdRfi = null;
        let logoImageIdCdrfi = null;
        console.log('[DEBUG EXCEL] logoPath:', logoPath);
        console.log('[DEBUG EXCEL] Exists:', fs.existsSync(logoPath));
        if (fs.existsSync(logoPath)) {
            const logoBuffer = fs.readFileSync(logoPath);
            console.log('[DEBUG EXCEL] Buffer length:', logoBuffer.length);
            logoImageIdRfi = workbook.addImage({
                buffer: logoBuffer,
                extension: 'png',
            });
            logoImageIdCdrfi = workbook.addImage({
                buffer: logoBuffer,
                extension: 'png',
            });
            console.log('[DEBUG EXCEL] Image IDs:', logoImageIdRfi, logoImageIdCdrfi);
        }
        
        // RFI Sheet
        const rfiSheet = workbook.addWorksheet('RFI LOG');
        
        // Fill first 4 rows with white background without vertically merging them
        for (let r = 1; r <= 4; r++) {
            const row = rfiSheet.getRow(r);
            row.height = 20;
            for (let c = 1; c <= 11; c++) {
                row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
            }
        }

        if (logoImageIdRfi !== null) {
            rfiSheet.addImage(logoImageIdRfi, {
                tl: { col: 3, row: 0 }, // Start at Column D, Row 1
                br: { col: 10, row: 4 } // End before Column K (so covers D to J) and Row 5 (covers 1 to 4)
            });
        }

        rfiSheet.mergeCells('A5:K5');
        const rfiTitle = rfiSheet.getCell('A5');
        rfiTitle.value = 'RFI LOG';
        rfiTitle.alignment = { vertical: 'middle', horizontal: 'center' };
        rfiTitle.font = { size: 16, bold: true, color: { argb: 'FF0070C0' } };
        
        const rfiHeaderRow = rfiSheet.getRow(6);
        rfiHeaderRow.values = ['S.NO', 'RFI #', 'CLIENT RFI #', 'STATUS', 'PRIORITY', 'SENT DATE', 'SEQ/AREA', 'RFI TYPE', 'DESCRIPTION', 'RECVD DATE', 'REMARKS'];
        rfiHeaderRow.height = 30;
        rfiHeaderRow.eachCell((cell, colNumber) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            const widths = [8, 15, 15, 12, 12, 15, 15, 15, 50, 15, 30];
            rfiSheet.getColumn(colNumber).width = widths[colNumber - 1];
        });
        
        rfis.forEach((rfi, idx) => {
            const row = rfiSheet.addRow([
                idx + 1,
                rfi.rfiNumber || rfi.id || '',
                rfi.clientRfiNumber || '',
                rfi.status || '',
                rfi.priority || '',
                rfi.sentDate || '',
                rfi.seqArea || '',
                rfi.rfiType || '',
                rfi.description || '',
                rfi.receivedDate || '',
                rfi.remarks || ''
            ]);
            row.eachCell(cell => {
                cell.alignment = { vertical: 'middle', wrapText: true };
                cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            });
        });
        
        rfiSheet.views = [
            { state: 'normal', activeCell: 'A6' }
        ];
        
        // CDRFI Sheet
        const cdrfiSheet = workbook.addWorksheet('CDRFI LOG');
        
        // Fill first 4 rows with white background without vertically merging them
        for (let r = 1; r <= 4; r++) {
            const row = cdrfiSheet.getRow(r);
            row.height = 20;
            for (let c = 1; c <= 11; c++) {
                row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
            }
        }

        if (logoImageIdCdrfi !== null) {
            cdrfiSheet.addImage(logoImageIdCdrfi, {
                tl: { col: 3, row: 0 }, // Start at Column D, Row 1
                br: { col: 10, row: 4 } // End before Column K (so covers D to J) and Row 5 (covers 1 to 4)
            });
        }

        cdrfiSheet.mergeCells('A5:K5');
        const cdrfiTitle = cdrfiSheet.getCell('A5');
        cdrfiTitle.value = 'CDRFI LOG';
        cdrfiTitle.alignment = { vertical: 'middle', horizontal: 'center' };
        cdrfiTitle.font = { size: 16, bold: true, color: { argb: 'FF0070C0' } };
        
        const cdrfiHeaderRow = cdrfiSheet.getRow(6);
        cdrfiHeaderRow.values = ['S.NO', 'CALDIM CDRFI #', 'CLIENT CDRFI #', 'STATUS', 'PRIORITY', 'SENT DATE', 'SEQ/AREA', 'CDRFI TYPE', 'DESCRIPTION', 'RECVD DATE', 'REMARKS'];
        cdrfiHeaderRow.height = 30;
        cdrfiHeaderRow.eachCell((cell, colNumber) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            const widths = [8, 18, 18, 12, 12, 15, 15, 15, 50, 15, 30];
            cdrfiSheet.getColumn(colNumber).width = widths[colNumber - 1];
        });
        
        cdrfis.forEach((cdrfi, idx) => {
            const row = cdrfiSheet.addRow([
                idx + 1,
                cdrfi.caldimCdrfiNo || cdrfi.id || '',
                cdrfi.clientCdrfiNo || '',
                cdrfi.status || '',
                cdrfi.priority || '',
                cdrfi.sentDate || '',
                cdrfi.seqArea || '',
                cdrfi.cdrfiType || '',
                cdrfi.description || '',
                cdrfi.receivedDate || '',
                cdrfi.remarks || ''
            ]);
            row.eachCell(cell => {
                cell.alignment = { vertical: 'middle', wrapText: true };
                cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            });
        });

        cdrfiSheet.views = [
            { state: 'normal', activeCell: 'A6' }
        ];

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="RFI_Log_${project.name}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Error exporting RFI log:', error);
        res.status(500).json({ success: false, error: 'Failed to generate Excel file' });
    }
};
