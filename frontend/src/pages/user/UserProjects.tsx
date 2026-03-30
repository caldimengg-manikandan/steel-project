import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { userListProjects } from '../../services/projectApi';
import type { Project, ProjectPermission } from '../../types';
import { IconOpen } from '../../components/Icons';

export default function UserProjects() {
    const navigate = useNavigate();

    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchProjects = useCallback(async () => {
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
        fetchProjects();
    }, [fetchProjects]);

    const STATUS_LABEL: Record<string, string> = { active: 'Active', on_hold: 'On Hold', completed: 'Completed', archived: 'Archived' };
    const STATUS_CLS: Record<string, string> = { active: 'badge-success', on_hold: 'badge-warning', completed: 'badge-info', archived: 'badge-neutral' };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h2 className="page-title">My Projects</h2>
                    <p className="page-subtitle">Projects assigned to your account and your permission level on each</p>
                </div>
            </div>

            {/* Summary cards */}
            <div className="stats-grid mb-lg" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                {[
                    { label: 'Total Assigned', value: projects.length, cls: 'accent-blue' },
                    { label: 'As Editor', value: projects.filter((p: Project) => (p.permission || 'viewer') === 'editor').length, cls: 'accent-green' },
                    { label: 'As Viewer', value: projects.filter((p: Project) => (p.permission || 'viewer') === 'viewer').length, cls: 'accent-amber' },
                    { label: 'As Admin', value: projects.filter((p: Project) => (p.permission || 'viewer') === 'admin').length, cls: 'accent-slate' },
                ].map(({ label, value, cls }) => (
                    <div className={`stat-card ${cls}`} key={label} style={{ padding: '16px 20px' }}>
                        <div className="stat-card-label">{label}</div>
                        <div className="stat-card-value" style={{ fontSize: 28 }}>{value}</div>
                    </div>
                ))}
            </div>

            {error && (
                <div className="info-box danger mb-md" style={{ padding: '12px 16px', borderRadius: 8 }}>
                    <strong>Error:</strong> {error}
                    <button onClick={fetchProjects} className="btn btn-ghost btn-sm" style={{ marginLeft: 12 }}>Retry</button>
                </div>
            )}

            {/* Table */}
            <div className="table-wrapper">
                {loading ? (
                    <div className="table-empty" style={{ padding: '60px 0' }}>
                        <div className="spinner mb-sm"></div>
                        <p>Loading your projects...</p>
                    </div>
                ) : (
                    <table>
                        <thead>
                            <tr>
                                <th style={{ width: 40 }}>#</th>
                                <th>Project Name</th>
                                <th>Client Name</th>
                                <th>Your Role</th>
                                <th>Approval %</th>
                                <th>Fabrication %</th>
                                <th>Sequence %</th>
                                <th>Status</th>
                                <th>Drawings</th>
                                <th>Last Updated</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {projects.length === 0 ? (
                                <tr>
                                    <td colSpan={11} className="table-empty">
                                        No projects assigned to your account. Contact your administrator.
                                    </td>
                                </tr>
                            ) : (
                                projects.map((p: Project, i: number) => (
                                    <tr key={p.id}>
                                        <td className="text-muted font-mono" style={{ fontSize: 12 }}>{i + 1}</td>
                                        <td style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-primary)' }}>{p.name}</td>
                                        <td style={{ color: 'var(--color-text-secondary)' }}>{p.clientName}</td>
                                        <td>
                                            <span className={`role-chip ${p.permission || 'viewer'}`}>
                                                {(p.permission || 'viewer').toUpperCase()}
                                            </span>
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
                                            {(() => {
                                                const s = p.sequences || [];
                                                const total = s.length;
                                                const done = s.filter((seq: any) => seq.status === 'Completed').length;
                                                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                                                const today = new Date().toISOString().split('T')[0];
                                                const hasDelayed = s.some((seq: any) => seq.status !== 'Completed' && seq.deadline && seq.deadline.split('T')[0] < today);
                                                
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
                                            <span className={`badge ${STATUS_CLS[p.status]}`}>
                                                {STATUS_LABEL[p.status]}
                                            </span>
                                        </td>
                                        <td className="font-mono" style={{ fontWeight: 600 }}>{p.drawingCount}</td>
                                        <td className="text-muted font-mono" style={{ fontSize: 12.5 }}>
                                            {new Date(p.updatedAt).toLocaleDateString()}
                                        </td>
                                        <td>
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => navigate(`/dashboard/projects/${p.id}`)}
                                            >
                                                <IconOpen /> Open
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Permission Legend */}
            <div className="perm-legend">
                <strong style={{ color: 'var(--color-text-primary)', flexShrink: 0 }}>Permission Guide:</strong>
                <span><span className="role-chip viewer">Viewer</span>&nbsp; Read-only access</span>
                <span><span className="role-chip editor">Editor</span>&nbsp; Upload and edit drawings</span>
                <span><span className="role-chip admin">Admin</span>&nbsp; Full project control</span>
            </div>
        </div>
    );
}
