import { useState, useEffect, useCallback } from 'react';
import { adminGetDashboardStats } from '../../services/adminUserApi';
import { useNavigate } from 'react-router-dom';

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, string> = {
        active: 'badge-success', on_hold: 'badge-warning', completed: 'badge-info', archived: 'badge-neutral',
    };
    const labels: Record<string, string> = {
        active: 'Active', on_hold: 'On Hold', completed: 'Completed', archived: 'Archived',
    };
    return <span className={`badge ${map[status] ?? 'badge-neutral'}`}>{labels[status] ?? status}</span>;
}

export default function AdminDashboard() {
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showDelayedList, setShowDelayedList] = useState(false);
    const navigate = useNavigate();

    const fetchStats = useCallback(async () => {
        try {
            setLoading(true);
            const data = await adminGetDashboardStats();
            setStats(data);
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

                <div className="stat-card accent-green">
                    <div className="stat-card-label">Total Projects</div>
                    <div className="stat-card-value text-success">{stats.totalProjects || 0}</div>
                    <div className="stat-card-meta">Active & Pending projects</div>
                </div>

                <div className="stat-card accent-amber">
                    <div className="stat-card-label">Total Users</div>
                    <div className="stat-card-value">{stats.totalUsers || 0}</div>
                    <div className="stat-card-meta">Registered platform users</div>
                </div>

                <div className="stat-card accent-violet">
                    <div className="stat-card-label">Total Drawings</div>
                    <div className="stat-card-value" style={{ color: 'var(--accent-violet)' }}>{stats.totalDrawings || 0}</div>
                    <div className="stat-card-meta">Processed & approved DWGs</div>
                </div>

                {(() => {
                    const delayedTasks = stats.delayedTasks || [];
                    
                    // Get unique projects that are delayed
                    const uniqueDelayedProjects = Array.from(new Map(
                        delayedTasks
                            .filter((t: any) => t.projId && String(t.projId) !== 'undefined')
                            .map((t: any) => {
                                const stringId = String(t.projId);
                                return [stringId, { id: stringId, name: t.projName }];
                            })
                    ).values());

                    const delayedCount = uniqueDelayedProjects.length;

                    return (
                        <div 
                            className="stat-card accent-red pr" 
                            style={{ overflow: showDelayedList ? 'visible' : 'hidden', cursor: 'default' }}
                            onMouseLeave={() => setShowDelayedList(false)}
                        >
                            <div className="stat-card-label">Delayed Drawings / Tasks</div>
                            <div className="stat-card-value text-danger" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                {delayedCount}
                                {delayedCount > 0 && (
                                    <button 
                                        className="btn-icon btn-ghost" 
                                        onClick={() => setShowDelayedList(!showDelayedList)}
                                        style={{ height: 32, width: 32, borderRadius: '50%', color: 'var(--color-danger)' }}
                                        title="View delayed projects"
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
                                            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                            <div className="stat-card-meta">Projects with past-due drawing sequences</div>

                            {/* Dropdown List */}
                            {showDelayedList && delayedCount > 0 && (
                                <div className="delayed-dropdown-list">
                                    <div className="dropdown-arrow"></div>
                                    <div className="dropdown-header">Overdue Projects</div>
                                    <div className="dropdown-items">
                                        {uniqueDelayedProjects.map((p: any) => {
                                            const projectTasks = delayedTasks.filter((t: any) => String(t.projId) === p.id);
                                            return (
                                                <div key={p.id} style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--color-border-light)' }}>
                                                    <div 
                                                        className="dropdown-item"
                                                        onMouseDown={(e) => {
                                                            e.stopPropagation();
                                                            navigate(`/admin/projects/${p.id}`);
                                                        }}
                                                        style={{ borderBottom: 'none', paddingBottom: 6 }}
                                                    >
                                                        <div className="item-dot"></div>
                                                        <span className="item-name">{p.name}</span>
                                                        <span className="item-count">
                                                            {projectTasks.length} tasks
                                                        </span>
                                                    </div>
                                                    <div style={{ padding: '0 16px 10px 32px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                        {projectTasks.map((t: any, idx: number) => (
                                                            <div 
                                                                key={idx}
                                                                onMouseDown={(e) => {
                                                                    e.stopPropagation();
                                                                    navigate(`/admin/projects/${p.id}`);
                                                                }}
                                                                style={{ fontSize: 11, color: 'var(--color-text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                                                                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)' }}
                                                                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)' }}
                                                            >
                                                                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--color-danger)' }} />
                                                                {t.seqName} <span style={{ fontSize: 9, opacity: 0.7 }}>({new Date(t.deadline).toLocaleDateString()})</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="dropdown-header" style={{ borderTop: '1px solid var(--color-border-light)', cursor: 'pointer', textAlign: 'center', padding: '10px 0' }} onMouseDown={(e) => {
                                        e.preventDefault();
                                        const el = document.getElementById('delayed-tasks-module');
                                        if (el) el.scrollIntoView({ behavior: 'smooth' });
                                        setShowDelayedList(false);
                                    }}>
                                        View all details ↓
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
                <div className="card">
                    <div className="card-header">
                        <span className="card-header-title">My Projects</span>
                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                            {stats.totalProjects} total
                        </span>
                    </div>
                    <div className="table-wrapper" style={{ border: 'none', boxShadow: 'none', borderRadius: 0 }}>
                        <table>
                            <thead>
                                <tr>
                                    <th>Project Name</th>
                                    <th>Client</th>
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
                                    stats.recentProjects.map((p: any) => {
                                        const hasDelayed = (p.sequences || []).some((s: any) => {
                                            const targetDate = s.approvalDate || s.deadline;
                                            return s.status !== 'Completed' && targetDate && targetDate < today;
                                        });
                                        return (
                                            <tr key={p._id || p.id}>
                                                <td 
                                                    style={{ fontWeight: 600, color: 'var(--color-primary)', cursor: 'pointer' }}
                                                    onClick={() => navigate(`/admin/projects/${String(p._id || p.id)}`)}
                                                >
                                                    {p.name}
                                                </td>
                                                <td style={{ color: 'var(--color-text-secondary)' }}>{p.clientName}</td>
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
                                                                <div style={{width: 40, height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden'}}>
                                                                    <div style={{width: `${pct}%`, height: '100%', background: 'var(--accent-violet)'}} />
                                                                </div>
                                                                <span style={{fontSize: 11, fontWeight: 700, color: 'var(--accent-violet)'}}>{pct}%</span>
                                                                {hasDelayed && <span className="badge badge-danger" style={{ fontSize: 9, padding: '1px 5px' }}>DELAYED</span>}
                                                            </div>
                                                        );
                                                    })()}
                                                </td>
                                                <td><StatusBadge status={p.status} /></td>
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

                {/* Delayed Tasks Detailed Module */}
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
                                                {new Date(t.deadline).toLocaleDateString()}
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

            </div>
        </div>
    );
}
