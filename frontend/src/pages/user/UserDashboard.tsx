import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { userListProjects } from '../../services/projectApi';
import { formatDate } from '../../utils/dateUtils';
import type { Project, ProjectPermission } from '../../types';
import { useNavigate } from 'react-router-dom';


export default function UserDashboard() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const data = await userListProjects();
            const mapped = data.projects.map((p: any) => ({
                ...p,
                id: String(p._id || p.id),
                permission: (p.myPermission ?? 'viewer') as ProjectPermission,
            }));
            setProjects(mapped);
        } catch (err: any) {
            setError(err.message || 'Failed to load projects');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const activeCount = projects.filter((p) => p.status === 'active').length;
    const drawingCount = projects.reduce((s, p) => s + (p.drawingCount || 0), 0);
    const clientCount = new Set(projects.map(p => p.clientName)).size;
    const highestPerm =
        projects.some((p) => p.permission === 'admin') ? 'Admin' :
            projects.some((p) => p.permission === 'editor') ? 'Editor' : 'Viewer';

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h2 className="page-title">Welcome back, {user?.username}</h2>
                    <p className="page-subtitle">Here's an overview of your assigned projects and drawing status</p>
                </div>
            </div>

            {/* Stats */}
            {error && (
                <div className="info-box danger mb-md">
                    <strong>Error:</strong> {error}
                </div>
            )}

            {loading ? (
                <div className="text-center py-xl">
                    <div className="spinner mb-md"></div>
                    <p className="text-muted">Loading dashboard...</p>
                </div>
            ) : (
                <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                    <div className="stat-card accent-blue">
                        <div className="stat-card-label">Assigned Projects</div>
                        <div className="stat-card-value">{projects.length}</div>
                        <div className="stat-card-meta">{activeCount} active</div>
                    </div>

                    <div className="stat-card accent-amber">
                        <div className="stat-card-label">Total Clients</div>
                        <div className="stat-card-value">{clientCount}</div>
                        <div className="stat-card-meta">Unique organizations</div>
                    </div>

                    <div className="stat-card accent-green">
                        <div className="stat-card-label">Total Drawings</div>
                        <div className="stat-card-value">{drawingCount}</div>
                        <div className="stat-card-meta">Across your projects</div>
                    </div>

                    <div className="stat-card accent-slate">
                        <div className="stat-card-label">Access Level</div>
                        <div className="stat-card-value" style={{ fontSize: 30 }}>{highestPerm}</div>
                        <div className="stat-card-meta">Highest permission</div>
                    </div>
                </div>
            )}

            {/* Full-width layout for My Projects */}
            {!loading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
                    {/* My Projects table */}
                    <div className="card">
                        <div className="card-header">
                            <span className="card-header-title">My Projects</span>
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{projects.length} assigned</span>
                        </div>
                        <div className="table-wrapper" style={{ border: 'none', boxShadow: 'none', borderRadius: 0 }}>
                            <table style={{ minWidth: 900 }}>
                                <thead>
                                    <tr>
                                        <th>Client</th>
                                        <th>Project Name</th>
                                        <th>Approval %</th>
                                        <th>Fabrication %</th>
                                        <th>RFIs (O/C)</th>
                                        <th>Sequence %</th>
                                        <th>Your Role</th>
                                        <th>Status</th>
                                        <th>Updated</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {projects.length === 0 ? (
                                        <tr>
                                            <td colSpan={9} className="table-empty">
                                                No projects assigned yet. Contact your administrator.
                                            </td>
                                        </tr>
                                    ) : (
                                        projects.map((p) => {
                                            const today = new Date().toISOString().split('T')[0];
                                            const hasDelayed = (p.sequences || []).some((s: any) => {
                                                const targetDate = s.approvalDate || s.deadline;
                                                return s.status !== 'Completed' && targetDate && targetDate < today;
                                            });

                                            return (
                                                <tr key={p.id}>
                                                    <td style={{ color: 'var(--color-text-secondary)' }}>{p.clientName}</td>
                                                    <td 
                                                        style={{ fontWeight: 700, color: 'var(--color-primary)', cursor: 'pointer' }}
                                                        onClick={() => navigate(`/dashboard/projects/${p.id}`)}
                                                    >
                                                        {p.name}
                                                    </td>
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
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <span style={{ color: 'var(--color-danger)', fontWeight: 700, fontSize: 13 }}>{p.openRfiCount || 0}</span>
                                                            <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>/</span>
                                                            <span style={{ color: 'var(--color-success)', fontWeight: 700, fontSize: 13 }}>{p.closedRfiCount || 0}</span>
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
                                                    <td>
                                                        <span className={`role-chip ${p.permission}`}>
                                                            {p.permission ? p.permission.charAt(0).toUpperCase() + p.permission.slice(1) : 'Viewer'}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span className={`badge ${p.status === 'active' ? 'badge-success' :
                                                            p.status === 'on_hold' ? 'badge-warning' :
                                                                p.status === 'completed' ? 'badge-info' : 'badge-neutral'
                                                            }`}>
                                                            {p.status.replace('_', ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                                                        </span>
                                                    </td>
                                                    <td className="text-muted" style={{ fontSize: 12.5 }}>
                                                        {formatDate(p.updatedAt)}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
