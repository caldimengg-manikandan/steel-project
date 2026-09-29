// ============================================================
// Lightweight Client-Side PPTX Parser (Pure OpenXML + JSZip)
// Extracts slides, dimensions, shapes, text, images, and tables
// ============================================================

import JSZip from 'jszip';

export interface TextRun {
    text: string;
    size?: number; // font size in pt (e.g. 24)
    color?: string; // hex color e.g. '#1e293b'
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
}

export interface Paragraph {
    align?: 'left' | 'center' | 'right' | 'justify';
    level?: number;
    bullet?: boolean;
    runs: TextRun[];
}

export interface TableCell {
    text: string;
    bg?: string;
    bold?: boolean;
    color?: string;
    align?: 'left' | 'center' | 'right';
}

export interface SlideElement {
    id: string;
    type: 'text' | 'image' | 'table' | 'shape';
    x: number; // percentage (0 - 100)
    y: number; // percentage (0 - 100)
    width: number; // percentage (0 - 100)
    height: number; // percentage (0 - 100)
    rotation?: number; // degrees
    bg?: string; // background color
    borderColor?: string;
    borderWidth?: number;
    borderRadius?: number;
    // Text specific
    paragraphs?: Paragraph[];
    // Image specific
    imageUrl?: string;
    // Table specific
    tableRows?: TableCell[][];
}

export interface ParsedSlide {
    slideIndex: number; // 0-based
    slideNumber: number; // 1-based
    title?: string;
    bgColor?: string;
    bgImageUrl?: string;
    elements: SlideElement[];
    rawTextSummary?: string;
}

export interface ParsedPresentation {
    aspectRatio: number; // e.g. 16/9 = 1.7777, 4/3 = 1.3333
    widthEMU: number;
    heightEMU: number;
    slides: ParsedSlide[];
    blobUrls: string[]; // for cleanup
    isLegacyBinaryPpt?: boolean;
}

// Helper: Normalize hex color (6 chars)
function parseHexColor(raw?: string | null): string | undefined {
    if (!raw) return undefined;
    const clean = raw.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(clean)) {
        return `#${clean}`;
    }
    if (/^[0-9a-fA-F]{3}$/.test(clean)) {
        return `#${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`;
    }
    return undefined;
}

// Helper: Extract color from solidFill or schemeClr
function extractColor(elem: Element | null): string | undefined {
    if (!elem) return undefined;
    const srgbClr = elem.querySelector('srgbClr');
    if (srgbClr) {
        const val = srgbClr.getAttribute('val');
        if (val) return parseHexColor(val);
    }
    const scrgbClr = elem.querySelector('scrgbClr');
    if (scrgbClr) {
        const r = Math.round((parseFloat(scrgbClr.getAttribute('r') || '0') / 100000) * 255);
        const g = Math.round((parseFloat(scrgbClr.getAttribute('g') || '0') / 100000) * 255);
        const b = Math.round((parseFloat(scrgbClr.getAttribute('b') || '0') / 100000) * 255);
        return `rgb(${r},${g},${b})`;
    }
    // Scheme color fallback
    const schemeClr = elem.querySelector('schemeClr');
    if (schemeClr) {
        const val = schemeClr.getAttribute('val');
        switch (val) {
            case 'tx1':
            case 'dk1':
                return '#0f172a';
            case 'tx2':
            case 'dk2':
                return '#334155';
            case 'bg1':
            case 'lt1':
                return '#ffffff';
            case 'bg2':
            case 'lt2':
                return '#f8fafc';
            case 'accent1':
                return '#2563eb';
            case 'accent2':
                return '#ea580c';
            case 'accent3':
                return '#059669';
            case 'accent4':
                return '#7c3aed';
            case 'accent5':
                return '#0891b2';
            case 'accent6':
                return '#d97706';
            default:
                return undefined;
        }
    }
    return undefined;
}

