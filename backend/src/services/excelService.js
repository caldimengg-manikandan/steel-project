/**
 * ============================================================
 * Excel Generation Service
 * ============================================================
 * Generates or appends to a project-scoped Excel workbook
 * using ExcelJS.  Each project gets one Excel file.
 * New rows are appended; header row is only written once.
 *
 * Output path:  uploads/excel/<projectId>_drawings.xlsx
 */
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
// Shared revision-priority helper (fabrication beats approval)
const { pickLatestRevision } = require('./transmittalService');

const EXCEL_DIR = path.join(__dirname, '../../uploads/excel');

// Dynamic logo path — works on any machine regardless of username
const LOGO_PATH = path.join(__dirname, '../../../frontend/src/assets/excel_im/excel_img.png');

// Ensure directory exists
if (!fs.existsSync(EXCEL_DIR)) {
    fs.mkdirSync(EXCEL_DIR, { recursive: true });
}

const COLUMNS = [
    { header: 'Sl. No.', key: 'slNo', width: 8 },
    { header: 'Sheet No.', key: 'drawingNumber', width: 22 },
    { header: 'Drawing Title', key: 'drawingTitle', width: 45 },
    { header: 'Revision Mark', key: 'revision', width: 14 },
    { header: 'Date', key: 'date', width: 16 },
    { header: 'Remarks', key: 'remarks', width: 40 },
    { header: 'Original Filename', key: 'fileName', width: 30 }, // Added for clarity
];

const HEADER_STYLE = {
    font: { bold: true, color: { argb: 'FF000000' }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
    alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
    border: {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
    },
};

const SUB_HEADER_STYLE = {
    font: { bold: true, color: { argb: 'FF000000' }, size: 12 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }, // Yellow
    alignment: { vertical: 'middle', horizontal: 'center' },
    border: {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
    },
};

const ALT_ROW_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FA' } };

/**
 * appendToProjectExcel
 * ─────────────────────
 * Appends one row to the project's Excel workbook.
 * Creates the file with styled headers if it doesn't exist.
 *
 * @param {string} projectId
 * @param {object} row - Fields to write (see COLUMNS keys)
 * @returns {string} absolute path to the Excel file
 */
async function appendToProjectExcel(projectId, row) {
    return appendRowsToProjectExcel(projectId, [row]);
}

/**
 * appendRowsToProjectExcel
 * ───────────────────────
 * Appends multiple rows to the project's Excel workbook in one pass.
 *
 * @param {string} projectId
 * @param {Array<object>} rows - List of objects with fields from COLUMNS
 * @returns {string} absolute path to the Excel file
 */
async function appendRowsToProjectExcel(projectId, rows) {
    if (!rows || rows.length === 0) return null;
    const filePath = path.join(EXCEL_DIR, `${projectId}_drawings.xlsx`);
    console.log(`[ExcelService] Batch saving ${rows.length} rows for project ${projectId}`);

    try {
        const workbook = new ExcelJS.Workbook();
        let worksheet;

        if (fs.existsSync(filePath)) {
            await workbook.xlsx.readFile(filePath);
            worksheet = workbook.getWorksheet('Drawing Log');
            if (!worksheet) {
                worksheet = workbook.addWorksheet('Drawing Log');
                _applyHeaders(worksheet);
            } else {
                worksheet.columns = COLUMNS;
            }
        } else {
            workbook.creator = 'Steel Detailing DMS';
            worksheet = workbook.addWorksheet('Drawing Log');
            _applyHeaders(worksheet);
        }

        // Sl. No. Calculation
        const startSlNo = worksheet.rowCount - 1;

        rows.forEach((row, index) => {
            const slNo = startSlNo + index;
            worksheet.addRow({
                slNo: slNo > 0 ? slNo : 1,
                drawingNumber: row.drawingNumber || '',
                drawingTitle: row.drawingTitle || row.drawingDescription || '',
                revision: row.revision || '',
                date: row.date || '',
                remarks: row.remarks || '',
                fileName: row.fileName || '',
            });

            // Style the new row
            const newRow = worksheet.lastRow;
            newRow.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' }, bottom: { style: 'thin' },
                    left: { style: 'thin' }, right: { style: 'thin' },
                };
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            });
        });

        await workbook.xlsx.writeFile(filePath);
        console.log(`[ExcelService] ✓ Excel updated: ${projectId}`);
        return filePath;
    } catch (err) {
        console.error(`[ExcelService] CRITICAL Error writing Excel for ${projectId}:`, err);
        throw err;
    }
}

