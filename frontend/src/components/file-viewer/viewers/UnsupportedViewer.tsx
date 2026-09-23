import React from 'react';
import type { SubViewerProps } from '../types';
import { formatBytes, downloadFile } from '../utils';

export default function UnsupportedViewer({ file }: SubViewerProps) {
    const ext = file.filename.split('.').pop()?.toUpperCase() || 'FILE';

    const getFileIcon = (extension: string) => {
        if (['DWG', 'DXF', 'STEP', 'IGES', 'IFC'].includes(extension)) return '📐';
        if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ'].includes(extension)) return '📦';
        if (['EXE', 'MSI', 'BAT', 'SH'].includes(extension)) return '⚙️';
        return '📁';
    };

    return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            <div className="m365-unsupported-card">
                <div style={{ fontSize: 52 }}>{getFileIcon(ext)}</div>

                <div>
                    <h3 style={{ margin: '0 0 6px 0', fontSize: 16, fontWeight: 700, color: '#1e293b', wordBreak: 'break-word' }}>
                        {file.filename}
                    </h3>
                    <div style={{ fontSize: 12.5, color: '#64748b' }}>
                        {ext} File • {formatBytes(file.sizeBytes)}
                    </div>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '10px 14px', fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>
                    In-browser interactive preview is not available for this file format ({ext}). You can download the file to inspect it in your local desktop application.
                </div>

                <button
                    type="button"
                    className="m365-btn"
                    onClick={() => downloadFile(file.url, file.filename)}
                    style={{
                        background: '#0078d4',
                        color: '#ffffff',
                        padding: '8px 20px',
                        fontSize: 13,
                        fontWeight: 600,
                        borderRadius: 6,
                        height: 38,
                        marginTop: 6,
                        boxShadow: '0 2px 6px rgba(0, 120, 212, 0.28)',
                    }}
                >
                    <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                        <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
                        <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z" />
                    </svg>
                    Download File
                </button>
            </div>
        </div>
    );
}
