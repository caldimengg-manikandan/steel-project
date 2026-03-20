const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const LOGO_PATH = path.join(__dirname, '../../../frontend/src/assets/excel_im/excel_img.png');

/**
 * extractSkFromFilename
 * Extracts SK# exclusively from the PDF filename.
 * Matches: SK1, SK-01, SK_02, SK#3, SK 04  →  SK#1, SK#2, SK#3
 * Returns "SK# - Unknown" if no match found.
 */
function extractSkFromFilename(filename) {
    if (!filename) return 'SK# - Unknown';
    const m = filename.match(/SK[\s#\-_]*(\d+)/i);
    if (m) {
        const num = parseInt(m[1], 10); // strip leading zeros
        return `SK#${num}`;
    }
    return 'SK# - Unknown';
}

/**
 * formatDescription
 * Reformats a raw description string for clear Excel display:
 * - Splits on sentence boundaries (. / ? / ! followed by space or newline)
 * - Marks each sentence with a bullet point (•)
 * - Separates observation sentences from question sentences with a double newline
 * - Trims extra whitespace
 */
function formatDescription(raw) {
    if (!raw || !raw.trim()) return '';

    // Normalize: collapse multiple whitespace (but keep intentional newlines as sentence breaks)
    const normalized = raw.replace(/[ \t]+/g, ' ').trim();

    // Split on sentence-ending punctuation followed by whitespace or newline
    const parts = normalized
        .split(/(?<=[.?!])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

    if (parts.length <= 1) {
        // Single sentence — return as-is
        return parts[0] || normalized;
    }

    // Separate observations (non-questions) from questions (ending with ?)
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


/**
 * generateRfiLogExcel
 * Generates an RFI Log Excel in the style shown in the reference image:
 *   - Logo row: Caldim logo image (merged across all columns)
 *   - Row 2: Merged banner → CUSTOMER | PROJECT NAME | PROJECT NO | Updated on
 *   - Row 3: Column headers → S.NO | Sent On | SK # | Ref. Drawing | Description | Response
 *   - Data rows with alternating white/light-grey backgrounds
 *   - "CONFIRMED" responses highlighted in yellow with red bold text
 */
exports.generateRfiLogExcel = async (rfiExtractions, projectDetails, baseUrl, isExternal = false) => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'System';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('RFI Log');

    // ── Project meta ─────────────────────────────────────────
    const projectName = (typeof projectDetails === 'object' ? projectDetails.projectName : projectDetails) || 'PROJECT NAME';
    const clientName = (typeof projectDetails === 'object' ? projectDetails.clientName : '') || 'CUSTOMER';
    const projectNo = (typeof projectDetails === 'object' ? projectDetails.projectNo : '') || '';

    const today = new Date();
    const updatedOn = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;

    // ── Flatten all RFIs & Check for Client RFI Numbers ───────
    let allRfis = [];
    rfiExtractions.forEach(doc => {
        const docSkNumber = extractSkFromFilename(doc.originalFileName);
        doc.rfis.forEach(rfi => {
            const computedSk = (rfi.skNumber && rfi.skNumber.trim()) ? rfi.skNumber : docSkNumber;
            allRfis.push({
                ...rfi,
                refDrawing: rfi.refDrawing || doc.originalFileName,
                skNumber: computedSk,
                sentOn: rfi.sentOn || doc.sentOn || '',
                fileUrl: doc.fileUrl,
            });
        });
    });

    const hasClientRfiNo = allRfis.some(r => r.clientRfiNumber && r.clientRfiNumber.trim().length > 0);
    const TOTAL_COLS = hasClientRfiNo ? 11 : 10;

    // ── Column widths ─────────────────────────────────────────
    sheet.getColumn(1).width = 8;    // S.NO
    sheet.getColumn(2).width = 14;   // Sent On
    sheet.getColumn(3).width = 12;   // SK #
    sheet.getColumn(4).width = 22;   // Ref. Drawing
    sheet.getColumn(5).width = 60;   // Description
    if (hasClientRfiNo) {
        sheet.getColumn(6).width = 20;   // CLIENT RFI NUMBER
        sheet.getColumn(7).width = 38;   // Response
        sheet.getColumn(8).width = 12;   // Status
        sheet.getColumn(9).width = 14;   // Closed on
        sheet.getColumn(10).width = 30;  // Remarks
        sheet.getColumn(11).width = 20;  // Link to Source
    } else {
        sheet.getColumn(6).width = 38;   // Response
        sheet.getColumn(7).width = 12;   // Status
        sheet.getColumn(8).width = 14;   // Closed on
        sheet.getColumn(9).width = 30;   // Remarks
        sheet.getColumn(10).width = 20;  // Link to Source
    }

    const commonBorder = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
    };

    // ════════════════════════════════════════════════════════
    // ROW 1 — Caldim Logo image
    // ════════════════════════════════════════════════════════
    const logoRow = sheet.getRow(1);
    logoRow.height = 55; // enough height to display the logo clearly

    // Fill logo row cells with white background
    for (let c = 1; c <= TOTAL_COLS; c++) {
        const cell = logoRow.getCell(c);
        cell.style = {
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
            border: commonBorder,
        };
    }
    sheet.mergeCells(1, 1, 1, TOTAL_COLS);

    // Embed logo if the file exists
    if (fs.existsSync(LOGO_PATH)) {
        const logoImageId = workbook.addImage({
            filename: LOGO_PATH,
            extension: 'png',
        });
        sheet.addImage(logoImageId, {
            tl: { col: 0, row: 0 },       // top-left: column A, row 1
            br: { col: TOTAL_COLS, row: 1 }, // bottom-right: last column, row 2
            editAs: 'oneCell',
        });
    }

    // ════════════════════════════════════════════════════════
    // ROW 2 — "RFI LOG" title (centered, dark navy)
    // ════════════════════════════════════════════════════════
    const titleRow = sheet.getRow(2);
    titleRow.height = 22;
    titleRow.getCell(1).value = 'RFI LOG';
    titleRow.getCell(1).style = {
        font: { bold: true, size: 13, color: { argb: 'FFFFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2F5A' } },
        alignment: { vertical: 'middle', horizontal: 'center' },
        border: commonBorder,
    };
    sheet.mergeCells(2, 1, 2, TOTAL_COLS);
    // apply border to all merged cells in row 2
    for (let c = 2; c <= TOTAL_COLS; c++) {
        titleRow.getCell(c).style = {
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2F5A' } },
            border: commonBorder,
        };
    }

    // ════════════════════════════════════════════════════════
    // ROW 3 — Info banner: CUSTOMER | PROJECT NAME | PROJECT NO | Updated on
    // ════════════════════════════════════════════════════════
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

    // ensure all merged cells in row 3 have border
    for (let c = 1; c <= TOTAL_COLS; c++) {
        if (!infoRow.getCell(c).style || !infoRow.getCell(c).style.border) {
            infoRow.getCell(c).border = commonBorder;
        }
    }

    // ════════════════════════════════════════════════════════
    // ROW 4 — Column headers
    const COL_HEADERS = ['S.NO', 'Sent On', 'SK #', 'Ref. Drawing', 'Description'];
    if (hasClientRfiNo) COL_HEADERS.push('CLIENT RFI NUMBER');
    COL_HEADERS.push('Response', 'Status', 'Closed on', 'Remarks', 'Link to Source');

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

    // Freeze top 4 rows (logo + title + info banner + column headers)
    sheet.views = [{ state: 'frozen', ySplit: 4 }];

    // ── Row rendering ─────────────────────────────────────────
    let prevSentOn = null;
    let prevSkNum = null;
    const groupBoundaries = [];

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

        // Populate standard columns
        dataRow.getCell(1).value = index + 1;
        dataRow.getCell(1).style = { font: { size: 10 }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'center' }, border: commonBorder };
        dataRow.getCell(2).value = sentOnStr;
        dataRow.getCell(2).style = { font: { size: 10 }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'center' }, border: commonBorder };
        
        // SK #
        const skCell = dataRow.getCell(3);
        const resolvedBase = (baseUrl || '').toString().replace(/\/$/, '');
        let href = (item.fileUrl) ? `${resolvedBase}${item.fileUrl}` : '';
        if (isExternal) href = `${resolvedBase}/${encodeURIComponent(item.refDrawing || '')}`;
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

        // Handle dynamic column indexing
        let cursor = 6;
        if (hasClientRfiNo) {
            dataRow.getCell(cursor).value = item.clientRfiNumber || '';
            dataRow.getCell(cursor).style = { font: { size: 10 }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'center' }, border: commonBorder };
            cursor++;
        }

        // Response
        const respCell = dataRow.getCell(cursor);
        const responseVal = item.response || '';
        const isConfirmed = responseVal && responseVal.trim().toUpperCase() === 'CONFIRMED';
        let responseHref = (item.responseAttachmentUrl && !isExternal) ? `${resolvedBase}${item.responseAttachmentUrl}` : '';

        if (isConfirmed) {
            respCell.value = 'CONFIRMED';
            respCell.style = { font: { bold: true, size: 10, color: { argb: 'FFFF0000' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }, alignment: { vertical: 'middle', horizontal: 'center', wrapText: true }, border: commonBorder };
        } else if (responseHref) {
            respCell.value = { text: responseVal || 'View Attachment', hyperlink: responseHref };
            respCell.style = { font: { size: 10, color: { argb: 'FF2563EB' }, underline: true }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'left', wrapText: true }, border: commonBorder };
        } else {
            respCell.value = responseVal;
            respCell.style = { font: { size: 10 }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'left', wrapText: true }, border: commonBorder };
        }
        cursor++;

        // Status
        const statusVal = (item.status || 'OPEN').toUpperCase();
        const statusCell = dataRow.getCell(cursor);
        const isClosed = statusVal === 'CLOSED' || statusVal === 'CLOSE';
        const isOpen = statusVal === 'OPEN';
        let statusFill = isClosed ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } } : (isOpen ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } } : rowFill);
        statusCell.value = isClosed ? 'CLOSED' : (isOpen ? 'OPEN' : statusVal);
        statusCell.style = { font: { bold: true, size: 10, color: { argb: (isClosed || isOpen) ? 'FFFFFFFF' : 'FF000000' } }, fill: statusFill, alignment: { vertical: 'middle', horizontal: 'center' }, border: commonBorder };
        cursor++;

        // Closed On
        const closedOnStr = item.closedOn ? (() => { const d = new Date(item.closedOn); return isNaN(d) ? item.closedOn : `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`; })() : '';
        dataRow.getCell(cursor).value = closedOnStr;
        dataRow.getCell(cursor).style = { font: { size: 10 }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'center' }, border: commonBorder };
        cursor++;

        // Remarks
        dataRow.getCell(cursor).value = item.remarks || '';
        dataRow.getCell(cursor).style = { font: { size: 10 }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'left', wrapText: true }, border: commonBorder };
        cursor++;

        // Link to Source
        const linkCell = dataRow.getCell(cursor);
        if (href) {
            linkCell.value = { text: 'View PDF', hyperlink: href };
            linkCell.style = { font: { size: 10, color: { argb: 'FF2563EB' }, underline: true }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'center' }, border: commonBorder };
        } else {
            linkCell.value = 'View PDF';
            linkCell.style = { font: { size: 10, color: { argb: 'FF9CA3AF' }, italic: true }, fill: rowFill, alignment: { vertical: 'middle', horizontal: 'center' }, border: commonBorder };
        }

        // Grouping
        const isSameGroup = (sentOnStr === prevSentOn && skNum === prevSkNum);
        if (!isSameGroup) {
            if (groupBoundaries.length > 0) groupBoundaries[groupBoundaries.length - 1].end = excelRowNum - 1;
            groupBoundaries.push({ start: excelRowNum, end: excelRowNum, sentOn: sentOnStr, skNum });
            prevSentOn = sentOnStr;
            prevSkNum = skNum;
        }
    });

    if (groupBoundaries.length > 0) {
        groupBoundaries[groupBoundaries.length - 1].end = allRfis.length + 4;
    }

    // ── Merge Sent On (col 2) and SK # (col 3) within each group ─
    groupBoundaries.forEach(g => {
        if (g.end > g.start) {
            try { sheet.mergeCells(g.start, 2, g.end, 2); } catch (_) { }
            try { sheet.mergeCells(g.start, 3, g.end, 3); } catch (_) { }
        }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return { buffer, filename: 'RFI_Log.xlsx' };
};


