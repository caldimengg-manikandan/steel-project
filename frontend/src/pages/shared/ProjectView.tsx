import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getProjectById, adminUpdateProject } from '../../services/projectApi';
import type { Project, ProjectPermission } from '../../types';
import { IconBack, IconUpload, IconClose } from '../../components/Icons';
import { uploadDrawing, listExtractions, checkDuplicates } from '../../services/extractionApi';
import { listTransmittals } from '../../services/transmittalApi';
import DrawingExtractionPanel from '../../components/DrawingExtractionPanel';
import TransmittalPanel from '../../components/TransmittalPanel';
import RfiExtractionPanel from '../../components/RfiPanel';

export default function ProjectView() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    const [project, setProject] = useState<Project | null>(null);
    const [allRevisions, setAllRevisions] = useState<any[]>([]); // Populated from Extractions
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState<'revisions' | 'info' | 'extraction' | 'transmittals' | 'rfi'>('transmittals');
    const [uploadModal, setUploadModal] = useState(false);
    const [uploading, setUploading] = useState(false);
    // Duplicate detection state
    const [dupCheckLoading, setDupCheckLoading] = useState(false);
    const [dupModal, setDupModal] = useState(false);
    const [dupList, setDupList] = useState<Array<{ filename: string; sheetNumber: string; revision: string }>>([]);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [localSavePath, setLocalSavePath] = useState('');
    // Transmittal selection modal state
    const [transmittalSelectModal, setTransmittalSelectModal] = useState(false);
    const [existingTransmittals, setExistingTransmittals] = useState<any[]>([]);
    const [loadingTransmittals, setLoadingTransmittals] = useState(false);
    // null = "Create New Transmittal"; number = existing transmittal number
    const [selectedTransmittalNumber, setSelectedTransmittalNumber] = useState<number | null>(null);

    const fetchData = useCallback(async () => {
        if (!id) return;
        try {
            setLoading(true);
            const data = await getProjectById(id);
            const proj = {
                ...data.project,
                id: data.project._id || data.project.id
            };
            setProject(proj);

            // Sync with Extractions
            const extData = await listExtractions(id);

            // Step 1: Pre-scan to group all revisions per drawing to determine "Only Fab" status
            const drawingMarksMap: Record<string, Set<string>> = {};
            const completed = extData.extractions.filter((ex: any) => ex.status === 'completed');

            completed.forEach((ex: any) => {
                const sNo = ex.extractedFields.drawingNumber || 'Extracted';
                if (!drawingMarksMap[sNo]) drawingMarksMap[sNo] = new Set();
                
                const hist = Array.isArray(ex.extractedFields.revisionHistory) && ex.extractedFields.revisionHistory.length > 0
                    ? ex.extractedFields.revisionHistory
                    : [{ mark: ex.extractedFields.revision }];
                
                hist.forEach((h: any) => {
                    if (h.mark != null && h.mark !== '') {
                        drawingMarksMap[sNo].add(String(h.mark).trim().toUpperCase());
                    }
                });
            });

            // Step 2: Populate revision rows with the "isOnlyFab" flag
            const revs: any[] = [];
            completed.forEach((ex: any) => {
                const sheetNo = ex.extractedFields.drawingNumber || 'Extracted';
                const uploadedBy = ex.uploadedBy;

                // "Only Fabrication" = No alphabetic revision marks exist for this sheet number
                const marks = Array.from(drawingMarksMap[sheetNo] || []);
                const hasApproval = marks.some(m => /^[A-Z]/.test(m));
                const isOnlyFab = marks.length > 0 && !hasApproval;

                const history = Array.isArray(ex.extractedFields.revisionHistory) && ex.extractedFields.revisionHistory.length > 0
                    ? ex.extractedFields.revisionHistory
                    : [{ mark: ex.extractedFields.revision, date: ex.extractedFields.date, remarks: ex.extractedFields.remarks }];

                history.forEach((h: any, i: number) => {
                    if (h.mark !== undefined && h.mark !== null && h.mark !== '') {
                        revs.push({
                            id: `${ex._id}-${i}`,
                            sheetNo,
                            revMark: h.mark,
                            date: h.date || '-',
                            description: ex.extractedFields.drawingTitle || ex.extractedFields.drawingDescription || `[No Title] ${ex.originalFileName}`,
                            revisedBy: uploadedBy,
                            isOnlyFab
                        });
                    }
                });
            });
            setAllRevisions(revs);

        } catch (err: any) {
            setError(err.message || 'Failed to load project details');
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // ── Reusable upload helper ────────────────────────────────
    const doUpload = async (filesToUpload: File[]) => {
        if (!project?._id) return;
        setUploading(true);
        try {
            const res = await uploadDrawing(project._id, filesToUpload, localSavePath, selectedTransmittalNumber);
            alert(res.message);
            setUploadModal(false);
            setDupModal(false);
            setDupList([]);
            setPendingFiles([]);
            fetchData();
            setActiveTab('extraction');
        } catch (err: any) {
            alert(`Upload failed: ${err.message}`);
        } finally {
            setUploading(false);
        }
    };

    // ── Open transmittal selector before showing the upload modal ──
    const handleUploadButtonClick = async () => {
        if (!project?._id) return;
        setLoadingTransmittals(true);
        try {
            const data = await listTransmittals(project._id || project.id);
            setExistingTransmittals(data.transmittals || []);
        } catch {
            setExistingTransmittals([]);
        } finally {
            setLoadingTransmittals(false);
        }
        // Default selection: "Create New" when none exist, else first transmittal
        setSelectedTransmittalNumber(null);
        setTransmittalSelectModal(true);
    };

    if (loading) {
        return (
            <div className="text-center py-xl" style={{ marginTop: 100 }}>
                <div className="spinner mb-md"></div>
                <p className="text-muted">Loading project details...</p>
            </div>
        );
    }

    if (error || !project) {
        return (
            <div className="empty-state" style={{ marginTop: 60 }}>
                <div className="info-box danger mb-md">{error || 'Project not found.'}</div>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>Go Back</button>
            </div>
        );
    }

    const assignment = project.assignments?.find((a) => a.userId === user?.id);
    const permission: ProjectPermission = isAdmin ? 'admin' : (assignment?.permission as ProjectPermission ?? 'viewer');
    const canUpload = permission === 'editor' || permission === 'admin';

    const STATUS_LABEL: Record<string, string> = { active: 'Active', on_hold: 'On Hold', completed: 'Completed', archived: 'Archived' };
    const STATUS_CLS: Record<string, string> = { active: 'badge-success', on_hold: 'badge-warning', completed: 'badge-info', archived: 'badge-neutral' };

    /** Format any ISO/UTC date string to IST (Asia/Kolkata) */
    function toIST(raw: string) {
        if (!raw) return '-';
        try {
            return new Date(raw).toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
            });
        } catch {
            return raw;
        }
    }

    const assignedUsers = project?.assignments?.filter(a => a.permission !== 'admin') || [];

    return (
        <div>
            {/* Project Header */}
            <div className="project-header-bar">
                <div className="project-header-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <button
                            className="btn btn-ghost btn-sm btn-icon"
                            onClick={() => navigate(-1)}
                            title="Back"
                        >
                            <IconBack />
                        </button>
                        <h2 className="project-name-heading">{project.name}</h2>
                        <span className={`badge ${STATUS_CLS[project.status]}`}>
                            {STATUS_LABEL[project.status]}
                        </span>
                    </div>
                    <div className="project-meta-row">
                        <div className="project-meta-item">
                            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M2 14V4l6-2 6 2v10H2z" /></svg>
                            Client: <strong style={{ color: 'var(--color-text-primary)' }}>{project.clientName}</strong>
                        </div>
                        <div className="project-meta-item">
                            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M8 1a4 4 0 100 8A4 4 0 008 1zm0 9c-3 0-6 1.3-6 3v1h12v-1c0-1.7-3-3-6-3z" /></svg>
                            Assigned: {assignedUsers.length} user{assignedUsers.length !== 1 ? 's' : ''}
                        </div>
                        <div className="project-meta-item">
                            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><rect x="1" y="3" width="14" height="12" rx="1" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.2" /><path d="M5 1v3M11 1v3M1 7h14" stroke="currentColor" strokeWidth="1.2" /></svg>
                            Updated: {toIST(project.updatedAt)}
                        </div>
                        <div className="project-meta-item">
                            <span className={`role-chip ${permission}`}>{permission.charAt(0).toUpperCase() + permission.slice(1)}</span>
                        </div>
                    </div>
                </div>
                {canUpload && (
                    <button className="btn btn-primary" onClick={handleUploadButtonClick} disabled={loadingTransmittals}>
                        <IconUpload /> {loadingTransmittals ? 'Loading…' : 'Upload Drawing'}
                    </button>
                )}
            </div>

            {/* Tabs */}
            <div className="tab-bar">
                {(['transmittals', 'revisions', 'extraction', 'rfi', 'info'] as const).map((tab) => (
                    <button
                        key={tab}
                        className={`tab-item${activeTab === tab ? ' active' : ''}`}
                        onClick={() => setActiveTab(tab)}
                    >
                        {tab === 'transmittals' && 'Transmittals & Log'}
                        {tab === 'revisions' && `Revision History (${allRevisions.length})`}
                        {tab === 'extraction' && 'Extraction'}
                        {tab === 'rfi' && 'RFI'}
                        {tab === 'info' && 'Project Info'}
                    </button>
                ))}
            </div>

            {/* ── AI Extraction Tab ── */}
            {activeTab === 'extraction' && (
                <div className="card" style={{ padding: 'var(--space-lg)' }}>
                    <DrawingExtractionPanel
                        projectId={project.id}
                        canUpload={canUpload}
                    />
                </div>
            )}

            {/* ── RFI Tab ── */}
            {activeTab === 'rfi' && (
                <div className="card" style={{ padding: 'var(--space-lg)' }}>
                    <RfiExtractionPanel
                        projectId={project.id}
                        projectName={project.name}
                        canUpload={canUpload}
                        sequences={project.sequences}
                    />
                </div>
            )}

            {/* ── Transmittals Tab ── */}
            {activeTab === 'transmittals' && (
                <TransmittalPanel projectId={project.id} canEdit={canUpload} />
            )}

            {/* ── Revision History Tab ── */}
            {activeTab === 'revisions' && (
                <div className="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Sheet No.</th>
                                <th>Rev Mark</th>
                                <th>Date</th>
                                <th>Description</th>
                                <th>Revised By</th>
                            </tr>
                        </thead>
                        <tbody>
                            {allRevisions.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="table-empty">No revision history found.</td>
                                </tr>
                            ) : (
                                allRevisions.map((r) => (
                                    <tr key={r.id}>
                                        <td className="font-mono" style={{ fontWeight: 600 }}>{r.sheetNo}</td>
                                        <td style={r.isOnlyFab ? { background: '#f1f1f9', fontWeight: 700 } : {}}>
                                            <span className={`role-chip ${r.isOnlyFab ? 'archived' : 'viewer'}`}>
                                                {r.revMark}
                                            </span>
                                        </td>
                                        <td className="text-muted">{r.date}</td>
                                        <td>{r.description}</td>
                                        <td className="text-muted">{r.revisedBy}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* ── Project Info Tab ── */}
            {activeTab === 'info' && (
                <div className="card">
                    <div className="card-body">
                        <div className="form-row" style={{ marginBottom: 'var(--space-md)' }}>
                            <div>
                                <div className="form-label" style={{ marginBottom: 4 }}>Project Name</div>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>{project.name}</div>
                            </div>
                            <div>
                                <div className="form-label" style={{ marginBottom: 4 }}>Client Name</div>
                                <div style={{ fontSize: 14 }}>{project.clientName}</div>
                            </div>
                        </div>
                        <div className="form-row" style={{ marginBottom: 'var(--space-md)' }}>
                            <div>
                                <div className="form-label" style={{ marginBottom: 4 }}>Status</div>
                                <span className={`badge ${STATUS_CLS[project.status]}`}>{STATUS_LABEL[project.status]}</span>
                            </div>
                            <div>
                                <div className="form-label" style={{ marginBottom: 4 }}>Created</div>
                                <div className="text-muted">{toIST(project.createdAt)}</div>
                            </div>
                        </div>
                        {project.description && (
                            <div style={{ marginBottom: 'var(--space-md)' }}>
                                <div className="form-label" style={{ marginBottom: 4 }}>Description</div>
                                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                                    {project.description}
                                </div>
                            </div>
                        )}
                        <div>
                            <div className="form-label" style={{ marginBottom: 8 }}>Assigned Users</div>
                            {assignedUsers.length === 0 ? (
                                <span className="text-muted">No users assigned.</span>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {assignedUsers.map((a) => (
                                        <div
                                            key={a.userId}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 10,
                                                padding: '7px 10px',
                                                border: '1px solid var(--color-border-light)',
                                                borderRadius: 3,
                                                background: '#fafbfc',
                                                fontSize: 13,
                                            }}
                                        >
                                            <div style={{
                                                width: 24, height: 24,
                                                borderRadius: '50%',
                                                background: 'var(--color-primary)',
                                                color: 'white',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: 10, fontWeight: 700,
                                            }}>
                                                {a.username.slice(0, 2).toUpperCase()}
                                            </div>
                                            <span style={{ flex: 1, fontWeight: 500 }}>{a.username}</span>
                                            <span className={`role-chip ${a.permission}`}>
                                                {a.permission.charAt(0).toUpperCase() + a.permission.slice(1)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* ── Sequence Progress Section ── */}
                        <div style={{ marginTop: 24, borderTop: '1px solid var(--color-border-light)', paddingTop: 20 }}>
                            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                                Sequence Progress
                            </h3>
                            
                            {!project.sequences || project.sequences.length === 0 ? (
                                <div className="text-muted" style={{ fontSize: 13, padding: '12px 0' }}>No sequences defined for this project.</div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                                    {project.sequences.map((seq, idx) => (
                                        <div 
                                            key={idx} 
                                            style={{ 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                justifyContent: 'space-between',
                                                padding: '12px 16px',
                                                background: '#fff',
                                                border: '1px solid var(--color-border-light)',
                                                borderRadius: 8,
                                                boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
                                            }}
                                        >
                                            <span style={{ fontWeight: 600, fontSize: 14 }}>{seq.name}</span>
                                            <select
                                                style={{
                                                    padding: '4px 8px',
                                                    borderRadius: 6,
                                                    fontSize: 12,
                                                    fontWeight: 700,
                                                    cursor: 'pointer',
                                                    border: '1px solid transparent',
                                                    color: 'white',
                                                    backgroundColor: seq.status === 'Completed' ? '#16a34a' : '#dc2626', // Green : Red
                                                    appearance: 'none',
                                                    WebkitAppearance: 'none',
                                                    textAlign: 'center',
                                                    minWidth: 110,
                                                    outline: 'none'
                                                }}
                                                value={seq.status}
                                                onChange={async (e) => {
                                                    const newStatus = e.target.value as 'Completed' | 'Not Completed';
                                                    if (!id) return;
                                                    try {
                                                        const newSeqs = [...project.sequences];
                                                        newSeqs[idx] = { ...newSeqs[idx], status: newStatus };
                                                        
                                                        await adminUpdateProject(id, { sequences: newSeqs });
                                                        fetchData(); // Refresh page
                                                    } catch (err: any) {
                                                        alert(`Failed to update sequence: ${err.message}`);
                                                    }
                                                }}
                                            >
                                                <option value="Not Completed">Not Completed</option>
                                                <option value="Completed">Completed</option>
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Transmittal Selection Modal ── */}
            {transmittalSelectModal && (
                <div className="modal-overlay" onClick={() => setTransmittalSelectModal(false)}>
                    <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header" style={{ background: 'linear-gradient(135deg,#1e3a5f,#2563eb)', color: 'white', borderRadius: '8px 8px 0 0' }}>
                            <span className="modal-title" style={{ color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                    <line x1="12" y1="18" x2="12" y2="12" />
                                    <line x1="9" y1="15" x2="15" y2="15" />
                                </svg>
                                Select Transmittal
                            </span>
                            <button className="modal-close" style={{ color: 'white' }} onClick={() => setTransmittalSelectModal(false)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 18, lineHeight: 1.6 }}>
                                Choose which transmittal this folder upload belongs to. All uploaded drawings will be associated with the selected transmittal.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                                {/* Existing transmittals */}
                                {existingTransmittals.map(t => (
                                    <label
                                        key={t._id}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 12,
                                            padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                                            border: `2px solid ${selectedTransmittalNumber === t.transmittalNumber ? '#2563eb' : 'var(--color-border-light)'}`,
                                            background: selectedTransmittalNumber === t.transmittalNumber ? 'rgba(37,99,235,0.06)' : 'var(--color-surface)',
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            name="transmittalChoice"
                                            checked={selectedTransmittalNumber === t.transmittalNumber}
                                            onChange={() => setSelectedTransmittalNumber(t.transmittalNumber)}
                                            style={{ accentColor: '#2563eb', width: 16, height: 16, cursor: 'pointer' }}
                                        />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)' }}>
                                                Transmittal #{t.transmittalNumber}
                                                <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 12, color: 'var(--color-text-muted)' }}>
                                                    — {t.newCount + t.revisedCount} drawing{(t.newCount + t.revisedCount) !== 1 ? 's' : ''}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                                Created: {new Date(t.createdAt).toLocaleDateString()}
                                            </div>
                                        </div>
                                        {selectedTransmittalNumber === t.transmittalNumber && (
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="#2563eb" stroke="none"><path d="M20 6L9 17l-5-5" stroke="#2563eb" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                        )}
                                    </label>
                                ))}

                                {/* Create New Transmittal */}
                                <label
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 12,
                                        padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                                        border: `2px solid ${selectedTransmittalNumber === null ? '#059669' : 'var(--color-border-light)'}`,
                                        background: selectedTransmittalNumber === null ? 'rgba(5,150,105,0.06)' : 'var(--color-surface)',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    <input
                                        type="radio"
                                        name="transmittalChoice"
                                        checked={selectedTransmittalNumber === null}
                                        onChange={() => setSelectedTransmittalNumber(null)}
                                        style={{ accentColor: '#059669', width: 16, height: 16, cursor: 'pointer' }}
                                    />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 700, fontSize: 14, color: '#059669', display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                                            Create New Transmittal
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                            Auto-assigns the next transmittal number
                                        </div>
                                    </div>
                                    {selectedTransmittalNumber === null && (
                                        <svg width="16" height="16" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" stroke="#059669" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                    )}
                                </label>
                            </div>

                            <div className="form-actions">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setTransmittalSelectModal(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={() => {
                                        setTransmittalSelectModal(false);
                                        setUploadModal(true);
                                    }}
                                >
                                    Continue Upload →
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Upload Modal */}
            {uploadModal && (
                <div className="modal-overlay" onClick={() => { setUploadModal(false); }}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">Upload Drawing</span>
                            <button className="modal-close" onClick={() => { setUploadModal(false); }}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            {/* Drop zone — folder upload */}
                            <div className="form-group" style={{ marginBottom: 16 }}>
                                <label className="form-label" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                                    PDF File
                                </label>
                                <input
                                    id="file-upload"
                                    type="file"
                                    accept=".pdf"
                                    multiple
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                        const files = e.target.files;
                                        if (files && files.length > 0) {
                                            setPendingFiles(Array.from(files));
                                        } else {
                                            setPendingFiles([]);
                                        }
                                    }}
                                />
                                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                    <label htmlFor="file-upload" className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                                        Choose File
                                    </label>
                                    <span style={{ fontSize: 13, color: pendingFiles.length > 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                                        {pendingFiles.length > 0 ? `${pendingFiles.length} file(s) selected` : 'No file chosen'}
                                    </span>
                                </div>
                            </div>

                            <div className="form-group" style={{ marginBottom: 24 }}>
                                <label className="form-label" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                                    Source Folder Path (Optional)
                                </label>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="e.g. C:\TestDrawings\Project1"
                                    value={localSavePath}
                                    onChange={(e) => setLocalSavePath(e.target.value)}
                                    style={{ fontSize: 13 }}
                                    title="If provided, generated Excel files will be automatically saved here."
                                />
                            </div>

                            <div className="form-actions">
                                <button className="btn btn-secondary" disabled={uploading} onClick={() => { setUploadModal(false); setPendingFiles([]); }}>Cancel</button>
                                <button
                                    className="btn btn-primary"
                                    disabled={pendingFiles.length === 0 || uploading || dupCheckLoading}
                                    onClick={async () => {
                                        if (pendingFiles.length === 0 || !id) return;
                                        // ── Pre-flight duplicate check ──
                                        setDupCheckLoading(true);
                                        try {
                                            const fileNames = pendingFiles.map(file => file.name);
                                            const result = await checkDuplicates(id, fileNames);
                                            if (result.hasDuplicates) {
                                                // Show duplicate confirmation modal
                                                setDupList(result.duplicates);
                                                setDupModal(true);
                                            } else {
                                                // No duplicates — upload immediately
                                                await doUpload(pendingFiles);
                                            }
                                        } catch {
                                            // If duplicate check fails, fall through to upload
                                            await doUpload(pendingFiles);
                                        } finally {
                                            setDupCheckLoading(false);
                                        }
                                    }}
                                >
                                    <IconUpload /> {dupCheckLoading ? 'Checking…' : uploading ? 'Uploading...' : 'Upload Drawing'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* ── Duplicate Detection Confirmation Modal ── */}
            {dupModal && (
                <div className="modal-overlay" onClick={() => setDupModal(false)}>
                    <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">⚠️ Duplicate Drawings Detected</span>
                            <button className="modal-close" onClick={() => setDupModal(false)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <p style={{ marginBottom: 12, color: 'var(--color-text-secondary)', fontSize: 13 }}>
                                <strong>{dupList.length}</strong> drawing{dupList.length !== 1 ? 's' : ''} with the same revision already
                                exist in this project. Do you want to continue uploading?
                            </p>
                            {dupList.length > 0 && (
                                <div className="table-wrapper" style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 16 }}>
                                    <table style={{ fontSize: 12 }}>
                                        <thead>
                                            <tr>
                                                <th>Filename</th>
                                                <th>Sheet No.</th>
                                                <th>Revision</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {dupList.map((d, i) => (
                                                <tr key={i}>
                                                    <td className="text-muted font-mono" style={{ fontSize: 11 }}>{d.filename}</td>
                                                    <td>{d.sheetNumber || '—'}</td>
                                                    <td>{d.revision || '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
                                Selecting <strong>Continue</strong> will skip the duplicate drawing(s) and only upload new or updated revisions.
                            </p>
                            <div className="form-actions">
                                <button
                                    className="btn btn-secondary"
                                    disabled={uploading}
                                    onClick={() => { setDupModal(false); setDupList([]); setPendingFiles([]); }}
                                >
                                    Cancel Upload
                                </button>
                                <button
                                    className="btn btn-primary"
                                    disabled={uploading}
                                    onClick={() => doUpload(pendingFiles)}
                                >
                                    {uploading ? 'Uploading...' : 'Continue'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Permission Legend */}
            <div className="perm-legend">
                <strong style={{ color: 'var(--color-text-primary)', flexShrink: 0 }}>Permission Guide:</strong>
                <span><span className="role-chip viewer">VIEWER</span>&nbsp; Read-only access</span>
                <span><span className="role-chip editor">EDITOR</span>&nbsp; Upload and edit drawings</span>
                <span><span className="role-chip admin">ADMIN</span>&nbsp; Full project control</span>
            </div>
        </div>
    );
}
