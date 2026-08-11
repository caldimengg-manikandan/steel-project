import { useState, useEffect, useCallback } from 'react';
import { adminGetDashboardStats } from '../../services/adminUserApi';
import { adminListClients } from '../../services/adminClientApi';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../../context/SettingsContext';
import { formatDate } from '../../utils/dateUtils';
import type { Client } from '../../types';

function StatusBadge({ status, rawStatus }: { status: string, rawStatus?: string }) {
    const map: Record<string, string> = {
        in_progress: 'badge-success', on_hold: 'badge-danger', completed: 'badge-info', archived: 'badge-warning',
    };
    const labels: Record<string, string> = {
        in_progress: 'In-progress', on_hold: 'On Hold', completed: 'Completed', archived: 'Archived',
    };
    
    const displayStatus = rawStatus || labels[status] || status;
    const s = (displayStatus || '').toLowerCase();
    
    let cls = map[status] ?? 'badge-success';
    if (s.includes('hold')) cls = 'badge-danger';
    else if (s.includes('complete')) cls = 'badge-info';
    else if (s.includes('archiv')) cls = 'badge-warning';
    else if (s.includes('progress')) cls = 'badge-success';

    let formatted = displayStatus.replace(/_/g, ' ');
    if (formatted.toLowerCase() === 'in progress') formatted = 'In-progress';
    else formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);

    return <span className={`badge ${cls}`}>{formatted}</span>;
}

