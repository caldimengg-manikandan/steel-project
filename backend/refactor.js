const fs = require('fs');

const content = fs.readFileSync('src/services/transmittalExcelService.js', 'utf8');

// 1. Insert resolveSowKey at the top
const resolveSowKeyCode = `
/**
 * Resolves the SOW heading from a file path using bottom-up traversal.
 */
function resolveSowKey(fullPath, validSowNames, sowPrefixes) {
    if (!fullPath) return '';
    const parts = fullPath.replace(/\\\\/g, '/').split('/');
    let detectedSow = null;
    let sowKey = '';
    
    const sortedPrefixes = Array.from(sowPrefixes).sort((a, b) => b.length - a.length);

    for (let i = parts.length - 2; i >= 0; i--) {
        const upperPart = parts[i].trim().toUpperCase();
        
        if (/^(d[\\s\\-]*sheets?|detail[\\s\\-]*sheets?|e[\\s\\-]*sheets?|erection[\\s\\-]*sheets?)$/i.test(upperPart)) {
            continue;
        }

        for (const prefix of sortedPrefixes) {
            const escapedPrefix = prefix.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
            const regex = new RegExp(\`(\${escapedPrefix}[\\\\s_#-]*\\\\d+)\`, 'i');
            const match = upperPart.match(regex);
            if (match) {
                detectedSow = match[1].trim();
                break;
            }
        }
        
        if (!detectedSow && validSowNames.length > 0) {
            if (validSowNames.some(sow => upperPart.includes(sow))) {
                detectedSow = validSowNames.find(sow => upperPart.includes(sow));
            }
        }

        if (detectedSow) {
            sowKey = upperPart;
            break;
        }
    }

    if (!sowKey && parts.length > 2) {
        const immediateParent = parts[parts.length - 2].trim().toUpperCase();
        if (!/^(d[\\s\\-]*sheets?|detail[\\s\\-]*sheets?|e[\\s\\-]*sheets?|erection[\\s\\-]*sheets?)$/i.test(immediateParent)) {
            sowKey = immediateParent;
        }
    }
    return sowKey || '';
}
`;

let newContent = content.replace("const commonBorderStyle = {", resolveSowKeyCode + "\\nconst commonBorderStyle = {");

// 2. Refactor generateTransmittalExcel to use resolveSowKey
const oldTraversal = `            for (let i = parts.length - 2; i >= 0; i--) {
                const upperPart = parts[i].trim().toUpperCase();
                
                // Skip the main folder names so we don't accidentally match them as SOWs
                if (/^(d[\\s\\-]*sheets?|detail[\\s\\-]*sheets?|e[\\s\\-]*sheets?|erection[\\s\\-]*sheets?)$/i.test(upperPart)) {
                    continue;
                }

                // Detect dynamically
                for (const prefix of sortedPrefixes) {
                    const escapedPrefix = prefix.replace(/[.*+?^\\$\\{\\}()|[\\]\\\\]/g, '\\\\$&');
                    const regex = new RegExp(\`(\${escapedPrefix}[\\\\s_#-]*\\\\d+)\`, 'i');
                    const match = upperPart.match(regex);
                    if (match) {
                        detectedSow = match[1].trim();
                        break;
                    }
                }
                
                if (!detectedSow && validSowNames.length > 0) {
                    if (validSowNames.some(sow => upperPart.includes(sow))) {
                        detectedSow = validSowNames.find(sow => upperPart.includes(sow));
                    }
                }

                if (detectedSow) {
                    sowKey = upperPart; // The SOW folder name must become the section heading
                    break;
                }
            }

            if (!sowKey && parts.length > 2) {
                // Fallback
                const immediateParent = parts[parts.length - 2].trim().toUpperCase();
                if (!/^(d[\\s\\-]*sheets?|detail[\\s\\-]*sheets?|e[\\s\\-]*sheets?|erection[\\s\\-]*sheets?)$/i.test(immediateParent)) {
                    sowKey = immediateParent;
                }
            }`;

newContent = newContent.replace(`        if (fullPath) {
            const parts = fullPath.replace(/\\\\/g, '/').split('/');
            let detectedSow = null;
            
            const sortedPrefixes = Array.from(sowPrefixes).sort((a, b) => b.length - a.length);

${oldTraversal}
        }`, "        if (fullPath) { sowKey = resolveSowKey(fullPath, validSowNames, sowPrefixes); }");

// 3. Rewrite generateDrawingLogExcel
// I will replace the entire generateDrawingLogExcel function

