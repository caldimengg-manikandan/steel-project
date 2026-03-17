import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { adminListProjects } from '../../services/projectApi';
import {
    listRfiExtractions,
    uploadRfiDrawing,
    getRfiExcelDownloadUrl,
    deleteRfiExtraction,
    updateRfiResponse
} from '../../services/rfiApi';
import { useAuth } from '../../context/AuthContext';

// ── Inline SVG icons ──────────────────────────────────────
const IconQuestion = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);
const IconUpload2 = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
    </svg>
);
const IconDownload = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
);
const IconDelete = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </svg>
);
const IconChevron = ({ open }: { open: boolean }) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
        <polyline points="9 18 15 12 9 6" />
    </svg>
);
const IconPdf = () => (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="12" y2="17" />
    </svg>
);

export default function AdminRfi() {
    const { user } = useAuth();
    const location = useLocation();

    const [projects, setProjects] = useState<any[]>([]);
    const [selectedProject, setSelectedProject] = useState<any | null>(null);
    const [extractions, setExtractions] = useState<any[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(true);
    const [loadingExtractions, setLoadingExtractions] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [uploadSuccess, setUploadSuccess] = useState('');
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isAdmin = user?.role === 'admin';
    const [folderUrl, setFolderUrl] = useState('');  // base URL for 'Link to Source' in Excel

    // response editing: key = `${extractionId}_${rfiIndex}`, value = draft text
    const [responseEdits, setResponseEdits] = useState<Record<string, string>>({});
    const [remarksEdits, setRemarksEdits] = useState<Record<string, string>>({});
    // tracks which rfi is currently being saved
    const [savingResponse, setSavingResponse] = useState<Record<string, boolean>>({});
    const [savedResponse, setSavedResponse] = useState<Record<string, boolean>>({});
    // tracks which rfi is currently being saved

    useEffect(() => {
        (async () => {
            try {
                const data = await adminListProjects();
                const fetchedProjects = data.projects || [];
                setProjects(fetchedProjects);
                
                if (fetchedProjects.length > 0) {
                    const stateProjectId = location.state?.projectId;
                    if (stateProjectId) {
                        const target = fetchedProjects.find((p: any) => (p._id || p.id) === stateProjectId);
                        if (target) {
                            setSelectedProject(target);
                        } else {
                            setSelectedProject(fetchedProjects[0]);
                        }
                    } else {
                        setSelectedProject(fetchedProjects[0]);
                    }
                }
            } catch (err) { console.error(err); }
            finally { setLoadingProjects(false); }
        })();
    }, [location.state]);

    const loadExtractions = useCallback(async () => {
        if (!selectedProject) return;
        setLoadingExtractions(true);
        try {
            const data = await listRfiExtractions(selectedProject._id || selectedProject.id);
            setExtractions(data.extractions || []);
        } catch { }
        finally { setLoadingExtractions(false); }
    }, [selectedProject]);

    useEffect(() => { loadExtractions(); }, [loadExtractions]);

    // Auto-poll while any extraction is pending
    useEffect(() => {
        const hasActive = extractions.some(e => e.status === 'queued' || e.status === 'processing') || uploading;
        if (!hasActive) return;
        const t = setInterval(loadExtractions, 2500);
        return () => clearInterval(t);
    }, [extractions, uploading, loadExtractions]);

    const doUpload = async (files: File[]) => {
        if (!selectedProject || files.length === 0) return;
        const projectId = selectedProject._id || selectedProject.id;

        // Check for duplicate filenames
        const duplicates = extractions.filter(ext => 
            files.some(f => f.name === ext.originalFileName)
        );

        if (duplicates.length > 0) {
            const msg = duplicates.length === 1 
                ? `File "${duplicates[0].originalFileName}" already exists in RFI. Should I replace the image?`
                : `${duplicates.length} files already exist in RFI. Should I replace the images?`;
            
            if (!window.confirm(msg)) {
                return; // User clicked "Cancel"
            }

            // User clicked "Yes": Delete duplicates first
            setUploading(true);
            try {
                for (const dup of duplicates) {
                    await deleteRfiExtraction(projectId, dup._id);
                }
                // Remove deleted items from UI immediately
                setExtractions(prev => prev.filter(x => !duplicates.some(d => d._id === x._id)));
            } catch (err) {
                setUploading(false);
                setUploadError('Failed to remove existing file(s) for replacement.');
                return;
            }
        } else {
            setUploading(true);
        }

        setUploadError(''); setUploadSuccess('');
        try {
            await uploadRfiDrawing(projectId, files);
            setPendingFiles([]);
            if (fileInputRef.current) fileInputRef.current.value = '';
            setUploadSuccess(`${files.length} file(s) queued for extraction.`);
            loadExtractions();
        } catch (err: any) {
            setUploadError(err.message || 'Upload failed');
        } finally { setUploading(false); }
    };

    const handleDelete = async (extractionId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm('Delete this RFI extraction?')) return;
        try {
            await deleteRfiExtraction(selectedProject._id || selectedProject.id, extractionId);
            setExtractions(prev => prev.filter(x => x._id !== extractionId));
        } catch { alert('Failed to delete.'); }
    };

    const handleSaveResponse = async (extractionId: string, rfiIndex: number, responseText: string, remarksText: string) => {
        const key = `${extractionId}_${rfiIndex}`;
        setSavingResponse(prev => ({ ...prev, [key]: true }));
        try {
            const resData = await updateRfiResponse(
                selectedProject._id || selectedProject.id,
                extractionId,
                rfiIndex,
                responseText,
                remarksText
            );
            // Update local extractions state so the saved value is reflected
            setExtractions(prev => prev.map(ext => {
                if (ext._id !== extractionId) return ext;
                const updatedRfis = ext.rfis.map((rfi: any, i: number) =>
                    i === rfiIndex ? resData.rfi : rfi
                );
                return { ...ext, rfis: updatedRfis };
            }));
            setSavedResponse(prev => ({ ...prev, [key]: true }));
            setTimeout(() => setSavedResponse(prev => ({ ...prev, [key]: false })), 2000);
        } catch (err: any) {
            alert(`Failed to save response: ${err.message}`);
        } finally {
            setSavingResponse(prev => ({ ...prev, [key]: false }));
        }
    };

    // handleStatusChange removed since status is now auto-computed

    const completedCount = extractions.filter(e => e.status === 'completed').length;
    const projectId = selectedProject?._id || selectedProject?.id;

    const statusConfig: Record<string, { label: string; color: string; bg: string; dot: string }> = {
        completed: { label: 'Completed', color: '#166534', bg: '#dcfce7', dot: '#22c55e' },
        failed: { label: 'Failed', color: '#991b1b', bg: '#fee2e2', dot: '#ef4444' },
        processing: { label: 'Processing', color: '#92400e', bg: '#fef3c7', dot: '#f59e0b' },
        queued: { label: 'Queued', color: '#374151', bg: '#f3f4f6', dot: '#9ca3af' },
    };

    const StatusChip = ({ status }: { status: string }) => {
        const s = statusConfig[status] || statusConfig.queued;
        return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, background: s.bg, color: s.color, fontSize: 12, fontWeight: 600 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.dot, display: 'inline-block' }} />
                {s.label}
            </span>
        );
    };

    return (
        <div style={{ fontFamily: 'inherit' }}>
            {/* ── Page Header ── */}
            <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#2563eb,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                            <IconQuestion />
                        </div>
                        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)' }}>RFI Log</h2>
                    </div>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)', paddingLeft: 48 }}>
                        Upload drawings, auto-extract RFI annotations, and generate a structured Excel log.
                    </p>
                </div>
                {completedCount > 0 && projectId && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                        {/* Folder URL input */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                                Folder URL (optional)
                            </label>
                            <input
                                type="text"
                                value={folderUrl}
                                onChange={e => setFolderUrl(e.target.value)}
                                placeholder="https://drive.google.com/drive/folders/..."
                                style={{
                                    fontSize: 12,
                                    padding: '6px 10px',
                                    borderRadius: 7,
                                    border: '1px solid var(--color-border)',
                                    background: 'var(--color-background)',
                                    color: 'var(--color-text-primary)',
                                    width: 310,
                                    outline: 'none',
                                    fontFamily: 'inherit',
                                }}
                            />
                        </div>
                        <a
                            href={getRfiExcelDownloadUrl(projectId, undefined, folderUrl)}
                            download
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 8,
                                padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                                background: 'linear-gradient(135deg,#059669,#047857)', color: 'white',
                                textDecoration: 'none', boxShadow: '0 2px 8px rgba(5,150,105,0.3)',
                                transition: 'opacity 0.15s',
                            }}
                        >
                            <IconDownload /> Download RFI Excel
                        </a>
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>

                {/* ── Project Picker ── */}
                <div style={{
                    width: 210, flexShrink: 0,
                    background: 'var(--color-surface)', border: '1px solid var(--color-border-light)',
                    borderRadius: 12, overflow: 'hidden',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
                }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border-light)', fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Projects
                    </div>
                    {loadingProjects ? (
                        <div style={{ padding: 20, fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center' }}>Loading...</div>
                    ) : projects.length === 0 ? (
                        <div style={{ padding: 20, fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center' }}>No projects</div>
                    ) : (
                        <div style={{ maxHeight: 460, overflowY: 'auto' }}>
                            {projects.map(p => {
                                const pid = p._id || p.id;
                                const active = pid === projectId;
                                return (
                                    <button
                                        key={pid}
                                        onClick={() => { setSelectedProject(p); setExpanded(null); setUploadError(''); setUploadSuccess(''); }}
                                        style={{
                                            width: '100%', textAlign: 'left', padding: '10px 14px',
                                            background: active ? 'linear-gradient(135deg,#2563eb,#7c3aed)' : 'transparent',
                                            color: active ? 'white' : 'var(--color-text-primary)',
                                            border: 'none', cursor: 'pointer',
                                            borderBottom: '1px solid var(--color-border-light)',
                                            fontSize: 13, fontWeight: active ? 600 : 400,
                                            display: 'flex', alignItems: 'center', gap: 10,
                                            transition: 'background 0.15s',
                                        }}
                                    >
                                        <span style={{
                                            width: 28, height: 28, borderRadius: 6,
                                            background: active ? 'rgba(255,255,255,0.2)' : 'var(--color-border-light)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            flexShrink: 0, fontSize: 11, fontWeight: 700,
                                            color: active ? 'white' : 'var(--color-text-secondary)',
                                        }}>
                                            {p.name.slice(0, 2).toUpperCase()}
                                        </span>
                                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* ── Main Panel ── */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {!selectedProject ? (
                        <div style={{ padding: 50, textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border-light)' }}>
                            Select a project to start.
                        </div>
                    ) : (
                        <>
                            {/* Upload Card */}
                            <div style={{ background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border-light)', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                                {/* Card header */}
                                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div>
                                        <span style={{ fontWeight: 700, fontSize: 14 }}>{selectedProject.name}</span>
                                        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                                            {completedCount} completed extraction{completedCount !== 1 ? 's' : ''}
                                        </span>
                                    </div>
                                </div>

                                {/* Drop zone */}
                                <div style={{ padding: 20 }}>
                                    <div
                                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                                        onDragLeave={() => setDragOver(false)}
                                        onDrop={(e) => {
                                            e.preventDefault(); setDragOver(false);
                                            const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.pdf'));
                                            if (files.length > 0) { setPendingFiles(files); setUploadError(''); setUploadSuccess(''); }
                                            else setUploadError('Only PDF files are accepted.');
                                        }}
                                        onClick={() => fileInputRef.current?.click()}
                                        style={{
                                            border: `2px dashed ${dragOver ? '#2563eb' : 'var(--color-border)'}`,
                                            borderRadius: 10, padding: '32px 20px', textAlign: 'center',
                                            cursor: 'pointer', transition: 'all 0.2s',
                                            background: dragOver ? 'rgba(37,99,235,0.04)' : 'var(--color-background)',
                                        }}
                                    >
                                        <input
                                            type="file" accept=".pdf" multiple ref={fileInputRef} style={{ display: 'none' }}
                                            onChange={(e) => {
                                                if (e.target.files && e.target.files.length > 0) {
                                                    setPendingFiles(Array.from(e.target.files));
                                                    setUploadError(''); setUploadSuccess('');
                                                }
                                            }}
                                        />
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                                            {pendingFiles.length > 0 ? (
                                                <>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                                                        {pendingFiles.map((f, i) => (
                                                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 6, fontSize: 12 }}>
                                                                <IconPdf /><span style={{ color: '#0369a1', fontWeight: 500 }}>{f.name}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Click to change selection</span>
                                                </>
                                            ) : (
                                                <>
                                                    <div style={{ width: 52, height: 52, borderRadius: 12, background: 'rgba(37,99,235,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <IconUpload2 />
                                                    </div>
                                                    <div>
                                                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 3 }}>
                                                            Drop PDF files here or <span style={{ color: '#2563eb' }}>browse</span>
                                                        </div>
                                                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                                            Supports multiple PDF files — RFI annotations extracted automatically
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Action row */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
                                        {uploadError && (
                                            <span style={{ fontSize: 12, color: '#dc2626', flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                ⚠ {uploadError}
                                            </span>
                                        )}
                                        {uploadSuccess && (
                                            <span style={{ fontSize: 12, color: '#059669', flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                ✓ {uploadSuccess}
                                            </span>
                                        )}
                                        {!uploadError && !uploadSuccess && <span style={{ flex: 1 }} />}
                                        <button
                                            onClick={() => doUpload(pendingFiles)}
                                            disabled={uploading || pendingFiles.length === 0}
                                            style={{
                                                padding: '9px 20px', borderRadius: 8, border: 'none', cursor: (uploading || pendingFiles.length === 0) ? 'not-allowed' : 'pointer',
                                                background: (uploading || pendingFiles.length === 0) ? '#e5e7eb' : 'linear-gradient(135deg,#2563eb,#7c3aed)',
                                                color: (uploading || pendingFiles.length === 0) ? '#9ca3af' : 'white',
                                                fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
                                                transition: 'opacity 0.15s',
                                            }}
                                        >
                                            <IconUpload2 />
                                            {uploading ? 'Uploading…' : 'Upload & Extract'}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Results */}
                            {loadingExtractions ? (
                                <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>Loading extractions...</div>
                            ) : extractions.length === 0 ? (
                                <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13, background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border-light)' }}>
                                    No RFI extractions yet — upload a drawing PDF above to get started.
                                </div>
                            ) : (
                                <div style={{ background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border-light)', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                                    {/* Table header */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 90px 110px 100px 60px', padding: '10px 16px', background: 'var(--color-background)', borderBottom: '1px solid var(--color-border-light)', fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                        <span>Drawing File</span>
                                        <span>Status</span>
                                        <span style={{ textAlign: 'center' }}>RFIs</span>
                                        <span>Uploaded By</span>
                                        <span>Date</span>
                                        <span />
                                    </div>

                                    {extractions.map((ext, idx) => {
                                        const isExp = expanded === ext._id;
                                        const isLast = idx === extractions.length - 1;
                                        return (
                                            <div key={ext._id} style={{ borderBottom: isLast ? 'none' : '1px solid var(--color-border-light)' }}>
                                                {/* Row */}
                                                <div
                                                    onClick={() => setExpanded(isExp ? null : ext._id)}
                                                    style={{
                                                        display: 'grid', gridTemplateColumns: '1fr 120px 90px 110px 100px 60px',
                                                        padding: '12px 16px', cursor: 'pointer', alignItems: 'center',
                                                        background: isExp ? 'rgba(37,99,235,0.03)' : 'transparent',
                                                        transition: 'background 0.15s',
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
                                                        <IconChevron open={isExp} />
                                                        <span style={{ fontSize: 13, fontWeight: 500, color: '#2563eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {ext.originalFileName}
                                                        </span>
                                                    </div>
                                                    <StatusChip status={ext.status} />
                                                    <span style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: ext.rfis?.length > 0 ? '#2563eb' : 'var(--color-text-muted)' }}>
                                                        {ext.rfis?.length ?? 0}
                                                    </span>
                                                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{ext.uploadedBy}</span>
                                                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{new Date(ext.createdAt).toLocaleDateString()}</span>
                                                    {isAdmin && (
                                                        <button
                                                            onClick={(e) => handleDelete(ext._id, e)}
                                                            title="Delete"
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                        >
                                                            <IconDelete />
                                                        </button>
                                                    )}
                                                </div>

                                                {/* Expanded detail */}
                                                {isExp && ext.rfis && ext.rfis.length > 0 && (
                                                    <div style={{ background: 'var(--color-background)', borderTop: '1px solid var(--color-border-light)', padding: '12px 20px 16px 46px' }}>
                                                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <span>Extracted RFI Items</span>
                                                            {ext.status === 'completed' && projectId && (
                                                                <a
                                                                    href={getRfiExcelDownloadUrl(projectId, ext._id, folderUrl)}
                                                                    download
                                                                    style={{
                                                                        display: 'inline-flex', alignItems: 'center', gap: 6,
                                                                        padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                                                                        background: 'var(--color-surface)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-light)',
                                                                        textDecoration: 'none', transition: 'background 0.15s', textTransform: 'none', letterSpacing: 0
                                                                    }}
                                                                >
                                                                    <IconDownload /> Download File Excel
                                                                </a>
                                                            )}
                                                        </div>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                            {ext.rfis.map((rfi: any, i: number) => {
                                                                const key = `${ext._id}_${i}`;
                                                                const draftText = responseEdits[key] ?? rfi.response ?? '';
                                                                const draftRemarks = remarksEdits[key] ?? rfi.remarks ?? '';
                                                                const isSaving = savingResponse[key] || false;
                                                                const justSaved = savedResponse[key] || false;
                                                                return (
                                                                    <div key={i} style={{
                                                                        background: 'var(--color-surface)', border: '1px solid var(--color-border-light)', borderRadius: 8, padding: '12px 14px',
                                                                        display: 'grid', gridTemplateColumns: '70px 1fr 1fr 1fr 80px', gap: 12, alignItems: 'start',
                                                                    }}>
                                                                        <div style={{
                                                                            fontSize: 13, fontWeight: 700, color: 'white',
                                                                            background: 'linear-gradient(135deg,#2563eb,#7c3aed)',
                                                                            borderRadius: 6, padding: '3px 8px', textAlign: 'center', alignSelf: 'start',
                                                                        }}>
                                                                            {rfi.rfiNumber}
                                                                        </div>
                                                                        <div>
                                                                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>Description</div>
                                                                            <div style={{ fontSize: 12, color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{rfi.description || '—'}</div>
                                                                        </div>
                                                                        <div>
                                                                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Response</div>
                                                                            <textarea
                                                                                value={draftText}
                                                                                onChange={(e) => setResponseEdits(prev => ({ ...prev, [key]: e.target.value }))}
                                                                                placeholder="Type a response…"
                                                                                rows={3}
                                                                                style={{
                                                                                    width: '100%',
                                                                                    fontSize: 12,
                                                                                    padding: '6px 8px',
                                                                                    borderRadius: 6,
                                                                                    border: '1px solid var(--color-border)',
                                                                                    background: 'var(--color-background)',
                                                                                    color: 'var(--color-text-primary)',
                                                                                    resize: 'vertical',
                                                                                    fontFamily: 'inherit',
                                                                                    lineHeight: 1.5,
                                                                                    boxSizing: 'border-box',
                                                                                    outline: 'none',
                                                                                }}
                                                                            />
                                                                            <button
                                                                                onClick={() => handleSaveResponse(ext._id, i, draftText, draftRemarks)}
                                                                                disabled={isSaving}
                                                                                style={{
                                                                                    marginTop: 6,
                                                                                    padding: '4px 12px',
                                                                                    fontSize: 11,
                                                                                    fontWeight: 600,
                                                                                    borderRadius: 6,
                                                                                    border: 'none',
                                                                                    cursor: isSaving ? 'not-allowed' : 'pointer',
                                                                                    background: justSaved
                                                                                        ? 'rgba(34,197,94,0.15)'
                                                                                        : 'linear-gradient(135deg,#2563eb,#7c3aed)',
                                                                                    color: justSaved ? '#22c55e' : 'white',
                                                                                    transition: 'all 0.2s',
                                                                                    display: 'inline-flex',
                                                                                    alignItems: 'center',
                                                                                    gap: 4,
                                                                                }}
                                                                            >
                                                                                {isSaving ? 'Saving…' : justSaved ? '✓ Saved' : 'Save Response / Remarks'}
                                                                            </button>
                                                                        </div>
                                                                        <div>
                                                                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Remarks</div>
                                                                            <textarea
                                                                                value={draftRemarks}
                                                                                onChange={(e) => setRemarksEdits(prev => ({ ...prev, [key]: e.target.value }))}
                                                                                placeholder="Type remarks…"
                                                                                rows={3}
                                                                                style={{
                                                                                    width: '100%',
                                                                                    fontSize: 12,
                                                                                    padding: '6px 8px',
                                                                                    borderRadius: 6,
                                                                                    border: '1px solid var(--color-border)',
                                                                                    background: 'var(--color-background)',
                                                                                    color: 'var(--color-text-primary)',
                                                                                    resize: 'vertical',
                                                                                    fontFamily: 'inherit',
                                                                                    lineHeight: 1.5,
                                                                                    boxSizing: 'border-box',
                                                                                    outline: 'none',
                                                                                }}
                                                                            />
                                                                        </div>
                                                                        <div>
                                                                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Status</div>
                                                                            <select
                                                                                value={rfi.status || 'OPEN'}
                                                                                disabled={true}
                                                                                style={{
                                                                                    appearance: 'none',
                                                                                    WebkitAppearance: 'none',
                                                                                    padding: '5px 28px 5px 10px',
                                                                                    borderRadius: 20,
                                                                                    border: 'none',
                                                                                    fontSize: 11,
                                                                                    fontWeight: 700,
                                                                                    cursor: 'not-allowed',
                                                                                    outline: 'none',
                                                                                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='3'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                                                                                    backgroundRepeat: 'no-repeat',
                                                                                    backgroundPosition: 'right 8px center',
                                                                                    transition: 'background 0.2s, opacity 0.2s',
                                                                                    opacity: 0.8,
                                                                                    ...(rfi.status === 'CLOSED'
                                                                                        ? { background: '#16a34a', color: '#fff' }  // green
                                                                                        : { background: '#dc2626', color: '#fff' }  // red
                                                                                    ),
                                                                                }}
                                                                            >
                                                                                <option value="OPEN">OPEN</option>
                                                                                <option value="CLOSED">CLOSED</option>
                                                                            </select>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}

                                                {isExp && ext.status === 'failed' && (
                                                    <div style={{ background: 'rgba(220,38,38,0.1)', borderTop: '1px solid rgba(220,38,38,0.2)', padding: '12px 20px 14px 46px', fontSize: 13, color: '#dc2626' }}>
                                                        <strong>Extraction failed:</strong> {ext.errorDetails || 'Unknown error'}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
