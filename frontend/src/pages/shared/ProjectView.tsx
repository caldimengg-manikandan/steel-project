import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getProjectById, updateProjectSequences } from '../../services/projectApi';
import type { Project, ProjectPermission } from '../../types';
import { IconBack, IconUpload, IconClose } from '../../components/Icons';
import { uploadDrawing, listExtractions, checkDuplicates, reserveTransmittalNumber } from '../../services/extractionApi';
import { listTransmittals } from '../../services/transmittalApi';
import DrawingExtractionPanel from '../../components/DrawingExtractionPanel';
import TransmittalPanel from '../../components/TransmittalPanel';
import RfiExtractionPanel from '../../components/RfiPanel';

export default function ProjectView() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    // DEBUG (Step 5): Log ID for troubleshooting
    useEffect(() => {
        console.log(`[ProjectView] URL Parameter 'id' is:`, id);
    }, [id]);

    const [project, setProject] = useState<Project | null>(null);
    const [allRevisions, setAllRevisions] = useState<any[]>([]); // Populated from Extractions
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState<'dashboard' | 'revisions' | 'info' | 'extraction' | 'transmittals' | 'rfi'>('dashboard');
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
    const [selectedSequences, setSelectedSequences] = useState<string[]>([]);

    const fetchData = useCallback(async () => {
        if (!id || id === 'undefined' || id.length < 5) {
            console.error(`[ProjectView] Bailing fetch due to invalid ID:`, id);
            setError(`Project ID is invalid or missing (Received: "${id}").`);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const [projData, extData] = await Promise.all([
                getProjectById(id),
                listExtractions(id)
            ]);

            setProject(projData.project);

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
        const pId = project?._id || project?.id;
        if (!pId) {
            console.error("[ProjectView] Cannot upload: No valid project ID found in state.", project);
            return;
        }
        setUploading(true);
        try {
            let numToUse = selectedTransmittalNumber;
            if (numToUse === null) {
                const res = await reserveTransmittalNumber(pId);
                numToUse = res.transmittalNumber;
            }
            const res = await uploadDrawing(pId, filesToUpload, localSavePath, numToUse, selectedSequences);
            alert(res.message);
            setUploadModal(false);
            setDupModal(false);
            setDupList([]);
            setPendingFiles([]);
            setSelectedSequences([]);
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
        const pId = project?._id || project?.id;
        if (!pId) return;
        setLoadingTransmittals(true);
        try {
            const data = await listTransmittals(pId);
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
                {(['dashboard', 'transmittals', 'revisions', 'extraction', 'rfi', 'info'] as const).map((tab) => (
                    <button
                        key={tab}
                        className={`tab-item${activeTab === tab ? ' active' : ''}`}
                        onClick={() => setActiveTab(tab)}
                    >
                        {tab === 'dashboard' && '📊 Dashboard'}
                        {tab === 'transmittals' && 'Transmittals & Log'}
                        {tab === 'revisions' && `Revision History (${allRevisions.length})`}
                        {tab === 'extraction' && 'Extraction'}
                        {tab === 'rfi' && 'RFI'}
                        {tab === 'info' && 'Project Info'}
                    </button>
                ))}
            </div>

            {/* ── Dashboard Tab ── */}
            {activeTab === 'dashboard' && (() => {
                const fabCount   = (project as any).fabricationCount || 0;
                const appCount   = (project as any).approvalCount    || 0;
                const openRfi    = project.openRfiCount  || 0;
                const closedRfi  = project.closedRfiCount || 0;
                const seqs       = project.sequences || [];
                const seqTotal   = seqs.length;
                const seqDone    = seqs.filter((s: any) => s.status === 'Completed').length;
                const seqPct     = seqTotal > 0 ? Math.round((seqDone / seqTotal) * 100) : 0;
                const fabPct     = project.fabricationPercentage || 0;
                const appPct     = project.approvalPercentage    || 0;

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 32 }}>

                        {/* ── KPI row — reuse the app's stat-card class ── */}
                        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(5,1fr)', marginBottom: 0 }}>

                            {/* Fabrication */}
                            <div className="stat-card accent-green">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div className="stat-card-label">Fabrication</div>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--color-success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-success-mid)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                                    </div>
                                </div>
                                <div className="stat-card-value">{fabCount}</div>
                                <div className="stat-card-meta">{fabPct}% of total drawings</div>
                            </div>

                            {/* Approval */}
                            <div className="stat-card accent-blue">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div className="stat-card-label">Approval</div>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--color-info-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-info-mid)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                                    </div>
                                </div>
                                <div className="stat-card-value">{appCount}</div>
                                <div className="stat-card-meta">{appPct}% of total drawings</div>
                            </div>

                            {/* Open RFIs */}
                            <div className="stat-card accent-slate" style={{ '--before-bg': 'var(--color-danger-mid)' } as any}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div className="stat-card-label">Open RFIs</div>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--color-danger-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger-mid)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                    </div>
                                </div>
                                <div className="stat-card-value" style={{ color: openRfi > 0 ? 'var(--color-danger-mid)' : 'var(--color-text-primary)' }}>{openRfi}</div>
                                <div className="stat-card-meta">unresolved questions</div>
                            </div>

                            {/* Closed RFIs */}
                            <div className="stat-card accent-green" style={{ '--stat-accent': 'var(--color-success-mid)' } as any}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div className="stat-card-label">Closed RFIs</div>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--color-success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-success-mid)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                    </div>
                                </div>
                                <div className="stat-card-value" style={{ color: 'var(--color-success-mid)' }}>{closedRfi}</div>
                                <div className="stat-card-meta">resolved questions</div>
                            </div>

                            {/* Sequences */}
                            <div className="stat-card accent-violet">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div className="stat-card-label">Sequences</div>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(124,58,237,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                                    </div>
                                </div>
                                <div className="stat-card-value" style={{ color: 'var(--accent-violet)' }}>{seqDone}<span style={{ fontSize: 22, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: 0 }}>/{seqTotal}</span></div>
                                <div className="stat-card-meta">{seqPct}% complete</div>
                            </div>
                        </div>

                        {/* ── Bottom two-column section ── */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

                            {/* Progress panel */}
                            <div className="card">
                                <div className="card-header">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                                        <span className="card-header-title">Progress Overview</span>
                                    </div>
                                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>Fabrication · Approval · Sequences</span>
                                </div>
                                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                                    {[
                                        { label: 'Fabrication',  pct: fabPct, count: fabCount, color: 'var(--color-success-mid)', bg: 'var(--color-success-bg)', barBg: 'rgba(22,163,74,0.15)' },
                                        { label: 'Approval',     pct: appPct, count: appCount, color: 'var(--color-info-mid)',    bg: 'var(--color-info-bg)',    barBg: 'rgba(37,99,235,0.12)' },
                                        { label: 'Sequences',    pct: seqPct, count: seqDone,  color: 'var(--accent-violet)',     bg: 'rgba(124,58,237,0.08)', barBg: 'rgba(124,58,237,0.12)' },
                                    ].map(({ label, pct, count, color, bg, barBg }) => (
                                        <div key={label}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{label}</span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{count} drawings</span>
                                                    <span style={{ fontSize: 12, fontWeight: 700, color, background: bg, padding: '2px 9px', borderRadius: 99, border: `1px solid ${color}22` }}>{pct}%</span>
                                                </div>
                                            </div>
                                            <div style={{ height: 7, background: barBg, borderRadius: 99, overflow: 'hidden' }}>
                                                <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.8s ease' }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Right column: Sequences + COR */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                                {/* Sequences list */}
                                <div className="card" style={{ flex: 1 }}>
                                    <div className="card-header">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent-violet)" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                                            <span className="card-header-title">Sequences</span>
                                        </div>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-violet)', background: 'rgba(124,58,237,0.1)', padding: '2px 10px', borderRadius: 99 }}>{seqDone}/{seqTotal} done · {seqPct}%</span>
                                    </div>
                                    <div className="card-body" style={{ padding: 'var(--space-md)' }}>
                                        {seqTotal === 0 ? (
                                            <div className="table-empty" style={{ padding: '24px 0' }}>No sequences defined for this project.</div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                {seqs.map((seq: any, idx: number) => {
                                                    const done = seq.status === 'Completed';
                                                    return (
                                                        <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 'var(--radius-md)', background: done ? 'var(--color-success-bg)' : 'var(--color-bg-page)', border: `1px solid ${done ? 'var(--color-success-bg)' : 'var(--color-border-light)'}` }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                                <div style={{ width: 7, height: 7, borderRadius: '50%', background: done ? 'var(--color-success-mid)' : 'var(--color-border)', flexShrink: 0 }} />
                                                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{seq.name}</span>
                                                            </div>
                                                            <span className={`badge ${done ? 'badge-success' : 'badge-neutral'}`}>{done ? '✓ Complete' : 'Pending'}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* COR placeholder */}
                                <div className="card" style={{ border: '1.5px dashed var(--color-border)' }}>
                                    <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px var(--space-lg)' }}>
                                        <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-lg)', background: 'var(--color-warning-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning-mid)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 3 }}>Change Orders (COR)</div>
                                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.55 }}>COR tracking coming soon — requirements will be configured here.</div>
                                        </div>
                                        <span className="badge badge-warning" style={{ flexShrink: 0, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' }}>Coming Soon</span>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* ── AI Extraction Tab ── */}
            {activeTab === 'extraction' && (
                <div className="card" style={{ padding: 'var(--space-lg)' }}>
                    <DrawingExtractionPanel
                        projectId={(project?._id || project?.id) as string}
                        canUpload={canUpload}
                        sequences={project.sequences}
                    />
                </div>
            )}

            {/* ── RFI Tab ── */}
            {activeTab === 'rfi' && (
                <div className="card" style={{ padding: 'var(--space-lg)' }}>
                    <RfiExtractionPanel
                        projectId={(project?._id || project?.id) as string}
                        projectName={project.name}
                        canUpload={canUpload}
                        sequences={project.sequences}
                    />
                </div>
            )}

            {/* ── Transmittals Tab ── */}
            {activeTab === 'transmittals' && (
                <TransmittalPanel projectId={(project?._id || project?.id) as string} canEdit={canUpload} sequences={project.sequences} />
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
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                                    {project.sequences.map((seq, idx) => {
                                        const isDone = seq.status === 'Completed';
                                        const canEditSequences = isAdmin || project.myPermission === 'editor' || project.myPermission === 'admin';
                                        const handleUpdateSequence = async (updates: Partial<typeof seq>) => {
                                            if (!id) return;
                                            if (!canEditSequences) {
                                                alert('Permission denied: Only editors or admins can update sequences.');
                                                return;
                                            }
                                            try {
                                                const newSeqs = [...project.sequences];
                                                newSeqs[idx] = { ...newSeqs[idx], ...updates };
                                                await updateProjectSequences(id, newSeqs);
                                                await fetchData();
                                            } catch (err: any) {
                                                alert(`Failed to update sequence: ${err.message}`);
                                            }
                                        };
                                        return (
                                            <div
                                                key={idx}
                                                style={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    padding: '12px 16px',
                                                    background: isDone ? 'var(--color-success-bg)' : 'var(--color-bg-card)',
                                                    border: `1px solid ${isDone ? 'var(--color-success-bg)' : 'var(--color-border-light)'}`,
                                                    borderRadius: 'var(--radius-lg)',
                                                    boxShadow: 'var(--shadow-xs)',
                                                    transition: 'all 0.15s',
                                                    gap: 12,
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                                    {/* Sequence name with status dot */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                                                        <div style={{
                                                            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                                            background: isDone ? 'var(--color-success-mid)' : 'var(--color-border)',
                                                            boxShadow: isDone ? '0 0 0 3px var(--color-success-bg)' : 'none',
                                                        }} />
                                                        <span style={{
                                                            fontWeight: 700, fontSize: 13,
                                                            color: 'var(--color-text-primary)',
                                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                        }}>{seq.name}</span>
                                                    </div>

                                                    {/* Toggle pill */}
                                                    <div style={{
                                                        display: 'flex',
                                                        flexShrink: 0,
                                                        background: 'var(--color-bg-page)',
                                                        border: '1px solid var(--color-border)',
                                                        borderRadius: 99,
                                                        padding: 3,
                                                        gap: 2,
                                                    }}>
                                                        <button
                                                            onClick={() => handleUpdateSequence({ status: 'Not Completed' })}
                                                            disabled={!canEditSequences}
                                                            style={{
                                                                padding: '3px 10px',
                                                                borderRadius: 99,
                                                                fontSize: 10,
                                                                fontWeight: 700,
                                                                border: 'none',
                                                                cursor: canEditSequences ? 'pointer' : 'not-allowed',
                                                                transition: 'all 0.15s',
                                                                background: !isDone ? 'var(--color-danger-mid)' : 'transparent',
                                                                color: !isDone ? 'white' : 'var(--color-text-muted)',
                                                                boxShadow: !isDone ? '0 1px 4px rgba(220,38,38,0.3)' : 'none',
                                                                letterSpacing: 0.2,
                                                                opacity: canEditSequences ? 1 : 0.6,
                                                            }}
                                                        >
                                                            Pending
                                                        </button>
                                                        <button
                                                            onClick={() => handleUpdateSequence({ status: 'Completed', fabricationDate: seq.fabricationDate || new Date().toISOString() })}
                                                            disabled={!canEditSequences}
                                                            style={{
                                                                padding: '3px 10px',
                                                                borderRadius: 99,
                                                                fontSize: 10,
                                                                fontWeight: 700,
                                                                border: 'none',
                                                                cursor: canEditSequences ? 'pointer' : 'not-allowed',
                                                                transition: 'all 0.15s',
                                                                background: isDone ? 'var(--color-success-mid)' : 'transparent',
                                                                color: isDone ? 'white' : 'var(--color-text-muted)',
                                                                boxShadow: isDone ? '0 1px 4px rgba(22,163,74,0.3)' : 'none',
                                                                letterSpacing: 0.2,
                                                                opacity: canEditSequences ? 1 : 0.6,
                                                            }}
                                                        >
                                                            ✓ Done
                                                        </button>
                                                    </div>
                                                </div>

                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                                    <div>
                                                        <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Approval Date</label>
                                                        <input 
                                                            type="date" 
                                                            className="form-control form-control-sm"
                                                            style={{ height: 28, fontSize: 11 }}
                                                            value={seq.approvalDate ? seq.approvalDate.split('T')[0] : ''}
                                                            onChange={(e) => handleUpdateSequence({ approvalDate: e.target.value })}
                                                            disabled={!canEditSequences}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Fabrication Date</label>
                                                        <input 
                                                            type="date" 
                                                            className="form-control form-control-sm"
                                                            style={{ height: 28, fontSize: 11 }}
                                                            value={seq.fabricationDate ? seq.fabricationDate.split('T')[0] : ''}
                                                            onChange={(e) => handleUpdateSequence({ fabricationDate: e.target.value })}
                                                            disabled={!canEditSequences}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
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

                            {project.sequences && project.sequences.length > 0 && (
                                <div style={{ marginBottom: 20, padding: '14px 16px', background: 'var(--color-background)', borderRadius: 10, border: '1px solid var(--color-border-light)' }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Target Sequences</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                                        {project.sequences.map((seq: any, idx: number) => (
                                            <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500, userSelect: 'none' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedSequences.includes(seq.name)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) setSelectedSequences(prev => [...prev, seq.name]);
                                                        else setSelectedSequences(prev => prev.filter(s => s !== seq.name));
                                                    }}
                                                    style={{ width: 17, height: 17, cursor: 'pointer', accentColor: '#2563eb' }}
                                                />
                                                {seq.name}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}

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
