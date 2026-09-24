import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import type { SubViewerProps } from '../types';
import * as XLSX from 'xlsx';

const ROW_HEIGHT = 28;

export default function SpreadsheetViewer({
    file,
    zoom,
    activeSheet,
    onSheetsLoaded,
}: SubViewerProps) {
    const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
    const [gridData, setGridData] = useState<any[][]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>('');

    // Virtualization state
    const wrapRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef<number | null>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(600);

    // Fetch and parse workbook
    useEffect(() => {
        let isMounted = true;
        setLoading(true);
        setError('');

        async function loadWorkbook() {
            try {
                const token = localStorage.getItem('token');
                const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
                const res = await fetch(file.url, { headers, credentials: 'include' });
                if (!res.ok) throw new Error(`Failed to load spreadsheet (${res.status} ${res.statusText})`);

                const buffer = await res.arrayBuffer();
                const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
                if (!isMounted) return;

                setWorkbook(wb);
                const sheetNames = wb.SheetNames || [];
                const firstSheet = sheetNames[0] || 'Sheet1';
                onSheetsLoaded?.(sheetNames, firstSheet);
            } catch (err: any) {
                if (isMounted) setError(err.message || 'Error parsing spreadsheet');
            } finally {
                if (isMounted) setLoading(false);
            }
        }

        loadWorkbook();

        return () => {
            isMounted = false;
        };
    }, [file.url]);

    // Parse active sheet whenever sheet selection or workbook changes
    useEffect(() => {
        if (!workbook) return;
        const currentSheetName = activeSheet || workbook.SheetNames[0];
        const sheet = workbook.Sheets[currentSheetName];
        if (!sheet) {
            setGridData([]);
            return;
        }

        const data: any[][] = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            defval: '',
            blankrows: false,
        });
        setGridData(data);
        if (wrapRef.current) wrapRef.current.scrollTop = 0;
        setScrollTop(0);
    }, [workbook, activeSheet]);

    // Measure viewport on mount and resize
    useEffect(() => {
        const updateHeight = () => {
            if (wrapRef.current) {
                setViewportHeight(wrapRef.current.clientHeight || 600);
            }
        };
        updateHeight();
        window.addEventListener('resize', updateHeight);
        return () => window.removeEventListener('resize', updateHeight);
    }, [loading]);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const currentTarget = e.currentTarget;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
            setScrollTop(currentTarget.scrollTop);
        });
    }, []);

    const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        // Support Shift + mouse wheel or horizontal wheel tilt
        if (e.shiftKey && e.deltaY !== 0 && wrapRef.current) {
            wrapRef.current.scrollLeft += e.deltaY;
        }
    }, []);

    const maxCols = useMemo(() => {
        if (!gridData.length) return 0;
        let max = 0;
        for (let i = 0; i < gridData.length; i++) {
            const row = gridData[i];
            if (Array.isArray(row) && row.length > max) {
                max = row.length;
            }
        }
        return max;
    }, [gridData]);

    if (loading) {
        return (
            <div className="m365-loading-state">
                <div style={{ fontSize: 28 }}>📊</div>
                <div>Loading spreadsheet workbook...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="m365-error-state">
                <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Unable to render Spreadsheet</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>{error}</div>
            </div>
        );
    }

    if (gridData.length === 0) {
        return (
            <div className="m365-loading-state" style={{ color: '#94a3b8' }}>
                <div>Sheet is empty</div>
            </div>
        );
    }

    const scale = zoom / 100;
    const totalRows = gridData.length;
    const effectiveScrollTop = scrollTop / (scale || 1);
    const effectiveViewportHeight = viewportHeight / (scale || 1);
    const visibleCount = Math.ceil(effectiveViewportHeight / ROW_HEIGHT);
    const overscan = 20;

    const startIndex = Math.max(0, Math.floor(effectiveScrollTop / ROW_HEIGHT) - overscan);
    const endIndex = Math.min(totalRows, startIndex + visibleCount + overscan * 2);
    const visibleRows = gridData.slice(startIndex, endIndex);

    const topPadHeight = startIndex * ROW_HEIGHT;
    const bottomPadHeight = Math.max(0, (totalRows - endIndex) * ROW_HEIGHT);

    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <div
                ref={wrapRef}
                className="m365-grid-wrap"
                onScroll={handleScroll}
                onWheel={handleWheel}
            >
                <div
                    className="m365-grid-zoom-container"
                    style={{
                        zoom: scale,
                        width: 'max-content',
                        minWidth: '100%',
                    }}
                >
                    <table className="m365-grid-table">
                        <thead>
                            <tr>
                                <th style={{ width: 44, textAlign: 'center', background: '#e2e8f0', color: '#64748b' }}>#</th>
                                {Array.from({ length: maxCols }).map((_, colIdx) => (
                                    <th key={colIdx} style={{ minWidth: 90 }}>
                                        {XLSX.utils.encode_col(colIdx)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {topPadHeight > 0 && (
                                <tr style={{ height: `${topPadHeight}px`, border: 'none' }}>
                                    <td colSpan={maxCols + 1} style={{ padding: 0, border: 'none', background: 'transparent' }} />
                                </tr>
                            )}
                            {visibleRows.map((row, relIdx) => {
                                const rowIdx = startIndex + relIdx;
                                return (
                                    <tr key={rowIdx} style={{ height: `${ROW_HEIGHT}px` }}>
                                        <td style={{ textAlign: 'center', background: '#f8fafc', color: '#64748b', fontWeight: 600 }}>
                                            {rowIdx + 1}
                                        </td>
                                        {Array.from({ length: maxCols }).map((_, colIdx) => {
                                            const val = row ? row[colIdx] : '';
                                            const displayVal = val instanceof Date ? val.toLocaleDateString() : String(val ?? '');
                                            return (
                                                <td key={colIdx} title={displayVal}>
                                                    {displayVal}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                            {bottomPadHeight > 0 && (
                                <tr style={{ height: `${bottomPadHeight}px`, border: 'none' }}>
                                    <td colSpan={maxCols + 1} style={{ padding: 0, border: 'none', background: 'transparent' }} />
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            {/* Status bar */}
            <div className="m365-grid-status-bar">
                <span>
                    Sheet: <strong>{activeSheet || 'Sheet1'}</strong> • <strong>{totalRows.toLocaleString()}</strong> rows • <strong>{maxCols}</strong> columns
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#94a3b8', fontSize: 11 }}>Hold Shift + scroll wheel to scroll horizontally</span>
                    <button
                        type="button"
                        className="m365-grid-scroll-btn"
                        onClick={() => wrapRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
                        title="Scroll Left (or Shift + Wheel)"
                        aria-label="Scroll table left"
                    >
                        ◀
                    </button>
                    <button
                        type="button"
                        className="m365-grid-scroll-btn"
                        onClick={() => wrapRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
                        title="Scroll Right (or Shift + Wheel)"
                        aria-label="Scroll table right"
                    >
                        ▶
                    </button>
                </div>
            </div>
        </div>
    );
}
