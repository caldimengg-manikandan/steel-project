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

function addLogoToSheet(sheet, lastColLetter, lastColIndex) {
  sheet.getRow(1).height = 60;
  sheet.mergeCells('A1:' + lastColLetter + '1');
  if (logoId !== null) {
    sheet.addImage(logoId, {
      tl: { col: 1, row: 0 },
      br: { col: lastColIndex, row: 1 },
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
const summary = wb.addWorksheet('SUMMARY', { pageSetup: { paperSize: 9, orientation: 'portrait' } });
summary.columns = [
  { width: 3 },  // A
  { width: 25 }, // B
  { width: 20 }, // C
  { width: 20 }, // D
  { width: 20 }, // E
  { width: 20 }, // F
  { width: 20 }, // G
  { width: 10 }, // H
  { width: 10 }, // I
  { width: 15 }, // J
  { width: 20 }, // K
  { width: 25 }, // L
];

addLogoToSheet(summary, 'L', 11);

summary.getRow(2).height = 25;
summary.mergeCells('A2:L2');
const titleCell = summary.getCell('A2');
titleCell.value = 'Weekly Project Progress Report';
titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

function addField(row, colLabel, label, colValStart, colValEnd) {
  const labelCell = summary.getCell(colLabel + row);
  labelCell.value = label;
  labelCell.alignment = { horizontal: 'right', vertical: 'bottom' };
  labelCell.font = { name: 'Calibri', size: 11, color: { argb: 'FF595959' } };
  
  if (colValStart !== colValEnd) summary.mergeCells(colValStart + row + ':' + colValEnd + row);
  const valCell = summary.getCell(colValStart + row);
  valCell.border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };
  valCell.alignment = { horizontal: 'left', vertical: 'bottom' };
  valCell.font = { name: 'Calibri', size: 11 };
}

addField(3, 'B', 'Date :', 'C', 'D');
addField(4, 'B', 'Project Name :', 'C', 'J');
addField(4, 'K', 'Project No :', 'L', 'L');
addField(5, 'B', 'Client Name :', 'C', 'J');
addField(5, 'K', 'Client Project No :', 'L', 'L');
addField(6, 'B', 'Client Address :', 'C', 'J');
addField(8, 'B', 'Client Project Manager :', 'C', 'F');
addField(9, 'B', 'Report Circulated to :', 'C', 'F');
addField(10, 'B', 'Caldim Project Manager :', 'C', 'F');
addField(11, 'B', 'Report Circulated to :', 'C', 'F');

function setupInputLines(start, end) {
  for(let i=start; i<=end; i++) {
    summary.getRow(i).height = 25;
    summary.mergeCells('B'+i+':L'+i);
    const cell = summary.getCell('B'+i);
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };
    cell.font = { name: 'Calibri', size: 11 };
    cell.alignment = { vertical: 'bottom' };
  }
}

summary.getRow(14).height = 15;
summary.mergeCells('A14:L14');
summary.getCell('A14').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };

summary.mergeCells('A15:C15');
summary.getCell('A15').value = 'Project Description';
summary.getCell('A15').font = { name: 'Calibri', size: 11, color: { argb: 'FF595959' } };
summary.getCell('A15').border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };

summary.mergeCells('A16:D16');
summary.getCell('A16').value = 'Project Type : (Residential / Commercial / Industrial / Etc..)';
summary.getCell('A16').font = { name: 'Calibri', size: 11, color: { argb: 'FF595959' } };

setupInputLines(17, 19);

summary.getRow(20).height = 15;
summary.mergeCells('A20:L20');
summary.getCell('A20').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };

summary.mergeCells('A21:D21');
summary.getCell('A21').value = 'Project Status as of Last Week';
summary.getCell('A21').font = { name: 'Calibri', size: 11, color: { argb: 'FF595959' } };
summary.getCell('A21').border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };

setupInputLines(22, 24);

summary.getRow(25).height = 15;
summary.mergeCells('A25:L25');
summary.getCell('A25').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };

summary.mergeCells('A26:D26');
summary.getCell('A26').value = 'Overall Project Approval Status';
summary.getCell('A26').font = { name: 'Calibri', size: 11, color: { argb: 'FF595959' } };
summary.getCell('A26').border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };

setupInputLines(27, 28);

summary.getRow(29).height = 15;
summary.mergeCells('A29:L29');
summary.getCell('A29').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };

summary.mergeCells('A30:D30');
summary.getCell('A30').value = 'Overall Fabrication Status';
summary.getCell('A30').font = { name: 'Calibri', size: 11, color: { argb: 'FF595959' } };
summary.getCell('A30').border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };

setupInputLines(31, 32);

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