function _applyHeaders(worksheet) {
    worksheet.columns = COLUMNS;

    // Header Row (Row 1)
    const headerRow = worksheet.getRow(1);
    headerRow.height = 30;
    headerRow.eachCell((cell) => {
        cell.style = HEADER_STYLE;
    });

    // Sub-Header Row (Row 2): SHOP DRAWING
    worksheet.addRow(['SHOP DRAWING', '', '', '', '', '', '']);
    worksheet.mergeCells(`A2:G2`); // Merge across all columns including Sl. No.
    const subHeaderRow = worksheet.getRow(2);
    subHeaderRow.height = 25;

    // Style the primary merged cell (A2)
    const subCell = subHeaderRow.getCell(1);
    subCell.style = SUB_HEADER_STYLE;

    // Subheader row doesn't need borders on individual cells since it's merged,
    // but ExcelJS sometimes needs the style applied to the row for continuity.
    subHeaderRow.eachCell((cell) => { cell.style = SUB_HEADER_STYLE; });

    // Freeze header + subheader
    worksheet.views = [{ state: 'frozen', ySplit: 2 }];
}

// ─────────────────────────────────────────────────────────────
// Section / group header styles for the Drawing Log sheet
// ─────────────────────────────────────────────────────────────
const SECTION_APPROVAL_STYLE = {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } }, // Blue
    alignment: { vertical: 'middle', horizontal: 'center' },
    border: {
        top: { style: 'medium' }, bottom: { style: 'medium' },
        left: { style: 'medium' }, right: { style: 'medium' },
    },
};

const SECTION_FABRICATION_STYLE = {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } }, // Green
    alignment: { vertical: 'middle', horizontal: 'center' },
    border: {
        top: { style: 'medium' }, bottom: { style: 'medium' },
        left: { style: 'medium' }, right: { style: 'medium' },
    },
};

const SECTION_OTHER_STYLE = {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6A1B9A' } }, // Purple
    alignment: { vertical: 'middle', horizontal: 'center' },
    border: {
        top: { style: 'medium' }, bottom: { style: 'medium' },
        left: { style: 'medium' }, right: { style: 'medium' },
    },
};

const COL_COUNT = 7; // Sl.No + Sheet No + Title + Rev + Date + Remarks + Filename

/**
 * generateProjectExcel
 * ────────────────────────────────────────────────────────────
 * Builds a fresh multi-sheet Excel from the supplied rows array.
 * Returns the workbook buffer (Buffer) directly — the caller is
 * responsible for sending it to the client.
 *
 * Sheet 1 — "Drawing Log"
 *   • Sections: "Issued for Approval" and "Issued for Fabrication"
 *     (plus "Other" for rows that don't match either).
 *   • Each section has a coloured header row followed by numbered data rows.
 *
 * Sheet 2 — "Extraction Data"
 *   • Flat list of every completed extraction row (same as before).
 *
 * @param {Array<object>} rows  — completed extraction records from MongoDB (.lean())
 * @param {string}        projectName  — used in the title cell
 * @returns {Promise<Buffer>}
 */
