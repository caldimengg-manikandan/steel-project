const exceljs = require('exceljs');
const path = require('path');
const fs = require('fs');

const wb = new exceljs.Workbook();
const logoPath = 'C:/steel-project(2)/steel-project/steel-project/frontend/src/assets/excel_im/excel_img.png';
const logoExists = fs.existsSync(logoPath);
let logoId = null;
if (logoExists) {
  logoId = wb.addImage({
    filename: logoPath,
    extension: 'png',
  });
}

function addLogoToSheet(sheet, lastColLetter, lastColIndex, imgStartCol, imgEndCol) {
  sheet.getRow(1).height = 60;
  sheet.mergeCells('A1:' + lastColLetter + '1');
  if (logoId !== null) {
    sheet.addImage(logoId, {
      tl: { col: imgStartCol !== undefined ? imgStartCol : 1, row: 0 },
      br: { col: imgEndCol !== undefined ? imgEndCol : lastColIndex, row: 1 },
      editAs: 'oneCell'
    });
  }
}

function styleHeaders(sheet, headers) {
  const headerRow = sheet.getRow(2);
  headerRow.height = 30;
  headerRow.values = headers;
  
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber <= headers.length) {
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
      };
    }
  });

  // Style data rows (3 to 30) so they have borders by default
  for (let i = 3; i <= 30; i++) {
    const dataRow = sheet.getRow(i);
    dataRow.height = 20;
    for (let c = 1; c <= headers.length; c++) {
      const cell = dataRow.getCell(c);
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
      };
    }
  }
}

// --------------------- SUMMARY ---------------------
const summary = wb.addWorksheet('SUMMARY', { views: [{ showGridLines: false }], pageSetup: { paperSize: 9, orientation: 'portrait' } });
summary.columns = [
  { width: 3 },  // A - Left Margin
  { width: 3 },  // B - Left Margin for text
  { width: 25 }, // C - Labels (Date:, Project Name:)
  { width: 10 }, // D - Input start
  { width: 10 }, // E
  { width: 10 }, // F
  { width: 10 }, // G
  { width: 10 }, // H
  { width: 10 }, // I
  { width: 10 }, // J
  { width: 5 },  // K - Gap
  { width: 20 }, // L - Labels (Project No:)
  { width: 15 }, // M - Input start
  { width: 15 }, // N - Input end / Right Margin
];

addLogoToSheet(summary, 'N', 13, 3, 10);

summary.getRow(2).height = 25;
summary.mergeCells('A2:N2');
const titleCell = summary.getCell('A2');
titleCell.value = 'Weekly Project Progress Report';
titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

function addField(row, colLabel, label, colValStart, colValEnd) {
  const labelCell = summary.getCell(colLabel + row);
  labelCell.value = label;
  labelCell.alignment = { horizontal: 'right', vertical: 'bottom' };
  labelCell.font = { name: 'Calibri', size: 11, color: { argb: 'FF595959' }, italic: true };
  
  if (colValStart !== colValEnd) summary.mergeCells(colValStart + row + ':' + colValEnd + row);
  const valCell = summary.getCell(colValStart + row);
  valCell.border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };
  valCell.alignment = { horizontal: 'left', vertical: 'bottom' };
  valCell.font = { name: 'Calibri', size: 11 };
}

addField(3, 'C', 'Date :', 'D', 'E');
addField(4, 'C', 'Project Name :', 'D', 'J');
addField(4, 'L', 'Project No :', 'M', 'N');
addField(5, 'C', 'Client Name :', 'D', 'J');
addField(5, 'L', 'Client Project No :', 'M', 'N');
addField(6, 'C', 'Client Address :', 'D', 'N');
addField(8, 'C', 'Client Project Manager :', 'D', 'H');
addField(9, 'C', 'Report Circulated to :', 'D', 'H');
addField(10, 'C', 'Caldim Project Manager :', 'D', 'G');
addField(11, 'C', 'Report Circulated to :', 'D', 'G');

function setupInputLines(start, end) {
  for(let i=start; i<=end; i++) {
    summary.getRow(i).height = 25;
  }
  summary.mergeCells(`B${start}:N${end}`);
  const cell = summary.getCell(`B${start}`);
  cell.font = { name: 'Calibri', size: 11 };
  cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
}

summary.getRow(12).height = 15;
summary.mergeCells('A12:N12');
summary.getCell('A12').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };

summary.mergeCells('B13:D13');
summary.getCell('B13').value = 'Project Description';
summary.getCell('B13').font = { name: 'Calibri', size: 11, color: { argb: 'FF595959' }, italic: true };
summary.getCell('B13').border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };

summary.mergeCells('B14:E14');
summary.getCell('B14').value = 'Project Type : (Residential / Commercial / Industrial / Etc..)';
summary.getCell('B14').font = { name: 'Calibri', size: 11, color: { argb: 'FF595959' }, italic: true };

