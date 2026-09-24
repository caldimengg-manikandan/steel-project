import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import type { SubViewerProps } from '../types';
import Papa from 'papaparse';

const ROW_HEIGHT = 29;

export default function CsvViewer({ file, zoom, searchQuery = '' }: SubViewerProps) {
    const [rawRows, setRawRows] = useState<string[][]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>('');
    const [sortCol, setSortCol] = useState<number | null>(null);
    const [sortAsc, setSortAsc] = useState(true);

    // Virtualization state
    const wrapRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef<number | null>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(600);

    // Debounced search query for large datasets
    const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(searchQuery);
            if (wrapRef.current) wrapRef.current.scrollTop = 0;
            setScrollTop(0);
        }, 180);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        let isMounted = true;
        setLoading(true);
        setError('');

        async function loadCsv() {
            try {
                const token = localStorage.getItem('token');
                const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
                const res = await fetch(file.url, { headers, credentials: 'include' });
                if (!res.ok) throw new Error(`Failed to load CSV (${res.status} ${res.statusText})`);

                const text = await res.text();
                Papa.parse<string[]>(text, {
                    skipEmptyLines: 'greedy',
                    fastMode: true,
                    complete: (results) => {
                        if (!isMounted) return;
                        setRawRows(results.data || []);
                        setLoading(false);
                    },
                    error: (err: any) => {
                        if (!isMounted) return;
                        setError(err.message || 'Error parsing CSV');
                        setLoading(false);
                    },
                });
            } catch (err: any) {
                if (isMounted) {
                    setError(err.message || 'Failed to fetch CSV file');
                    setLoading(false);
                }
            }
        }

        loadCsv();

        return () => {
            isMounted = false;
        };
    }, [file.url]);

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

    const headers = useMemo(() => (rawRows.length > 0 ? rawRows[0] : []), [rawRows]);
    const bodyRows = useMemo(() => (rawRows.length > 1 ? rawRows.slice(1) : []), [rawRows]);

    // Search filtering
    const filteredRows = useMemo(() => {
        if (!debouncedQuery.trim()) return bodyRows;
        const q = debouncedQuery.toLowerCase();
        return bodyRows.filter(row => row.some(cell => String(cell || '').toLowerCase().includes(q)));
    }, [bodyRows, debouncedQuery]);

    // Column sorting
    const sortedRows = useMemo(() => {
        if (sortCol === null) return filteredRows;
        return [...filteredRows].sort((a, b) => {
            const valA = String(a[sortCol] || '').trim();
            const valB = String(b[sortCol] || '').trim();

            const numA = Number(valA);
            const numB = Number(valB);
            if (!isNaN(numA) && !isNaN(numB)) {
                return sortAsc ? numA - numB : numB - numA;
            }
            return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
        });
    }, [filteredRows, sortCol, sortAsc]);

    function handleHeaderClick(colIdx: number) {
        if (sortCol === colIdx) {
            setSortAsc(!sortAsc);
        } else {
            setSortCol(colIdx);
            setSortAsc(true);
        }
        if (wrapRef.current) wrapRef.current.scrollTop = 0;
        setScrollTop(0);
    }

    if (loading) {
        return (
            <div className="m365-loading-state">
                <div style={{ fontSize: 28 }}>📋</div>
                <div>Parsing CSV file...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="m365-error-state">
                <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Unable to render CSV</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>{error}</div>
            </div>
        );
    }

    if (rawRows.length === 0) {
        return (
            <div className="m365-loading-state" style={{ color: '#94a3b8' }}>
                <div>CSV file is empty</div>
            </div>
        );
    }

    const scale = zoom / 100;
    const totalRows = sortedRows.length;
    const effectiveScrollTop = scrollTop / (scale || 1);
    const effectiveViewportHeight = viewportHeight / (scale || 1);
    const visibleCount = Math.ceil(effectiveViewportHeight / ROW_HEIGHT);
    const overscan = 20;

    const startIndex = Math.max(0, Math.floor(effectiveScrollTop / ROW_HEIGHT) - overscan);
    const endIndex = Math.min(totalRows, startIndex + visibleCount + overscan * 2);
    const visibleRows = sortedRows.slice(startIndex, endIndex);

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
                                {headers.map((col, idx) => (
                                    <th
                                        key={idx}
                                        onClick={() => handleHeaderClick(idx)}
                                        title="Click to sort column"
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                            <span>{col || `Col ${idx + 1}`}</span>
                                            {sortCol === idx && (
                                                <span style={{ fontSize: 10, color: '#0284c7' }}>{sortAsc ? '▲' : '▼'}</span>
                                            )}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {topPadHeight > 0 && (
                                <tr style={{ height: `${topPadHeight}px`, border: 'none' }}>
                                    <td colSpan={headers.length + 1} style={{ padding: 0, border: 'none', background: 'transparent' }} />
                                </tr>
                            )}
                            {visibleRows.map((row, relIdx) => {
                                const rowIdx = startIndex + relIdx;
                                return (
                                    <tr key={rowIdx} style={{ height: `${ROW_HEIGHT}px` }}>
                                        <td style={{ textAlign: 'center', background: '#f8fafc', color: '#64748b', fontWeight: 600 }}>
                                            {rowIdx + 1}
                                        </td>
                                        {headers.map((_, colIdx) => (
                                            <td key={colIdx} title={row[colIdx] || ''}>
                                                {row[colIdx] || ''}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })}
                            {bottomPadHeight > 0 && (
                                <tr style={{ height: `${bottomPadHeight}px`, border: 'none' }}>
                                    <td colSpan={headers.length + 1} style={{ padding: 0, border: 'none', background: 'transparent' }} />
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            {/* Minimalist status bar showing metrics */}
            <div className="m365-grid-status-bar">
                <span>
                    Showing <strong>{totalRows.toLocaleString()}</strong> rows • <strong>{headers.length}</strong> columns
                    {debouncedQuery && ` (filtered from ${bodyRows.length.toLocaleString()})`}
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
