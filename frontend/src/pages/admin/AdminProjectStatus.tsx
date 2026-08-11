import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminListProjects, downloadProjectStatusExcel } from '../../services/projectApi';
import { listRfiExtractions } from '../../services/rfiApi';
import type { Project, ProjectStatus as TypeProjectStatus } from '../../types';

const STATUS_LABEL: Record<TypeProjectStatus, string> = {
    in_progress: 'In-progress', on_hold: 'On Hold', completed: 'Completed', archived: 'Archived',
};

const STATUS_CLS: Record<TypeProjectStatus, string> = {
    in_progress: 'badge-success', on_hold: 'badge-danger', completed: 'badge-info', archived: 'badge-warning',
};

const getBadgeClass = (text: string) => {
    const s = (text || '').toLowerCase();
    if (s.includes('hold')) return 'badge-danger';
    if (s.includes('complete')) return 'badge-info';
    if (s.includes('archiv')) return 'badge-warning';
    return 'badge-success';
};

const formatBadgeText = (text: string) => {
    if (!text) return text;
    let formatted = text.replace(/_/g, ' ');
    if (formatted.toLowerCase() === 'in progress') return 'In-progress';
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
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
    const [projects, setProjects] = useState<any[]>([]);
    const [totalProjectsCount, setTotalProjectsCount] = useState<number>(0);
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
                isExternal: false
            }));
            setProjects(mapped);
            setTotalProjectsCount(data.count || mapped.length);
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

    const getOriginalCategory = (p: any) => {
        if (!p.rawStatus) return p.status || 'active';
        const s = p.rawStatus.toLowerCase();
        if (s.includes('hold') || s.includes('pause') || s.includes('stop')) return 'on_hold';
        if (s.includes('complete') || s.includes('finish') && !s.includes('not')) return 'completed';
        if (s.includes('archiv')) return 'archived';
        return 'in_progress';
    };

    const allProjects = projects;

    const totalProjects = Math.max(totalProjectsCount, allProjects.length);
    const activeProjects = allProjects.filter((p) => getOriginalCategory(p) === 'in_progress').length;

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
        <div className="admin-container">
            <div className="page-header" style={{ marginBottom: 25, borderBottom: '1px solid var(--color-border-light)', paddingBottom: 20 }}>
                <div className="page-header-left">
                    <h2 className="page-title">Project Live Status</h2>
                    <p className="page-subtitle">Real-time overview of fabrication, approval, RFI, and Change Order progress across all projects.</p>
                </div>
                <div className="page-header-actions">
                    <button
                        className={`btn ${downloading ? 'btn-disabled' : 'btn-primary'}`}
                        onClick={handleDownloadStatusExcel}
                        disabled={downloading}
                    >
                        <IconDownload /> {downloading ? 'Generating Excel...' : 'Export Global Status'}
                    </button>
                    {downloadError && <span style={{ fontSize: 12, color: 'var(--color-danger)', marginLeft: 10 }}>{downloadError}</span>}
                </div>
            </div>

            <div className="stats-grid" style={{ marginBottom: 25 }}>
                <div className="stat-card accent-blue">
                    <div className="stat-card-label">Total Projects</div>
                    <div className="stat-card-value text-blue">{totalProjects}</div>
                    <div className="stat-card-meta">{activeProjects} active projects</div>
                </div>
                <div className="stat-card accent-green">
                    <div className="stat-card-label">Overall Completion</div>
                    <div className="stat-card-value text-green">
                        {totalProjects > 0 ? Math.round(allProjects.reduce((sum, p) => sum + (p.fabricationPercentage || 0), 0) / totalProjects) : 0}%
                    </div>
                    <div className="stat-card-meta">Average fabrication progress</div>
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
            ) : allProjects.length === 0 ? (
                <div className="table-empty" style={{ padding: '60px 0', background: 'var(--color-bg-card)', borderRadius: 10, border: '1px solid var(--color-border)' }}>
                    <p>No projects found. Create a project first.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    {allProjects.map((project, index) => {
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
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div className="project-status-name">{project.name}</div>
                                            {project.location && (
                                                <div style={{
                                                    fontSize: 10,
                                                    fontWeight: 800,
                                                    color: 'var(--color-primary)',
                                                    background: 'var(--color-primary-light)',
                                                    padding: '2px 8px',
                                                    borderRadius: 12,
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.5px',
                                                    border: '1px solid rgba(30, 79, 216, 0.1)'
                                                }}>
                                                    {project.location}
                                                </div>
                                            )}
                                        </div>
                                        <div className="project-status-client">{project.clientName}</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginLeft: 'auto' }}>
                                        <span className={`badge ${getBadgeClass(project.rawStatus || STATUS_LABEL[project.status as TypeProjectStatus] || project.status)}`} style={{ padding: '6px 12px' }}>
                                            {formatBadgeText(project.rawStatus || STATUS_LABEL[project.status as TypeProjectStatus] || project.status)}
                                        </span>
                                    </div>
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
                                            <div className="project-status-stat-value" style={{ color: 'var(--color-success-mid)' }}>
                                                {closedRfiCount}
                                            </div>
                                            <div className="project-status-stat-sub">resolved items</div>
                                        </div>
                                    </div>
                                    <div className="project-status-stat">
                                        <div className="project-status-stat-label">Change Orders (CO)</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 15px', marginTop: 8 }}>
                                            <div style={{ textAlign: 'left' }}>
                                                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>Total</div>
                                                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text-primary)' }}>{project.corStatus?.totalCORItems ?? project.totalCO ?? 0}</div>
                                            </div>
                                            <div style={{ textAlign: 'left' }}>
                                                <div style={{ fontSize: 10, color: 'var(--color-success-mid)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>Approved</div>
                                                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-success-mid)' }}>{project.corStatus?.statusSummary?.Approved ?? project.approvedCO ?? 0}</div>
                                            </div>
                                            <div style={{ textAlign: 'left' }}>
                                                <div style={{ fontSize: 10, color: 'var(--color-primary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>Completed COs</div>
                                                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-primary)' }}>{project.corStatus?.statusSummary?.Completed ?? project.workCompletedCO ?? 0}</div>
                                            </div>
                                            <div style={{ textAlign: 'left' }}>
                                                <div style={{ fontSize: 10, color: 'var(--color-warning-mid)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>Pending</div>
                                                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-warning-mid)' }}>{project.corStatus?.statusSummary?.Submitted ?? project.pendingCO ?? 0}</div>
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
                                            <div style={{ padding: '20px 0', textAlign: 'center' }}>
                                                <div className="spinner spinner-sm"></div>
                                            </div>
                                        ) : filteredRfis.length === 0 ? (
                                            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                                                No {expandedRfiFilter.toLowerCase()} questions found for this project.
                                            </div>
                                        ) : (
                                            <div className="table-wrapper" style={{ maxHeight: 300, overflowY: 'auto' }}>
                                                <table className="table-sm">
                                                    <thead>
                                                        <tr>
                                                            <th>RFI #</th>
                                                            <th>Description</th>
                                                            <th>Drawing</th>
                                                            <th>Status</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {filteredRfis.map((rfi: any, rIdx: number) => (
                                                            <tr key={rIdx}>
                                                                <td style={{ fontWeight: 700 }}>{rfi.rfiNumber}</td>
                                                                <td style={{ fontSize: 12, color: 'var(--color-text-secondary)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rfi.description}</td>
                                                                <td style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{rfi.fileName}</td>
                                                                <td>
                                                                    <span className={`badge badge-sm ${rfi.status === 'CLOSED' ? 'badge-success' : 'badge-warning'}`}>
                                                                        {rfi.status}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
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
