import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { SubViewerProps } from '../types';

export default function ImageViewer({
    file,
    fileBlobUrl,
    zoom,
    fitMode,
    rotation = 0,
    onFitZoomComputed,
}: SubViewerProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [naturalDims, setNaturalDims] = useState<{ width: number; height: number } | null>(null);
    const imgRef = useRef<HTMLImageElement>(null);

    const computeAndReportFitZoom = useCallback((naturalW: number, naturalH: number) => {
        if (!naturalW || !naturalH) return;
        const availW = (window.innerWidth || 1200) * 0.88;
        const availH = (window.innerHeight || 800) * 0.78;
        const ratioW = availW / naturalW;
        const ratioH = availH / naturalH;
        const fitRatio = Math.min(ratioW, ratioH, 1);
        const fitZoom = Math.max(10, Math.min(400, Math.round(fitRatio * 100)));
        onFitZoomComputed?.(fitZoom);
    }, [onFitZoomComputed]);

    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        setNaturalDims({ width: w, height: h });
        setLoading(false);
        computeAndReportFitZoom(w, h);
    };

    useEffect(() => {
        if (!naturalDims) return;
        const onResize = () => {
            computeAndReportFitZoom(naturalDims.width, naturalDims.height);
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [naturalDims, computeAndReportFitZoom]);

    // When in custom zoom mode, scale explicitly based on natural dimensions so viewport scrolls naturally
    const customStyle: React.CSSProperties = fitMode === 'screen'
        ? {
            maxWidth: '92vw',
            maxHeight: '82vh',
            objectFit: 'contain',
            transform: `rotate(${rotation}deg)`,
            display: loading ? 'none' : 'block',
        }
        : {
            width: naturalDims ? Math.round(naturalDims.width * (zoom / 100)) : 'auto',
            height: naturalDims ? Math.round(naturalDims.height * (zoom / 100)) : 'auto',
            maxWidth: 'none',
            maxHeight: 'none',
            transform: `rotate(${rotation}deg)`,
            display: loading ? 'none' : 'block',
        };

    return (
        <div className="m365-media-canvas">
            {loading && !error && (
                <div className="m365-loading-state" style={{ position: 'absolute' }}>
                    <div className="m365-loading-spinner" />
                    <div style={{ color: '#000000', fontWeight: 600 }}>Loading image...</div>
                </div>
            )}

            {error ? (
                <div className="m365-error-state">
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Unable to load image</div>
                    <div style={{ fontSize: 13, color: '#6b7280' }}>
                        The image file could not be displayed or is corrupted.
                    </div>
                </div>
            ) : (
                <img
                    ref={imgRef}
                    src={fileBlobUrl || file.url}
                    alt={file.filename}
                    className="m365-image-preview"
                    style={customStyle}
                    onLoad={handleImageLoad}
                    onError={() => {
                        setLoading(false);
                        setError(true);
                    }}
                />
            )}
        </div>
    );
}
