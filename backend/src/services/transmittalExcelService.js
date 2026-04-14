/**
 * ============================================================
 * Transmittal Excel Service
 * ============================================================
 * Generates:
 *   1) A styled Transmittal Excel (TR-XXX sheet)
 *      — contains only the drawings in that transmittal
 *      — NEW rows are highlighted green, REVISED rows are orange
 *
 *   2) A styled Drawing Log Excel (cumulative log)
 *      — one row per drawing number
 *      — dynamic revision columns (same style as existing excelService)
 *      — shows all revision dates across all transmittals
 */
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const LOGO_PATH = path.join(__dirname, '../../../frontend/src/assets/excel_im/excel_img.png');

const commonBorderStyle = {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' },
};

// ─────────────────────────────────────────────────────────────
// generateTransmittalExcel
// ─────────────────────────────────────────────────────────────
/**
 * Generates an Excel file for a single transmittal.
 *
 * @param {object} transmittal  — Transmittal doc (lean)
 * @param {object} projectDetails  — { projectName, clientName, transmittalNo }
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
async function generateTransmittalExcel(transmittal, projectDetails) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Caldim Steel Detailing DMS';
    workbook.created = new Date();

    const { projectName = 'Project', clientName = 'CLIENT', transmittalNo } = projectDetails;
    const trNum = transmittalNo || transmittal.transmittalNumber || 1;

    const today = new Date();
    const formattedDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

    const trSheet = workbook.addWorksheet(`Transmittal TR-${String(trNum).padStart(3, '0')}`);

    // ── Logo ────────────────────────────────────────────────
    try {
        if (fs.existsSync(LOGO_PATH)) {
            const imageId = workbook.addImage({ filename: LOGO_PATH, extension: 'png' });
            trSheet.addImage(imageId, { tl: { col: 0, row: 0 }, br: { col: 5, row: 6 } });
        }
    } catch (err) { console.error('[TransmittalExcel] Logo error:', err.message); }

    for (let r = 1; r <= 6; r++) trSheet.getRow(r).height = 18;
    trSheet.getRow(7).height = 6;

    const T_START = 8;
    const greenFontStyle = { font: { bold: true, size: 12, color: { argb: 'FF00B050' } } };

    // Row 8: Project Name | Transmittal No
    const r1 = trSheet.getRow(T_START);
    r1.height = 22;
    r1.getCell(1).value = `PROJECT NAME : ${projectName.toUpperCase()}`;
    r1.getCell(1).style = greenFontStyle;
    trSheet.mergeCells(T_START, 1, T_START, 3);
    r1.getCell(4).value = `TRANSMITTAL NO: TR-${String(trNum).padStart(3, '0')}`;
    r1.getCell(4).style = { ...greenFontStyle, alignment: { horizontal: 'right' } };
    trSheet.mergeCells(T_START, 4, T_START, 6);

    // Row 9: Fabricator | Date
    const r2 = trSheet.getRow(T_START + 1);
    r2.height = 22;
    r2.getCell(1).value = `FABRICATOR   : ${clientName.toUpperCase()}`;
    r2.getCell(1).style = greenFontStyle;
    trSheet.mergeCells(T_START + 1, 1, T_START + 1, 3);
    r2.getCell(4).value = `DATE: ${formattedDate}`;
    r2.getCell(4).style = { ...greenFontStyle, alignment: { horizontal: 'right' } };
    trSheet.mergeCells(T_START + 1, 4, T_START + 1, 6);

    // Spacer + Legend
    const legendRow = trSheet.getRow(T_START + 2);
    legendRow.height = 16;
    legendRow.getCell(1).value = '● GREEN = New Drawing';
    legendRow.getCell(1).style = { font: { bold: true, color: { argb: 'FF00B050' }, size: 9 } };
    legendRow.getCell(3).value = '● ORANGE = Revised Drawing';
    legendRow.getCell(3).style = { font: { bold: true, color: { argb: 'FFFF6600' }, size: 9 } };

    trSheet.getRow(T_START + 3).height = 6;

    // ── Column Headers ────────────────────────────────────────
    const headerStyle = {
        font: { bold: true, size: 10, color: { argb: 'FF1F3864' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } },
        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
        border: commonBorderStyle,
    };

    const H_ROW = T_START + 4;
    const headers = ['Sl. No.', 'Sheet No.', 'Drawing Title', 'Revision', 'Date', 'Remarks', 'Status'];
    const widths = [8, 22, 50, 14, 16, 40, 14];

    const hRow = trSheet.getRow(H_ROW);
    hRow.height = 24;
    headers.forEach((h, i) => {
        hRow.getCell(i + 1).value = h;
        hRow.getCell(i + 1).style = headerStyle;
        trSheet.getColumn(i + 1).width = widths[i];
    });

    trSheet.views = [{ state: 'frozen', ySplit: H_ROW }];

    // ── Group drawings by folder ──────────────────────────────
    const folderGroups = {};
    (transmittal.drawings || []).forEach(d => {
        const folder = d.folderName || 'DRAWINGS';
        if (!folderGroups[folder]) folderGroups[folder] = [];
        folderGroups[folder].push(d);
    });

    const sortedFolders = Object.keys(folderGroups).sort();
    let slNo = 1;

    sortedFolders.forEach(folder => {
        // Folder header
        const fRow = trSheet.addRow([folder.toUpperCase()]);
        const rNum = fRow.number;
        fRow.height = 22;
        fRow.getCell(1).style = {
            font: { bold: true, size: 11, color: { argb: 'FF000000' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } },
            alignment: { horizontal: 'center', vertical: 'middle' },
            border: commonBorderStyle,
        };
        trSheet.mergeCells(rNum, 1, rNum, 7);
        for (let i = 1; i <= 7; i++) {
            fRow.getCell(i).border = commonBorderStyle;
            if (i > 1) fRow.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
        }

        // Sort by drawing number within folder
        const sorted = [...folderGroups[folder]].sort((a, b) =>
            (a.drawingNumber || '').localeCompare(b.drawingNumber || '', undefined, { numeric: true, sensitivity: 'base' })
        );

        sorted.forEach(d => {
            const isNew = d.changeType === 'new';
            const isRevised = d.changeType === 'revised';

            const dataRow = trSheet.addRow([
                slNo++,
                d.drawingNumber || '',
                d.drawingTitle || '',
                d.revision || '',
                d.date || '',
                d.remarks || '',
                isNew ? 'NEW' : isRevised ? `REVISED (was ${d.previousRevision || '?'})` : '',
            ]);

            dataRow.height = 22;

            const rowBg = isNew
                ? 'FFE2EFDA'   // light green for new
                : isRevised
                    ? 'FFFCE4D6' // light orange for revised
                    : 'FFFFFFFF';

            dataRow.eachCell((cell, colNum) => {
                cell.border = commonBorderStyle;
                cell.alignment = {
                    vertical: 'middle',
                    horizontal: (colNum === 3 || colNum === 6) ? 'left' : 'center',
                    wrapText: true,
                };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
            });

            // Bold the status cell
            const statusCell = dataRow.getCell(7);
            statusCell.font = {
                bold: true,
                color: { argb: isNew ? 'FF00B050' : isRevised ? 'FFFF6600' : 'FF000000' },
            };
        });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const safeProjectName = projectName.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const filename = `${safeProjectName}_TR-${String(trNum).padStart(3, '0')}_Transmittal.xlsx`;

    return { buffer, filename };
}

// ─────────────────────────────────────────────────────────────
// generateDrawingLogExcel
// ─────────────────────────────────────────────────────────────
/**
 * Generates a comprehensive Drawing Log Excel from the DrawingLog doc.
 * - One row per drawing number
 * - Dynamic revision columns
 * - Shows transmittal number where each revision was introduced
 *
 * @param {object} drawingLog     — DrawingLog doc (lean)
 * @param {object} projectDetails — { projectName, clientName }
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
async function generateDrawingLogExcel(drawingLog, projectDetails) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Caldim Steel Detailing DMS';
    workbook.created = new Date();

    const { projectName = 'Project', clientName = 'CLIENT' } = projectDetails;
    const drawings = drawingLog.drawings || [];

    const logSheet = workbook.addWorksheet('Drawing Log');

    // ── Logo ────────────────────────────────────────────────
    try {
        if (fs.existsSync(LOGO_PATH)) {
            const imageId = workbook.addImage({ filename: LOGO_PATH, extension: 'png' });
            // Scale logo to top left, roughly spanning A and B columns
            logSheet.addImage(imageId, { tl: { col: 0, row: 0 }, br: { col: 2, row: 5 } });
        }
    } catch (err) { console.error('[DrawingLogExcel] Logo error:', err.message); }

    for (let r = 1; r <= 6; r++) logSheet.getRow(r).height = 18;
    logSheet.getRow(7).height = 6;

    const L_START = 8;

    // ── Collect all unique revision marks across all drawings ─
    const allRevsSet = new Set();
    drawings.forEach(d => {
        (d.revisionHistory || []).forEach(rh => {
            if (rh.revision) allRevsSet.add(String(rh.revision).toUpperCase().trim());
        });
        if (d.currentRevision) allRevsSet.add(String(d.currentRevision).toUpperCase().trim());
    });

    const allRevsArr = Array.from(allRevsSet);
    const alphaRevs = allRevsArr.filter(r => /^[A-Za-z]/.test(r));
    let numRevs = allRevsArr.filter(r => !/^[A-Za-z]/.test(r));

    // Ensure at least Rev A exists for Approval
    ['A'].forEach(r => { if (!alphaRevs.includes(r)) alphaRevs.push(r); });
    alphaRevs.sort();

    // Ensure at least Rev 0 exists for Fabrication
    ['0'].forEach(n => { if (!numRevs.includes(n)) numRevs.push(n); });
    numRevs.sort((a, b) => {
        const numA = parseInt(a, 10);
        const numB = parseInt(b, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.localeCompare(b);
    });

    // totalCols = Sl.No + Sheet No + Title + alphaRevs + numRevs + Remarks
    const totalCols = Math.max(3 + alphaRevs.length + numRevs.length + 1, 4);

    // ── Row L_START: Title bar ────────────────────────────────
    const titleRow = logSheet.getRow(L_START);
    titleRow.height = 28;
    titleRow.getCell(1).value = 'OUTGOING DRAWING LOG SHEET';
    titleRow.getCell(1).style = {
        font: { bold: true, size: 14, color: { argb: 'FF000000' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },
        alignment: { vertical: 'middle', horizontal: 'center' },
        border: commonBorderStyle,
    };
    logSheet.mergeCells(L_START, 1, L_START, totalCols);

    // ── Row L_START+1: Project Name | Client Name ─────────────
    const projRow = logSheet.getRow(L_START + 1);
    projRow.height = 24;
    const projMidCol = Math.ceil(totalCols / 2);
    projRow.getCell(1).value = `Project Name : ${projectName}`;
    projRow.getCell(1).style = { font: { bold: true, size: 11 }, alignment: { vertical: 'middle', horizontal: 'left' }, border: commonBorderStyle };
    logSheet.mergeCells(L_START + 1, 1, L_START + 1, projMidCol);

    projRow.getCell(projMidCol + 1).value = `Client : ${clientName}`;
    projRow.getCell(projMidCol + 1).style = { font: { bold: true, size: 11 }, alignment: { vertical: 'middle', horizontal: 'left' }, border: commonBorderStyle };
    logSheet.mergeCells(L_START + 1, projMidCol + 1, L_START + 1, totalCols);

    // ── Rows L_START+2 & +3: Group + Sub Headers ──────────────
    const cHeadStyle = {
        font: { bold: true, size: 10, color: { argb: 'FF1F3864' } },
        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
        border: commonBorderStyle,
    };
    const approvalFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB4C6E7' } };
    const fabricFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6E0B4' } };
    const greyFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };

    const gHead = logSheet.getRow(L_START + 2);
    const subHead = logSheet.getRow(L_START + 3);
    gHead.height = 24;
    subHead.height = 22;

    ['Sl. No', 'Sheet No', 'Drawing Title'].forEach((label, idx) => {
        const col = idx + 1;
        gHead.getCell(col).value = label;
        gHead.getCell(col).style = { ...cHeadStyle, fill: greyFill };
        subHead.getCell(col).value = label;
        subHead.getCell(col).style = { ...cHeadStyle, fill: greyFill };
        logSheet.mergeCells(L_START + 2, col, L_START + 3, col);
    });

    let curCol = 4;

    if (alphaRevs.length > 0) {
        gHead.getCell(curCol).value = 'Sent for Approval';
        if (alphaRevs.length > 1) logSheet.mergeCells(L_START + 2, curCol, L_START + 2, curCol + alphaRevs.length - 1);
        for (let i = 0; i < alphaRevs.length; i++) gHead.getCell(curCol + i).style = { ...cHeadStyle, fill: approvalFill };
        alphaRevs.forEach(r => {
            subHead.getCell(curCol).value = `Rev ${r}`;
            subHead.getCell(curCol).style = { ...cHeadStyle, fill: approvalFill };
            logSheet.getColumn(curCol).width = 14;
            curCol++;
        });
    }

    if (numRevs.length > 0) {
        gHead.getCell(curCol).value = 'Sent for Fabrication';
        if (numRevs.length > 1) logSheet.mergeCells(L_START + 2, curCol, L_START + 2, curCol + numRevs.length - 1);
        for (let i = 0; i < numRevs.length; i++) gHead.getCell(curCol + i).style = { ...cHeadStyle, fill: fabricFill };
        numRevs.forEach(r => {
            subHead.getCell(curCol).value = `Rev ${r}`;
            subHead.getCell(curCol).style = { ...cHeadStyle, fill: fabricFill };
            logSheet.getColumn(curCol).width = 14;
            curCol++;
        });
    }

    const sIdx = curCol;
    gHead.getCell(sIdx).value = 'Remarks';
    gHead.getCell(sIdx).style = { ...cHeadStyle, fill: greyFill };
    subHead.getCell(sIdx).value = 'Remarks';
    subHead.getCell(sIdx).style = { ...cHeadStyle, fill: greyFill };
    logSheet.mergeCells(L_START + 2, sIdx, L_START + 3, sIdx);

    logSheet.getColumn(1).width = 10;
    logSheet.getColumn(2).width = 22;
    logSheet.getColumn(3).width = 45;
    logSheet.getColumn(sIdx).width = 40;

    logSheet.views = [{ state: 'frozen', ySplit: L_START + 3 }];

    // ── DRAWINGS section label ──────────────────────────────
    const fRowL = logSheet.addRow(['DRAWINGS']);
    const rNum = fRowL.number;
    fRowL.height = 22;
    fRowL.getCell(1).style = {
        font: { bold: true, size: 11, color: { argb: 'FF000000' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }, // Yellow background
        alignment: { horizontal: 'center', vertical: 'middle' },
        border: commonBorderStyle,
    };
    logSheet.mergeCells(rNum, 1, rNum, totalCols);
    for (let i = 1; i <= totalCols; i++) {
        fRowL.getCell(i).border = commonBorderStyle;
        if (i > 1) fRowL.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    }

    let logSlNo = 1;

    // Sort all drawings by drawing number
    const sorted = [...drawings].sort((a, b) =>
        (a.drawingNumber || '').localeCompare(b.drawingNumber || '', undefined, { numeric: true, sensitivity: 'base' })
    );

    sorted.forEach(d => {
        // Build revMap: normalizedRevision → date (from this drawing's revisionHistory)
        const revMap = {};
        const allRemarks = new Set();

        (d.revisionHistory || []).forEach(rh => {
            if (rh.revision) {
                const revKey = String(rh.revision).toUpperCase().trim();
                revMap[revKey] = rh.date || '';
            }
            if (rh.remarks) {
                allRemarks.add(rh.remarks.toUpperCase().trim());
            }
        });

        // Fallback description from root drawing if remarks are empty
        if (allRemarks.size === 0 && d.description) {
            allRemarks.add(d.description.toUpperCase().trim());
        }

        let combinedRemarks = Array.from(allRemarks).join(' / ');

        const rowData = [logSlNo++, d.drawingNumber, d.drawingTitle];
        alphaRevs.forEach(r => rowData.push(revMap[r] || ''));
        numRevs.forEach(r => rowData.push(revMap[r] || ''));
        rowData.push(combinedRemarks); // Remarks column

        const rDataL = logSheet.addRow(rowData);
        rDataL.height = 22;
        rDataL.eachCell((cell, colNum) => {
            cell.border = commonBorderStyle;
            cell.alignment = {
                vertical: 'middle',
                horizontal: (colNum === 3 || colNum === sIdx) ? 'left' : 'center',
                wrapText: true,
            };
        });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const safeProjectName = projectName.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const filename = `${safeProjectName}_Drawing_Log.xlsx`;

    return { buffer, filename };
}

module.exports = { generateTransmittalExcel, generateDrawingLogExcel };