const drawingLogStart = newContent.indexOf('async function generateDrawingLogExcel');
const drawingLogEnd = newContent.indexOf('module.exports = {');
const drawingLogCode = newContent.substring(drawingLogStart, drawingLogEnd);

const newDrawingLogCode = `async function generateDrawingLogExcel(drawingLog, projectDetails, logoPath) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Caldim Steel Detailing DMS';
    workbook.created = new Date();

    const { projectName = 'Project', clientName = 'CLIENT' } = projectDetails;
    const drawings = drawingLog.drawings || [];
    
    const projectId = drawingLog.projectId;
    let transmittalDates = {};
    let validSowNames = [];
    let sowPrefixes = new Set(['SOW', 'SOWLO', 'AREA']);
    let extMap = {};

    if (projectId) {
        try {
            const mongoose = require('mongoose');
            const Transmittal = mongoose.models.Transmittal || require('../models/Transmittal');
            const Project = mongoose.models.Project || require('../models/Project');
            const DrawingExtraction = mongoose.models.DrawingExtraction || require('../models/DrawingExtraction');
            
            // Fetch transmittals
            const transmittals = await Transmittal.find({ projectId }, 'transmittalNumber createdAt').lean();
            const formatDt = (d) => {
                if (!d) return '';
                return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            };
            transmittals.forEach(t => {
                if (t.createdAt) {
                    transmittalDates[t.transmittalNumber] = formatDt(t.createdAt);
                }
            });
            
            // Fetch SOW names
            const project = await Project.findById(projectId).lean();
            if (project) {
                const extractPrefix = (sowName) => {
                    validSowNames.push(sowName.trim().toUpperCase());
                    const match = sowName.trim().toUpperCase().match(/^([A-Z\\s_-]+?)\\d+$/);
                    if (match) sowPrefixes.add(match[1].trim());
                };
                (project.scopeOfWork || []).forEach(sow => extractPrefix(sow.name));
                (project.additionalScopeOfWork || []).forEach(sow => extractPrefix(sow.name));
            }
            
            // Fetch extractions
            const extIds = drawings.map(d => d.extractionId).filter(Boolean);
            const extractions = await DrawingExtraction.find({ _id: { $in: extIds } }).select('fileUrl storageGatewayPath _id').lean();
            extractions.forEach(e => {
                extMap[e._id.toString()] = e;
            });
            
        } catch (e) {
            console.error('[generateDrawingLogExcel] Failed to fetch context data:', e);
        }
    }

    // ── Group Drawings by SOW ──
    const groupedBySow = {};
    drawings.forEach(d => {
        const ext = extMap[d.extractionId?.toString()];
        const fullPath = ext ? (ext.storageGatewayPath || ext.fileUrl || '') : '';
        let sowKey = resolveSowKey(fullPath, validSowNames, sowPrefixes) || 'General';
        
        if (!groupedBySow[sowKey]) groupedBySow[sowKey] = [];
        groupedBySow[sowKey].push(d);
    });

    const { normalizeRevision } = require('./transmittalService');
    const sortedSows = Object.keys(groupedBySow).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    for (const sow of sortedSows) {
        const sowDrawings = groupedBySow[sow];
        
        // Ensure valid sheet name
        let safeSheetName = sow.replace(/[\\*?:\\/\\[\\]]/g, '_').substring(0, 31);
        const logSheet = workbook.addWorksheet(safeSheetName);

        // ── Logo ────────────────────────────────────────────────
        try {
            let finalLogo = logoPath ? path.join(__dirname, '../../', logoPath.replace(/^\\//, '')) : LOGO_DEFAULT;
            if (!finalLogo || !fs.existsSync(finalLogo) || !fs.statSync(finalLogo).isFile()) {
                finalLogo = LOGO_DEFAULT;
            }
            if (fs.existsSync(finalLogo)) {
                const extension = finalLogo.toLowerCase().endsWith('.png') ? 'png' : finalLogo.toLowerCase().endsWith('.jpeg') || finalLogo.toLowerCase().endsWith('.jpg') ? 'jpeg' : 'png';
                const imageId = workbook.addImage({ filename: finalLogo, extension });
                logSheet.addImage(imageId, { tl: { col: 2, row: 0 }, br: { col: 8, row: 5 } });
                logSheet.mergeCells('A1:Z5');
                logSheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
            }
        } catch (err) { }

        for (let r = 1; r <= 6; r++) logSheet.getRow(r).height = 18;
        logSheet.getRow(7).height = 6;

        const L_START = 8;

        // ── Collect unique revisions for this SOW ──
        const allRevsSet = new Set();
        sowDrawings.forEach(d => {
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

        const totalCols = Math.max(3 + alphaRevs.length + numRevs.length + 1, 4);

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

        const projRow = logSheet.getRow(L_START + 1);
        projRow.height = 24;
        const projMidCol = Math.ceil(totalCols / 2);
        projRow.getCell(1).value = \`Project Name : \${projectName}\`;
        projRow.getCell(1).style = { font: { bold: true, size: 11 }, alignment: { vertical: 'middle', horizontal: 'left' }, border: commonBorderStyle };
        logSheet.mergeCells(L_START + 1, 1, L_START + 1, projMidCol);

        projRow.getCell(projMidCol + 1).value = \`Client : \${clientName}\`;
        projRow.getCell(projMidCol + 1).style = { font: { bold: true, size: 11 }, alignment: { vertical: 'middle', horizontal: 'left' }, border: commonBorderStyle };
        logSheet.mergeCells(L_START + 1, projMidCol + 1, L_START + 1, totalCols);

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
                subHead.getCell(curCol).value = \`Rev \${r}\`;
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
                subHead.getCell(curCol).value = \`Rev \${r}\`;
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

        const fRowL = logSheet.addRow(['DRAWINGS']);
        const rNum = fRowL.number;
        fRowL.height = 22;
        fRowL.getCell(1).style = {
            font: { bold: true, size: 11, color: { argb: 'FF000000' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } },
            alignment: { horizontal: 'center', vertical: 'middle' },
            border: commonBorderStyle,
        };
        logSheet.mergeCells(rNum, 1, rNum, totalCols);
        for (let i = 1; i <= totalCols; i++) {
            fRowL.getCell(i).border = commonBorderStyle;
            if (i > 1) fRowL.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
        }

        let logSlNo = 1;
        const sorted = [...sowDrawings].sort((a, b) =>
            (a.drawingNumber || '').localeCompare(b.drawingNumber || '', undefined, { numeric: true, sensitivity: 'base' })
        );

        sorted.forEach(d => {
            const revMap = {};
            const allRemarks = new Set();

            (d.revisionHistory || []).forEach(rh => {
                if (rh.revision) {
                    const revKey = normalizeRevision(rh.revision);
                    revMap[revKey] = rh.date || (rh.transmittalNo && transmittalDates[rh.transmittalNo] ? transmittalDates[rh.transmittalNo] : (rh.transmittalNo ? \`TR-\${String(rh.transmittalNo).padStart(3, '0')}\` : '✓'));
                }
                if (rh.remarks) {
                    allRemarks.add(rh.remarks.toUpperCase().trim());
                }
            });

            if (d.currentRevision) {
                const curRevKey = normalizeRevision(d.currentRevision);
                if (!revMap[curRevKey]) {
                    revMap[curRevKey] = d.date || '✓';
                }
            }

            if (allRemarks.size === 0 && d.description) {
                allRemarks.add(d.description.toUpperCase().trim());
            }

            let combinedRemarks = Array.from(allRemarks).join(' / ');

            const rowData = [logSlNo++, d.drawingNumber, d.drawingTitle];
            alphaRevs.forEach(r => rowData.push(revMap[r] || ''));
            numRevs.forEach(r => rowData.push(revMap[r] || ''));
            rowData.push(combinedRemarks); 

            const rDataL = logSheet.addRow(rowData);
            rDataL.height = 22;
            const hasNumRev = numRevs.some(revMark => revMap[revMark]);
            const hasAlphaRev = alphaRevs.some(revMark => revMap[revMark]);
            const alphaStart = 4;
            const alphaEnd = 3 + alphaRevs.length;

            const isSkippedApproval = hasNumRev && !hasAlphaRev;

            rDataL.eachCell((cell, colNum) => {
                cell.border = commonBorderStyle;
                cell.alignment = {
                    vertical: 'middle',
                    horizontal: (colNum === 3 || colNum === sIdx) ? 'left' : 'center',
                    wrapText: true,
                };

                const isAlphaCol = colNum >= alphaStart && colNum <= alphaEnd;
                const greyFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECECEC' } }; 

                if (isAlphaCol && isSkippedApproval) {
                    cell.fill = greyFill;
                    if (!cell.value) cell.value = '-';
                }
            });
        });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const safeProjectName = projectName.replace(/[^a-zA-Z0-9_\\-]/g, '_');
    const filename = \`\${safeProjectName}_Drawing_Log.xlsx\`;

    return { buffer, filename };
}
`;

newContent = newContent.replace(drawingLogCode, newDrawingLogCode);

fs.writeFileSync('src/services/transmittalExcelService.new.js', newContent);
console.log('Successfully wrote transmittalExcelService.new.js');
