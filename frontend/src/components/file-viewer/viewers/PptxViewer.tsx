// ============================================================
// PptxViewer: Minimalist, Lightweight PowerPoint Presentation Viewer
// Features:
// - Fixed left thumbnail panel (<= 20% viewport width)
// - Selected slide vertically centered in thumbnail panel
// - Discrete 1-slide-per-scroll-unit mouse wheel navigation (no partial scrolling)
// - Distinct selected slide styling with PowerPoint-like aesthetics
// ============================================================

import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { SubViewerProps } from '../types';
import { parsePptx, type ParsedPresentation, type ParsedSlide } from './pptx/pptxParser';
import { SlideCanvas } from './pptx/SlideCanvas';
import { downloadFile } from '../utils';

export default function PptxViewer({
    file,
    fileBuffer,
    zoom,
    fitMode,
    pageNumber = 1,
    onPageChange,
    onNumPagesLoaded,
}: SubViewerProps) {
    const [presentation, setPresentation] = useState<ParsedPresentation | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeSlideIndex, setActiveSlideIndex] = useState(0);

    // Refs
    const thumbnailSidebarRef = useRef<HTMLDivElement>(null);
    const mainViewportRef = useRef<HTMLDivElement>(null);
    const blobUrlsRef = useRef<string[]>([]);

    // Mouse wheel discrete step accumulator & cooldown lock
    const wheelAccumulatorRef = useRef(0);
    const isWheelLockedRef = useRef(false);
    const wheelLockTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const WHEEL_THRESHOLD = 50; // Threshold for 1 complete scroll unit

    // Fetch and parse PPTX file
    useEffect(() => {
        let isMounted = true;
        setLoading(true);
        setError(null);

        // Cleanup previously created blob URLs
        blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
        blobUrlsRef.current = [];

        (async () => {
            try {
                let buffer = fileBuffer;
                if (!buffer || buffer.byteLength === 0) {
                    const token = localStorage.getItem('token');
                    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
                    const res = await fetch(file.url, { headers, credentials: 'include' });
                    if (!res.ok) throw new Error(`Failed to load file (${res.status} ${res.statusText})`);
                    buffer = await res.arrayBuffer();
                }

                if (!isMounted) return;

                const parsed = await parsePptx(buffer);
                if (!isMounted) {
                    parsed.blobUrls.forEach(u => URL.revokeObjectURL(u));
                    return;
                }

                blobUrlsRef.current = parsed.blobUrls;
                setPresentation(parsed);
                onNumPagesLoaded?.(parsed.slides.length);
                setActiveSlideIndex(0);
                onPageChange?.(1);
            } catch (err: any) {
                if (isMounted) {
                    setError(err.message || 'Failed to render PowerPoint presentation');
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        })();

        return () => {
            isMounted = false;
            blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
            blobUrlsRef.current = [];
            if (wheelLockTimeoutRef.current) clearTimeout(wheelLockTimeoutRef.current);
        };
    }, [file.url, fileBuffer]);

    // Sync external pageNumber changes (from toolbar input/arrows)
    useEffect(() => {
        if (!presentation || presentation.slides.length === 0) return;
        const targetIndex = Math.max(0, Math.min(presentation.slides.length - 1, pageNumber - 1));
        if (targetIndex !== activeSlideIndex) {
            setActiveSlideIndex(targetIndex);
        }
    }, [pageNumber, presentation]);

    // Center active thumbnail in the thumbnail sidebar
    const centerActiveThumbnail = useCallback((slideIndex: number, behavior: ScrollBehavior = 'smooth') => {
        const container = thumbnailSidebarRef.current;
        if (!container) return;

        requestAnimationFrame(() => {
            const thumbEl = container.querySelector(`[data-slide-index="${slideIndex}"]`) as HTMLElement;
            if (!thumbEl) return;

            const containerHeight = container.clientHeight;
            const thumbTop = thumbEl.offsetTop;
            const thumbHeight = thumbEl.offsetHeight;

            // Target scroll position to vertically center the active thumbnail
            const targetScrollTop = thumbTop - (containerHeight / 2) + (thumbHeight / 2);

            container.scrollTo({
                top: Math.max(0, targetScrollTop),
                behavior,
            });
        });
    }, []);

    // Slide change handler
    const selectSlide = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
        if (!presentation || presentation.slides.length === 0) return;
        const validIndex = Math.max(0, Math.min(presentation.slides.length - 1, index));
        setActiveSlideIndex(validIndex);
        onPageChange?.(validIndex + 1);
        centerActiveThumbnail(validIndex, behavior);
    }, [presentation, onPageChange, centerActiveThumbnail]);

    // Auto-center thumbnail whenever activeSlideIndex changes
    useEffect(() => {
        if (presentation && presentation.slides.length > 0) {
            centerActiveThumbnail(activeSlideIndex, 'smooth');
        }
    }, [activeSlideIndex, presentation, centerActiveThumbnail]);

    // Discrete Mouse Wheel Navigation: Exactly 1 slide per complete scroll unit
    useEffect(() => {
        const viewport = mainViewportRef.current;
        if (!viewport || !presentation || presentation.slides.length <= 1) return;

        const handleWheel = (e: WheelEvent) => {
            // Stop browser default partial scroll
            e.preventDefault();

            // If in cooldown lock, ignore extra wheel momentum/inertial ticks
            if (isWheelLockedRef.current) {
                return;
            }

            wheelAccumulatorRef.current += e.deltaY;

            // Detect if a complete scroll unit threshold has been crossed
            if (Math.abs(wheelAccumulatorRef.current) >= WHEEL_THRESHOLD) {
                const direction = wheelAccumulatorRef.current > 0 ? 1 : -1;
                wheelAccumulatorRef.current = 0;

                // Lock wheel momentarily to ensure exactly 1 slide per scroll unit
                isWheelLockedRef.current = true;
                if (wheelLockTimeoutRef.current) clearTimeout(wheelLockTimeoutRef.current);
                wheelLockTimeoutRef.current = setTimeout(() => {
                    isWheelLockedRef.current = false;
                }, 300);

                setActiveSlideIndex(prev => {
                    const next = Math.max(0, Math.min(presentation.slides.length - 1, prev + direction));
                    if (next !== prev) {
                        onPageChange?.(next + 1);
                    }
                    return next;
                });
            }
        };

        viewport.addEventListener('wheel', handleWheel, { passive: false });
        return () => {
            viewport.removeEventListener('wheel', handleWheel);
        };
    }, [presentation, onPageChange]);

    // Keyboard navigation: Arrow Up/Down, Left/Right, PageUp/PageDown, Home/End
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const activeTag = (document.activeElement?.tagName || '').toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;
            if (!presentation || presentation.slides.length === 0) return;

            if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
                e.preventDefault();
                selectSlide(activeSlideIndex + 1);
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') {
                e.preventDefault();
                selectSlide(activeSlideIndex - 1);
            } else if (e.key === 'Home') {
                e.preventDefault();
                selectSlide(0);
            } else if (e.key === 'End') {
                e.preventDefault();
                selectSlide(presentation.slides.length - 1);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [presentation, activeSlideIndex, selectSlide]);

    // ── Loading State ──────────────────────────────────────────
    if (loading) {
        return (
            <div className="pptx-status-container">
                <div className="pptx-spinner" />
                <div className="pptx-status-title">Loading PowerPoint Presentation...</div>
                <div className="pptx-status-subtitle">Parsing slide structures, shapes, and media</div>
            </div>
        );
    }

    // ── Legacy Binary PPT Fallback Notice ──────────────────────
    if (presentation?.isLegacyBinaryPpt) {
        return (
            <div className="pptx-status-container">
                <div className="pptx-status-title">Legacy PowerPoint 97-2003 Presentation (.ppt)</div>
                <p className="pptx-status-description">
                    This file is in the legacy binary format. For online slide-by-slide thumbnail preview,
                    please save or convert it as <strong>.pptx</strong>, or download the original file to view in Microsoft PowerPoint.
                </p>
                <button
                    type="button"
                    className="m365-btn m365-btn-primary"
                    onClick={() => downloadFile(file.url, file.filename)}
                >
                    ⬇️ Download Presentation
                </button>
            </div>
        );
    }

    // ── Error State ────────────────────────────────────────────
    if (error || !presentation || presentation.slides.length === 0) {
        return (
            <div className="pptx-status-container">
                <div className="pptx-status-title">Unable to preview presentation</div>
                <p className="pptx-status-description">{error || 'No slides found in this presentation.'}</p>
                <button
                    type="button"
                    className="m365-btn m365-btn-secondary"
                    onClick={() => downloadFile(file.url, file.filename)}
                >
                    ⬇️ Download File
                </button>
            </div>
        );
    }

    const currentSlide: ParsedSlide = presentation.slides[activeSlideIndex] || presentation.slides[0];
    const aspectRatio = presentation.aspectRatio || 16 / 9;

    // Zoom and Fit Mode calculation for main slide stage
    let zoomScale = zoom / 100;
    if (fitMode === 'width') {
        zoomScale = 1.0;
    } else if (fitMode === 'screen') {
        zoomScale = 0.92;
    }

    return (
        <div className="pptx-viewer-root">
            {/* ── Fixed Left Thumbnail Panel (Occupies <= 20% viewport width) ── */}
            <aside
                ref={thumbnailSidebarRef}
                className="pptx-thumbnail-panel"
                aria-label="Slide Thumbnails"
            >
                <div className="pptx-thumbnail-track">
                    {presentation.slides.map((slide, idx) => {
                        const isSelected = idx === activeSlideIndex;

                        return (
                            <div
                                key={slide.slideIndex}
                                data-slide-index={idx}
                                className={`pptx-thumbnail-card ${isSelected ? 'is-selected' : ''}`}
                                onClick={() => selectSlide(idx)}
                                title={`Slide ${idx + 1}: ${slide.title || 'Untitled'}`}
                                role="button"
                                tabIndex={0}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        selectSlide(idx);
                                    }
                                }}
                            >
                                {/* Slide Number Badge */}
                                <div className="pptx-thumbnail-num-badge">
                                    {idx + 1}
                                </div>

                                {/* Thumbnail Visual Canvas */}
                                <div className="pptx-thumbnail-canvas-wrap">
                                    <SlideCanvas
                                        slide={slide}
                                        aspectRatio={aspectRatio}
                                        isThumbnail={true}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </aside>

            {/* ── Main Slide Stage (Independent zoom & discrete wheel scroll) ── */}
            <main
                ref={mainViewportRef}
                className="pptx-main-viewport"
                tabIndex={0}
            >
                <div
                    className="pptx-slide-stage"
                    style={{
                        transform: `scale(${zoomScale})`,
                        transformOrigin: 'center center',
                    }}
                >
                    <SlideCanvas
                        slide={currentSlide}
                        aspectRatio={aspectRatio}
                        isThumbnail={false}
                        className="pptx-main-slide-shadow"
                    />
                </div>
            </main>
        </div>
    );
}
