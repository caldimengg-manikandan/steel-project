import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { adminListProjects } from '../../services/projectApi';
import {
    listRfiExtractions,
    uploadRfiDrawing,
    getRfiExcelDownloadUrl,
    deleteRfiExtraction,
    updateRfiResponse,
    uploadRfiResponseAttachment
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
const IconClip = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
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
    const [searchTerm, setSearchTerm] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isAdmin = user?.role === 'admin';
    const [folderUrl, setFolderUrl] = useState('');  // base URL for 'Link to Source' in Excel

    // response editing: key = `${extractionId}_${rfiIndex}`, value = draft text
    const [responseEdits, setResponseEdits] = useState<Record<string, string>>({});
    const [remarksEdits, setRemarksEdits] = useState<Record<string, string>>({});
    const [clientRfiEdits, setClientRfiEdits] = useState<Record<string, string>>({});
    // tracks which rfi is currently being saved
    const [savingResponse, setSavingResponse] = useState<Record<string, boolean>>({});
    const [savedResponse, setSavedResponse] = useState<Record<string, boolean>>({});
    const [selectedSequences, setSelectedSequences] = useState<string[]>([]);
    const [sequenceFilter, setSequenceFilter] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const data = await adminListProjects();
                const fetchedProjects = data.projects || [];
                setProjects(fetchedProjects);
                
                if (fetchedProjects.length > 0) {
                    const stateProjectId = location.state?.projectId;
                    if (stateProjectId) {
                        const target = fetchedProjects.find((p: any) => String(p._id || p.id) === String(stateProjectId));
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
            const data = await listRfiExtractions(String(selectedProject._id || selectedProject.id));
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
        const projectId = String(selectedProject._id || selectedProject.id);
        const projectName = selectedProject.name;

        // Validation: Filename must contain project name
        const invalidFiles = files.filter(f => !f.name.toLowerCase().includes(projectName.toLowerCase()));
        if (invalidFiles.length > 0) {
            const msg = `Validation Error: The following files do not contain the project name "${projectName}":\n\n` + 
                        invalidFiles.map(f => `• ${f.name}`).join('\n') + 
                        `\n\nPlease ensure your drawing filenames include the project name.`;
            alert(msg);
            setUploadError(`Drawing filenames must include the project name "${projectName}".`);
            return;
        }

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
            await uploadRfiDrawing(projectId, files, undefined, selectedSequences);
            setPendingFiles([]);
            setSelectedSequences([]);
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
            await deleteRfiExtraction(String(selectedProject._id || selectedProject.id), extractionId);
            setExtractions(prev => prev.filter(x => x._id !== extractionId));
        } catch { alert('Failed to delete.'); }
    };

    const handleSaveResponse = async (extractionId: string, rfiIndex: number, responseText: string, remarksText: string, clientRfiNo: string) => {
        const key = `${extractionId}_${rfiIndex}`;
        setSavingResponse(prev => ({ ...prev, [key]: true }));
        try {
            const resData = await updateRfiResponse(
                String(selectedProject._id || selectedProject.id),
                extractionId,
                rfiIndex,
                responseText,
                remarksText,
                clientRfiNo
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

    const handleAttachmentUpload = async (extractionId: string, rfiIndex: number, file: File) => {
        const key = `${extractionId}_${rfiIndex}`;
        setSavingResponse(prev => ({ ...prev, [key]: true }));
        try {
            const resData = await uploadRfiResponseAttachment(
                String(selectedProject._id || selectedProject.id),
                extractionId,
                rfiIndex,
                file
            );
            // Update local extractions state
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
            alert(`Failed to upload attachment: ${err.message}`);
        } finally {
            setSavingResponse(prev => ({ ...prev, [key]: false }));
        }
    };

    // handleStatusChange removed since status is now auto-computed

    const completedCount = extractions.filter(e => e.status === 'completed').length;
    const projectId = selectedProject ? String(selectedProject._id || selectedProject.id) : null;

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
                            {projects.map((p: any) => {
                                const pid = String(p._id || p.id);
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

                                    {/* Sequences Checkboxes */}
                                    {selectedProject.sequences && selectedProject.sequences.length > 0 && (
                                        <div style={{ marginTop: 16, padding: '14px 16px', background: 'var(--color-background)', borderRadius: 10, border: '1px solid var(--color-border-light)' }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Target Sequences</div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                                                {selectedProject.sequences.map((seq: any, idx: number) => (
                                                    <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500, userSelect: 'none' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedSequences.includes(seq.name)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) setSelectedSequences(prev => [...prev, seq.name]);
                                                                else setSelectedSequences(prev => prev.filter(s => s !== seq.name));
                                                            }}
                                                            style={{
                                                                width: 17, height: 17, cursor: 'pointer',
                                                                accentColor: '#2563eb'
                                                            }}
                                                        />
                                                        {seq.name}
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    )}

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
                                            <IconUpload2 /> {uploading ? 'Uploading...' : 'Upload & Extract'}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Search bar below upload */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border-light)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-muted)' }}>
                                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                                    </svg>
                                    <input 
                                        type="text" 
                                        placeholder="Search by description, RFI #, or file name..." 
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, width: '100%', color: 'var(--color-text-primary)', fontWeight: 500 }}
                                    />
                                </div>
                                
                                {selectedProject.sequences && selectedProject.sequences.length > 0 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderLeft: '1px solid var(--color-border-light)', paddingLeft: 12 }}>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Filter:</span>
                                        <select
                                            value={sequenceFilter}
                                            onChange={(e) => setSequenceFilter(e.target.value)}
                                            style={{
                                                fontSize: 12,
                                                fontWeight: 600,
                                                padding: '4px 24px 4px 10px',
                                                borderRadius: 6,
                                                border: '1px solid var(--color-border)',
                                                background: 'var(--color-background)',
                                                color: 'var(--color-text-primary)',
                                                outline: 'none',
                                                cursor: 'pointer',
                                                appearance: 'none',
                                                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='3'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                                                backgroundRepeat: 'no-repeat',
                                                backgroundPosition: 'right 8px center',
                                            }}
                                        >
                                            <option value="">All Sequences</option>
                                            {selectedProject.sequences.map((s: any, idx: number) => (
                                                <option key={idx} value={s.name}>{s.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {searchTerm && (
                                    <button 
                                        onClick={() => setSearchTerm('')}
                                        style={{ border: 'none', background: 'none', padding: 0.5, cursor: 'pointer', color: 'var(--color-text-muted)' }}
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                    </button>
                                )}
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
                                    {/* RESULTS LIST */}
                                    <div style={{ flex: 1, minHeight: 0 }}>
                                        {sequenceFilter ? (
                                            // ──────────────────────────────────────────────────────────────────
                                            // ── QUESTION VIEW (Flattened) ──
                                            // ──────────────────────────────────────────────────────────────────
                                            (() => {
                                                const allFiltered: any[] = [];
                                                extractions.filter((ext: any) => ext.sequences && ext.sequences.includes(sequenceFilter))
                                                .forEach((ext: any) => {
                                                    const matches = (ext.rfis || []).filter((rfi: any) => {
                                                        if (!searchTerm) return true;
                                                        const s = searchTerm.toLowerCase();
                                                        return (rfi.description || '').toLowerCase().includes(s) || 
                                                               (rfi.rfiNumber || '').toLowerCase().includes(s) ||
                                                               (rfi.response || '').toLowerCase().includes(s) ||
                                                               (rfi.remarks || '').toLowerCase().includes(s);
                                                    });
                                                    matches.forEach((rfi: any) => allFiltered.push({ rfi, parent: ext }));
                                                });

                                                if (allFiltered.length === 0) {
                                                    return <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>No RFIs found in sequence "{sequenceFilter}"</div>;
                                                }

                                                const hasAnyClientRfi = allFiltered.some(item => item.rfi.clientRfiNumber && item.rfi.clientRfiNumber.trim() !== '');
                                                const gridTemplate = hasAnyClientRfi 
                                                    ? '1.2fr 110px 110px 140px 110px 105px 30px' 
                                                    : '1.2fr 110px 140px 110px 105px 30px';

                                                return (
                                                    <>
                                                        {/* Header for Question View */}
                                                        <div style={{ display: 'grid', gridTemplateColumns: gridTemplate, padding: '12px 20px', background: 'var(--color-background)', borderBottom: '1px solid var(--color-border-light)', fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                                            <span>Question (RFI # & Description)</span>
                                                            <span>Status</span>
                                                            {hasAnyClientRfi && <span>Client RFI #</span>}
                                                            <span>Drawing Ref</span>
                                                            <span>Uploaded By</span>
                                                            <span>Date</span>
                                                            <span />
                                                        </div>
                                                        {allFiltered.map((item) => {
                                                            const { rfi, parent } = item;
                                                            const rfiIndexInOriginal = parent.rfis.findIndex((r: any) => r._id === rfi._id);
                                                            const key = `${parent._id}_${rfiIndexInOriginal}`;
                                                            const isExp = expanded === key;
                                                            const draftText = responseEdits[key] ?? rfi.response ?? '';
                                                            const draftRemarks = remarksEdits[key] ?? rfi.remarks ?? '';
                                                            const draftClientRfi = clientRfiEdits[key] ?? rfi.clientRfiNumber ?? '';
                                                            const isSaving = savingResponse[key] || false;
                                                            const justSaved = savedResponse[key] || false;
                                                            const rfiStatusConfig: Record<string, any> = {
                                                                OPEN: { label: 'Open', bg: '#fee2e2', color: '#991b1b', dot: '#ef4444' },
                                                                CLOSED: { label: 'Closed', bg: '#dcfce7', color: '#166534', dot: '#22c55e' }
                                                            };
                                                            const s = rfiStatusConfig[rfi.status] || rfiStatusConfig.OPEN;
                                                            return (
                                                                <div key={key} style={{ borderBottom: '1px solid var(--color-border-light)', transition: 'background 0.2s' }}>
                                                                    <div onClick={() => setExpanded(isExp ? null : key)} style={{ display: 'grid', gridTemplateColumns: gridTemplate, padding: '14px 20px', cursor: 'pointer', alignItems: 'center', background: isExp ? 'rgba(37,99,235,0.04)' : 'transparent' }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
                                                                            <IconChevron open={isExp} />
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                                                                <span style={{ fontSize: 13, fontWeight: 700, color: '#2563eb', whiteSpace: 'nowrap' }}>{rfi.rfiNumber}:</span>
                                                                                <span style={{ fontSize: 13, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rfi.description}</span>
                                                                            </div>
                                                                        </div>
                                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, width: 'fit-content' }}>
                                                                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />
                                                                            {s.label}
                                                                        </span>
                                                                        {hasAnyClientRfi && <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>{rfi.clientRfiNumber || '—'}</span>}
                                                                        <div style={{ fontSize: 12, fontWeight: 500, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                            <span title={parent.originalFileName}>{parent.originalFileName.split('_').pop()?.replace('.pdf', '') || 'Drawing'}</span>
                                                                        </div>
                                                                        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{parent.uploadedBy}</span>
                                                                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{new Date(parent.createdAt).toLocaleDateString()}</span>
                                                                        <span />
                                                                    </div>
                                                                    {isExp && (
                                                                        <div style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0', padding: '24px 30px' }}>
                                                                            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                                                                                <div style={{ fontSize: 11, fontWeight: 800, color: '#4338ca', background: '#e0e7ff', padding: '4px 12px', borderRadius: 6, border: '1px solid #c7d2fe' }}>SEQUENCE: {sequenceFilter}</div>
                                                                                <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
                                                                            </div>
                                                                            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: 24, background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 24, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                                                                                <div style={{ gridColumn: 'span 3' }}>
                                                                                    <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Full RFI Description</div>
                                                                                    <div style={{ fontSize: 14, color: '#1e293b', background: '#f8fafc', padding: 16, borderRadius: 10, border: '1px solid #e2e8f0', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{rfi.description}</div>
                                                                                </div>
                                                                                <div>
                                                                                    <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Client RFI #</div>
                                                                                    <input type="text" value={draftClientRfi} onChange={(e) => setClientRfiEdits(prev => ({ ...prev, [key]: e.target.value }))} style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14 }} placeholder="e.g. RFI-123" />
                                                                                </div>
                                                                                <div>
                                                                                    <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Response</div>
                                                                                    <textarea value={draftText} onChange={(e) => setResponseEdits(prev => ({ ...prev, [key]: e.target.value }))} rows={4} style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, resize: 'vertical' }} placeholder="Enter official response..." />
                                                                                    <div style={{ marginTop: 14, display: 'flex', gap: 12 }}>
                                                                                        <button onClick={() => handleSaveResponse(parent._id, rfiIndexInOriginal, draftText, draftRemarks, draftClientRfi)} style={{ background: justSaved ? '#22c55e' : '#2563eb', color: 'white', border: 'none', padding: '10px 24px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>{isSaving ? 'Saving...' : justSaved ? '✓ Saved' : 'Save Changes'}</button>
                                                                                        <button onClick={() => document.getElementById(`att-${key}`)?.click()} style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', padding: '10px 18px', borderRadius: 8, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}><IconClip /> Attach PDF</button>
                                                                                        <input type="file" id={`att-${key}`} style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAttachmentUpload(parent._id, rfiIndexInOriginal, f); }} />
                                                                                    </div>
                                                                                </div>
                                                                                <div>
                                                                                    <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Remarks</div>
                                                                                    <textarea value={draftRemarks} onChange={(e) => setRemarksEdits(prev => ({ ...prev, [key]: e.target.value }))} rows={4} style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, resize: 'vertical' }} placeholder="Internal remarks..." />
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </>
                                                );
                                            })()
                                        ) : (
                                            // ──────────────────────────────────────────────────────────────────
                                            // ── DRAWING VIEW (Default) ──
                                            // ──────────────────────────────────────────────────────────────────
                                            <>
                                                {/* Header for Drawing View */}
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 90px 110px 105px 40px', padding: '12px 20px', background: 'var(--color-background)', borderBottom: '1px solid var(--color-border-light)', fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                                    <span>Drawing File</span>
                                                    <span>Status</span>
                                                    <span style={{ textAlign: 'center' }}>RFIs</span>
                                                    <span>Uploaded By</span>
                                                    <span>Date</span>
                                                    <span />
                                                </div>
                                                {extractions.filter((ext: any) => {
                                                    if (!searchTerm) return true;
                                                    const s = searchTerm.toLowerCase();
                                                    const fileMatch = (ext.originalFileName || '').toLowerCase().includes(s);
                                                    const rfisMatch = (ext.rfis || []).some((r: any) => 
                                                        (r.description || '').toLowerCase().includes(s) || 
                                                        (r.rfiNumber || '').toLowerCase().includes(s)
                                                    );
                                                    return fileMatch || rfisMatch;
                                                }).map((ext: any, idx: number, arr: any[]) => {
                                                    const rfiMatches = (ext.rfis || []);
                                                    const isExp = expanded === ext._id || (searchTerm !== '' && rfiMatches.some((r: any) => (r.description || '').toLowerCase().includes(searchTerm.toLowerCase())));
                                                    const isLast = idx === arr.length - 1;
                                                    const rfiCount = rfiMatches.length;
                                                    return (
                                                        <div key={ext._id} style={{ borderBottom: isLast ? 'none' : '1px solid var(--color-border-light)' }}>
                                                            <div onClick={() => setExpanded(isExp ? null : ext._id)} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 90px 110px 105px 40px', padding: '14px 20px', cursor: 'pointer', alignItems: 'center', background: isExp ? 'rgba(37,99,235,0.03)' : 'transparent' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
                                                                    <IconChevron open={isExp} />
                                                                    <span style={{ fontSize: 13, fontWeight: 500, color: '#2563eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ext.originalFileName}</span>
                                                                </div>
                                                                <StatusChip status={ext.status} />
                                                                <span style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: rfiCount > 0 ? '#2563eb' : '#94a3b8' }}>{rfiCount}</span>
                                                                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{ext.uploadedBy}</span>
                                                                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{new Date(ext.createdAt).toLocaleDateString()}</span>
                                                                {isAdmin && (
                                                                    <button onClick={(e) => handleDelete(ext._id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4, opacity: 0.7 }} title="Delete"><IconDelete /></button>
                                                                )}
                                                            </div>
                                                            {isExp && ext.rfis && ext.rfis.length > 0 && (
                                                                <div style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0', padding: '16px 20px 24px 46px' }}>
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                                                        {ext.rfis.map((rfi: any, i: number) => {
                                                                            const key = `${ext._id}_${i}`;
                                                                            const draftText = responseEdits[key] ?? rfi.response ?? '';
                                                                            const draftRemarks = remarksEdits[key] ?? rfi.remarks ?? '';
                                                                            const draftClientRfi = clientRfiEdits[key] ?? rfi.clientRfiNumber ?? '';
                                                                            const isSaving = savingResponse[key] || false;
                                                                            const justSaved = savedResponse[key] || false;
                                                                            return (
                                                                                <div key={i} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, display: 'grid', gridTemplateColumns: '70px 1.2fr 130px 1fr 1fr 80px', gap: 14, alignItems: 'start' }}>
                                                                                    <div style={{ fontSize: 12, fontWeight: 800, background: '#2563eb', color: 'white', borderRadius: 6, padding: '4px 8px', textAlign: 'center' }}>{rfi.rfiNumber}</div>
                                                                                    <div>
                                                                                        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Description</div>
                                                                                        <div style={{ fontSize: 12, color: '#1e293b', lineHeight: 1.5 }}>{rfi.description}</div>
                                                                                    </div>
                                                                                    <div>
                                                                                        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Client RFI #</div>
                                                                                        <input type="text" value={draftClientRfi} onChange={(e) => setClientRfiEdits(prev => ({ ...prev, [key]: e.target.value }))} style={{ width: '100%', fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db' }} />
                                                                                    </div>
                                                                                    <div>
                                                                                        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Response</div>
                                                                                        <textarea value={draftText} onChange={(e) => setResponseEdits(prev => ({ ...prev, [key]: e.target.value }))} rows={3} style={{ width: '100%', fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db' }} />
                                                                                        <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                                                                                            <button onClick={() => handleSaveResponse(ext._id, i, draftText, draftRemarks, draftClientRfi)} style={{ background: justSaved ? '#22c55e' : '#2563eb', color: 'white', border: 'none', padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>{isSaving ? '...' : justSaved ? 'OK' : 'Save'}</button>
                                                                                            <button onClick={() => document.getElementById(`att-${key}`)?.click()} style={{ background: '#f3f4f6', border: '1px solid #d1d5db', padding: '4px 8px', borderRadius: 4, fontSize: 11 }}><IconClip /></button>
                                                                                            <input type="file" id={`att-${key}`} style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAttachmentUpload(ext._id, i, f); }} />
                                                                                        </div>
                                                                                    </div>
                                                                                    <div>
                                                                                        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Remarks</div>
                                                                                        <textarea value={draftRemarks} onChange={(e) => setRemarksEdits(prev => ({ ...prev, [key]: e.target.value }))} rows={3} style={{ width: '100%', fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db' }} />
                                                                                    </div>
                                                                                    <div>
                                                                                        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Status</div>
                                                                                        <div style={{ fontSize: 11, fontWeight: 700, color: 'white', background: rfi.status === 'CLOSED' ? '#16a34a' : '#dc2626', padding: '3px 8px', borderRadius: 20, textAlign: 'center' }}>{rfi.status || 'OPEN'}</div>
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            )}
                                                            {isExp && ext.status === 'failed' && (
                                                                <div style={{ background: '#fef2f2', borderTop: '1px solid #fee2e2', padding: '12px 20px 14px 46px', fontSize: 13, color: '#dc2626' }}>
                                                                    <strong>Extraction failed:</strong> {ext.errorDetails || 'Unknown error'}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
