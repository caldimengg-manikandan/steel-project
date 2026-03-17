import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminListProjects, downloadProjectStatusExcel } from '../../services/projectApi';
import { listRfiExtractions } from '../../services/rfiApi';
import type { Project, ProjectStatus as TypeProjectStatus } from '../../types';

const STATUS_LABEL: Record<TypeProjectStatus, string> = {
    active: 'Active',
    on_hold: 'On Hold',
    completed: 'Completed',
    archived: 'Archived',
};

const STATUS_CLS: Record<TypeProjectStatus, string> = {
    active: 'badge-success',
    on_hold: 'badge-warning',
    completed: 'badge-info',
    archived: 'badge-neutral',
};

function IconDownload() {
    return (
        <svg viewBox="0 0 16 16" fill="none" strokeWidth="1.5" stroke="currentColor" width="15" height="15">
            <path d="M8 2v8m0 0l-3-3m3 3l3-3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 12h12" strokeLinecap="round" />
        </svg>
    );
}

function IconChevron({ open }: { open: boolean }) {
    return (
        <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
                transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
            }}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    );
}

export default function AdminProjectStatus() {
    const navigate = useNavigate();
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [downloading, setDownloading] = useState(false);
    const [downloadError, setDownloadError] = useState('');

    // State for expanded RFI questions
    const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
    const [expandedRfiFilter, setExpandedRfiFilter] = useState<'OPEN' | 'CLOSED' | 'ALL'>('ALL');
    const [projectRfis, setProjectRfis] = useState<Record<string, any[]>>({});
    const [loadingRfis, setLoadingRfis] = useState<Record<string, boolean>>({});

    const fetchProjects = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            const data = await adminListProjects();
            const mapped = data.projects.map((p: any) => ({
                ...p,
                id: p._id || p.id,
            }));
            setProjects(mapped);
        } catch (err: any) {
            setError(err.message || 'Failed to load projects');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchProjects();
    }, [fetchProjects]);

    const handleToggleRfis = async (projectId: string, filter: 'OPEN' | 'CLOSED') => {
        if (expandedProjectId === projectId && expandedRfiFilter === filter) {
            setExpandedProjectId(null);
            return;
        }

        setExpandedProjectId(projectId);
        setExpandedRfiFilter(filter);

        // Fetch RFIs if not already fetched
        if (!projectRfis[projectId]) {
            try {
                setLoadingRfis((prev) => ({ ...prev, [projectId]: true }));
                const data = await listRfiExtractions(projectId);
                // Flatten all RFIs from all extractions
                const allRfis: any[] = [];
                data.extractions.forEach((ext: any) => {
                    if (ext.rfis && Array.isArray(ext.rfis)) {
                        ext.rfis.forEach((rfi: any) => {
                            allRfis.push({
                                ...rfi,
                                fileName: ext.originalFileName,
                            });
                        });
                    }
                });
                setProjectRfis((prev) => ({ ...prev, [projectId]: allRfis }));
            } catch (err) {
                console.error('Failed to fetch RFIs:', err);
            } finally {
                setLoadingRfis((prev) => ({ ...prev, [projectId]: false }));
            }
        }
    };

    const totalProjects = projects.length;
    const activeProjects = projects.filter((p) => p.status === 'active').length;
    const totalDrawings = projects.reduce((s, p) => s + (p.drawingCount || 0), 0);

    async function handleDownloadStatusExcel() {
        try {
            setDownloading(true);
            setDownloadError('');
            await downloadProjectStatusExcel();
        } catch (err: any) {
            setDownloadError(err.message || 'Download failed');
        } finally {
            setDownloading(false);
        }
    }

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h2 className="page-title">Project Status</h2>
                    <p className="page-subtitle">Live overview of fabrication &amp; approval counts per project</p>
                </div>
                {/* Download Status Excel Button */}
                <button
                    className="btn btn-primary"
                    onClick={handleDownloadStatusExcel}
                    disabled={downloading || loading || projects.length === 0}
                    title="Download all project status as Excel"
                >
                    <IconDownload />
                    {downloading ? 'Downloading…' : 'Download Status Excel'}
                </button>
            </div>

            {downloadError && (
                <div className="info-box danger mb-md" style={{ padding: '10px 16px', borderRadius: 8 }}>
                    <strong>Download Error:</strong> {downloadError}
                </div>
            )}

            {/* Top stat cards */}
            <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="stat-card accent-blue">
                    <div className="stat-card-label">Total Projects</div>
                    <div className="stat-card-value">{loading ? '—' : totalProjects}</div>
                </div>
                <div className="stat-card accent-green">
                    <div className="stat-card-label">Active Projects</div>
                    <div className="stat-card-value">{loading ? '—' : activeProjects}</div>
                </div>
                <div className="stat-card accent-amber">
                    <div className="stat-card-label">Total Drawings</div>
                    <div className="stat-card-value">{loading ? '—' : totalDrawings}</div>
                </div>
            </div>

            {error && (
                <div className="info-box danger mb-md" style={{ padding: '12px 16px', borderRadius: 8 }}>
                    <strong>Error:</strong> {error}
                    <button onClick={fetchProjects} className="btn btn-ghost btn-sm" style={{ marginLeft: 12 }}>
                        Retry
                    </button>
                </div>
            )}

            {loading ? (
                <div className="text-center py-xl">
                    <div className="spinner mb-md"></div>
                    <p className="text-muted">Loading project status...</p>
                </div>
            ) : projects.length === 0 ? (
                <div className="table-empty" style={{ padding: '60px 0', background: 'var(--color-bg-card)', borderRadius: 10, border: '1px solid var(--color-border)' }}>
                    <p>No projects found. Create a project first.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    {projects.map((project, index) => {
                        const fabricationCount = (project as any).fabricationCount || 0;
                        const approvedCount = (project as any).approvalCount || 0;
                        const openRfiCount = project.openRfiCount || 0;
                        const closedRfiCount = project.closedRfiCount || 0;
                        
                        const isSectionExpanded = expandedProjectId === project.id;
                        
                        const filteredRfis = (projectRfis[project.id] || []).filter(r => 
                            expandedRfiFilter === 'ALL' ? true : r.status === expandedRfiFilter
                        );

                        return (
                            <div key={project.id} className="project-status-card">
                                <div className="project-status-header">
                                    <div className="project-status-num">{index + 1}</div>
                                    <div className="project-status-info">
                                        <div className="project-status-name">{project.name}</div>
                                        <div className="project-status-client">{project.clientName}</div>
                                    </div>
                                    <span className={`badge ${STATUS_CLS[project.status]}`}>
                                        {STATUS_LABEL[project.status]}
                                    </span>
                                </div>

                                <div className="project-status-stats">
                                    <div className="project-status-stat">
                                        <div className="project-status-stat-label">Uploaded</div>
                                        <div className="project-status-stat-value" style={{ fontSize: 24 }}>
                                            {project.drawingCount || 0}<span style={{ fontSize: 14, color: 'var(--color-text-muted)', fontWeight: 500, marginLeft: 2 }}>/ {project.approximateDrawingsCount || '?'}</span>
                                        </div>
                                        <div className="project-status-stat-sub">drawings uploaded</div>
                                    </div>
                                    <div className="project-status-stat">
                                        <div className="project-status-stat-label">Fabrications</div>
                                        <div className="project-status-stat-value">{project.fabricationPercentage || 0}%</div>
                                        <div className="project-status-stat-sub">{fabricationCount} drawings fabricated</div>
                                    </div>
                                    <div className="project-status-stat">
                                        <div className="project-status-stat-label">Approvals</div>
                                        <div className="project-status-stat-value">{project.approvalPercentage || 0}%</div>
                                        <div className="project-status-stat-sub">{approvedCount} drawings approved</div>
                                    </div>
                                    <div 
                                        className={`project-status-stat ${isSectionExpanded && expandedRfiFilter === 'OPEN' ? 'active-stat-selection' : ''}`} 
                                        style={{ transition: 'all 0.2s' }}
                                    >
                                        <div 
                                            className="project-status-stat-label" 
                                            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                                            onClick={(e) => { e.stopPropagation(); handleToggleRfis(project.id, 'OPEN'); }}
                                        >
                                            Open RFIs <IconChevron open={isSectionExpanded && expandedRfiFilter === 'OPEN'} />
                                        </div>
                                        <div 
                                            onClick={() => navigate('/admin/rfi', { state: { projectId: project.id } })}
                                            style={{ cursor: 'pointer' }}
                                        >
                                            <div className="project-status-stat-value" style={{ color: openRfiCount > 0 ? 'var(--color-danger-mid)' : 'inherit' }}>
                                                {openRfiCount}
                                            </div>
                                            <div className="project-status-stat-sub">unresolved questions</div>
                                        </div>
                                    </div>
                                    <div 
                                        className={`project-status-stat ${isSectionExpanded && expandedRfiFilter === 'CLOSED' ? 'active-stat-selection' : ''}`}
                                        style={{ transition: 'all 0.2s' }}
                                    >
                                        <div 
                                            className="project-status-stat-label" 
                                            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                                            onClick={(e) => { e.stopPropagation(); handleToggleRfis(project.id, 'CLOSED'); }}
                                        >
                                            Closed RFIs <IconChevron open={isSectionExpanded && expandedRfiFilter === 'CLOSED'} />
                                        </div>
                                        <div 
                                            onClick={() => navigate('/admin/rfi', { state: { projectId: project.id } })}
                                            style={{ cursor: 'pointer' }}
                                        >
                                            <div className="project-status-stat-value" style={{ color: closedRfiCount > 0 ? 'var(--color-success-mid)' : 'inherit' }}>
                                                {closedRfiCount}
                                            </div>
                                            <div className="project-status-stat-sub">resolved items</div>
                                        </div>
                                    </div>

                                    {/* Change Order Column */}
                                    <div className="project-status-stat" style={{ background: 'var(--color-bg-alt)' }}>
                                        <div className="project-status-stat-label">Change Orders (CO)</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginTop: 4 }}>
                                            <div style={{ textAlign: 'left' }}>
                                                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600 }}>Total</div>
                                                <div style={{ fontSize: 13, fontWeight: 700 }}>{project.totalCO || 0}</div>
                                            </div>
                                            <div style={{ textAlign: 'left' }}>
                                                <div style={{ fontSize: 10, color: 'var(--color-success-mid)', fontWeight: 600 }}>Approved</div>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-success-mid)' }}>{project.approvedCO || 0}</div>
                                            </div>
                                            <div style={{ textAlign: 'left' }}>
                                                <div style={{ fontSize: 10, color: 'var(--color-primary)', fontWeight: 600 }}>Completed</div>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)' }}>{project.workCompletedCO || 0}</div>
                                            </div>
                                            <div style={{ textAlign: 'left' }}>
                                                <div style={{ fontSize: 10, color: 'var(--color-warning-mid)', fontWeight: 600 }}>Pending</div>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-warning-mid)' }}>{project.pendingCO || 0}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="project-status-progress-row">
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Approval Progress</span>
                                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary)' }}>{project.approvalPercentage || 0}%</span>
                                        </div>
                                        <div className="project-status-progress-bar" style={{ height: 6 }}>
                                            <div
                                                className="project-status-progress-fill"
                                                style={{ width: `${project.approvalPercentage || 0}%`, background: 'var(--color-primary)' }}
                                            />
                                        </div>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Fabrication Progress</span>
                                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-success-mid)' }}>{project.fabricationPercentage || 0}%</span>
                                        </div>
                                        <div className="project-status-progress-bar" style={{ height: 6 }}>
                                            <div
                                                className="project-status-progress-fill"
                                                style={{ width: `${project.fabricationPercentage || 0}%`, background: 'var(--color-success-mid)' }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {isSectionExpanded && (
                                    <div style={{ padding: '0 20px 20px 20px', borderTop: '1px solid var(--color-border-light)', background: '#fafbfc' }}>
                                        <div style={{ marginTop: 15, fontSize: 13, fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <div style={{ width: 4, height: 16, background: expandedRfiFilter === 'OPEN' ? 'var(--color-danger-mid)' : 'var(--color-success-mid)', borderRadius: 2 }} />
                                                {expandedRfiFilter === 'OPEN' ? 'Open Questions' : 'Resolved Questions'}
                                            </div>
                                            <div className="badge badge-neutral" style={{ fontSize: 10, cursor: 'pointer' }} onClick={() => setExpandedProjectId(null)}>
                                                Close Dropdown
                                            </div>
                                        </div>
                                        
                                        {loadingRfis[project.id] ? (
                                            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                                                <div className="spinner spinner-sm mb-sm" style={{ display: 'inline-block' }}></div>
                                                <p>Fetching questions...</p>
                                            </div>
                                        ) : filteredRfis.length === 0 ? (
                                            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13, border: '1px dashed var(--color-border)', borderRadius: 6, background: '#fff' }}>
                                                No {expandedRfiFilter === 'OPEN' ? 'open' : 'closed'} RFI questions found.
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                                {filteredRfis.map((rfi, idx) => (
                                                    <div 
                                                        key={idx} 
                                                        onClick={() => navigate('/admin/rfi', { state: { projectId: project.id } })}
                                                        style={{ 
                                                            background: '#fff', 
                                                            border: '1px solid var(--color-border-light)', 
                                                            borderRadius: 8, 
                                                            padding: '12px 14px', 
                                                            position: 'relative', 
                                                            boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                                                            cursor: 'pointer',
                                                            transition: 'transform 0.1s'
                                                        }}
                                                        onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
                                                        onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                                                    >
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 6 }}>
                                                            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '2px 8px', borderRadius: 4 }}>
                                                                #{rfi.rfiNumber || (idx + 1)}
                                                            </div>
                                                            <span className={`badge ${rfi.status === 'CLOSED' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: 10 }}>
                                                                {rfi.status}
                                                            </span>
                                                        </div>
                                                        <div style={{ fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500, marginBottom: 4, lineHeight: 1.5 }}>
                                                            {rfi.description}
                                                        </div>
                                                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'flex', gap: 12 }}>
                                                            <span>Drawing: <strong style={{ color: 'var(--color-text-secondary)' }}>{rfi.fileName}</strong></span>
                                                            {rfi.refDrawing && <span>Ref: <strong>{rfi.refDrawing}</strong></span>}
                                                        </div>
                                                        {rfi.response && (
                                                            <div style={{ marginTop: 8, padding: '8px 10px', background: '#f0fdf4', borderRadius: 6, borderLeft: '3px solid #16a34a' }}>
                                                                <div style={{ fontSize: 10, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Response</div>
                                                                <div style={{ fontSize: 12, color: '#166534' }}>{rfi.response}</div>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
