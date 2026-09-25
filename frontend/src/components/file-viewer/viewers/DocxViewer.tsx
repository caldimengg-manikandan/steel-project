import React, { useEffect, useState } from 'react';
import type { SubViewerProps } from '../types';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { downloadFile } from '../utils';

const BASE = import.meta.env.VITE_API_URL || '/steel/api';

function escapeHtml(str: string): string {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Client-side fallback for RTF files saved as .doc
 */
function extractClientRtfFallback(buffer: ArrayBuffer): string | null {
    try {
        const text = new TextDecoder('utf-8').decode(buffer);
        if (text.startsWith('{\\rtf')) {
            const cleaned = text
                .replace(/\\par[d]?\s*/g, '\n\n')
                .replace(/\\[a-z0-9-]+\s?/gi, '')
                .replace(/[{}]/g, '')
                .trim();
            const paras = cleaned.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
            if (paras.length > 0) {
                return paras.map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`).join('\n');
            }
        }
    } catch {
        return null;
    }
    return null;
}

/**
 * Client-side fallback for legacy Word 97-2004 .doc files using XLSX.CFB
 */
function extractClientDocFallback(buffer: ArrayBuffer): string | null {
    try {
        const CFB = (XLSX as any).CFB;
        if (!CFB || typeof CFB.read !== 'function') return null;

        const cfb = CFB.read(new Uint8Array(buffer), { type: 'array' });
        const entry = CFB.find(cfb, '/WordDocument') || CFB.find(cfb, 'WordDocument');
        if (!entry || !entry.content) return null;

        const bytes = entry.content as Uint8Array;
        let text = '';
        let i = 0;
        while (i < bytes.length) {
            const b1 = bytes[i];
            const b2 = i + 1 < bytes.length ? bytes[i + 1] : -1;
            // Printable ASCII or newline/tab
            if ((b1 >= 32 && b1 <= 126) || b1 === 10 || b1 === 13 || b1 === 9) {
                text += String.fromCharCode(b1);
                i++;
            } else if (b2 === 0 && ((b1 >= 32 && b1 <= 126) || b1 === 10 || b1 === 13 || b1 === 9)) {
                text += String.fromCharCode(b1);
                i += 2;
            } else {
                i++;
            }
        }

        const lines = text
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => l.length > 1 && !l.includes('\u0000') && !l.includes('\u0001'));

        if (!lines.length) return null;
        return lines.map(line => `<p>${escapeHtml(line)}</p>`).join('\n');
    } catch {
        return null;
    }
}

export default function DocxViewer({ file, fileBuffer, zoom, fitMode }: SubViewerProps) {
    const [htmlContent, setHtmlContent] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>('');

    useEffect(() => {
        let isMounted = true;
        setLoading(true);
        setError('');

        async function loadDoc() {
            try {
                let buffer = fileBuffer;
                if (!buffer || buffer.byteLength === 0) {
                    const token = localStorage.getItem('token');
                    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
                    const res = await fetch(file.url, { headers, credentials: 'include' });
                    if (!res.ok) throw new Error(`Failed to load document (${res.status} ${res.statusText})`);
                    buffer = await res.arrayBuffer();
                }

                if (!isMounted) return;

                if (!buffer || buffer.byteLength === 0) {
                    throw new Error('The document file is empty.');
                }

                const uint8 = new Uint8Array(buffer);
                // Check format signatures
                const isZip = uint8.length >= 4 && uint8[0] === 0x50 && uint8[1] === 0x4B; // 'PK'
                const isRtf = uint8.length >= 5 && uint8[0] === 0x7B && uint8[1] === 0x5C && uint8[2] === 0x72; // '{\r'
                const isHtml = (() => {
                    try {
                        const head = new TextDecoder().decode(uint8.subarray(0, 100)).toLowerCase();
                        return head.includes('<html') || head.includes('<!doctype') || head.includes('<body');
                    } catch {
                        return false;
                    }
                })();

                // 1. If modern DOCX (ZIP archive format)
                if (isZip) {
                    try {
                        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
                        if (!isMounted) return;
                        if (result.value) {
                            setHtmlContent(result.value);
                            return;
                        }
                    } catch (mammothErr) {
                        console.warn('[DocxViewer] Mammoth conversion failed, trying server converter:', mammothErr);
                    }
                }

                // 2. If HTML saved as .doc
                if (isHtml) {
                    try {
                        const html = new TextDecoder().decode(buffer);
                        if (!isMounted) return;
                        setHtmlContent(html);
                        return;
                    } catch { /* proceed */ }
                }

                // 3. Server conversion endpoint (WordExtractor for binary .doc, RTF, etc.)
                try {
                    const filename = file.filename || 'document.doc';
                    const convertUrl = `${BASE}/mail/convert-doc?filename=${encodeURIComponent(filename)}`;
                    const convertRes = await fetch(convertUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/octet-stream',
                            ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        },
                        credentials: 'include',
                        body: buffer,
                    });

                    if (convertRes.ok) {
                        const data = await convertRes.json();
                        if (!isMounted) return;
                        if (data && data.html) {
                            setHtmlContent(data.html);
                            return;
                        }
                    } else {
                        console.warn(`[DocxViewer] Server convert-doc returned HTTP ${convertRes.status}`);
                    }
                } catch (serverErr) {
                    console.warn('[DocxViewer] Server convert-doc request failed:', serverErr);
                }

                if (!isMounted) return;

                // 4. Client fallback: RTF parsing
                if (isRtf) {
                    const rtfHtml = extractClientRtfFallback(buffer);
                    if (rtfHtml) {
                        setHtmlContent(rtfHtml);
                        return;
                    }
                }

                // 5. Client fallback: OLE2 CFB extraction
                const cfbHtml = extractClientDocFallback(buffer);
                if (cfbHtml) {
                    setHtmlContent(cfbHtml);
                    return;
                }

                throw new Error(
                    isZip
                        ? 'Could not parse Word document content.'
                        : 'This legacy Word (.doc) document could not be rendered for web preview.'
                );
            } catch (err: any) {
                if (isMounted) {
                    setError(err.message || 'Error converting Word document.');
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        }

        loadDoc();

        return () => {
            isMounted = false;
        };
    }, [file.url, file.filename, fileBuffer]);

    if (loading) {
        return (
            <div className="m365-loading-state">
                <div className="m365-loading-spinner" />
                <div style={{ color: '#000000', fontWeight: 600 }}>Formatting Word document...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="m365-error-state" style={{ maxWidth: 440, margin: '48px auto', textAlign: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: '#1f2937' }}>
                    Unable to render Word Document
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, lineHeight: 1.5 }}>
                    {error}
                </div>
                <button
                    type="button"
                    onClick={() => downloadFile(file.url, file.filename)}
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        padding: '10px 20px',
                        borderRadius: 6,
                        background: '#0078d4',
                        color: '#ffffff',
                        fontWeight: 600,
                        fontSize: 13,
                        border: 'none',
                        cursor: 'pointer',
                        boxShadow: '0 2px 6px rgba(0, 120, 212, 0.3)',
                    }}
                >
                    <span>⬇️</span>
                    <span>Download {file.filename || 'Document'}</span>
                </button>
            </div>
        );
    }

    const scale = fitMode === 'width' ? 1 : zoom / 100;
    const maxWidth = fitMode === 'width' ? '98%' : '850px';

    return (
        <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
            <div
                className="m365-paper-doc"
                style={{
                    width: maxWidth,
                    transform: fitMode === 'width' ? 'none' : `scale(${scale})`,
                    marginBottom: 40,
                }}
                dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
        </div>
    );
}
