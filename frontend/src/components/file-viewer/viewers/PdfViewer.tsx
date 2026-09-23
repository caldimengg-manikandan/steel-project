import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { SubViewerProps } from '../types';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface PageCardProps {
    pageNum: number;
    pdfDoc: any;
    scale: number;
    baseDims: { width: number; height: number };
    scrollContainer: HTMLElement | null;
}

function PdfPageCard({ pageNum, pdfDoc, scale, baseDims, scrollContainer }: PageCardProps) {
    const cardRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const renderTaskRef = useRef<any>(null);
    // Render first 2 pages immediately for instant initial content
    const [shouldRender, setShouldRender] = useState(pageNum <= 2);
    const [isRendered, setIsRendered] = useState(false);
    const [pageDims, setPageDims] = useState<{ width: number; height: number } | null>(null);
    const lastRenderedScale = useRef<number | null>(null);

    // Lazy load detection via IntersectionObserver with generous rootMargin
    useEffect(() => {
        const el = cardRef.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setShouldRender(true);
                }
            },
            {
                root: scrollContainer,
                rootMargin: '800px 0px 800px 0px',
                threshold: 0.01,
            }
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, [scrollContainer]);

    // Canvas render
    useEffect(() => {
        if (!shouldRender || !pdfDoc || !canvasRef.current) return;
        if (lastRenderedScale.current === scale && isRendered) return;

        let isCancelled = false;

        async function renderCanvas() {
            try {
                if (renderTaskRef.current) {
                    renderTaskRef.current.cancel();
                }

                const page = await pdfDoc.getPage(pageNum);
                if (isCancelled || !canvasRef.current) return;

                const unscaledVp = page.getViewport({ scale: 1 });
                setPageDims({ width: unscaledVp.width, height: unscaledVp.height });

                const canvas = canvasRef.current;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;

                const dpr = window.devicePixelRatio || 1;
                const viewport = page.getViewport({ scale: scale * dpr });

                canvas.width = viewport.width;
                canvas.height = viewport.height;
                canvas.style.width = `${viewport.width / dpr}px`;
                canvas.style.height = `${viewport.height / dpr}px`;

                const task = page.render({
                    canvasContext: ctx,
                    viewport,
                });
                renderTaskRef.current = task;
                await task.promise;

                if (!isCancelled) {
                    lastRenderedScale.current = scale;
                    setIsRendered(true);
                }
            } catch (err: any) {
                if (err?.name !== 'RenderingCancelledException') {
                    console.warn(`[PdfViewer] Page ${pageNum} render error:`, err);
                }
            }
        }

        renderCanvas();

        return () => {
            isCancelled = true;
            if (renderTaskRef.current) {
                renderTaskRef.current.cancel();
            }
        };
    }, [shouldRender, pdfDoc, pageNum, scale, isRendered]);

    const cardW = pageDims?.width || baseDims.width;
    const cardH = pageDims?.height || baseDims.height;
    const displayW = Math.round(cardW * scale);
    const displayH = Math.round(cardH * scale);

    return (
        <div
            ref={cardRef}
            className="m365-pdf-page-card"
            data-page-number={pageNum}
            style={{
                width: displayW ? `${displayW}px` : 'auto',
                minHeight: displayH ? `${displayH}px` : '400px',
                height: isRendered ? 'auto' : `${displayH}px`,
            }}
        >
            <canvas ref={canvasRef} style={{ display: isRendered ? 'block' : 'none' }} />
            {!isRendered && (
                <div
                    className="m365-pdf-page-placeholder"
                    style={{ width: displayW ? `${displayW}px` : '100%', height: displayH ? `${displayH}px` : '400px' }}
                >
                    <div style={{ fontSize: 24, marginBottom: 6 }}>📄</div>
                    <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>Page {pageNum}</span>
                </div>
            )}
        </div>
    );
}