export async function parsePptx(arrayBuffer: ArrayBuffer): Promise<ParsedPresentation> {
    const bytes = new Uint8Array(arrayBuffer);

    // Check for legacy binary PowerPoint (OLE Compound File: 0xD0, 0xCF, 0x11, 0xE0)
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
        return {
            aspectRatio: 16 / 9,
            widthEMU: 12192000,
            heightEMU: 6858000,
            slides: [],
            blobUrls: [],
            isLegacyBinaryPpt: true,
        };
    }

    const zip = await JSZip.loadAsync(arrayBuffer);
    const domParser = new DOMParser();
    const blobUrls: string[] = [];

    // 1. Extract all media (images) from ppt/media/ into Object URLs
    const mediaMap = new Map<string, string>();
    const mediaFiles = zip.file(/^ppt\/media\//);
    for (const file of mediaFiles) {
        try {
            const blob = await file.async('blob');
            const blobUrl = URL.createObjectURL(blob);
            blobUrls.push(blobUrl);

            const baseName = file.name.split('/').pop() || file.name;
            mediaMap.set(file.name, blobUrl);
            mediaMap.set(baseName, blobUrl);
            mediaMap.set(`../media/${baseName}`, blobUrl);
            mediaMap.set(`media/${baseName}`, blobUrl);
        } catch {
            // ignore corrupt media entry
        }
    }

    // 2. Parse ppt/presentation.xml for dimensions and slide order
    let widthEMU = 12192000; // default 16:9 (13.333" x 7.5")
    let heightEMU = 6858000;
    const slideRIds: string[] = [];

    const presXmlStr = await zip.file('ppt/presentation.xml')?.async('string');
    if (presXmlStr) {
        const presDoc = domParser.parseFromString(presXmlStr, 'application/xml');
        const sldSz = presDoc.querySelector('sldSz');
        if (sldSz) {
            const cx = parseInt(sldSz.getAttribute('cx') || '', 10);
            const cy = parseInt(sldSz.getAttribute('cy') || '', 10);
            if (!isNaN(cx) && cx > 0) widthEMU = cx;
            if (!isNaN(cy) && cy > 0) heightEMU = cy;
        }

        const sldIdLst = presDoc.querySelectorAll('sldIdLst > sldId');
        sldIdLst.forEach(el => {
            const rId = el.getAttribute('r:id') || el.getAttribute('id');
            if (rId) slideRIds.push(rId);
        });
    }

    const aspectRatio = widthEMU / heightEMU || 16 / 9;

    // 3. Resolve slide relationship targets from ppt/_rels/presentation.xml.rels
    const slidePaths: string[] = [];
    const presRelsStr = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
    const rIdToTargetMap = new Map<string, string>();

    if (presRelsStr) {
        const relsDoc = domParser.parseFromString(presRelsStr, 'application/xml');
        const relEls = relsDoc.querySelectorAll('Relationship');
        relEls.forEach(rel => {
            const id = rel.getAttribute('Id');
            const target = rel.getAttribute('Target');
            if (id && target) {
                // Normalize target path to e.g. ppt/slides/slide1.xml
                const cleanTarget = target.startsWith('/')
                    ? target.slice(1)
                    : target.startsWith('slides/')
                    ? `ppt/${target}`
                    : target.startsWith('../')
                    ? `ppt/${target.replace(/^\.\.\//, '')}`
                    : `ppt/slides/${target}`;
                rIdToTargetMap.set(id, cleanTarget);
            }
        });
    }

    for (const rId of slideRIds) {
        const target = rIdToTargetMap.get(rId);
        if (target && zip.file(target)) {
            slidePaths.push(target);
        }
    }

    // Fallback: If no slide paths found through rels, discover slides directly
    if (slidePaths.length === 0) {
        const discovered = zip.file(/^ppt\/slides\/slide\d+\.xml$/);
        discovered.sort((a, b) => {
            const numA = parseInt(a.name.match(/slide(\d+)\.xml/)?.[1] || '0', 10);
            const numB = parseInt(b.name.match(/slide(\d+)\.xml/)?.[1] || '0', 10);
            return numA - numB;
        });
        slidePaths.push(...discovered.map(f => f.name));
    }

    // 4. Parse each slide
    const slides: ParsedSlide[] = [];

    for (let i = 0; i < slidePaths.length; i++) {
        const slidePath = slidePaths[i];
        const slideFile = zip.file(slidePath);
        if (!slideFile) continue;

        const slideXml = await slideFile.async('string');
        const slideDoc = domParser.parseFromString(slideXml, 'application/xml');

        // Parse slide-specific relationships for images
        const slideRelPath = slidePath.replace(/slide(\d+)\.xml$/, '_rels/slide$1.xml.rels');
        const slideRelsStr = await zip.file(slideRelPath)?.async('string');
        const slideMediaRIdMap = new Map<string, string>();

        if (slideRelsStr) {
            const sRelsDoc = domParser.parseFromString(slideRelsStr, 'application/xml');
            sRelsDoc.querySelectorAll('Relationship').forEach(rel => {
                const id = rel.getAttribute('Id');
                const target = rel.getAttribute('Target');
                if (id && target) {
                    const resolved = mediaMap.get(target)
                        || mediaMap.get(target.split('/').pop() || '')
                        || mediaMap.get(`ppt/media/${target.split('/').pop()}`);
                    if (resolved) {
                        slideMediaRIdMap.set(id, resolved);
                    }
                }
            });
        }

        // Slide Background
        let bgColor: string | undefined = undefined;
        let bgImageUrl: string | undefined = undefined;
        const bgEl = slideDoc.querySelector('cSld > bg, p\\:bg');
        if (bgEl) {
            bgColor = extractColor(bgEl);
            const blip = bgEl.querySelector('blip');
            if (blip) {
                const rEmbed = blip.getAttribute('r:embed');
                if (rEmbed) bgImageUrl = slideMediaRIdMap.get(rEmbed);
            }
        }

        const elements: SlideElement[] = [];
        let slideTitle = '';
        const textSnippets: string[] = [];

        // Helper: Parse transformation <a:xfrm> into percentages
        const parseXfrm = (container: Element) => {
            const xfrm = container.querySelector('xfrm');
            if (!xfrm) return null;
            const off = xfrm.querySelector('off');
            const ext = xfrm.querySelector('ext');
            if (!off || !ext) return null;

            const x = parseInt(off.getAttribute('x') || '0', 10);
            const y = parseInt(off.getAttribute('y') || '0', 10);
            const cx = parseInt(ext.getAttribute('cx') || '0', 10);
            const cy = parseInt(ext.getAttribute('cy') || '0', 10);
            const rot = parseInt(xfrm.getAttribute('rot') || '0', 10);

            return {
                x: Math.max(0, Math.min(100, (x / widthEMU) * 100)),
                y: Math.max(0, Math.min(100, (y / heightEMU) * 100)),
                width: Math.max(0, Math.min(100, (cx / widthEMU) * 100)),
                height: Math.max(0, Math.min(100, (cy / heightEMU) * 100)),
                rotation: rot ? rot / 60000 : 0,
            };
        };

        // Extract shapes (text boxes, rects, titles)
        const shapeEls = slideDoc.querySelectorAll('p\\:sp, sp');
        shapeEls.forEach((sp, spIdx) => {
            const xfrm = parseXfrm(sp);
            if (!xfrm) return;

            // Check if shape is marked as a title placeholder
            const ph = sp.querySelector('ph');
            const phType = ph?.getAttribute('type') || '';
            const isTitlePh = phType === 'title' || phType === 'ctrTitle' || phType === 'subTitle';

            // Background & Border
            const spPr = sp.querySelector('spPr');
            const bg = spPr ? extractColor(spPr.querySelector('solidFill')) : undefined;
            const ln = spPr?.querySelector('ln');
            const borderColor = ln ? extractColor(ln) : undefined;
            const borderWidth = ln ? Math.max(1, Math.round(parseInt(ln.getAttribute('w') || '12700', 10) / 12700)) : undefined;

            // Paragraphs and text runs
            const paragraphs: Paragraph[] = [];
            const pEls = sp.querySelectorAll('txBody > a\\:p, p');

            pEls.forEach(p => {
                const pPr = p.querySelector('pPr');
                const alignAttr = pPr?.getAttribute('algn');
                const align: 'left' | 'center' | 'right' | 'justify' =
                    alignAttr === 'ctr' ? 'center' : alignAttr === 'r' ? 'right' : alignAttr === 'just' ? 'justify' : 'left';
                const level = parseInt(pPr?.getAttribute('lvl') || '0', 10);
                const hasBullet = Boolean(pPr?.querySelector('buChar, buAutoNum, buSzPct'));

                const runs: TextRun[] = [];
                // Look for text runs <a:r> and text tags <a:t>
                const rEls = p.querySelectorAll('r, a\\:r');
                rEls.forEach(r => {
                    const t = r.querySelector('t, a\\:t')?.textContent || '';
                    if (!t) return;
                    const rPr = r.querySelector('rPr, a\\:rPr');
                    const szAttr = rPr?.getAttribute('sz');
                    const size = szAttr ? Math.max(9, Math.round(parseInt(szAttr, 10) / 100)) : (isTitlePh ? 28 : 14);
                    const bold = rPr?.getAttribute('b') === '1' || rPr?.getAttribute('b') === 'true' || isTitlePh;
                    const italic = rPr?.getAttribute('i') === '1' || rPr?.getAttribute('i') === 'true';
                    const underline = rPr?.getAttribute('u') === 'sng';
                    const color = extractColor(rPr) || (bg && bg.startsWith('#0') ? '#ffffff' : undefined);

                    runs.push({ text: t, size, bold, italic, underline, color });
                    textSnippets.push(t);
                    if (isTitlePh && !slideTitle) {
                        slideTitle = t;
                    }
                });

                // Fallback: check direct <a:t> if no <a:r>
                if (runs.length === 0) {
                    const directT = p.querySelector('t, a\\:t')?.textContent;
                    if (directT) {
                        runs.push({ text: directT, size: isTitlePh ? 28 : 14, bold: isTitlePh });
                        textSnippets.push(directT);
                        if (isTitlePh && !slideTitle) slideTitle = directT;
                    }
                }

                if (runs.length > 0) {
                    paragraphs.push({ align, level, bullet: hasBullet || level > 0, runs });
                }
            });

            if (paragraphs.length > 0 || bg || borderColor) {
                elements.push({
                    id: `shape-${spIdx}`,
                    type: paragraphs.length > 0 ? 'text' : 'shape',
                    ...xfrm,
                    bg,
                    borderColor,
                    borderWidth,
                    paragraphs,
                });
            }
        });

        // Extract pictures <p:pic>
        const picEls = slideDoc.querySelectorAll('p\\:pic, pic');
        picEls.forEach((pic, picIdx) => {
            const xfrm = parseXfrm(pic);
            if (!xfrm) return;
            const blip = pic.querySelector('blip');
            const rEmbed = blip?.getAttribute('r:embed');
            if (rEmbed) {
                const imgUrl = slideMediaRIdMap.get(rEmbed);
                if (imgUrl) {
                    elements.push({
                        id: `pic-${picIdx}`,
                        type: 'image',
                        ...xfrm,
                        imageUrl: imgUrl,
                    });
                }
            }
        });

        // Extract tables <p:graphicFrame> -> <a:tbl>
        const tableFrames = slideDoc.querySelectorAll('graphicFrame, p\\:graphicFrame');
        tableFrames.forEach((gf, gfIdx) => {
            const tbl = gf.querySelector('tbl, a\\:tbl');
            if (!tbl) return;
            const xfrm = parseXfrm(gf);
            if (!xfrm) return;

            const tableRows: TableCell[][] = [];
            const trEls = tbl.querySelectorAll('tr, a\\:tr');
            trEls.forEach((tr, trIdx) => {
                const rowCells: TableCell[] = [];
                const tcEls = tr.querySelectorAll('tc, a\\:tc');
                tcEls.forEach(tc => {
                    const text = Array.from(tc.querySelectorAll('t, a\\:t')).map(t => t.textContent || '').join(' ').trim();
                    const bg = extractColor(tc.querySelector('tcPr'));
                    const isHeader = trIdx === 0;
                    rowCells.push({
                        text,
                        bg: bg || (isHeader ? '#f1f5f9' : undefined),
                        bold: isHeader,
                        color: isHeader ? '#0f172a' : undefined,
                    });
                    if (text) textSnippets.push(text);
                });
                if (rowCells.length > 0) tableRows.push(rowCells);
            });

            if (tableRows.length > 0) {
                elements.push({
                    id: `tbl-${gfIdx}`,
                    type: 'table',
                    ...xfrm,
                    tableRows,
                });
            }
        });

        if (!slideTitle && textSnippets.length > 0) {
            slideTitle = textSnippets[0].slice(0, 45);
        }

        slides.push({
            slideIndex: i,
            slideNumber: i + 1,
            title: slideTitle || `Slide ${i + 1}`,
            bgColor: bgColor || '#ffffff',
            bgImageUrl,
            elements,
            rawTextSummary: textSnippets.join(' • ').slice(0, 300),
        });
    }

    return {
        aspectRatio,
        widthEMU,
        heightEMU,
        slides,
        blobUrls,
    };
}
