import React, { Suspense, useEffect, useState, useMemo, useCallback } from 'react';
import type { FileViewerProps, FileType } from './types';
import { detectFileType, formatBytes, downloadFile, getOfficeBadge } from './utils';
import './FileViewer.css';

// Lazy-load sub-viewers on demand to ensure zero bloat when not opened
const PdfViewer = React.lazy(() => import('./viewers/PdfViewer'));
const DocxViewer = React.lazy(() => import('./viewers/DocxViewer'));
const SpreadsheetViewer = React.lazy(() => import('./viewers/SpreadsheetViewer'));
const CsvViewer = React.lazy(() => import('./viewers/CsvViewer'));
const ImageViewer = React.lazy(() => import('./viewers/ImageViewer'));
const VideoViewer = React.lazy(() => import('./viewers/VideoViewer'));
const AudioViewer = React.lazy(() => import('./viewers/AudioViewer'));
const UnsupportedViewer = React.lazy(() => import('./viewers/UnsupportedViewer'));

export default function FileViewer({ file, onClose }: FileViewerProps) {
    if (!file) return null;

    const fileType: FileType = useMemo(
        () => detectFileType(file.filename, file.contentType),
        [file.filename, file.contentType]
    );

    const badge = useMemo(() => getOfficeBadge(fileType), [fileType]);

    // Toolbar & Viewer state
    const [zoom, setZoom] = useState<number>(100);
    const [fitMode, setFitMode] = useState<'custom' | 'width' | 'screen'>('custom');
    const [currentFitZoom, setCurrentFitZoom] = useState<number | null>(null);
    const [zoomInput, setZoomInput] = useState<string>('100');
    const [isFullscreen, setIsFullscreen] = useState(false);

    // PDF state
    const [pageNumber, setPageNumber] = useState(1);
    const [numPages, setNumPages] = useState(1);
    const [pageInput, setPageInput] = useState<string>('1');
    const [requestedPage, setRequestedPage] = useState<{ page: number; timestamp: number } | null>(null);
    const [isTwoPageView, setIsTwoPageView] = useState(false);

    // Spreadsheet state
    const [sheets, setSheets] = useState<string[]>([]);
    const [activeSheet, setActiveSheet] = useState<string>('');

    // CSV state
    const [searchQuery, setSearchQuery] = useState('');

    // Image state
    const [rotation, setRotation] = useState(0);

    // Reset view state when opening a different file
    useEffect(() => {
        setZoom(100);
        setFitMode(fileType === 'image' ? 'screen' : 'custom');
        setCurrentFitZoom(null);
        setZoomInput('100');
        setPageNumber(1);
        setNumPages(1);
        setPageInput('1');
        setRequestedPage(null);
        setIsTwoPageView(false);
        setSheets([]);
        setActiveSheet('');
        setSearchQuery('');
        setRotation(0);
    }, [file.url, fileType]);

    // Keep pageInput synced with pageNumber
    useEffect(() => {
        setPageInput(String(pageNumber));
    }, [pageNumber]);

    // Keep zoomInput synced with zoom / fit zoom
    useEffect(() => {
        if (fileType === 'image' && fitMode === 'screen' && currentFitZoom) {
            setZoomInput(String(currentFitZoom));
        } else {
            setZoomInput(String(zoom));
        }
    }, [zoom, fitMode, currentFitZoom, fileType]);

    const handleFitZoomComputed = useCallback((fitPercent: number) => {
        setCurrentFitZoom(fitPercent);
        if (fitMode === 'screen') {
            setZoomInput(String(fitPercent));
        }
    }, [fitMode]);

    // Handle Escape key to close
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        // Lock body scrolling
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [onClose]);

    // Commit page input on Enter or blur
    const commitPageInput = () => {
        const parsed = parseInt(pageInput.trim(), 10);
        if (!isNaN(parsed)) {
            const clamped = Math.max(1, Math.min(numPages, parsed));
            setPageNumber(clamped);
            setPageInput(String(clamped));
            setRequestedPage({ page: clamped, timestamp: Date.now() });
        } else {
            setPageInput(String(pageNumber));
        }
    };

    // Commit zoom input on Enter or blur
    const commitZoomInput = () => {
        const cleaned = zoomInput.replace(/[^0-9]/g, '');
        const parsed = parseInt(cleaned, 10);
        if (!isNaN(parsed) && parsed > 0) {
            const clamped = Math.max(25, Math.min(400, parsed));
            setFitMode('custom');
            setZoom(clamped);
            setZoomInput(String(clamped));
        } else {
            const fallback = (fileType === 'image' && fitMode === 'screen' && currentFitZoom) ? currentFitZoom : zoom;
            setZoomInput(String(fallback));
        }
    };

    // Zoom handlers
    const zoomIn = () => {
        let baseZoom = zoom;
        if (fileType === 'image' && fitMode === 'screen' && currentFitZoom) {
            baseZoom = currentFitZoom;
        }
        const next = Math.min(400, Math.round((baseZoom + 10) / 5) * 5);
        setFitMode('custom');
        setZoom(next);
        setZoomInput(String(next));
    };

    const zoomOut = () => {
        let baseZoom = zoom;
        if (fileType === 'image' && fitMode === 'screen' && currentFitZoom) {
            baseZoom = currentFitZoom;
        }
        const next = Math.max(25, Math.round((baseZoom - 10) / 5) * 5);
        setFitMode('custom');
        setZoom(next);
        setZoomInput(String(next));
    };

    const resetZoom = () => {
        setFitMode('custom');
        setZoom(100);
        setZoomInput('100');
    };

    const toggleFit = () => {
        if (fileType === 'image') {
            if (fitMode === 'screen') {
                setFitMode('custom');
                setZoom(100);
                setZoomInput('100');
            } else {
                setFitMode('screen');
                if (currentFitZoom) {
                    setZoomInput(String(currentFitZoom));
                }
            }
        } else {
            setFitMode(prev => (prev === 'width' ? 'custom' : 'width'));
            if (fitMode !== 'width') {
                setZoom(100);
                setZoomInput('100');
            }
        }
    };

    const rotateImage = () => {
        setRotation(prev => (prev + 90) % 360);
    };

    const toggleFullscreen = useCallback(() => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen?.().catch(() => {});
            setIsFullscreen(true);
        } else {
            document.exitFullscreen?.().catch(() => {});
            setIsFullscreen(false);
        }
    }, []);

    useEffect(() => {
        const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', onFsChange);
        return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    const handleSheetsLoaded = useCallback((loadedSheets: string[], defaultSheet: string) => {
        setSheets(loadedSheets);
        setActiveSheet(defaultSheet);
    }, []);

    return (
        <div className="m365-viewer-backdrop" onClick={onClose}>
            <div
                className={`m365-viewer-container ${isFullscreen ? 'is-fullscreen' : ''}`}
                onClick={e => e.stopPropagation()}
            >
                {/* ── Microsoft 365 Thin Sticky Toolbar ── */}
                <div className="m365-toolbar">
                    {/* Left: Badge, File Name, Size */}
                    <div className="m365-toolbar-left">
                        <span
                            className="m365-file-badge"
                            style={{ background: badge.bg, color: badge.color }}
                        >
                            {badge.label}
                        </span>
                        <span className="m365-file-title" title={file.filename}>
                            {file.filename}
                        </span>
                        {file.sizeBytes !== undefined && (
                            <span className="m365-file-size">
                                • {formatBytes(file.sizeBytes)}
                            </span>
                        )}
                    </div>

                    {/* Center: Contextual Tools based on File Type */}
                    <div className="m365-toolbar-center">
                        {/* PDF Page Navigation */}
                        {fileType === 'pdf' && (
                            <>
                                <button
                                    type="button"
                                    className="m365-btn m365-btn-icon"
                                    onClick={() => {
                                        const next = Math.max(pageNumber - 1, 1);
                                        setPageNumber(next);
                                        setRequestedPage({ page: next, timestamp: Date.now() });
                                    }}
                                    disabled={pageNumber <= 1}
                                    title="Previous Page (Left Arrow)"
                                >
                                    ‹
                                </button>
                                <div className="m365-nav-input-wrap">
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        className="m365-page-input"
                                        value={pageInput}
                                        onChange={e => setPageInput(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                                commitPageInput();
                                                (e.target as HTMLInputElement).blur();
                                            }
                                        }}
                                        onBlur={commitPageInput}
                                        title="Type a page number and press Enter to navigate"
                                        aria-label="Current page number"
                                    />
                                    <span className="m365-nav-total">/ {numPages}</span>
                                </div>
                                <button
                                    type="button"
                                    className="m365-btn m365-btn-icon"
                                    onClick={() => {
                                        const next = Math.min(pageNumber + 1, numPages);
                                        setPageNumber(next);
                                        setRequestedPage({ page: next, timestamp: Date.now() });
                                    }}
                                    disabled={pageNumber >= numPages}
                                    title="Next Page (Right Arrow)"
                                >
                                    ›
                                </button>
                                <div className="m365-separator" />
                            </>
                        )}

                        {/* Excel Sheet Tabs */}
                        {fileType === 'xlsx' && sheets.length > 0 && (
                            <>
                                <div className="m365-sheet-tabs">
                                    {sheets.map(sheet => (
                                        <button
                                            key={sheet}
                                            type="button"
                                            className={`m365-sheet-tab ${activeSheet === sheet ? 'active' : ''}`}
                                            onClick={() => setActiveSheet(sheet)}
                                        >
                                            {sheet}
                                        </button>
                                    ))}
                                </div>
                                <div className="m365-separator" />
                            </>
                        )}

                        {/* CSV Search Filter */}
                        {fileType === 'csv' && (
                            <>
                                <input
                                    type="text"
                                    className="m365-search-input"
                                    placeholder="🔍 Filter CSV..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                />
                                <div className="m365-separator" />
                            </>
                        )}

                        {/* Zoom Controls (PDF, DOCX, XLSX, CSV, Image) */}
                        {['pdf', 'docx', 'xlsx', 'csv', 'image'].includes(fileType) && (
                            <>
                                <button
                                    type="button"
                                    className="m365-btn m365-btn-icon"
                                    onClick={zoomOut}
                                    disabled={zoom <= 25}
                                    title="Zoom Out"
                                >
                                    −
                                </button>
                                <div className="m365-zoom-input-wrap" title="Type a zoom percentage and press Enter (25% - 400%)">
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        className="m365-zoom-input"
                                        value={zoomInput}
                                        onChange={e => setZoomInput(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                                commitZoomInput();
                                                (e.target as HTMLInputElement).blur();
                                            }
                                        }}
                                        onBlur={commitZoomInput}
                                        aria-label="Zoom level percentage"
                                    />
                                    <span className="m365-zoom-unit">%</span>
                                </div>
                                <button
                                    type="button"
                                    className="m365-btn m365-btn-icon"
                                    onClick={zoomIn}
                                    disabled={zoom >= 400}
                                    title="Zoom In"
                                >
                                    +
                                </button>
                            </>
                        )}

                        {/* Fit Mode Button (PDF, DOCX, Image) */}
                        {['pdf', 'docx', 'image'].includes(fileType) && (
                            <button
                                type="button"
                                className={`m365-btn ${fitMode !== 'custom' ? 'active' : ''}`}
                                onClick={toggleFit}
                                title={fileType === 'image' ? 'Fit to Screen' : 'Fit to Width'}
                            >
                                <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
                                    <path d="M1.5 1a.5.5 0 0 0-.5.5v3a.5.5 0 0 1-1 0v-3A1.5 1.5 0 0 1 1.5 0h3a.5.5 0 0 1 0 1h-3zM11 1a.5.5 0 0 1 .5-.5h3A1.5 1.5 0 0 1 16 2v3a.5.5 0 0 1-1 0V2a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 1-.5-.5zM.5 11a.5.5 0 0 1 .5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 1 0 1h-3A1.5 1.5 0 0 1 0 14.5v-3a.5.5 0 0 1 .5-.5zm15 0a.5.5 0 0 1 .5.5v3a1.5 1.5 0 0 1-1.5 1.5h-3a.5.5 0 0 1 0-1h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 1 .5-.5z" />
                                </svg>
                                <span className="m365-btn-label">Fit</span>
                            </button>
                        )}

                        {/* PDF Two-Page View Toggle */}
                        {fileType === 'pdf' && (
                            <button
                                type="button"
                                className={`m365-btn ${isTwoPageView ? 'active' : ''}`}
                                onClick={() => setIsTwoPageView(prev => !prev)}
                                title={isTwoPageView ? 'Switch to Single-Page View' : 'Switch to Two-Page Spread View'}
                                style={{ gap: 6 }}
                            >
                                <span style={{ fontSize: 13 }}>{isTwoPageView ? '📖' : '📄'}</span>
                                <span className="m365-btn-label">{isTwoPageView ? 'Two Pages' : 'Single Page'}</span>
                            </button>
                        )}

                        {/* Image Rotate Button */}
                        {fileType === 'image' && (
                            <button
                                type="button"
                                className="m365-btn"
                                onClick={rotateImage}
                                title="Rotate 90°"
                            >
                                <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
                                    <path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z" />
                                    <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z" />
                                </svg>
                                <span className="m365-btn-label">Rotate</span>
                            </button>
                        )}
                    </div>

                    {/* Right: Fullscreen, Download, Close */}
                    <div className="m365-toolbar-right">
                        {/* Fullscreen Button */}
                        <button
                            type="button"
                            className="m365-btn m365-btn-icon"
                            onClick={toggleFullscreen}
                            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                        >
                            {isFullscreen ? (
                                <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
                                    <path d="M5.5 0a.5.5 0 0 1 .5.5v4A1.5 1.5 0 0 1 4.5 6h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 10.5 4.5v-4a.5.5 0 0 1 .5-.5zM0 10.5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 6 11.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zm10.5 1a1.5 1.5 0 0 1 1.5-1.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4z" />
                                </svg>
                            ) : (
                                <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
                                    <path fillRule="evenodd" d="M5.828 10.172a.5.5 0 0 0-.707 0l-4.096 4.096V11.5a.5.5 0 0 0-1 0v3.975a.5.5 0 0 0 .5.5H4.5a.5.5 0 0 0 0-1H1.732l4.096-4.096a.5.5 0 0 0 0-.707zm4.344 0a.5.5 0 0 1 .707 0l4.096 4.096V11.5a.5.5 0 1 1 1 0v3.975a.5.5 0 0 1-.5.5H11.5a.5.5 0 0 1 0-1h2.768l-4.096-4.096a.5.5 0 0 1 0-.707zm0-4.344a.5.5 0 0 0 .707 0l4.096-4.096V4.5a.5.5 0 1 0 1 0V.525a.5.5 0 0 0-.5-.5H11.5a.5.5 0 0 0 0 1h2.768l-4.096 4.096a.5.5 0 0 0 0 .707zm-4.344 0a.5.5 0 0 1-.707 0L1.025 1.732V4.5a.5.5 0 0 1-1 0V.525a.5.5 0 0 1 .5-.5H4.5a.5.5 0 0 1 0 1H1.732l4.096 4.096a.5.5 0 0 1 0 .707z" />
                                </svg>
                            )}
                        </button>

                        {/* Download Button */}
                        <button
                            type="button"
                            className="m365-btn"
                            onClick={() => downloadFile(file.url, file.filename)}
                            title="Download original file"
                            style={{ background: '#0078d4', color: '#ffffff', borderColor: '#0078d4' }}
                        >
                            <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
                                <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
                                <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z" />
                            </svg>
                            <span className="m365-btn-label">Download</span>
                        </button>

                        <div className="m365-separator" />

                        {/* Close Button */}
                        <button
                            type="button"
                            className="m365-btn-close"
                            onClick={onClose}
                            title="Close Preview (Esc)"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* ── Document Viewport with Suspense fallback ── */}
                <div className={`m365-viewport ${['xlsx', 'csv'].includes(fileType) ? 'is-grid-mode' : ''}`}>
                    <Suspense
                        fallback={
                            <div className="m365-loading-state">
                                <div style={{ fontSize: 32 }}>⏳</div>
                                <div style={{ fontWeight: 600 }}>Loading document viewer...</div>
                            </div>
                        }
                    >
                        {fileType === 'pdf' && (
                            <PdfViewer
                                file={file}
                                zoom={zoom}
                                onZoomChange={setZoom}
                                fitMode={fitMode}
                                onFitModeChange={setFitMode}
                                isFullscreen={isFullscreen}
                                onToggleFullscreen={toggleFullscreen}
                                pageNumber={pageNumber}
                                numPages={numPages}
                                onPageChange={setPageNumber}
                                onNumPagesLoaded={setNumPages}
                                requestedPage={requestedPage}
                                isTwoPageView={isTwoPageView}
                                onToggleTwoPageView={() => setIsTwoPageView(p => !p)}
                            />
                        )}

                        {fileType === 'docx' && (
                            <DocxViewer
                                file={file}
                                zoom={zoom}
                                onZoomChange={setZoom}
                                fitMode={fitMode}
                                onFitModeChange={setFitMode}
                                isFullscreen={isFullscreen}
                                onToggleFullscreen={toggleFullscreen}
                            />
                        )}

                        {fileType === 'xlsx' && (
                            <SpreadsheetViewer
                                file={file}
                                zoom={zoom}
                                onZoomChange={setZoom}
                                fitMode={fitMode}
                                onFitModeChange={setFitMode}
                                isFullscreen={isFullscreen}
                                onToggleFullscreen={toggleFullscreen}
                                sheets={sheets}
                                activeSheet={activeSheet}
                                onSheetChange={setActiveSheet}
                                onSheetsLoaded={handleSheetsLoaded}
                            />
                        )}

                        {fileType === 'csv' && (
                            <CsvViewer
                                file={file}
                                zoom={zoom}
                                onZoomChange={setZoom}
                                fitMode={fitMode}
                                onFitModeChange={setFitMode}
                                isFullscreen={isFullscreen}
                                onToggleFullscreen={toggleFullscreen}
                                searchQuery={searchQuery}
                                onSearchQueryChange={setSearchQuery}
                            />
                        )}

                        {fileType === 'image' && (
                            <ImageViewer
                                file={file}
                                zoom={zoom}
                                onZoomChange={setZoom}
                                fitMode={fitMode}
                                onFitModeChange={setFitMode}
                                isFullscreen={isFullscreen}
                                onToggleFullscreen={toggleFullscreen}
                                rotation={rotation}
                                onRotate={rotateImage}
                                onFitZoomComputed={handleFitZoomComputed}
                            />
                        )}

                        {fileType === 'video' && (
                            <VideoViewer
                                file={file}
                                zoom={zoom}
                                onZoomChange={setZoom}
                                fitMode={fitMode}
                                onFitModeChange={setFitMode}
                                isFullscreen={isFullscreen}
                                onToggleFullscreen={toggleFullscreen}
                            />
                        )}

                        {fileType === 'audio' && (
                            <AudioViewer
                                file={file}
                                zoom={zoom}
                                onZoomChange={setZoom}
                                fitMode={fitMode}
                                onFitModeChange={setFitMode}
                                isFullscreen={isFullscreen}
                                onToggleFullscreen={toggleFullscreen}
                            />
                        )}

                        {fileType === 'unsupported' && (
                            <UnsupportedViewer
                                file={file}
                                zoom={zoom}
                                onZoomChange={setZoom}
                                fitMode={fitMode}
                                onFitModeChange={setFitMode}
                                isFullscreen={isFullscreen}
                                onToggleFullscreen={toggleFullscreen}
                            />
                        )}
                    </Suspense>
                </div>
            </div>
        </div>
    );
}
