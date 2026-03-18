import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import {
    uploadRfiDrawing,
    listRfiExtractions,
    getRfiExcelDownloadUrl,
    deleteRfiExtraction
} from '../services/rfiApi';
import { IconUpload, IconTrash } from './Icons';

interface RfiExtractionPanelProps {
    projectId: string;
    projectName?: string;
    canUpload: boolean;
}

export default function RfiExtractionPanel({
    projectId,
    projectName = '',
    canUpload,
}: RfiExtractionPanelProps) {

    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    const [extractions, setExtractions] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [expanded, setExpanded] = useState<string | null>(null);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [localSavePath, setLocalSavePath] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollRef = useRef<any>(null);

    const fetchExtractions = useCallback(async (isBg = false) => {
        if (!projectId) return;
        if (!isBg) setLoading(true);

        try {
            const data = await listRfiExtractions(projectId);
            setExtractions(data.extractions || []);
        } catch (err) {
            console.error('[RfiPanel] Fetch failed:', err);
        } finally {
            if (!isBg) setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        fetchExtractions();
    }, [fetchExtractions]);

    useEffect(() => {
        const hasActive = extractions.some(e => e.status === 'queued' || e.status === 'processing') || uploading;
        if (hasActive && !pollRef.current) {
            pollRef.current = setInterval(() => fetchExtractions(true), 2000);
        } else if (!hasActive && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [extractions, fetchExtractions, uploading]);

    const handleUploads = async (files: FileList | File[]) => {
        const fileArray = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
        if (fileArray.length === 0) {
            setUploadError('No valid PDF files found.');
            return;
        }

        // Project Name Validation: Filename must contain project name
        if (projectName) {
            const invalidFiles = fileArray.filter(f => !f.name.toLowerCase().includes(projectName.toLowerCase()));
            if (invalidFiles.length > 0) {
                const msg = `Validation Error: The following files do not contain the project name "${projectName}":\n\n` + 
                            invalidFiles.map(f => `• ${f.name}`).join('\n') + 
                            `\n\nPlease ensure your drawing filenames include the project name.`;
                alert(msg);
                setUploadError(`Drawing filenames must include the project name "${projectName}".`);
                return;
            }
        }

        setUploadError('');
        setUploading(true);

        try {
            await uploadRfiDrawing(projectId, fileArray, localSavePath);
            setPendingFiles([]);
            setLocalSavePath('');
            if (fileInputRef.current) fileInputRef.current.value = '';
            fetchExtractions();
        } catch (err: any) {
            setUploadError(err.response?.data?.error || err.message || 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm('Are you sure you want to delete this RFI extraction?')) return;
        try {
            await deleteRfiExtraction(projectId, id);
            setExtractions(prev => prev.filter(x => x._id !== id));
        } catch (err) {
            console.error(err);
            alert('Failed to delete');
        }
    };

    const StatusBadge = ({ status }: { status: string }) => {
        switch (status) {
            case 'completed': return <span className="badge badge-success">Completed</span>;
            case 'failed': return <span className="badge badge-danger">Failed</span>;
            case 'processing': return <span className="badge badge-warning">Parsing...</span>;
            default: return <span className="badge badge-neutral">Queued</span>;
        }
    };

    const completedCount = extractions.filter(e => e.status === 'completed').length;

    return (
        <div style={{ padding: 'var(--space-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: 16 }}>RFI Extraction</h3>
                    <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Automatically extract RFI annotations from drawings</p>
                </div>
                {completedCount > 0 && (
                    <a
                        href={getRfiExcelDownloadUrl(projectId)}
                        download
                        className="btn btn-secondary"
                        style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                    >
                        Download RFI Excel
                    </a>
                )}
            </div>


            {canUpload && (
                <div style={{ marginBottom: 20, padding: 16, background: '#fafbfc', border: '1px dashed var(--color-border)', borderRadius: 8 }}>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: 14 }}>Upload RFI Drawing (PDF)</h4>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <input
                            type="file"
                            accept=".pdf"
                            multiple
                            ref={fileInputRef}
                            onChange={(e) => {
                                if (e.target.files) setPendingFiles(Array.from(e.target.files));
                            }}
                            style={{ display: 'none' }}
                        />
                        <button className="btn btn-secondary" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                            Choose Files
                        </button>
                        <input
                            type="text"
                            placeholder="Optional: Auto-save Excel here (e.g. C:\RFI)"
                            value={localSavePath}
                            onChange={(e) => setLocalSavePath(e.target.value)}
                            style={{ flex: 1, minWidth: 200, padding: '6px 10px', fontSize: 13, borderRadius: 4, border: '1px solid var(--color-border-light)' }}
                        />
                        <button
                            className="btn btn-primary"
                            disabled={uploading || pendingFiles.length === 0}
                            onClick={() => handleUploads(pendingFiles)}
                        >
                            <IconUpload /> {uploading ? 'Uploading...' : 'Upload & Extract'}
                        </button>
                    </div>
                    {pendingFiles.length > 0 && (
                        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-primary)' }}>
                            {pendingFiles.length} file(s) ready to upload.
                        </div>
                    )}
                    {uploadError && <div style={{ color: 'red', fontSize: 13, marginTop: 10 }}>{uploadError}</div>}
                </div>
            )}

            <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, background: '#f8f9fa', border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 14px', maxWidth: 400 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-muted)' }}>
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input 
                    type="text" 
                    placeholder="Search RFI questions or drawings..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, width: '100%', color: 'var(--color-text-primary)' }}
                />
                {searchTerm && (
                    <button onClick={() => setSearchTerm('')} style={{ border: 'none', background: 'none', padding: 0.5, cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                )}
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: 40 }}>Loading RFIs...</div>
            ) : extractions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, border: '1px solid var(--color-border-light)', borderRadius: 8, background: '#fafbfc', color: 'var(--color-text-secondary)' }}>
                    No RFI extractions yet. Upload a drawing to get started.
                </div>
            ) : (
                <div className="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Drawing File</th>
                                <th>Status</th>
                                <th>RFIs Found</th>
                                <th>Uploaded By</th>
                                <th>Created</th>
                                {isAdmin && <th>Actions</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {extractions.filter(ext => {
                                if (!searchTerm) return true;
                                const s = searchTerm.toLowerCase();
                                return (ext.originalFileName || '').toLowerCase().includes(s) || 
                                       (ext.rfis || []).some((rfi: any) => 
                                           (rfi.description || '').toLowerCase().includes(s) || 
                                           (rfi.rfiNumber || '').toLowerCase().includes(s) ||
                                           (rfi.response || '').toLowerCase().includes(s)
                                       );
                            }).map((ext, _) => {
                                const rfiMatches = searchTerm ? (ext.rfis || []).filter((rfi: any) => {
                                    const s = searchTerm.toLowerCase();
                                    return (rfi.description || '').toLowerCase().includes(s) || 
                                           (rfi.rfiNumber || '').toLowerCase().includes(s) ||
                                           (rfi.response || '').toLowerCase().includes(s);
                                }) : (ext.rfis || []);

                                const isExp = expanded === ext._id || (searchTerm !== '' && rfiMatches.length > 0);
                                return (
                                    <React.Fragment key={ext._id}>
                                        <tr
                                            onClick={() => setExpanded(isExp ? null : ext._id)}
                                            style={{ cursor: 'pointer', background: isExp ? '#fafbfc' : 'transparent' }}
                                        >
                                            <td style={{ fontWeight: 500, color: 'var(--color-primary)' }}>{ext.originalFileName || 'Unknown'}</td>
                                            <td><StatusBadge status={ext.status} /></td>
                                            <td>{ext.rfis ? ext.rfis.length : 0}</td>
                                            <td className="text-muted">{ext.uploadedBy}</td>
                                            <td className="text-muted">{new Date(ext.createdAt).toLocaleString()}</td>
                                            {isAdmin && (
                                                <td>
                                                    <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => handleDelete(ext._id, e)}>
                                                        <IconTrash />
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                        {isExp && ext.rfis && ext.rfis.length > 0 && (
                                            <tr>
                                                <td colSpan={isAdmin ? 6 : 5} style={{ padding: 0, background: '#f8f9fa' }}>
                                                    <div style={{ padding: '10px 20px' }}>
                                                        <table style={{ margin: 0, background: 'white', border: '1px solid #e1e4e8', borderRadius: 4 }}>
                                                            <thead style={{ background: '#f6f8fa' }}>
                                                                <tr>
                                                                    <th>RFI # {searchTerm && <span style={{ color: 'var(--color-primary)', fontWeight: 'normal', fontSize: 11 }}>({rfiMatches.length} matches)</span>}</th>
                                                                    <th>Description</th>
                                                                    <th>Response</th>
                                                                    <th>Status</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {rfiMatches.map((rfi: any, idx: number) => (
                                                                    <tr key={idx}>
                                                                        <td style={{ width: 80, fontWeight: 'bold' }}>{rfi.rfiNumber}</td>
                                                                        <td style={{ whiteSpace: 'pre-wrap' }}>{rfi.description}</td>
                                                                        <td style={{ whiteSpace: 'pre-wrap', color: 'var(--color-text-secondary)' }}>
                                                                            {rfi.response || '-'}
                                                                            {rfi.responseAttachmentUrl && (
                                                                                <div style={{ marginTop: 4 }}>
                                                                                    <a 
                                                                                        href={rfi.responseAttachmentUrl} 
                                                                                        target="_blank" 
                                                                                        rel="noreferrer"
                                                                                        style={{ fontSize: 11, color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}
                                                                                    >
                                                                                        📎 {rfi.responseAttachmentName || 'View Attachment'}
                                                                                    </a>
                                                                                </div>
                                                                            )}
                                                                        </td>
                                                                        <td>
                                                                            <span className={`badge ${rfi.status === 'CLOSED' ? 'badge-success' : 'badge-warning'}`}>
                                                                                {rfi.status}
                                                                            </span>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                        {isExp && ext.status === 'failed' && (
                                            <tr>
                                                <td colSpan={isAdmin ? 6 : 5} style={{ padding: '10px 20px', color: 'red', background: '#fff0f0' }}>
                                                    <strong>Error:</strong> {ext.errorDetails || 'Unknown error occurred'}
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