setupInputLines(15, 17);

summary.getRow(18).height = 15;
summary.mergeCells('A18:N18');
summary.getCell('A18').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };

summary.mergeCells('B19:E19');
summary.getCell('B19').value = 'Project Status as of Last Week';
summary.getCell('B19').font = { name: 'Calibri', size: 11, color: { argb: 'FF595959' }, italic: true };
summary.getCell('B19').border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };

setupInputLines(20, 22);

summary.getRow(23).height = 15;
summary.mergeCells('A23:N23');
summary.getCell('A23').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };

summary.mergeCells('B24:E24');
summary.getCell('B24').value = 'Overall Project Approval Status';
summary.getCell('B24').font = { name: 'Calibri', size: 11, color: { argb: 'FF595959' }, italic: true };
summary.getCell('B24').border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };

setupInputLines(25, 26);

summary.getRow(27).height = 15;
summary.mergeCells('A27:N27');
summary.getCell('A27').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };

summary.mergeCells('B28:E28');
summary.getCell('B28').value = 'Overall Fabrication Status';
summary.getCell('B28').font = { name: 'Calibri', size: 11, color: { argb: 'FF595959' }, italic: true };
summary.getCell('B28').border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };

setupInputLines(29, 30);

// Add outer closure (bounding box) around the SUMMARY page
for (let r = 1; r <= 30; r++) {
  const leftCell = summary.getCell('A' + r);
  const rightCell = summary.getCell('N' + r);
  
  leftCell.border = Object.assign({}, leftCell.border, { left: { style: 'medium', color: { argb: 'FF000000' } } });
  rightCell.border = Object.assign({}, rightCell.border, { right: { style: 'medium', color: { argb: 'FF000000' } } });
}

for (let c = 1; c <= 14; c++) {
  // Top border on Row 1
  const topCell = summary.getRow(1).getCell(c);
  topCell.border = Object.assign({}, topCell.border, { top: { style: 'medium', color: { argb: 'FF000000' } } });
  
  // Bottom border on Row 30
  const bottomCell = summary.getRow(30).getCell(c);
  bottomCell.border = Object.assign({}, bottomCell.border, { bottom: { style: 'medium', color: { argb: 'FF000000' } } });
}

// --------------------- SOW ---------------------
const sow = wb.addWorksheet('SOW');
addLogoToSheet(sow, 'E', 4);
sow.columns = [
  { width: 10 }, { width: 40 }, { width: 15 }, { width: 20 }, { width: 30 }
];
styleHeaders(sow, ['S.No', 'Description', 'Change', 'Received Date', 'Remarks']);

// --------------------- SCHEDULE ---------------------
const schedule = wb.addWorksheet('SCHEDULE');
addLogoToSheet(schedule, 'I', 8);
schedule.columns = [
  { width: 10 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, 
  { width: 15 }, { width: 15 }, { width: 15 }, { width: 30 }
];
styleHeaders(schedule, ['S.No', 'Seq/Area', 'Status', 'Planned IFA', 'Actual IFA', 'BFA Received', 'Planned Fab', 'Actual Fab', 'Remarks']);

// --------------------- TRANSMITTAL LOG ---------------------
const transmittal = wb.addWorksheet('TRANSMITTAL LOG');
addLogoToSheet(transmittal, 'G', 6);
transmittal.columns = [
  { width: 10 }, { width: 20 }, { width: 15 }, { width: 15 }, { width: 10 }, { width: 15 }, { width: 30 }
];
styleHeaders(transmittal, ['S.No', 'Transmittal No', 'Date', 'App/Fab', 'Sheets', 'Seq/Area', 'Remarks']);

// --------------------- RFI LOG ---------------------
const rfi = wb.addWorksheet('RFI LOG');
addLogoToSheet(rfi, 'J', 9);
rfi.columns = [
  { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, 
  { width: 15 }, { width: 15 }, { width: 30 }, { width: 15 }, { width: 30 }
];
styleHeaders(rfi, ['RFI No', 'Client RFI No', 'Status', 'Priority', 'Sent Date', 'Seq/Area', 'RFI Type', 'Description', 'Received Date', 'Remarks']);

// --------------------- CDRFI LOG ---------------------
const cdrfi = wb.addWorksheet('CDRFI LOG');
addLogoToSheet(cdrfi, 'J', 9);
cdrfi.columns = [
  { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, 
  { width: 15 }, { width: 15 }, { width: 30 }, { width: 15 }, { width: 30 }
];
styleHeaders(cdrfi, ['Caldim CDRFI No', 'Client CDRFI No', 'Status', 'Priority', 'Sent Date', 'Seq/Area', 'CDRFI Type', 'Description', 'Received Date', 'Remarks']);

wb.xlsx.writeFile(path.join(__dirname, 'src/templates/weekly_report_template.xlsx')).then(() => {
    console.log('Template created with logo on all tabs.');
});
