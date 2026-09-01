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

const LOGO_DEFAULT = path.join(__dirname, '../../../frontend/src/assets/excel_im/excel_img.png');

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
async function generateTransmittalExcel(transmittal, projectDetails, logoPath) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Caldim Steel Detailing DMS';
    workbook.created = new Date();

    const { projectName = 'Project', clientName = 'CLIENT', transmittalNo } = projectDetails;
    const trNum = transmittalNo || transmittal.transmittalNumber || 1;

    const today = new Date();
    const formattedDate = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;

    const trSheet = workbook.addWorksheet(`Transmittal TR-${String(trNum).padStart(3, '0')}`);

    // ── 1. Logo Banner (Col A to F, Rows 1 to 6) ──────────────────
    try {
        let finalLogo = logoPath ? path.join(__dirname, '../../', logoPath.replace(/^\//, '')) : LOGO_DEFAULT;
        if (!finalLogo || !fs.existsSync(finalLogo) || !fs.statSync(finalLogo).isFile()) {
            finalLogo = LOGO_DEFAULT;
        }
        if (fs.existsSync(finalLogo)) {
            const extension = finalLogo.toLowerCase().endsWith('.png') ? 'png' : finalLogo.toLowerCase().endsWith('.jpeg') || finalLogo.toLowerCase().endsWith('.jpg') ? 'jpeg' : 'png';
            const imageId = workbook.addImage({ filename: finalLogo, extension });
            trSheet.addImage(imageId, { tl: { col: 0, row: 0 }, br: { col: 6, row: 6 } });
            trSheet.mergeCells('A1:F6');
            trSheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        }
    } catch (err) { console.error('[TransmittalExcel] Logo error:', err.message); }

    for (let r = 1; r <= 6; r++) trSheet.getRow(r).height = 18;
    trSheet.getRow(7).height = 8;

    const greenFontStyle = { font: { bold: true, size: 11, color: { argb: 'FF00B050' } } };

    // ── 2. Row 8: PROJECT NAME | TRANSMITTAL NO ──
    const r1 = trSheet.getRow(8);
    r1.height = 22;
    r1.getCell(1).value = `PROJECT NAME : ${projectName.toUpperCase()}`;
    r1.getCell(1).style = greenFontStyle;
    trSheet.mergeCells(8, 1, 8, 3);

    r1.getCell(5).value = `TRANSMITTAL NO: TR-${String(trNum).padStart(3, '0')}`;
    r1.getCell(5).style = { ...greenFontStyle, alignment: { horizontal: 'right' } };
    trSheet.mergeCells(8, 5, 8, 6);

    // ── 3. Row 9: FABRICATOR | DATE ──
    const r2 = trSheet.getRow(9);
    r2.height = 22;
    r2.getCell(1).value = `FABRICATOR  : ${clientName.toUpperCase()}`;
    r2.getCell(1).style = greenFontStyle;
    trSheet.mergeCells(9, 1, 9, 3);

    r2.getCell(5).value = `DATE: ${formattedDate}`;
    r2.getCell(5).style = { ...greenFontStyle, alignment: { horizontal: 'right' } };
    trSheet.mergeCells(9, 5, 9, 6);

    trSheet.getRow(10).height = 6;

    // ── 4. Row 11: Light Blue Table Header Row ──
    const headerStyle = {
        font: { bold: true, size: 10, color: { argb: 'FF1F3864' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } },
        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
        border: commonBorderStyle,
    };

    const H_ROW = 11;
    const headers = ['Sl. No.', 'Sheet No.', 'Drawing Title', 'REV#', 'DATE', 'Revision History'];
    const widths = [10, 20, 45, 12, 16, 35];

    const hRow = trSheet.getRow(H_ROW);
    hRow.height = 24;
    headers.forEach((h, i) => {
        const cell = hRow.getCell(i + 1);
        cell.value = h;
        cell.style = headerStyle;
        trSheet.getColumn(i + 1).width = widths[i];
    });

    trSheet.views = [{ state: 'frozen', ySplit: H_ROW }];

    // ── 5. Group Drawings by Folder (Section Headers e.g. DETAIL SHEET) ──
    const folderGroups = {};
    (transmittal.drawings || []).forEach(d => {
        const folder = d.folderName || 'DETAIL SHEET';
        if (!folderGroups[folder]) folderGroups[folder] = [];
        folderGroups[folder].push(d);
    });

    const sortedFolders = Object.keys(folderGroups).sort();
    let slNo = 1;

    sortedFolders.forEach(folder => {
        // Yellow Folder Header Row (e.g. DETAIL SHEET)
        const fRow = trSheet.addRow([folder.toUpperCase()]);
        const rNum = fRow.number;
        fRow.height = 22;
        fRow.getCell(1).style = {
            font: { bold: true, size: 11, color: { argb: 'FF000000' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } },
            alignment: { horizontal: 'center', vertical: 'middle' },
            border: commonBorderStyle,
        };
        trSheet.mergeCells(rNum, 1, rNum, 6);
        for (let i = 1; i <= 6; i++) {
            fRow.getCell(i).border = commonBorderStyle;
            if (i > 1) fRow.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
        }

        const sortedDrawings = [...folderGroups[folder]].sort((a, b) =>
            (a.drawingNumber || '').localeCompare(b.drawingNumber || '', undefined, { numeric: true, sensitivity: 'base' })
        );

        sortedDrawings.forEach(d => {
            const dataRow = trSheet.addRow([
                slNo++,
                d.drawingNumber || '',
                d.drawingTitle || '',
                d.revision || '0',
                d.date || '',
                d.remarks || (d.changeType === 'new' ? 'ISSUED FOR APPROVAL' : d.changeType === 'revised' ? 'ISSUED FOR RE-APPROVAL' : 'RE-ISSUED')
            ]);

            dataRow.height = 22;

            dataRow.eachCell((cell, colNum) => {
                cell.border = commonBorderStyle;
                cell.alignment = {
                    vertical: 'middle',
                    horizontal: (colNum === 1 || colNum === 4 || colNum === 5) ? 'center' : 'left',
                    wrapText: true,
                };
            });
        });
    });

    // Column widths
    const columnWidths = { A: 8, B: 20, C: 40, D: 10, E: 15, F: 30 };
    Object.keys(columnWidths).forEach(col => {
        trSheet.getColumn(col).width = columnWidths[col];
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
async function generateDrawingLogExcel(drawingLog, projectDetails, logoPath) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Caldim Steel Detailing DMS';
    workbook.created = new Date();

    const { projectName = 'Project', clientName = 'CLIENT' } = projectDetails;
    const drawings = drawingLog.drawings || [];

    const logSheet = workbook.addWorksheet('Drawing Log');

    // ── Logo ────────────────────────────────────────────────
    try {
        let finalLogo = logoPath ? path.join(__dirname, '../../', logoPath.replace(/^\//, '')) : LOGO_DEFAULT;
        if (!finalLogo || !fs.existsSync(finalLogo) || !fs.statSync(finalLogo).isFile()) {
            finalLogo = LOGO_DEFAULT;
        }
        console.log('[DrawingLogExcel] Attempting logo use:', { logoPath, finalLogo, exists: fs.existsSync(finalLogo) });
        if (fs.existsSync(finalLogo)) {
            const extension = finalLogo.toLowerCase().endsWith('.png') ? 'png' : finalLogo.toLowerCase().endsWith('.jpeg') || finalLogo.toLowerCase().endsWith('.jpg') ? 'jpeg' : 'png';
            const imageId = workbook.addImage({ filename: finalLogo, extension });
            // Scale logo to span C to H columns
            logSheet.addImage(imageId, { tl: { col: 2, row: 0 }, br: { col: 8, row: 5 } });
            // Merge all top cells to create a completely plain background banner
            logSheet.mergeCells('A1:Z5');
            // Fill the merged area with solid white to ensure no gridlines are shown at all
            logSheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        }
    } catch (err) { console.error('[DrawingLogExcel] Logo error:', err.message); }

    for (let r = 1; r <= 6; r++) logSheet.getRow(r).height = 18;
    logSheet.getRow(7).height = 6;

    const L_START = 8;

    const { normalizeRevision } = require('./transmittalService');

    // ── Collect all unique revision marks across all drawings ─
    const allRevsSet = new Set();
    drawings.forEach(d => {
        (d.revisionHistory || []).forEach(rh => {
            if (rh.revision) {
                const norm = normalizeRevision(rh.revision);
                if (norm) allRevsSet.add(norm);
            }
        });
        if (d.currentRevision) {
            const norm = normalizeRevision(d.currentRevision);
            if (norm) allRevsSet.add(norm);
        }
    });

    const allRevsArr = Array.from(allRevsSet);
    const alphaRevs = allRevsArr.filter(r => /^[A-Za-z]/.test(r));
    let numRevs = allRevsArr.filter(r => !/^[A-Za-z]/.test(r));

    alphaRevs.sort();

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
        // Build revMap: normalizedRevision → date / transmittalNo (from this drawing's revisionHistory)
        const revMap = {};
        const allRemarks = new Set();

        (d.revisionHistory || []).forEach(rh => {
            if (rh.revision) {
                const revKey = normalizeRevision(rh.revision);
                revMap[revKey] = rh.date || (rh.transmittalNo ? `TR-${String(rh.transmittalNo).padStart(3, '0')}` : '✓');
            }
            if (rh.remarks) {
                allRemarks.add(rh.remarks.toUpperCase().trim());
            }
        });

        // Also include the current latest revision if not already in history
        if (d.currentRevision) {
            const curRevKey = normalizeRevision(d.currentRevision);
            if (!revMap[curRevKey]) {
                revMap[curRevKey] = d.date || '✓';
            }
        }

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
