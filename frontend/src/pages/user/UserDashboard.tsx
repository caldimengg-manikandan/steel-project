import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { userListProjects } from '../../services/projectApi';
import type { Project, ProjectPermission } from '../../types';



export default function UserDashboard() {
    const { user } = useAuth();
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
    const highestPerm =
        projects.some((p) => p.permission === 'admin') ? 'Admin' :
            projects.some((p) => p.permission === 'editor') ? 'Editor' : 'Viewer';

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h2 className="page-title">Welcome back, {user?.username}</h2>
                    <p className="page-subtitle">Here's an overview of your assigned projects and recent activity</p>
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
                <div className="stats-grid">
                    <div className="stat-card accent-blue">
                        <div className="stat-card-label">Assigned Projects</div>
                        <div className="stat-card-value">{projects.length}</div>
                        <div className="stat-card-meta">{activeCount} active</div>
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

            {/* Two-column layout */}
            {!loading && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 'var(--space-lg)' }}>
                    {/* My Projects table */}
                    <div className="card">
                        <div className="card-header">
                            <span className="card-header-title">My Projects</span>
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{projects.length} assigned</span>
                        </div>
                        <div className="table-wrapper" style={{ border: 'none', boxShadow: 'none', borderRadius: 0 }}>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Project Name</th>
                                        <th>Client</th>
                                        <th>Approval %</th>
                                        <th>Fabrication %</th>
                                        <th>Your Role</th>
                                        <th>Status</th>
                                        <th>Updated</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {projects.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="table-empty">
                                                No projects assigned yet. Contact your administrator.
                                            </td>
                                        </tr>
                                    ) : (
                                        projects.map((p) => (
                                            <tr key={p.id}>
                                                <td style={{ fontWeight: 700 }}>{p.name}</td>
                                                <td style={{ color: 'var(--color-text-secondary)' }}>{p.clientName}</td>
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
                                                    {new Date(p.updatedAt).toLocaleDateString()}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Recent Activity (Placeholder) */}
                    <div className="card">
                        <div className="card-header">
                            <span className="card-header-title">Recent Activity</span>
                        </div>
                        <div style={{ padding: '24px var(--space-lg)', textAlign: 'center' }}>
                            <p className="text-muted" style={{ fontSize: 13 }}>No recent activity to display.</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