async function generateProjectExcel(rows, projectDetails, type) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Caldim Steel Detailing DMS';
    workbook.created = new Date();

    const projectName = typeof projectDetails === 'object' ? projectDetails.projectName || 'Project' : projectDetails || 'Project';
    const clientName = typeof projectDetails === 'object' ? projectDetails.clientName || 'UNKNOWN' : 'UNKNOWN';
    const transmittalNo = typeof projectDetails === 'object' ? (projectDetails.transmittalNo || 1) : 1;

    const today = new Date();
    const formattedDate = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;

    // ── Shared Helper Functions ───────────────────────────────
    // Use fabrication-priority selection: numeric (0,1,2…) beats alpha (A,B,C…)
    function getLatestDate(f) {
        if (f.revisionHistory && Array.isArray(f.revisionHistory) && f.revisionHistory.length > 0) {
            const latest = pickLatestRevision(f.revisionHistory);
            return latest.date || '';
        }
        return f.date || '';
    }

    function getLatestRev(f) {
        if (f.revisionHistory && Array.isArray(f.revisionHistory) && f.revisionHistory.length > 0) {
            const latest = pickLatestRevision(f.revisionHistory);
            return latest.mark || latest.revision || '';
        }
        return f.revision || '';
    }

    const commonBorderStyle = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' }
    };

    function getLatestRemarks(f) {
        if (f.revisionHistory && Array.isArray(f.revisionHistory) && f.revisionHistory.length > 0) {
            const latest = pickLatestRevision(f.revisionHistory);
            return latest.remarks || '';
        }
        return f.remarks || '';
    }

    // ═══════════════════════════════════════════════════════════
    // SHEET 1  —  Transmittal
    // ═══════════════════════════════════════════════════════════
    if (!type || type === 'transmittal') {
        const trSheet = workbook.addWorksheet('Transmittal');

        // ── Caldim Logo (dynamic path) ────────────────────────
        try {
            if (fs.existsSync(LOGO_PATH)) {
                const imageId = workbook.addImage({ filename: LOGO_PATH, extension: 'png' });
                // Place logo in rows 1-6 (6 row tall banner)
                trSheet.addImage(imageId, { tl: { col: 0, row: 0 }, br: { col: 5, row: 6 } });
            }
        } catch (err) { console.error('[ExcelService] Logo error:', err.message); }

        // Row heights for logo area spacer
        for (let r = 1; r <= 6; r++) trSheet.getRow(r).height = 18;

        const T_START = 8; // Info rows start at row 8 (row 7 = spacer)
        trSheet.getRow(7).height = 6; // thin spacer below logo

        const greenFontStyle = { font: { bold: true, size: 12, color: { argb: 'FF00B050' } } };

        // Row 8: PROJECT NAME  |  TRANSMITTAL NO
        const r1 = trSheet.getRow(T_START);
        r1.height = 22;
        r1.getCell(1).value = `PROJECT NAME : ${projectName.toUpperCase()}`;
        r1.getCell(1).style = greenFontStyle;
        trSheet.mergeCells(T_START, 1, T_START, 3);
        r1.getCell(4).value = `TRANSMITTAL NO: TR-${String(transmittalNo).padStart(3, '0')}`;
        r1.getCell(4).style = { ...greenFontStyle, alignment: { horizontal: 'right' } };
        trSheet.mergeCells(T_START, 4, T_START, 6);

        // Row 9: FABRICATOR  |  DATE
        const r2 = trSheet.getRow(T_START + 1);
        r2.height = 22;
        r2.getCell(1).value = `FABRICATOR   : ${clientName.toUpperCase()}`;
        r2.getCell(1).style = greenFontStyle;
        trSheet.mergeCells(T_START + 1, 1, T_START + 1, 3);
        r2.getCell(4).value = `DATE: ${formattedDate}`;
        r2.getCell(4).style = { ...greenFontStyle, alignment: { horizontal: 'right' } };
        trSheet.mergeCells(T_START + 1, 4, T_START + 1, 6);

        // Spacer row
        trSheet.getRow(T_START + 2).height = 8;

        // ── Column Header Rows (T_START+3 and T_START+4) ──────
        const trH1 = trSheet.getRow(T_START + 3);
        const trH2 = trSheet.getRow(T_START + 4);
        trH1.height = 24; trH2.height = 22;

        const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }; // light blue
        const headerStyle = {
            font: { bold: true, size: 10, color: { argb: 'FF1F3864' } },
            fill: headerFill,
            alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
            border: commonBorderStyle
        };

        // Determine Header label based on revisions (Numeric = Fabrication, Alpha = Approval)
        let hasFabrication = false;
        rows.forEach(r => {
            const f = r.extractedFields || {};
            const rev = (f.revision || '').trim();
            if (rev && !isNaN(parseInt(rev, 10))) hasFabrication = true;
        });
        const headerLabel = hasFabrication ? 'Sent for Fabrication' : 'Sent for Approval';

        // Row 1 of header: Sl.No | Sheet No. | Drawing Title | [Dynamic Header] | Revision History
        trH1.getCell(1).value = 'Sl. No.';
        trH1.getCell(2).value = 'Sheet No.';
        trH1.getCell(3).value = 'Drawing Title';
        trH1.getCell(4).value = headerLabel;
        trSheet.mergeCells(T_START + 3, 4, T_START + 3, 5); // D-E merge for header
        trH1.getCell(6).value = 'Revision History';

        // Row 2 of header: sub-labels for fabrication/approval cols
        trH2.getCell(4).value = 'REV#';
        trH2.getCell(5).value = 'DATE';

        // Vertical merges for non-split columns
        trSheet.mergeCells(T_START + 3, 1, T_START + 4, 1);
        trSheet.mergeCells(T_START + 3, 2, T_START + 4, 2);
        trSheet.mergeCells(T_START + 3, 3, T_START + 4, 3);
        trSheet.mergeCells(T_START + 3, 6, T_START + 4, 6);

        // Apply header style to all header cells
        [trH1, trH2].forEach(r => {
            for (let i = 1; i <= 6; i++) { r.getCell(i).style = headerStyle; }
        });

        // Column widths (6 columns)
        trSheet.getColumn(1).width = 12;   // Sl. No.
        trSheet.getColumn(2).width = 22;   // Sheet No.
        trSheet.getColumn(3).width = 50;   // Drawing Title
        trSheet.getColumn(4).width = 18;   // REV#
        trSheet.getColumn(5).width = 18;   // DATE
        trSheet.getColumn(6).width = 40;   // Revision History

        trSheet.views = [{ state: 'frozen', ySplit: T_START + 4 }];

        // ── Data rows grouped by folder ───────────────────────
        const folderGroups = {};
        rows.forEach(r => {
            const fName = r.folderName || 'DETAIL SHEETS';
            if (!folderGroups[fName]) folderGroups[fName] = [];
            folderGroups[fName].push(r);
        });

        // Sort folders alphabetically, then sort drawings within each folder by drawingNumber
        const sortedFolderNames = Object.keys(folderGroups).sort((a, b) => a.localeCompare(b));
        sortedFolderNames.forEach(folder => {
            folderGroups[folder].sort((a, b) => {
                const aNum = (a.extractedFields && a.extractedFields.drawingNumber) || a.originalFileName || '';
                const bNum = (b.extractedFields && b.extractedFields.drawingNumber) || b.originalFileName || '';
                return aNum.localeCompare(bNum, undefined, { numeric: true, sensitivity: 'base' });
            });
        });

        let tSlno = 1;

        sortedFolderNames.forEach(folder => {
            // Folder header row — Yellow highlight (subfolder section header)
            const fRow = trSheet.addRow(['']);
            const rNum = fRow.number;
            fRow.height = 22;
            fRow.getCell(1).value = folder.toUpperCase();
            fRow.getCell(1).style = {
                font: { bold: true, size: 11, color: { argb: 'FF000000' } },
                fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } },
                alignment: { horizontal: 'center', vertical: 'middle' },
                border: commonBorderStyle
            };
            trSheet.mergeCells(rNum, 1, rNum, 6);
            for (let i = 1; i <= 6; i++) {
                fRow.getCell(i).border = commonBorderStyle;
                if (i > 1) fRow.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
            }

            folderGroups[folder].forEach(r => {
                const f = r.extractedFields || {};
                const rData = trSheet.addRow([
                    tSlno++,
                    f.drawingNumber || '',
                    f.drawingTitle || f.drawingDescription || r.originalFileName || '',
                    getLatestRev(f),
                    getLatestDate(f),
                    getLatestRemarks(f)
                ]);
                rData.height = 22;
                rData.eachCell((cell, colNum) => {
                    cell.border = commonBorderStyle;
                    cell.alignment = {
                        vertical: 'middle',
                        horizontal: (colNum === 3 || colNum === 6) ? 'left' : 'center',
                        wrapText: true
                    };
                });
            });
        });
    }

    // ═══════════════════════════════════════════════════════════
    // SHEET 2  —  Drawing Log
    // ═══════════════════════════════════════════════════════════
    if (!type || type === 'log') {
        const logSheet = workbook.addWorksheet('Drawing Log');

        // ── Caldim Logo (dynamic path) ────────────────────────
        try {
            if (fs.existsSync(LOGO_PATH)) {
                const imageId = workbook.addImage({ filename: LOGO_PATH, extension: 'png' });
                // Scale logo to top left, roughly spanning A and C columns
                logSheet.addImage(imageId, { tl: { col: 0, row: 0 }, br: { col: 2, row: 5 } });
            }
        } catch (err) { console.error('[ExcelService] Logo error:', err.message); }

        for (let r = 1; r <= 6; r++) logSheet.getRow(r).height = 18;
        logSheet.getRow(7).height = 6; // thin spacer

        const L_START = 8;

        // ── Gather all revisions to build dynamic columns ─────
        const allRevsSet = new Set();
        rows.forEach(r => {
            const f = r.extractedFields || {};
            const revHist = f.revisionHistory && Array.isArray(f.revisionHistory) && f.revisionHistory.length > 0
                ? f.revisionHistory
                : [{ mark: f.revision }];
            revHist.forEach(hist => {
                if (hist.mark !== undefined && hist.mark !== null && hist.mark !== '') {
                    allRevsSet.add(String(hist.mark).toUpperCase().trim());
                }
            });
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

        const totalRevs = alphaRevs.length + numRevs.length;
        const totalCols = Math.max(3 + totalRevs + 1, 4);

        // ── Row L_START: Title bar ─────────────────────────────
        const titleRow = logSheet.getRow(L_START);
        titleRow.height = 28;
        titleRow.getCell(1).value = 'OUTGOING DRAWING LOG SHEET';
        titleRow.getCell(1).style = {
            font: { bold: true, size: 14, color: { argb: 'FF000000' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },
            alignment: { vertical: 'middle', horizontal: 'center' },
            border: commonBorderStyle
        };
        logSheet.mergeCells(L_START, 1, L_START, totalCols);

        // ── Row L_START+1: Project Name + Client Name ──────────
        const projRow = logSheet.getRow(L_START + 1);
        projRow.height = 24;
        const projMidCol = Math.ceil(totalCols / 2);

        projRow.getCell(1).value = `Project Name : ${projectName}`;
        projRow.getCell(1).style = { font: { bold: true, size: 11 }, alignment: { vertical: 'middle', horizontal: 'left' }, border: commonBorderStyle };
        logSheet.mergeCells(L_START + 1, 1, L_START + 1, projMidCol);

        projRow.getCell(projMidCol + 1).value = `Client : ${clientName}`;
        projRow.getCell(projMidCol + 1).style = { font: { bold: true, size: 11 }, alignment: { vertical: 'middle', horizontal: 'left' }, border: commonBorderStyle };
        logSheet.mergeCells(L_START + 1, projMidCol + 1, L_START + 1, totalCols);

        // ── Rows L_START+2 & +3: Group + Sub Headers ──────────
        const cHeadStyle = { font: { bold: true, size: 10, color: { argb: 'FF1F3864' } }, alignment: { vertical: 'middle', horizontal: 'center', wrapText: true }, border: commonBorderStyle };
        const approvalFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB4C6E7' } };
        const fabricFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6E0B4' } };
        const greyFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };

        const gHead = logSheet.getRow(L_START + 2);
        const subHead = logSheet.getRow(L_START + 3);
        gHead.height = 24; subHead.height = 22;

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

        // Group rows per drawing number to consolidate revision data into one row per drawing
        const groupDwg = {};
        rows.forEach(r => {
            const f = r.extractedFields || {};
            const dNum = f.drawingNumber || 'UNKNOWN';

            if (!groupDwg[dNum]) {
                groupDwg[dNum] = {
                    drawingNumber: dNum,
                    drawingTitle: f.drawingTitle || f.drawingDescription || r.originalFileName || '',
                    revisions: [],
                    remarks: []
                };
            }

            const revHist = f.revisionHistory && Array.isArray(f.revisionHistory) && f.revisionHistory.length > 0
                ? f.revisionHistory
                : [{ mark: f.revision, date: f.date, remarks: f.remarks }];

            revHist.forEach(hist => {
                if (hist.mark !== undefined && hist.mark !== null && hist.mark !== '') {
                    groupDwg[dNum].revisions.push({
                        mark: String(hist.mark).toUpperCase().trim(),
                        date: hist.date || '',
                        remarks: hist.remarks || ''
                    });
                }
            });

            if (f.remarks) groupDwg[dNum].remarks.push(f.remarks.toUpperCase().trim());
        });

        // Sort alphabetically by drawing number
        const dwgsList = Object.values(groupDwg).sort((a, b) =>
            a.drawingNumber.localeCompare(b.drawingNumber, undefined, { numeric: true, sensitivity: 'base' })
        );

        dwgsList.forEach(d => {
            const revMap = {};
            d.revisions.forEach(rev => { if (rev.mark) revMap[rev.mark] = rev.date; });

            let combinedRemarks = Array.from(new Set(d.remarks.filter(Boolean))).join(' / ');

            const rowData = [logSlNo++, d.drawingNumber, d.drawingTitle];
            alphaRevs.forEach(r => rowData.push(revMap[r] || ''));
            numRevs.forEach(r => rowData.push(revMap[r] || ''));
            rowData.push(combinedRemarks);

            const rDataL = logSheet.addRow(rowData);
            rDataL.height = 22;

            // Highlight in grey if it ONLY went for fabrication (numeric revs only, no letters)
            const hasAlphaRev = alphaRevs.some(revMark => revMap[revMark]);
            const hasNumRev = numRevs.some(revMark => revMap[revMark]);
            const isOnlyFabLog = hasNumRev && !hasAlphaRev;

            rDataL.eachCell((cell, colNum) => {
                cell.border = commonBorderStyle;
                cell.alignment = {
                    vertical: 'middle',
                    horizontal: (colNum === 3 || colNum === sIdx) ? 'left' : 'center',
                    wrapText: true
                };

                // Highlight ONLY the specific revision cell if it went only for fabrication
                const numStart = 4 + alphaRevs.length;
                const numEnd = 3 + alphaRevs.length + numRevs.length;
                const isNumCol = colNum >= numStart && colNum <= numEnd;

                if (isOnlyFabLog && isNumCol && cell.value) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFECECEC' } // Light Grey
                    };
                }
            });
        });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const safeProjectName = projectName.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const filename = type === 'log' ? `${safeProjectName}_Drawing_Log.xlsx` : `${safeProjectName}_Transmittal.xlsx`;
    return { buffer, filename };
}

