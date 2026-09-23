import React, { useEffect, useState } from 'react';
import type { SubViewerProps } from '../types';
import mammoth from 'mammoth';

export default function DocxViewer({ file, zoom, fitMode }: SubViewerProps) {
    const [htmlContent, setHtmlContent] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>('');

    useEffect(() => {
        let isMounted = true;
        setLoading(true);
        setError('');

        async function loadDocx() {
            try {
                const token = localStorage.getItem('token');
                const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
                const res = await fetch(file.url, { headers, credentials: 'include' });
                if (!res.ok) throw new Error(`Failed to load document (${res.status} ${res.statusText})`);

                const buffer = await res.arrayBuffer();
                const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
                if (!isMounted) return;

                if (!result.value && result.messages?.length) {
                    console.warn('[DocxViewer] Mammoth warnings:', result.messages);
                }
                setHtmlContent(result.value || '<p style="color: #64748b;">(Empty document)</p>');
            } catch (err: any) {
                if (isMounted) {
                    setError(err.message || 'Error converting Word document.');
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        }

        loadDocx();

        return () => {
            isMounted = false;
        };
    }, [file.url]);

    if (loading) {
        return (
            <div className="m365-loading-state">
                <div style={{ fontSize: 28 }}>📝</div>
                <div>Formatting Word document...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="m365-error-state">
                <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Unable to render Word Document</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>{error}</div>
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
