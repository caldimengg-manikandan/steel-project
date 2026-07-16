const ErrorLog = require('../models/ErrorLog');
const SystemSettings = require('../models/SystemSettings');
const exceljs = require('exceljs');
const path = require('path');
const fs = require('fs');
const { sendErrorLogNotification } = require('../services/emailService');

exports.getErrorLogs = async (req, res) => {
    try {
        const logs = await ErrorLog.find().sort({ createdAt: -1 });
        res.json({ success: true, logs });
    } catch (error) {
        console.error('Error fetching error logs:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch error logs' });
    }
};

exports.saveErrorLogs = async (req, res) => {
    try {
        const { logs, addedByRole, addedByName } = req.body;
        if (!Array.isArray(logs)) {
            return res.status(400).json({ success: false, error: 'Invalid data format' });
        }

        // Identify brand-new entries (no existing _id) before saving
        const newEntries = logs.filter(log => !log._id || log._id === 'new');

        const bulkOps = logs.map(log => {
            if (log._id && log._id !== 'new') {
                return {
                    updateOne: {
                        filter: { _id: log._id },
                        update: { $set: log },
                        upsert: true
                    }
                };
            } else {
                const { _id, ...insertData } = log;
                return {
                    insertOne: {
                        document: insertData
                    }
                };
            }
        });

        // Delete logs not in payload
        const logIdsToKeep = logs.filter(l => l._id && l._id !== 'new').map(l => l._id);
        await ErrorLog.deleteMany({ _id: { $nin: logIdsToKeep } });

        if (bulkOps.length > 0) {
            await ErrorLog.bulkWrite(bulkOps);
        }

        // Send email notifications for each new entry (non-blocking)
        if (newEntries.length > 0 && addedByRole) {
            for (const entry of newEntries) {
                sendErrorLogNotification(entry, addedByRole, addedByName).catch(err =>
                    console.error('[Email] Notification error:', err.message)
                );
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error saving error logs:', error);
        res.status(500).json({ success: false, error: 'Failed to save error logs' });
    }
};


exports.downloadExcel = async (req, res) => {
    try {
        const logs = await ErrorLog.find().sort({ createdAt: 1 });
        
        const workbook = new exceljs.Workbook();
        const sheet = workbook.addWorksheet('ERROR LOG');

        // Fetch settings for logo
        const settings = await SystemSettings.findOne();
        let logoPath = null;
        if (settings && settings.companyLogoUrl) {
            logoPath = settings.companyLogoUrl;
        }

        const LOGO_DEFAULT = path.join(__dirname, '../../public/assets/default-logo.png');
        const finalLogo = logoPath ? path.join(__dirname, '../../', logoPath.replace(/^\//, '')) : LOGO_DEFAULT;
        
        try {
            if (fs.existsSync(finalLogo)) {
                const imageId = workbook.addImage({ filename: finalLogo, extension: 'png' });
                sheet.addImage(imageId, { tl: { col: 0, row: 0 }, br: { col: 2, row: 3 } });
            }
        } catch (err) { console.error('Logo error:', err.message); }

        // Title row
        sheet.mergeCells('A1:P3');
        const titleCell = sheet.getCell('A1');
        titleCell.value = 'ERROR LOG';
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
        titleCell.font = { size: 16, bold: true, color: { argb: 'FF0070C0' } }; // Blue color like screenshot

        // Header Row (Row 4)
        const headers = [
            'S No', 'Date', 'Project / Job Name', 'Client / Fabricator', 'Error Category',
            'Error Description', 'Impact (Shop/Fld)', 'PM', 'Modeler', 'Detailer', 'Checker',
            'Root Cause', 'Corrective/Preventive Action', 'Severity', 'Status', 'Remarks'
        ];
        
        const headerRow = sheet.getRow(4);
        headerRow.values = headers;
        headerRow.height = 30;
        
        headerRow.eachCell((cell, colNumber) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1F4E78' } // Dark blue header
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = {
                top: { style: 'thin' }, left: { style: 'thin' },
                bottom: { style: 'thin' }, right: { style: 'thin' }
            };
            // Set column widths
            const widths = [5, 12, 18, 18, 15, 25, 12, 12, 12, 12, 12, 20, 25, 12, 12, 20];
            sheet.getColumn(colNumber).width = widths[colNumber - 1];
        });

        // Data Rows
        logs.forEach((log, index) => {
            const row = sheet.addRow([
                index + 1,
                log.date || '',
                log.projectName || '',
                log.clientName || '',
                log.errorCategory || '',
                log.errorDescription || '',
                log.impact || '',
                log.pm || '',
                log.modeler || '',
                log.detailer || '',
                log.checker || '',
                log.rootCause || '',
                log.correctiveAction || '',
                log.severity || '',
                log.status || '',
                log.remarks || ''
            ]);
            
            row.eachCell((cell) => {
                cell.alignment = { vertical: 'middle', wrapText: true };
                cell.font = { size: 9 };
                cell.border = {
                    top: { style: 'thin' }, left: { style: 'thin' },
                    bottom: { style: 'thin' }, right: { style: 'thin' }
                };
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="ErrorLog.xlsx"');

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Error exporting error log:', error);
        res.status(500).json({ success: false, error: 'Failed to generate Excel file' });
    }
};
