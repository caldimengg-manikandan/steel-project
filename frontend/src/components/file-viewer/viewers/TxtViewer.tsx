import React, { useState, useMemo, useRef, useCallback } from 'react';
import type { SubViewerProps } from '../types';

export default function TxtViewer({ file, fileBuffer, zoom, searchQuery = '' }: SubViewerProps) {
    const [isWordWrap, setIsWordWrap] = useState<boolean>(true);
    const [copied, setCopied] = useState<boolean>(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Decode file buffer synchronously in < 1ms — zero network delay
    const rawText = useMemo(() => {
        if (!fileBuffer || fileBuffer.byteLength === 0) return '';
        try {
            return new TextDecoder('utf-8', { fatal: false }).decode(fileBuffer);
        } catch {
            try {
                return new TextDecoder('windows-1252').decode(fileBuffer);
            } catch {
                return '';
            }
        }
    }, [fileBuffer]);

    // Split text into individual lines safely
    const lines = useMemo(() => {
        if (!rawText) return [];
        return rawText.split(/\r?\n/);
    }, [rawText]);

    // Fast, zero-allocation statistics counter
    const stats = useMemo(() => {
        const lineCount = lines.length;
        const charCount = rawText.length;
        let wordCount = 0;
        let inWord = false;
        for (let i = 0; i < rawText.length; i++) {
            const ch = rawText.charCodeAt(i);
            if (ch <= 32) {
                inWord = false;
            } else if (!inWord) {
                inWord = true;
                wordCount++;
            }
        }
        return { lineCount, charCount, wordCount };
    }, [lines, rawText]);

    // Clean search matching
    const searchTrimmed = (searchQuery || '').trim().toLowerCase();

    const matchStats = useMemo(() => {
        if (!searchTrimmed || searchTrimmed.length === 0) {
            return { count: 0, matchingLineIndices: new Set<number>() };
        }
        let count = 0;
        const matchingLineIndices = new Set<number>();
        const queryLen = searchTrimmed.length;

        for (let i = 0; i < lines.length; i++) {
            const lineLower = lines[i].toLowerCase();
            let idx = lineLower.indexOf(searchTrimmed);
            let lineMatched = false;
            while (idx !== -1) {
                count++;
                lineMatched = true;
                idx = lineLower.indexOf(searchTrimmed, idx + queryLen);
            }
            if (lineMatched) {
                matchingLineIndices.add(i);
            }
        }
        return { count, matchingLineIndices };
    }, [lines, searchTrimmed]);

    // Copy to clipboard handler
    const handleCopyAll = useCallback(() => {
        if (!rawText) return;
        navigator.clipboard.writeText(rawText).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }).catch(() => {});
    }, [rawText]);

    // Dynamic zoom sizing
    const fontSizePx = Math.max(10, Math.min(28, Math.round(13.5 * (zoom / 100))));
    const lineHeightPx = Math.round(fontSizePx * 1.6);

    // Highlight text matching helper
    const renderHighlightedLine = useCallback((line: string) => {
        if (!searchTrimmed || searchTrimmed.length === 0) return line || '\u00A0';

        const lineLower = line.toLowerCase();
        const parts: React.ReactNode[] = [];
        let lastIdx = 0;
        let matchIdx = lineLower.indexOf(searchTrimmed, lastIdx);
        const queryLen = searchTrimmed.length;

        while (matchIdx !== -1) {
            if (matchIdx > lastIdx) {
                parts.push(line.slice(lastIdx, matchIdx));
            }
            parts.push(
                <mark key={matchIdx} className="m365-txt-match">
                    {line.slice(matchIdx, matchIdx + queryLen)}
                </mark>
            );
            lastIdx = matchIdx + queryLen;
            matchIdx = lineLower.indexOf(searchTrimmed, lastIdx);
        }

        if (lastIdx < line.length) {
            parts.push(line.slice(lastIdx));
        }

        return parts.length > 0 ? parts : (line || '\u00A0');
    }, [searchTrimmed]);

    return (
        <div className="m365-txt-viewer-root">
            {/* ── Sub-header Toolbar (Wrap, Copy, Search match pill) ── */}
            <div className="m365-txt-controls-bar">
                <div className="m365-txt-controls-left">
                    <button
                        type="button"
                        className={`m365-txt-ctrl-btn ${isWordWrap ? 'active' : ''}`}
                        onClick={() => setIsWordWrap(prev => !prev)}
                        title={isWordWrap ? "Disable Word Wrap (Horizontal Scroll)" : "Enable Word Wrap"}
                    >
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="3" y1="6" x2="21" y2="6" />
                            <line x1="3" y1="12" x2="15" y2="12" />
                            <polyline points="18 9 21 12 18 15" />
                            <path d="M21 12H15a3 3 0 0 0-3 3v0a3 3 0 0 0 3 3h3" />
                            <line x1="3" y1="18" x2="12" y2="18" />
                        </svg>
                        <span>{isWordWrap ? 'Word Wrap: On' : 'Word Wrap: Off'}</span>
                    </button>

                    <button
                        type="button"
                        className={`m365-txt-ctrl-btn ${copied ? 'copied' : ''}`}
                        onClick={handleCopyAll}
                        title="Copy entire text content to clipboard"
                    >
                        {copied ? (
                            <>
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                                <span style={{ color: '#059669', fontWeight: 600 }}>Copied!</span>
                            </>
                        ) : (
                            <>
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                                <span>Copy Text</span>
                            </>
                        )}
                    </button>
                </div>

                <div className="m365-txt-controls-right">
                    {searchTrimmed && (
                        <span className="m365-txt-matches-badge">
                            {matchStats.count} {matchStats.count === 1 ? 'match' : 'matches'}
                        </span>
                    )}
                    <span className="m365-txt-stat-badge">
                        {stats.lineCount.toLocaleString()} {stats.lineCount === 1 ? 'line' : 'lines'}
                    </span>
                    <span className="m365-txt-stat-badge">
                        {stats.charCount.toLocaleString()} chars
                    </span>
                    <span className="m365-txt-encoding-badge">UTF-8</span>
                </div>
            </div>

            {/* ── Document View Area ── */}
            <div
                className="m365-txt-container"
                ref={containerRef}
            >
                {lines.length === 0 ? (
                    <div className="m365-txt-empty-state">
                        (Empty file)
                    </div>
                ) : (
                    <div
                        className={`m365-txt-canvas ${isWordWrap ? 'is-wrapped' : 'is-nowrap'}`}
                        style={{
                            fontSize: `${fontSizePx}px`,
                            lineHeight: `${lineHeightPx}px`,
                        }}
                    >
                        {lines.map((line, idx) => {
                            const isMatched = matchStats.matchingLineIndices.has(idx);
                            return (
                                <div
                                    key={idx}
                                    className={`m365-txt-line-row ${isMatched ? 'has-match' : ''}`}
                                >
                                    <div
                                        className="m365-txt-gutter"
                                        aria-hidden="true"
                                        style={{ fontSize: `${Math.max(10, fontSizePx - 2)}px` }}
                                    >
                                        {idx + 1}
                                    </div>
                                    <div className="m365-txt-line-content">
                                        {renderHighlightedLine(line)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
