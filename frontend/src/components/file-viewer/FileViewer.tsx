import React, { Suspense, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import type { FileViewerProps, FileType, FileViewerFile } from './types';
import { detectFileType, formatBytes, downloadFile, getOfficeBadge } from './utils';
import { getCachedFile, setCachedFile } from './fileCache';
import './FileViewer.css';

// Lazy-load sub-viewers on demand to ensure zero bloat when not opened
const PdfViewer = React.lazy(() => import('./viewers/PdfViewer'));
const DocxViewer = React.lazy(() => import('./viewers/DocxViewer'));
const SpreadsheetViewer = React.lazy(() => import('./viewers/SpreadsheetViewer'));
const CsvViewer = React.lazy(() => import('./viewers/CsvViewer'));
const TxtViewer = React.lazy(() => import('./viewers/TxtViewer'));
const ImageViewer = React.lazy(() => import('./viewers/ImageViewer'));
const VideoViewer = React.lazy(() => import('./viewers/VideoViewer'));
const AudioViewer = React.lazy(() => import('./viewers/AudioViewer'));
const PptxViewer = React.lazy(() => import('./viewers/PptxViewer'));
const UnsupportedViewer = React.lazy(() => import('./viewers/UnsupportedViewer'));

export default function FileViewer({ file: initialFile, files, onClose, onFileChange }: FileViewerProps) {
    const [activeFile, setActiveFile] = useState<FileViewerFile | null>(initialFile);

    // Download and Progress State
    const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'ready' | 'error'>('idle');
    const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
    const [downloadLoaded, setDownloadLoaded] = useState<number>(0);
    const [downloadTotal, setDownloadTotal] = useState<number>(initialFile?.sizeBytes || 0);
    const [downloadStatusText, setDownloadStatusText] = useState<string>('Connecting to server...');
    const [downloadError, setDownloadError] = useState<string>('');
    const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
    const [fileBlobUrl, setFileBlobUrl] = useState<string | null>(null);

    useEffect(() => {
        setFileBuffer(null);
        setFileBlobUrl(null);
        setDownloadStatus('idle');
        setActiveFile(initialFile);
    }, [initialFile]);

    const file = activeFile || initialFile;

    const fileList = useMemo(() => {
        if (files && files.length > 0) return files;
        return file ? [file] : [];
    }, [files, file]);

    const currentIndex = useMemo(() => {
        if (!file || fileList.length === 0) return -1;
        const idxById = file.id ? fileList.findIndex(f => f.id === file.id) : -1;
        if (idxById !== -1) return idxById;
        return fileList.findIndex(f => f.url === file.url || f.filename === file.filename);
    }, [fileList, file]);

    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex >= 0 && currentIndex < fileList.length - 1;

    const prevFile = hasPrev ? fileList[currentIndex - 1] : null;
    const nextFile = hasNext ? fileList[currentIndex + 1] : null;

    const navigateTo = useCallback((targetIndex: number) => {
        if (targetIndex < 0 || targetIndex >= fileList.length) return;
        const nextTarget = fileList[targetIndex];
        if (!nextTarget) return;
        setFileBuffer(null);
        setFileBlobUrl(null);
        setDownloadStatus('idle');
        setActiveFile(nextTarget);
        if (onFileChange) {
            onFileChange(nextTarget);
        }
    }, [fileList, onFileChange]);

    const handlePrev = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (hasPrev) {
            navigateTo(currentIndex - 1);
        }
    }, [hasPrev, currentIndex, navigateTo]);

    const handleNext = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (hasNext) {
            navigateTo(currentIndex + 1);
        }
    }, [hasNext, currentIndex, navigateTo]);

    const fileType: FileType = useMemo(
        () => file ? detectFileType(file.filename, file.contentType) : 'unsupported',
        [file?.filename, file?.contentType]
    );

    const badge = useMemo(() => getOfficeBadge(fileType), [fileType]);

    // Keyboard navigation: Alt+Left / Alt+Right anywhere, or ArrowLeft / ArrowRight for non-paginated files
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const activeTag = document.activeElement?.tagName.toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable) {
                return;
            }

            if (e.key === 'ArrowLeft' && (e.altKey || (fileType !== 'pdf' && fileType !== 'pptx'))) {
                if (hasPrev) {
                    e.preventDefault();
                    handlePrev();
                }
            } else if (e.key === 'ArrowRight' && (e.altKey || (fileType !== 'pdf' && fileType !== 'pptx'))) {
                if (hasNext) {
                    e.preventDefault();
                    handleNext();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [hasPrev, hasNext, handlePrev, handleNext, fileType]);

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
    const [isPanMode, setIsPanMode] = useState(true);

    // Spreadsheet state
    const [sheets, setSheets] = useState<string[]>([]);
    const [activeSheet, setActiveSheet] = useState<string>('');
    const sheetTabsRef = useRef<HTMLDivElement>(null);

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
        setIsPanMode(true);
        setSheets([]);
        setActiveSheet('');
        setSearchQuery('');
        setRotation(0);
    }, [file?.url, fileType]);

    // Download file buffer with real-time progress
    useEffect(() => {
        if (!file?.url) return;

        // Reset state for new file
        setDownloadError('');
        setDownloadLoaded(0);
        setDownloadTotal(file?.sizeBytes || 0);

        // Check in-memory cache first for instant opening
        const cached = getCachedFile(file.url);
        if (cached) {
            setFileBuffer(cached.buffer);
            setFileBlobUrl(cached.blobUrl);
            setDownloadPercent(100);
            setDownloadStatus('ready');
            return;
        }

        // For unsupported files, no need to download binary upfront
        if (fileType === 'unsupported') {
            setFileBuffer(null);
            setFileBlobUrl(null);
            setDownloadStatus('ready');
            return;
        }

        let isMounted = true;
        setFileBuffer(null);
        setFileBlobUrl(null);
        setDownloadStatus('downloading');
        setDownloadPercent(0);
        setDownloadStatusText('Connecting to server...');

        const token = localStorage.getItem('token');
        const xhr = new XMLHttpRequest();
        xhr.open('GET', file.url, true);
        xhr.responseType = 'arraybuffer';
        if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }

        const slowTimer = setTimeout(() => {
            if (isMounted) {
                setDownloadStatusText('Retrieving attachment from mail server...');
            }
        }, 1200);

        xhr.onprogress = (e) => {
            if (!isMounted) return;
            clearTimeout(slowTimer);

            const total = (e.lengthComputable && e.total > 0) ? e.total : (file.sizeBytes || 0);
            const loaded = e.loaded;
            setDownloadLoaded(loaded);

            if (total > 0) {
                setDownloadTotal(total);
                const pct = Math.min(99, Math.round((loaded / total) * 100));
                setDownloadPercent(pct);
                setDownloadStatusText(`Downloading... ${formatBytes(loaded)} of ${formatBytes(total)}`);
            } else {
                setDownloadPercent(null);
                setDownloadStatusText(`Downloading... ${formatBytes(loaded)}`);
            }
        };

        xhr.onload = () => {
            clearTimeout(slowTimer);
            if (!isMounted) return;

            if (xhr.status >= 200 && xhr.status < 300) {
                const buffer = xhr.response as ArrayBuffer;
                if (!buffer || buffer.byteLength === 0) {
                    setDownloadError('File content is empty.');
                    setDownloadStatus('error');
                    return;
                }
                const contentType = xhr.getResponseHeader('Content-Type') || file.contentType || undefined;
                const { blobUrl } = setCachedFile(file.url, buffer, contentType);
                setFileBuffer(buffer.slice(0));
                setFileBlobUrl(blobUrl);
                setDownloadPercent(100);
                setDownloadStatusText('Preparing document preview...');
                setTimeout(() => {
                    if (isMounted) setDownloadStatus('ready');
                }, 60);
            } else {
                setDownloadError(`Failed to load file (${xhr.status} ${xhr.statusText || 'Error'})`);
                setDownloadStatus('error');
            }
        };

        xhr.onerror = () => {
            clearTimeout(slowTimer);
            if (isMounted) {
                setDownloadError('Network error while connecting to server. Please check your connection.');
                setDownloadStatus('error');
            }
        };

        xhr.ontimeout = () => {
            clearTimeout(slowTimer);
            if (isMounted) {
                setDownloadError('Request timed out while downloading the file.');
                setDownloadStatus('error');
            }
        };

        xhr.send();

        return () => {
            isMounted = false;
            clearTimeout(slowTimer);
            xhr.abort();
        };
    }, [file?.url, file?.sizeBytes, file?.contentType, fileType]);

    const handleDownloadCurrentFile = useCallback(() => {
        if (!file) return;
        if (fileBlobUrl) {
            const a = document.createElement('a');
            a.href = fileBlobUrl;
            a.download = file.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } else {
            downloadFile(file.url, file.filename);
        }
    }, [fileBlobUrl, file]);

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

    // Handle H / V hotkeys for PDF tool switching (H: Hand / Pan, V: Cursor / Select)
    useEffect(() => {
        if (fileType !== 'pdf') return;
        const handleKeyDown = (e: KeyboardEvent) => {
            const activeTag = (document.activeElement?.tagName || '').toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            if (e.key === 'h' || e.key === 'H') {
                setIsPanMode(true);
            } else if (e.key === 'v' || e.key === 'V') {
                setIsPanMode(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [fileType]);

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
            document.documentElement.requestFullscreen?.().catch(() => { });
            setIsFullscreen(true);
        } else {
            document.exitFullscreen?.().catch(() => { });
            setIsFullscreen(false);
        }
    }, []);

    useEffect(() => {
        const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', onFsChange);
        return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    // Center the chosen sheet in the scrollable sheets tab bar
    const centerActiveSheetTab = useCallback((sheetName?: string) => {
        if (!sheetTabsRef.current) return;
        const container = sheetTabsRef.current;
        const targetSheet = sheetName || activeSheet;
        if (!targetSheet) return;

        requestAnimationFrame(() => {
            if (!container) return;
            const tabs = Array.from(container.querySelectorAll('.m365-sheet-tab')) as HTMLElement[];
            const activeTabEl = tabs.find(el => el.getAttribute('data-sheet') === targetSheet)
                || (container.querySelector('.m365-sheet-tab.active') as HTMLElement | null);
            if (!activeTabEl) return;

            const containerRect = container.getBoundingClientRect();
            const tabRect = activeTabEl.getBoundingClientRect();
            const currentScroll = container.scrollLeft;
            const offsetFromContainer = tabRect.left - containerRect.left + currentScroll;
            const targetScrollLeft = offsetFromContainer - (container.clientWidth / 2) + (tabRect.width / 2);

            container.scrollTo({
                left: Math.max(0, targetScrollLeft),
                behavior: 'smooth',
            });
        });
    }, [activeSheet]);

    // Automatically center active sheet tab when activeSheet changes or sheets are loaded
    useEffect(() => {
        if (fileType === 'xlsx' && activeSheet) {
            centerActiveSheetTab(activeSheet);
        }
    }, [fileType, activeSheet, sheets, centerActiveSheetTab]);

    // Recenter active sheet tab on window resize
    useEffect(() => {
        const handleResize = () => {
            if (fileType === 'xlsx' && activeSheet) {
                centerActiveSheetTab(activeSheet);
            }
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [fileType, activeSheet, centerActiveSheetTab]);

    const handleSheetsLoaded = useCallback((loadedSheets: string[], defaultSheet: string) => {
        setSheets(loadedSheets);
        setActiveSheet(defaultSheet);
    }, []);

    if (!file) return null;

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
                        {fileList.length > 1 && (
                            <span
                                className="m365-attachment-counter"
                                title={`Viewing attachment ${currentIndex + 1} of ${fileList.length}`}
                            >
                                {currentIndex + 1} of {fileList.length}
                            </span>
                        )}
                    </div>

                    {/* Center: Contextual Tools based on File Type */}
                    <div className="m365-toolbar-center">
                        {/* PDF / PPTX Page & Slide Navigation */}
                        {(fileType === 'pdf' || fileType === 'pptx') && (
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
                                    title={fileType === 'pptx' ? "Previous Slide (Up / Left Arrow)" : "Previous Page (Left Arrow)"}
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
                                        title={fileType === 'pptx' ? "Type a slide number and press Enter" : "Type a page number and press Enter"}
                                        aria-label="Current page/slide number"
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
                                    title={fileType === 'pptx' ? "Next Slide (Down / Right Arrow)" : "Next Page (Right Arrow)"}
                                >
                                    ›
                                </button>
                                <div className="m365-separator" />
                            </>
                        )}

                        {/* Excel Sheet Tabs */}
                        {fileType === 'xlsx' && sheets.length > 0 && (
                            <>
                                <div className="m365-sheet-tabs" ref={sheetTabsRef}>
                                    {sheets.map(sheet => (
                                        <button
                                            key={sheet}
                                            type="button"
                                            data-sheet={sheet}
                                            className={`m365-sheet-tab ${activeSheet === sheet ? 'active' : ''}`}
                                            onClick={() => {
                                                setActiveSheet(sheet);
                                                centerActiveSheetTab(sheet);
                                            }}
                                            title={`Switch to ${sheet}`}
                                        >
                                            {sheet}
                                        </button>
                                    ))}
                                </div>
                                <div className="m365-separator" />
                            </>
                        )}

                        {/* CSV & TXT Search Filter */}
                        {(fileType === 'csv' || fileType === 'txt') && (
                            <>
                                <input
                                    type="text"
                                    className="m365-search-input"
                                    placeholder={fileType === 'txt' ? "🔍 Search text..." : "🔍 Filter CSV..."}
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                />
                                <div className="m365-separator" />
                            </>
                        )}

                        {/* Zoom Controls (PDF, DOCX, XLSX, CSV, TXT, Image) */}
                        {['pdf', 'docx', 'xlsx', 'csv', 'txt', 'image'].includes(fileType) && (
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

                        {/* Fit Mode Button (PDF, DOC, DOCX, Image) */}
                        {['pdf', 'doc', 'docx', 'image'].includes(fileType) && (
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
                                <span className="m365-btn-label">{isTwoPageView ? 'Two Pages' : 'Single Page'}</span>
                            </button>
                        )}

                        {/* PDF Cursor vs Pan Mode Toggle */}
                        {fileType === 'pdf' && (
                            <div
                                className="m365-mode-toggle"
                                role="group"
                                aria-label="Cursor or Pan mode"
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    background: '#f3f2f1',
                                    borderRadius: 4,
                                    padding: 2,
                                    border: '1px solid #e1dfdd',
                                    gap: 2,
                                }}
                            >
                                <button
                                    type="button"
                                    className={`m365-btn ${!isPanMode ? 'active' : ''}`}
                                    onClick={() => setIsPanMode(false)}
                                    title="Cursor / Selection Tool: Select text and click normally (Shortcut: V)"
                                    style={{
                                        height: 26,
                                        padding: '0 8px',
                                        fontSize: 12,
                                        borderRadius: 3,
                                        border: 'none',
                                        gap: 5,
                                        background: !isPanMode ? '#ffffff' : 'transparent',
                                        color: !isPanMode ? '#0078d4' : '#605e5c',
                                        fontWeight: !isPanMode ? 600 : 500,
                                        boxShadow: !isPanMode ? '0 1px 2px rgba(0, 0, 0, 0.1)' : 'none',
                                        cursor: 'pointer',
                                        transition: 'all 0.12s ease',
                                    }}
                                >
                                    <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                                        <path d="M14.082 2.182a.5.5 0 0 0-.7-.7L1.87 8.358a.5.5 0 0 0 .11.87l4.316 1.726 1.726 4.317a.5.5 0 0 0 .87.11l6.876-11.513a.5.5 0 0 0-.686-.686zM6.924 10.37L3.488 8.995 12.56 3.652 7.218 12.724 5.842 9.288l1.082-1.082z" />
                                    </svg>
                                    <span className="m365-btn-label">Cursor</span>
                                </button>

                                <button
                                    type="button"
                                    className={`m365-btn ${isPanMode ? 'active' : ''}`}
                                    onClick={() => setIsPanMode(true)}
                                    title="Hand Pan Tool: Click and drag anywhere with the mouse to pan across the PDF (Shortcut: H)"
                                    style={{
                                        height: 26,
                                        padding: '0 8px',
                                        fontSize: 12,
                                        borderRadius: 3,
                                        border: 'none',
                                        gap: 5,
                                        background: isPanMode ? '#ffffff' : 'transparent',
                                        color: isPanMode ? '#0078d4' : '#605e5c',
                                        fontWeight: isPanMode ? 600 : 500,
                                        boxShadow: isPanMode ? '0 1px 2px rgba(0, 0, 0, 0.1)' : 'none',
                                        cursor: 'pointer',
                                        transition: 'all 0.12s ease',
                                    }}
                                >
                                    <span style={{ fontSize: 12 }}>✋</span>
                                    <span className="m365-btn-label">Pan</span>
                                </button>
                            </div>
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
                            onClick={handleDownloadCurrentFile}
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

                {/* ── Document Viewport with Download Progress, Error, & Suspense fallback ── */}
                <div className={`m365-viewport ${['xlsx', 'csv'].includes(fileType) ? 'is-grid-mode' : ''}`}>
                    {downloadStatus === 'downloading' && (
                        <div className="m365-loader-overlay">
                            <div className="m365-loader-card">
                                <span
                                    className="m365-loader-badge"
                                    style={{ background: badge.bg, color: badge.color }}
                                >
                                    <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                                        <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2z" />
                                    </svg>
                                    {badge.label}
                                </span>

                                <div className="m365-loader-filename" title={file.filename}>
                                    {file.filename}
                                </div>

                                <div className="m365-loader-filesize">
                                    {formatBytes(downloadTotal || file.sizeBytes || 0)}
                                </div>

                                <div className="m365-progress-track">
                                    <div
                                        className={`m365-progress-fill ${downloadPercent === null ? 'is-indeterminate' : ''}`}
                                        style={{
                                            width: downloadPercent !== null ? `${Math.max(4, downloadPercent)}%` : '40%',
                                            background: badge.bg ? `linear-gradient(90deg, ${badge.bg}, #0284c7)` : undefined,
                                        }}
                                    />
                                </div>

                                <div className="m365-progress-meta">
                                    <span className="m365-progress-status">{downloadStatusText}</span>
                                    <span className="m365-progress-percent">
                                        {downloadPercent !== null ? `${downloadPercent}%` : ''}
                                    </span>
                                </div>

                                <div className="m365-loader-actions">
                                    <button
                                        type="button"
                                        className="m365-btn"
                                        onClick={onClose}
                                        style={{ fontSize: 12, padding: '5px 16px' }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {downloadStatus === 'error' && (
                        <div className="m365-loader-overlay">
                            <div className="m365-error-state" style={{ maxWidth: 440 }}>
                                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: '#000000' }}>
                                    Unable to open file preview
                                </div>
                                <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20, lineHeight: 1.5 }}>
                                    {downloadError || 'Failed to download file from server.'}
                                </div>
                                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDownloadStatus('downloading');
                                            const token = localStorage.getItem('token');
                                            const xhr = new XMLHttpRequest();
                                            xhr.open('GET', file.url, true);
                                            xhr.responseType = 'arraybuffer';
                                            if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
                                            xhr.onload = () => {
                                                if (xhr.status >= 200 && xhr.status < 300) {
                                                    const buf = xhr.response as ArrayBuffer;
                                                    const { blobUrl } = setCachedFile(file.url, buf, file.contentType);
                                                    setFileBuffer(buf);
                                                    setFileBlobUrl(blobUrl);
                                                    setDownloadPercent(100);
                                                    setDownloadStatus('ready');
                                                } else {
                                                    setDownloadError(`Error ${xhr.status}: ${xhr.statusText}`);
                                                    setDownloadStatus('error');
                                                }
                                            };
                                            xhr.onerror = () => {
                                                setDownloadError('Network error while connecting to server.');
                                                setDownloadStatus('error');
                                            };
                                            xhr.send();
                                        }}
                                        style={{
                                            padding: '8px 16px',
                                            borderRadius: 6,
                                            border: '1px solid #0078d4',
                                            background: '#0078d4',
                                            color: '#ffffff',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Try Again
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleDownloadCurrentFile}
                                        style={{
                                            padding: '8px 16px',
                                            borderRadius: 6,
                                            border: '1px solid #cbd5e1',
                                            background: '#ffffff',
                                            color: '#334155',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Download File
                                    </button>
                                    <button
                                        type="button"
                                        onClick={onClose}
                                        style={{
                                            padding: '8px 16px',
                                            borderRadius: 6,
                                            border: '1px solid #e2e8f0',
                                            background: 'transparent',
                                            color: '#64748b',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {downloadStatus === 'ready' && (
                        <Suspense
                            fallback={
                                <div className="m365-loading-state">
                                    <div className="m365-loading-spinner" />
                                    <div style={{ fontWeight: 600, color: '#000000' }}>Initializing document...</div>
                                </div>
                            }
                        >
                            {fileType === 'pdf' && (
                                <PdfViewer
                                    file={file}
                                    fileBuffer={fileBuffer}
                                    fileBlobUrl={fileBlobUrl}
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
                                    isPanMode={isPanMode}
                                    onTogglePanMode={() => setIsPanMode(p => !p)}
                                />
                            )}

                            {fileType === 'docx' && (
                                <DocxViewer
                                    file={file}
                                    fileBuffer={fileBuffer}
                                    fileBlobUrl={fileBlobUrl}
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
                                    fileBuffer={fileBuffer}
                                    fileBlobUrl={fileBlobUrl}
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
                                    fileBuffer={fileBuffer}
                                    fileBlobUrl={fileBlobUrl}
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

                            {fileType === 'txt' && (
                                <TxtViewer
                                    file={file}
                                    fileBuffer={fileBuffer}
                                    fileBlobUrl={fileBlobUrl}
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

                            {fileType === 'pptx' && (
                                <PptxViewer
                                    file={file}
                                    fileBuffer={fileBuffer}
                                    fileBlobUrl={fileBlobUrl}
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
                                />
                            )}

                            {fileType === 'image' && (
                                <ImageViewer
                                    file={file}
                                    fileBuffer={fileBuffer}
                                    fileBlobUrl={fileBlobUrl}
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
                                    fileBuffer={fileBuffer}
                                    fileBlobUrl={fileBlobUrl}
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
                                    fileBuffer={fileBuffer}
                                    fileBlobUrl={fileBlobUrl}
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
                                    fileBuffer={fileBuffer}
                                    fileBlobUrl={fileBlobUrl}
                                    zoom={zoom}
                                    onZoomChange={setZoom}
                                    fitMode={fitMode}
                                    onFitModeChange={setFitMode}
                                    isFullscreen={isFullscreen}
                                    onToggleFullscreen={toggleFullscreen}
                                />
                            )}
                        </Suspense>
                    )}
                </div>

                {/* ── Unified Floating Attachment Navigation Controls (< and >) ── */}
                {hasPrev && (
                    <button
                        type="button"
                        className="m365-nav-floating-btn m365-nav-prev"
                        onClick={handlePrev}
                        title={prevFile ? `Previous Attachment (${currentIndex} of ${fileList.length}): ${prevFile.filename}` : 'Previous Attachment'}
                        aria-label="Previous Attachment"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>
                )}

                {hasNext && (
                    <button
                        type="button"
                        className="m365-nav-floating-btn m365-nav-next"
                        onClick={handleNext}
                        title={nextFile ? `Next Attachment (${currentIndex + 2} of ${fileList.length}): ${nextFile.filename}` : 'Next Attachment'}
                        aria-label="Next Attachment"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                            <polyline points="9 18 15 12 9 6" />
                        </svg>
                    </button>
                )}
            </div>
        </div>
    );
}
