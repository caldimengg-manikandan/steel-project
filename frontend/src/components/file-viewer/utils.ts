// ============================================================
// File Viewer Utilities
// ============================================================

import type { FileType } from './types';

export function detectFileType(filename: string, contentType?: string): FileType {
    const ct = (contentType || '').toLowerCase().trim();
    const ext = filename.split('.').pop()?.toLowerCase().trim() || '';

    // 1. MIME type inspection
    if (ct.includes('pdf')) return 'pdf';
    if (ct.includes('wordprocessingml') || ct.includes('msword')) return 'docx';
    if (ct.includes('spreadsheetml') || ct.includes('ms-excel')) return 'xlsx';
    if (ct.includes('presentationml') || ct.includes('powerpoint')) return 'pptx';
    if (ct.includes('csv') || ct.includes('comma-separated')) return 'csv';
    if (ct.startsWith('text/') || ct.includes('plain')) return 'txt';
    if (ct.startsWith('image/')) return 'image';
    if (ct.startsWith('video/')) return 'video';
    if (ct.startsWith('audio/')) return 'audio';

    // 2. Extension fallback
    switch (ext) {
        case 'pdf':
            return 'pdf';
        case 'docx':
        case 'doc':
            return 'docx';
        case 'xlsx':
        case 'xls':
        case 'xlsm':
        case 'xlsb':
            return 'xlsx';
        case 'pptx':
        case 'ppt':
        case 'potx':
        case 'ppsx':
        case 'pptm':
            return 'pptx';
        case 'csv':
        case 'tsv':
            return 'csv';
        case 'txt':
        case 'log':
        case 'text':
        case 'ini':
        case 'cfg':
        case 'conf':
        case 'md':
        case 'markdown':
        case 'json':
        case 'xml':
        case 'sql':
        case 'env':
        case 'yaml':
        case 'yml':
        case 'sh':
        case 'bat':
        case 'cmd':
            return 'txt';
        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'webp':
        case 'svg':
        case 'gif':
        case 'bmp':
        case 'ico':
            return 'image';
        case 'mp4':
        case 'webm':
        case 'ogg':
        case 'mov':
        case 'mkv':
            return 'video';
        case 'mp3':
        case 'wav':
        case 'm4a':
        case 'aac':
        case 'flac':
        case 'wma':
            return 'audio';
        default:
            return 'unsupported';
    }
}

export function formatBytes(b?: number): string {
    if (!b || isNaN(b) || b <= 0) return '0 B';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export async function downloadFile(url: string, filename: string): Promise<void> {
    try {
        const token = localStorage.getItem('token');
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(url, { headers, credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename || 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
    } catch {
        // Fallback to direct anchor navigation
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'download';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
}

export function getOfficeBadge(type: FileType): { label: string; bg: string; color: string } {
    switch (type) {
        case 'pdf':
            return { label: 'PDF', bg: '#fee2e2', color: '#b91c1c' };
        case 'docx':
            return { label: 'DOCX', bg: '#eff6ff', color: '#1d4ed8' };
        case 'xlsx':
            return { label: 'XLSX', bg: '#ecfdf5', color: '#047857' };
        case 'csv':
            return { label: 'CSV', bg: '#f0fdf4', color: '#15803d' };
        case 'txt':
            return { label: 'TXT', bg: '#f0f9ff', color: '#0284c7' };
        case 'pptx':
            return { label: 'PPTX', bg: '#fff1f0', color: '#c41d17' };
        case 'image':
            return { label: 'IMG', bg: '#faf5ff', color: '#7e22ce' };
        case 'video':
            return { label: 'VIDEO', bg: '#fdf2f8', color: '#be185d' };
        case 'audio':
            return { label: 'AUDIO', bg: '#fffbeb', color: '#b45309' };
        default:
            return { label: 'FILE', bg: '#f1f5f9', color: '#475569' };
    }
}