export default function AdminDashboard() {
    const [stats, setStats] = useState<any>(null);
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showDelayedList, setShowDelayedList] = useState(false);
    const [clientFilter, setClientFilter] = useState('ALL');
    const navigate = useNavigate();
    const { settings } = useSettings();

    const fetchStats = useCallback(async () => {
        try {
            setLoading(true);
            const [data, clientsData] = await Promise.all([
                adminGetDashboardStats(),
                adminListClients()
            ]);
            setStats(data);
            setClients(clientsData.clients || []);
        } catch (err: any) {
            setError(err.message || 'Failed to load dashboard');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    if (loading) return (
        <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <div className="spinner mb-sm"></div>
            <p>Loading overview stats...</p>
        </div>
    );

    if (error) return (
        <div className="info-box danger">
            <strong>Error:</strong> {error}
            <button onClick={fetchStats} className="btn btn-ghost btn-sm" style={{ marginLeft: 12 }}>Retry</button>
        </div>
    );

    if (!stats) return null;

    const today = new Date().toISOString().split('T')[0];

    const handleProjectNavigation = (project: any) => {
        const projectId = String(project?._id || project?.id || '').trim();
        if (!projectId || projectId === 'undefined') return;

        navigate(`/admin/projects/${projectId}`);
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h2 className="page-title">Admin Dashboard</h2>
                    <p className="page-subtitle">Overview of your projects, users, and drawings</p>
                </div>
            </div>

            {/* ── Stat Cards ── */}
            <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <div className="stat-card accent-blue">
                    <div className="stat-card-label">Total Clients</div>
                    <div className="stat-card-value text-primary">{stats.totalClients || 0}</div>
                    <div className="stat-card-meta">Registered organizations</div>
                </div>

                {settings.moduleProjects && (
                    <div className="stat-card accent-green">
                        <div className="stat-card-label">Total Projects</div>
                        <div className="stat-card-value text-success">{stats.totalProjects || 0}</div>
                        <div className="stat-card-meta">Active & Pending projects</div>
                    </div>
                )}

                <div className="stat-card accent-amber">
                    <div className="stat-card-label">Total Users</div>
                    <div className="stat-card-value text-amber">{stats.totalUsers || 0}</div>
                    <div className="stat-card-meta">Registered platform users</div>
                </div>

                {settings.moduleProjects && (
                    <div className="stat-card accent-violet">
                        <div className="stat-card-label">Active Projects</div>
                        <div className="stat-card-value text-violet">{stats.activeProjects || 0}</div>
                        <div className="stat-card-meta">Projects currently in progress</div>
                    </div>
                )}

                {settings.moduleProjects && (() => {
                    const delayedTasks = stats.delayedTasks || [];
                    if (delayedTasks.length === 0) return null;

                    // Get unique projects that are delayed
                    const uniqueDelayedProjects = Array.from(new Map(
                        delayedTasks
                            .filter((t: any) => t.projId && String(t.projId) !== 'undefined')
                            .map((t: any) => {
                                const stringId = String(t.projId);
                                const proj = (stats.recentProjects || []).find((rp: any) => String(rp._id || rp.id) === stringId);
                                return [stringId, proj || { name: t.projName, id: stringId }];
                            })
                    ).values());

                    return (
                        <div
                            className={`stat-card accent-red pr ${showDelayedList ? 'active' : ''}`}
                            onClick={() => setShowDelayedList(!showDelayedList)}
                            style={{ cursor: 'pointer', borderColor: 'var(--color-danger-mid)', background: showDelayedList ? 'var(--color-danger-glow)' : '' }}
                        >
                            <div className="stat-card-label" style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                </svg>
                                DELAYED TASKS
                            </div>
                            <div className="stat-card-value text-danger" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                {delayedTasks.length}
                                <svg
                                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="18" height="18"
                                    style={{ transform: showDelayedList ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.25s' }}
                                >
                                    <polyline points="6 9 12 15 18 9" />
                                </svg>
                            </div>
                            <div className="stat-card-meta">Overdue sequences requiring attention</div>

                            {showDelayedList && (
                                <div className="delayed-dropdown-list" style={{ width: '100%', left: 0, marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
                                    <div className="dropdown-header">Overdue Sequence & Tasks</div>
                                    <div className="dropdown-list" style={{ maxHeight: 300, overflowY: 'auto' }}>
                                        {(uniqueDelayedProjects as any[]).map((p: any) => {
                                            const projectTasks = delayedTasks.filter((t: any) => String(t.projId) === String(p.id || p._id));
                                            return (
                                                <div key={p.id || p._id} className="dropdown-section">
                                                    <div className="dropdown-section-title">
                                                        <span className="item-name">{p.name}</span>
                                                        <span className="item-count">{projectTasks.length}</span>
                                                    </div>
                                                    <div className="dropdown-items">
                                                        {projectTasks.map((t: any, idx: number) => (
                                                            <div
                                                                key={idx}
                                                                className="dropdown-item"
                                                                onClick={() => navigate(`/admin/projects/${String(t.projId)}`)}
                                                            >
                                                                <span className="item-dot"></span>
                                                                <span className="item-name">{t.seqName}</span>
                                                                <span className="item-date">{formatDate(t.deadline)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="dropdown-footer" onClick={() => {
                                        const el = document.getElementById('delayed-tasks-module');
                                        if (el) el.scrollIntoView({ behavior: 'smooth' });
                                        setShowDelayedList(false);
                                    }}>
                                        View Detailed Report →
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>

            {/* ── Content grid ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
                {/* My Projects Table */}
                {settings.moduleProjects && (
                    <div className="card">
                        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
                            <span className="card-header-title">My Projects</span>
                            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/admin/projects')}>View All Projects →</button>

                            {/* Client Filter Dropdown */}
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>Filter by Client:</span>
                                <select
                                    className="form-control form-control-sm"
                                    style={{ width: 'auto', minWidth: 140, height: 32, fontSize: 12 }}
                                    value={clientFilter}
                                    onChange={(e) => setClientFilter(e.target.value)}
                                >
                                    <option value="ALL">All Clients ({stats.totalProjects})</option>
                                    {clients
                                        .map(c => c.name)
                                        .sort()
                                        .map((client: string) => (
                                            <option key={client} value={client}>{client}</option>
                                        ))
                                    }
                                </select>
                            </div>
                        </div>
                        <div className="table-wrapper" style={{ border: 'none', boxShadow: 'none', borderRadius: 0 }}>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Client</th>
                                        <th>Project Name</th>
                                        <th>Approx. DWGs</th>
                                        <th>Approval %</th>
                                        <th>Fabrication %</th>
                                        <th>Sequence %</th>
                                        <th>Status</th>
                                        <th>Updated</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {!stats.recentProjects || stats.recentProjects.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} className="table-empty">
                                                No projects yet. Create your first project.
                                            </td>
                                        </tr>
                                    ) : (
                                        (stats.recentProjects || [])
                                            .filter((p: any) => clientFilter === 'ALL' || p.clientName === clientFilter)
                                            .map((p: any) => {
                                                const hasDelayed = (p.sequences || []).some((s: any) => {
                                                    const targetDate = s.approvalDate || s.deadline;
                                                    return s.status !== 'Completed' && targetDate && targetDate < today;
                                                });
                                                return (
                                                    <tr key={p._id || p.id}>
                                                        <td style={{ color: 'var(--color-text-secondary)' }}>{p.clientName}</td>
                                                        <td 
                                                            style={{ 
                                                                fontWeight: 600, 
                                                                color: 'var(--color-primary)', 
                                                                cursor: 'pointer',
                                                                textDecoration: 'underline',
                                                                textUnderlineOffset: '2px'
                                                            }}
                                                            onClick={() => handleProjectNavigation(p)}
                                                        >
                                                            {p.name}
                                                        </td>
                                                        <td className="font-mono" style={{ color: 'var(--color-text-muted)' }}>{p.approximateDrawingsCount || 0}</td>
                                                        <td>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                <div style={{width: 40, height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden'}}>
                                                                    <div style={{width: `${p.approvalPercentage || 0}%`, height: '100%', background: 'var(--color-primary)'}} />
                                                                </div>
                                                                <span style={{fontSize: 11, fontWeight: 700}}>{p.approvalPercentage || 0}%</span>
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                <div style={{width: 40, height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden'}}>
                                                                    <div style={{width: `${p.fabricationPercentage || 0}%`, height: '100%', background: 'var(--color-success-mid)'}} />
                                                                </div>
                                                                <span style={{fontSize: 11, fontWeight: 700}}>{p.fabricationPercentage || 0}%</span>
                                                            </div>
                                                        </td>
                                                        <td>
                                                            {(() => {
                                                                const s = p.sequences || [];
                                                                const total = s.length;
                                                                const done = s.filter((seq: any) => seq.status === 'Completed').length;
                                                                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                                                                return (
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                        <div style={{ width: 40, height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
                                                                            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-violet)' }} />
                                                                        </div>
                                                                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-violet)' }}>{pct}%</span>
                                                                        {hasDelayed && <span className="badge badge-danger" style={{ fontSize: 9, padding: '1px 5px' }}>DELAYED</span>}
                                                                    </div>
                                                                );
                                                            })()}
                                                        </td>
                                                        <td><StatusBadge status={p.status} rawStatus={p.rawStatus} /></td>
                                                        <td style={{ color: 'var(--color-text-muted)', fontSize: 12.5 }}>
                                                            {new Date(p.updatedAt).toLocaleDateString('en-US', {
                                                                day: '2-digit', month: 'short', year: 'numeric',
                                                                hour: '2-digit', minute: '2-digit',
                                                            })}
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Delayed Tasks Detailed Module */}
                {settings.moduleProjects && (
                    <div className="card" id="delayed-tasks-module">
                        <div className="card-header">
                            <span className="card-header-title" style={{ color: 'var(--color-danger)' }}>Delayed Sequences & Overdue Tasks</span>
                            <span className="badge badge-danger">High Priority</span>
                        </div>
                        <div className="table-wrapper" style={{ border: 'none', boxShadow: 'none', borderRadius: 0 }}>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Project</th>
                                        <th>Delayed Sequence</th>
                                        <th>Deadline</th>
                                        <th>Status</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(() => {
                                        const delayedTasks = stats.delayedTasks || [];

                                        if (delayedTasks.length === 0) {
                                            return <tr><td colSpan={5} className="table-empty">No delayed tasks found. Great job!</td></tr>;
                                        }

                                        return delayedTasks.map((t: any, i: number) => (
                                            <tr
                                                key={i}
                                                onClick={() => navigate(`/admin/projects/${String(t.projId)}`)}
                                                style={{ cursor: 'pointer', transition: 'background-color 0.2s' }}
                                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'}
                                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ''}
                                            >
                                                <td style={{ fontWeight: 600, color: 'var(--color-primary)' }}>
                                                    {t.projName}
                                                </td>
                                                <td style={{ color: 'var(--color-danger)', fontWeight: 600 }}>{t.seqName}</td>
                                                <td className="font-mono" style={{ color: 'var(--color-danger)' }}>
                                                    {formatDate(t.deadline)}
                                                </td>
                                                <td><span className="badge badge-danger">OVERDUE</span></td>
                                                <td>
                                                    <button
                                                        className="btn btn-ghost btn-sm"
                                                        style={{ color: 'var(--color-primary)' }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            navigate(`/admin/projects/${String(t.projId)}`);
                                                        }}
                                                    >
                                                        View Project →
                                                    </button>
                                                </td>
                                            </tr>
                                        ));
                                    })()}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
