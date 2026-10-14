const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const storageGateway = require('../utils/storageGateway');

const LOGO_DEFAULT = path.join(__dirname, '../../../frontend/src/assets/excel_im/excel_img.png');

function extractSkFromFilename(filename) {
    if (!filename) return 'SK# - Unknown';
    const m = filename.match(/SK[\s#\-_]*(\d+)/i);
    if (m) {
        const num = parseInt(m[1], 10);
        return `SK#${num}`;
    }
    return 'SK# - Unknown';
}

function formatDescription(raw) {
    if (!raw || !raw.trim()) return '';

    const normalized = raw.replace(/[ \t]+/g, ' ').trim();
    const parts = normalized
        .split(/(?<=[.?!])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

    if (parts.length <= 1) {
        return parts[0] || normalized;
    }

    const observations = [];
    const questions = [];
    parts.forEach(s => {
        if (s.endsWith('?')) {
            questions.push(s);
        } else {
            observations.push(s);
        }
    });

    const obsBlock = observations.join('\n');
    const qBlock = questions.join('\n');

    if (obsBlock && qBlock) {
        return `${obsBlock}\n\n${qBlock}`;
    }
    return (obsBlock || qBlock);
}

exports.generateCdrfiLogExcel = async (cdrfiExtractions, projectDetails, baseUrl, isExternal = false, token = '', filterStatus = null, apiRoot = '') => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'System';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('CDRFI Log');

    const projectName = (typeof projectDetails === 'object' ? projectDetails.projectName : projectDetails) || 'PROJECT NAME';
    const clientName = (typeof projectDetails === 'object' ? projectDetails.clientName : '') || 'CUSTOMER';
    const projectNo = (typeof projectDetails === 'object' ? projectDetails.projectNo : '') || '';

    const today = new Date();
    const updatedOn = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;

    let allRfis = [];
    cdrfiExtractions.forEach(doc => {
        const docSkNumber = extractSkFromFilename(doc.originalFileName);
        doc.rfis.forEach((rfi, idx) => {
            const compStatus = (rfi.status || 'OPEN').toUpperCase();
            if (filterStatus && compStatus !== filterStatus.toUpperCase()) return;

            const computedSk = (rfi.skNumber && rfi.skNumber.trim()) ? rfi.skNumber : docSkNumber;
            allRfis.push({
                ...rfi,
                refDrawing: rfi.refDrawing || doc.originalFileName,
                skNumber: computedSk,
                sentOn: rfi.sentOn || doc.sentOn || '',
                fileUrl: doc.fileUrl,
                storageGatewayPath: doc.storageGatewayPath,
                projectId: doc.projectId,
                extractionId: doc._id,
                rfiIndex: idx
            });
        });
    });

    const hasClientRfiNo = allRfis.some(r => r.clientRfiNumber && r.clientRfiNumber.trim().length > 0);
    const TOTAL_COLS = hasClientRfiNo ? 10 : 9;

    sheet.getColumn(1).width = 8;    // S.NO
    sheet.getColumn(2).width = 14;   // Sent On
    sheet.getColumn(3).width = 12;   // SK #
    sheet.getColumn(4).width = 22;   // Ref. Drawing
    sheet.getColumn(5).width = 60;   // Description
    if (hasClientRfiNo) {
        sheet.getColumn(6).width = 20;   // CLIENT CDRFI NUMBER
        sheet.getColumn(7).width = 38;   // Response
        sheet.getColumn(8).width = 12;   // Status
        sheet.getColumn(9).width = 14;   // Closed on
        sheet.getColumn(10).width = 30;  // Remarks
    } else {
        sheet.getColumn(6).width = 38;   // Response
        sheet.getColumn(7).width = 12;   // Status
        sheet.getColumn(8).width = 14;   // Closed on
        sheet.getColumn(9).width = 30;   // Remarks
    }

    const commonBorder = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
    };

    // ROW 1 — Logo
    const logoRow = sheet.getRow(1);
    logoRow.height = 55;
    for (let c = 1; c <= TOTAL_COLS; c++) {
        const cell = logoRow.getCell(c);
        cell.style = {
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
            border: commonBorder,
        };
    }
    sheet.mergeCells(1, 1, 1, TOTAL_COLS);

    try {
        const rawLogo = projectDetails?.logoPath || '';
        const finalLogo = rawLogo ? path.join(__dirname, '../../', rawLogo.replace(/^\//, '')) : LOGO_DEFAULT;
        if (fs.existsSync(finalLogo)) {
            const logoImageId = workbook.addImage({
                filename: finalLogo,
                extension: 'png',
            });
            sheet.addImage(logoImageId, {
                tl: { col: 0, row: 0 },
                ext: { width: 350, height: 50 }
            });
        }
    } catch (e) { console.error('[CdrfiExcel] Logo error:', e.message); }

    // ROW 2 — "CDRFI LOG" title
    const titleRow = sheet.getRow(2);
    titleRow.height = 22;
    titleRow.getCell(1).value = 'CDRFI LOG';
    titleRow.getCell(1).style = {
        font: { bold: true, size: 13, color: { argb: 'FFFFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2F5A' } },
        alignment: { vertical: 'middle', horizontal: 'center' },
        border: commonBorder,
    };
    sheet.mergeCells(2, 1, 2, TOTAL_COLS);
    for (let c = 2; c <= TOTAL_COLS; c++) {
        titleRow.getCell(c).style = {
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2F5A' } },
            border: commonBorder,
        };
    }

    // ROW 3 — Info banner
    const infoRow = sheet.getRow(3);
    infoRow.height = 24;

    const infoCellStyle = {
        font: { bold: true, size: 10, color: { argb: 'FFFFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2F5A' } },
        alignment: { vertical: 'middle', horizontal: 'center' },
        border: commonBorder,
    };

    infoRow.getCell(1).value = `CUSTOMER: ${clientName.toUpperCase()}`;
    infoRow.getCell(1).style = infoCellStyle;
    sheet.mergeCells(3, 1, 3, 2);

    infoRow.getCell(3).value = `PROJECT NAME: ${projectName.toUpperCase()}`;
    infoRow.getCell(3).style = infoCellStyle;
    sheet.mergeCells(3, 3, 3, 4);

    infoRow.getCell(5).value = `PROJECT NO: ${projectNo || '-'}`;
    infoRow.getCell(5).style = infoCellStyle;

    infoRow.getCell(6).value = `Updated on: ${updatedOn}`;
    infoRow.getCell(6).style = infoCellStyle;
    sheet.mergeCells(3, 6, 3, TOTAL_COLS);

    for (let c = 1; c <= TOTAL_COLS; c++) {
        if (!infoRow.getCell(c).style || !infoRow.getCell(c).style.border) {
            infoRow.getCell(c).border = commonBorder;
        }
    }

    // ROW 4 — Column headers
    const COL_HEADERS = ['S.NO', 'Sent On', 'SK #', 'Ref. Drawing', 'Description'];
    if (hasClientRfiNo) COL_HEADERS.push('CLIENT CDRFI NUMBER');
    COL_HEADERS.push('Response', 'Status', 'Closed on', 'Remarks');

    const colHeaderStyle = {
        font: { bold: true, size: 10, color: { argb: 'FF000000' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } },
        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
        border: commonBorder,
    };

    const headerRow = sheet.getRow(4);
    headerRow.height = 22;
    COL_HEADERS.forEach((h, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = h;
        cell.style = colHeaderStyle;
    });

    sheet.views = [{ state: 'frozen', ySplit: 4 }];

    allRfis.forEach((item, index) => {
        const excelRowNum = index + 5;
        const isEvenGroup = index % 2 === 1;
        const rowFill = isEvenGroup ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } } : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        const sentOnStr = item.sentOn ? (() => {
            const d = new Date(item.sentOn);
            return isNaN(d) ? item.sentOn : `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
        })() : '';

        const skNum = item.skNumber || '';
        const dataRow = sheet.getRow(excelRowNum);
        dataRow.height = 80;

        dataRow.getCell(1).value = index + 1;
        dataRow.getCell(1).style = { font: { size: 10 }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'center' }, border: commonBorder };
        dataRow.getCell(2).value = sentOnStr;
        dataRow.getCell(2).style = { font: { size: 10 }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'center' }, border: commonBorder };
        
        // SK # hyperlink to /cdrfis/...
        const skCell = dataRow.getCell(3);
        const resolvedBase = (baseUrl || '').toString().replace(/\/$/, '');
        
        let href = '';
        if (item.extractionId && item.projectId) {
            href = `${resolvedBase}/cdrfis/${item.projectId}/${item.extractionId}/view.pdf?token=${token}`;
        }

        if (href) {
            skCell.value = { text: skNum, hyperlink: href };
            skCell.style = { font: { size: 10, color: { argb: 'FF2563EB' }, underline: true }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'center' }, border: commonBorder };
        } else {
            skCell.value = skNum;
            skCell.style = { font: { size: 10 }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'center' }, border: commonBorder };
        }

        dataRow.getCell(4).value = item.refDrawing || '';
        dataRow.getCell(4).style = { font: { size: 10 }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'center', wrapText: true }, border: commonBorder };
        
        dataRow.getCell(5).value = formatDescription(item.description || '');
        dataRow.getCell(5).style = { font: { size: 10 }, fill: rowFill, alignment: { vertical: 'top', horizontal: 'left', wrapText: true }, border: commonBorder };

        let cursor = 6;
        if (hasClientRfiNo) {
            dataRow.getCell(cursor).value = item.clientRfiNumber || '';
            dataRow.getCell(cursor).style = { font: { size: 10 }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'center' }, border: commonBorder };
            cursor++;
        }

        const respCell = dataRow.getCell(cursor);
        const responseVal = item.response || '';
        const isConfirmed = responseVal && responseVal.trim().toUpperCase() === 'CONFIRMED';
        let responseHref = '';
        if (item.responseAttachmentUrl && item.extractionId && item.projectId && item.rfiIndex !== undefined) {
            responseHref = `${resolvedBase}/cdrfis/${item.projectId}/${item.extractionId}/attachment/${item.rfiIndex}?token=${token}`;
        } else if (item.responseAttachmentUrl) {
            const root = apiRoot || resolvedBase;
            responseHref = item.responseAttachmentUrl.startsWith('http')
                ? item.responseAttachmentUrl
                : `${root}${item.responseAttachmentUrl.startsWith('/') ? '' : '/'}${item.responseAttachmentUrl}`;
        }

        if (isConfirmed) {
            respCell.value = 'CONFIRMED';
            respCell.style = { font: { bold: true, size: 10, color: { argb: 'FFFF0000' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }, alignment: { vertical: 'middle', horizontal: 'center', wrapText: true }, border: commonBorder };
        } else if (responseHref) {
            const safeText = (responseVal || 'View Attachment').replace(/\r?\n/g, ' - ');
            respCell.value = { text: safeText, hyperlink: responseHref };
            respCell.style = { font: { size: 10, color: { argb: 'FF2563EB' }, underline: true }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'left', wrapText: true }, border: commonBorder };
        } else {
            respCell.value = responseVal;
            respCell.style = { font: { size: 10 }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'left', wrapText: true }, border: commonBorder };
        }
        cursor++;

        const statusVal = (item.status || 'OPEN').toUpperCase();
        const statusCell = dataRow.getCell(cursor);
        const isClosed = statusVal === 'CLOSED' || statusVal === 'CLOSE';
        const isOpen = statusVal === 'OPEN';
        let statusFill = isClosed ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } } : (isOpen ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } } : rowFill);
        statusCell.value = isClosed ? 'CLOSED' : (isOpen ? 'OPEN' : statusVal);
        statusCell.style = { font: { bold: true, size: 10, color: { argb: (isClosed || isOpen) ? 'FFFFFFFF' : 'FF000000' } }, fill: statusFill, alignment: { vertical: 'middle', horizontal: 'center' }, border: commonBorder };
        cursor++;

        const closedOnStr = item.closedOn ? (() => { const d = new Date(item.closedOn); return isNaN(d) ? item.closedOn : `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`; })() : '';
        dataRow.getCell(cursor).value = closedOnStr;
        dataRow.getCell(cursor).style = { font: { size: 10 }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'center' }, border: commonBorder };
        cursor++;

        dataRow.getCell(cursor).value = item.remarks || '';
        dataRow.getCell(cursor).style = { font: { size: 10 }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'left', wrapText: true }, border: commonBorder };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return { buffer, filename: 'CDRFI_Log.xlsx' };
};