/**
 * getProjectExcelPath
 * Returns the path if an Excel file exists for this project.
 */
function getProjectExcelPath(projectId) {
    const p = path.join(EXCEL_DIR, `${projectId}_drawings.xlsx`);
    return fs.existsSync(p) ? p : null;
}

/**
 * generateProjectStatusExcel
 * ─────────────────────────────────────────────────────────────
 * Builds an Excel workbook containing the status of all projects.
 * Each project occupies one row with drawing counts, revision stats,
 * and the project's overall status.
 *
 * @param {Array<object>} projectsData  — array of project objects with aggregated stats
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
async function generateProjectStatusExcel(projectsData) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Caldim Steel Detailing DMS';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Project Status');

    const today = new Date();
    const formattedDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

    // ── Logo ──────────────────────────────────────────────────
    try {
        if (fs.existsSync(LOGO_PATH)) {
            const imageId = workbook.addImage({ filename: LOGO_PATH, extension: 'png' });
            // Logo from A1 to E5
            sheet.addImage(imageId, { tl: { col: 0, row: 0 }, br: { col: 5, row: 5 } });
        }
    } catch (err) { console.error('[ExcelService] Logo error:', err.message); }

    // Space for logo (rows 1-5)
    for (let r = 1; r <= 5; r++) sheet.getRow(r).height = 18;
    sheet.getRow(6).height = 6; // Thin spacer

    // ── Pink Brand Header ──────────────────────────────────────
    const brandRow = sheet.getRow(7);
    brandRow.height = 32;
    const brandCell = brandRow.getCell(1);
    brandCell.value = 'CALDIM ENGINEERING PVT LTD - PROJECT STATUS (Chennai & Hosur)';
    brandCell.style = {
        font: { bold: true, size: 14, color: { argb: 'FF000000' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF9999' } }, // Pinkish
        alignment: { vertical: 'middle', horizontal: 'center' },
        border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
    };
    sheet.mergeCells(7, 1, 7, 14); // Merge across all 14 columns

    // ── Date row (Generated on) ──────────────────────────────
    const dateRow = sheet.getRow(8);
    dateRow.height = 20;
    const dateCell = dateRow.getCell(11); // Over PM/Approval area
    dateCell.value = `Generated On: ${formattedDate}`;
    dateCell.style = {
        font: { italic: true, size: 9, color: { argb: 'FF555555' } },
        alignment: { vertical: 'middle', horizontal: 'right' }
    };
    sheet.mergeCells(8, 11, 8, 14); 

    sheet.getRow(10).height = 28; // spacer before headers

    // ── Column Headers (Row 10) ───────────────────────────────
    const COLS = [
        { header: 'CDE#', key: 'cdeNo', width: 10 },
        { header: 'Branch', key: 'branch', width: 15 },
        { header: 'FABRICATOR', key: 'fabricator', width: 22 },
        { header: 'DIVISION', key: 'division', width: 15 },
        { header: 'FAB%', key: 'fab', width: 10 },
        { header: 'PROJECT NAME', key: 'projectName', width: 45 },
        { header: 'CLIENT CONTACT', key: 'clientContact', width: 35 },
        { header: 'CALDIM PM', key: 'pm', width: 20 },
        { header: 'APPROVAL STATUS', key: 'approvalStatus', width: 20 },
        { header: 'RFI STATUS', key: 'rfiStatus', width: 25 },
        { header: 'FAB STATUS', key: 'fabStatus', width: 20 },
        { header: 'Approved CO', key: 'approvedCo', width: 12 },
        { header: 'PENDING CO', key: 'pendingCo', width: 12 },
        { header: 'DECLINED CO', key: 'declinedCo', width: 12 },
    ];

    // Only set keys and widths to avoid ExcelJS automatically writing headers to Row 1
    sheet.columns = COLS.map(c => ({ key: c.key, width: c.width }));

    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }; // Yellow
    const headerStyle = {
        font: { bold: true, size: 9, color: { argb: 'FF000000' } },
        fill: headerFill,
        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
        border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
    };

    const headerRow = sheet.getRow(10);
    headerRow.height = 28;
    COLS.forEach((col, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = col.header;
        cell.style = headerStyle;
    });

    // ── Status label map ──────────────────────────────────────
    const STATUS_LABEL = { active: 'Active', on_hold: 'On Hold', completed: 'Completed', archived: 'Archived' };
    const STATUS_COLOR = { active: 'FF00B050', on_hold: 'FFFFC000', completed: 'FF0070C0', archived: 'FF7F7F7F' };

    // ── Data rows ─────────────────────────────────────────────
    const commonBorder = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' }
    };

    projectsData.forEach((proj, idx) => {
        const approx = proj.approximateDrawingsCount || 0;
        let approvalPercentage = 0;
        let fabricationPercentage = 0;
        if (approx > 0) {
            approvalPercentage = Math.round(((proj.approvalCount || 0) / approx) * 100);
            fabricationPercentage = Math.round(((proj.fabricationCount || 0) / approx) * 100);
        }

        const dataRow = sheet.addRow({
            cdeNo: '', // Placeholder
            branch: '', // Placeholder
            fabricator: '', // Placeholder
            division: '', // Placeholder
            fab: '', // Was fabricationPercentage
            projectName: proj.name || '',
            clientContact: proj.clientName || '',
            pm: '', // Placeholder
            approvalStatus: `${approvalPercentage}%`,
            rfiStatus: `Open: ${proj.openRfiCount || 0}, Closed: ${proj.closedRfiCount || 0}`,
            fabStatus: STATUS_LABEL[proj.status] || proj.status || '',
            approvedCo: '',
            pendingCo: '',
            declinedCo: '',
        });
        dataRow.height = 25; // Increased height to fit wrapped text if any
        dataRow.eachCell((cell, colNum) => {
            cell.border = commonBorder;
            // Project Name and Client Contact are columns 6 and 7
            cell.alignment = { vertical: 'middle', horizontal: (colNum === 6 || colNum === 7) ? 'left' : 'center', wrapText: true };
        });

        // Color-code the Fab Status cell (column 11)
        const statusCell = dataRow.getCell(11);
        const statusColor = STATUS_COLOR[proj.status] || 'FF000000';
        statusCell.font = { bold: true, color: { argb: statusColor }, size: 9 };

        // Alternate row background
        if (idx % 2 === 1) {
            dataRow.eachCell((cell, colNum) => {
                if (colNum !== 11) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
                }
            });
        }
    });

    // ── Freeze header ─────────────────────────────────────────
    sheet.views = [{ state: 'frozen', ySplit: 10 }];

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `Project_Status_Report_${formattedDate.replace(/\//g, '-')}.xlsx`;
    return { buffer, filename };
}

module.exports = {
    appendToProjectExcel,
    appendRowsToProjectExcel,
    getProjectExcelPath,
    generateProjectExcel,
    generateProjectStatusExcel,
    EXCEL_DIR,
};