export default function PdfViewer({
    file,
    zoom,
    fitMode,
    pageNumber = 1,
    onPageChange,
    onNumPagesLoaded,
    requestedPage,
    isTwoPageView = false,
}: SubViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [totalPages, setTotalPages] = useState<number>(0);
    const [baseDims, setBaseDims] = useState<{ width: number; height: number }>({ width: 612, height: 792 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>('');
    const isProgrammaticScrollRef = useRef(false);
    const pageNumberRef = useRef(pageNumber);
    pageNumberRef.current = pageNumber;
    const rafScrollRef = useRef<number | null>(null);

    // Locate scroll parent (.m365-viewport)
    useEffect(() => {
        if (containerRef.current) {
            const parent = containerRef.current.closest('.m365-viewport') as HTMLElement;
            setScrollContainer(parent || null);
        }
    }, [loading]);

    // Fetch and load PDF
    useEffect(() => {
        let isMounted = true;
        setLoading(true);
        setError('');

        async function loadPdf() {
            try {
                const token = localStorage.getItem('token');
                const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
                const res = await fetch(file.url, { headers, credentials: 'include' });
                if (!res.ok) throw new Error(`Failed to load PDF (${res.status} ${res.statusText})`);

                const buffer = await res.arrayBuffer();
                const loadingTask = pdfjsLib.getDocument({
                    data: new Uint8Array(buffer),
                    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/cmaps/',
                    cMapPacked: true,
                });

                const doc = await loadingTask.promise;
                if (!isMounted) return;

                setPdfDoc(doc);
                setTotalPages(doc.numPages);
                onNumPagesLoaded?.(doc.numPages);
                onPageChange?.(1);

                // Fetch page 1 base dimensions to establish aspect ratio
                try {
                    const page1 = await doc.getPage(1);
                    const vp1 = page1.getViewport({ scale: 1 });
                    if (isMounted) {
                        setBaseDims({ width: vp1.width, height: vp1.height });
                    }
                } catch (dimErr) {
                    console.warn('[PdfViewer] Could not get base page dims:', dimErr);
                }
            } catch (err: any) {
                if (isMounted) setError(err.message || 'Error rendering PDF document');
            } finally {
                if (isMounted) setLoading(false);
            }
        }

        loadPdf();

        return () => {
            isMounted = false;
        };
    }, [file.url]);

    // Calculate effective scale (accounting for fitMode === 'width' and isTwoPageView)
    const effectiveScale = useMemo(() => {
        if (fitMode === 'width' && scrollContainer && baseDims.width > 0) {
            const availableW = scrollContainer.clientWidth - 56;
            if (isTwoPageView) {
                return Math.max(0.2, Math.min(2.5, (availableW - 32) / (baseDims.width * 2)));
            }
            return Math.max(0.3, Math.min(3, availableW / baseDims.width));
        }
        return zoom / 100;
    }, [fitMode, zoom, scrollContainer, baseDims.width, isTwoPageView]);

    // Track scroll position to update visible page number in toolbar
    // Uses distance to natural reading line and NEVER falls back to page 1
    const handleScroll = useCallback(() => {
        if (isProgrammaticScrollRef.current || !scrollContainer || !containerRef.current) return;

        if (rafScrollRef.current) cancelAnimationFrame(rafScrollRef.current);
        rafScrollRef.current = requestAnimationFrame(() => {
            if (!scrollContainer || !containerRef.current) return;
            const cards = containerRef.current.querySelectorAll<HTMLElement>('.m365-pdf-page-card');
            if (!cards.length) return;

            const containerRect = scrollContainer.getBoundingClientRect();

            // Direct check for top edge
            if (scrollContainer.scrollTop <= 10) {
                if (pageNumberRef.current !== 1) onPageChange?.(1);
                return;
            }
            // Direct check for bottom edge
            if (scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight <= 15) {
                if (totalPages > 0 && pageNumberRef.current !== totalPages) onPageChange?.(totalPages);
                return;
            }

            const focusY = containerRect.top + containerRect.height / 3;
            let bestPage = pageNumberRef.current;
            let minDistance = Infinity;

            cards.forEach(card => {
                const rect = card.getBoundingClientRect();
                // Filter to cards intersecting the viewport area
                if (rect.bottom >= containerRect.top && rect.top <= containerRect.bottom) {
                    const cardCenterY = rect.top + rect.height / 2;
                    const dist = Math.abs(cardCenterY - focusY);
                    if (dist < minDistance) {
                        minDistance = dist;
                        const num = Number(card.dataset.pageNumber);
                        if (num) bestPage = num;
                    }
                }
            });

            if (bestPage !== pageNumberRef.current) {
                onPageChange?.(bestPage);
            }
        });
    }, [scrollContainer, totalPages, onPageChange]);

    useEffect(() => {
        const sc = scrollContainer;
        if (!sc) return;

        sc.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            sc.removeEventListener('scroll', handleScroll);
            if (rafScrollRef.current) cancelAnimationFrame(rafScrollRef.current);
        };
    }, [scrollContainer, handleScroll]);

    // Smooth programmatic scroll ONLY when user explicitly navigates (clicks Prev/Next or types page number)
    useEffect(() => {
        if (!requestedPage || !containerRef.current || totalPages === 0) return;

        const targetEl = containerRef.current.querySelector<HTMLElement>(`[data-page-number="${requestedPage.page}"]`);
        if (!targetEl || !scrollContainer) return;

        isProgrammaticScrollRef.current = true;
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const timer = setTimeout(() => {
            isProgrammaticScrollRef.current = false;
        }, 750);
        return () => clearTimeout(timer);
    }, [requestedPage, totalPages, scrollContainer]);

    // Keyboard navigation (Arrow keys / PageUp / PageDown)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (document.activeElement?.tagName === 'INPUT') return;

            if (e.key === 'ArrowRight' || e.key === 'PageDown') {
                if (pageNumber < totalPages) {
                    const next = pageNumber + 1;
                    onPageChange?.(next);
                    const targetEl = containerRef.current?.querySelector<HTMLElement>(`[data-page-number="${next}"]`);
                    if (targetEl) {
                        isProgrammaticScrollRef.current = true;
                        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        setTimeout(() => {
                            isProgrammaticScrollRef.current = false;
                        }, 750);
                    }
                }
            } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
                if (pageNumber > 1) {
                    const next = pageNumber - 1;
                    onPageChange?.(next);
                    const targetEl = containerRef.current?.querySelector<HTMLElement>(`[data-page-number="${next}"]`);
                    if (targetEl) {
                        isProgrammaticScrollRef.current = true;
                        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        setTimeout(() => {
                            isProgrammaticScrollRef.current = false;
                        }, 750);
                    }
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [pageNumber, totalPages, onPageChange]);

    // Keep active page in view when toggling two-page view
    useEffect(() => {
        if (!containerRef.current || !scrollContainer) return;
        const targetEl = containerRef.current.querySelector<HTMLElement>(`[data-page-number="${pageNumberRef.current}"]`);
        if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'auto', block: 'nearest' });
        }
    }, [isTwoPageView]);

    // Two-page grouping pairs
    const pagePairs = useMemo(() => {
        const pairs: number[][] = [];
        for (let i = 1; i <= totalPages; i += 2) {
            if (i + 1 <= totalPages) {
                pairs.push([i, i + 1]);
            } else {
                pairs.push([i]);
            }
        }
        return pairs;
    }, [totalPages]);

    if (loading) {
        return (
            <div className="m365-loading-state">
                <div style={{ fontSize: 28 }}>📄</div>
                <div>Loading PDF document...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="m365-error-state">
                <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Unable to render PDF</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>{error}</div>
            </div>
        );
    }

    if (isTwoPageView) {
        return (
            <div ref={containerRef} className="m365-pdf-continuous-container is-two-page">
                {pagePairs.map((pair, rowIdx) => (
                    <div className="m365-pdf-page-pair" key={rowIdx}>
                        {pair.map(pageNum => (
                            <PdfPageCard
                                key={pageNum}
                                pageNum={pageNum}
                                pdfDoc={pdfDoc}
                                scale={effectiveScale}
                                baseDims={baseDims}
                                scrollContainer={scrollContainer}
                            />
                        ))}
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div ref={containerRef} className="m365-pdf-continuous-container">
            {Array.from({ length: totalPages }).map((_, idx) => (
                <PdfPageCard
                    key={idx + 1}
                    pageNum={idx + 1}
                    pdfDoc={pdfDoc}
                    scale={effectiveScale}
                    baseDims={baseDims}
                    scrollContainer={scrollContainer}
                />
            ))}
        </div>
    );
}
