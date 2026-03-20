import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import type { Project, ProjectStatus } from '../../types';
import { adminListProjects, adminCreateProject, adminDeleteProject, adminUpdateProject } from '../../services/projectApi';
import { IconPlus, IconEdit, IconTrash, IconOpen, IconClose } from '../../components/Icons';

const STATUS_OPTIONS: ProjectStatus[] = ['active', 'on_hold', 'completed', 'archived'];
const STATUS_LABEL: Record<ProjectStatus, string> = {
    active: 'Active', on_hold: 'On Hold', completed: 'Completed', archived: 'Archived',
};

const STATUS_CLS: Record<ProjectStatus, string> = {
    active: 'badge-success', on_hold: 'badge-warning', completed: 'badge-info', archived: 'badge-neutral',
};

interface CreateProjectForm {
    name: string; clientName: string; description: string; status: ProjectStatus;
    approximateDrawingsCount: string;
    location: string;
    sequenceCount: string;
}
const DEFAULT_FORM: CreateProjectForm = { name: '', clientName: '', description: '', status: 'active', approximateDrawingsCount: '0', location: '', sequenceCount: '0' };

export default function AdminProjects() {
    const navigate = useNavigate();
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState<CreateProjectForm>(DEFAULT_FORM);
    const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
    const [editTarget, setEditTarget] = useState<Project | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [sequenceNames, setSequenceNames] = useState<string[]>([]);
    const [seqInput, setSeqInput] = useState<string>('');
    const { logout } = useAuth();

    const fetchProjects = useCallback(async () => {
        try {
            setLoading(true);
            const data = await adminListProjects();
            if (!data || !Array.isArray(data.projects)) {
                throw new Error('Invalid project data received from server');
            }
            // Map _id to id for internal consistency
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

    useEffect(() => {
        if (error.includes('expired') || error.includes('log in again')) {
            logout();
            navigate('/login');
        }
    }, [error, logout, navigate]);

    const filtered = projects.filter(
        (p) =>
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.clientName.toLowerCase().includes(search.toLowerCase())
    );

    async function handleCreate() {
        if (!form.name.trim() || !form.clientName.trim() || !form.location) return;
        try {
            setActionLoading(true);
            setError('');
            const { project } = await adminCreateProject({
                name: form.name.trim(),
                clientName: form.clientName.trim(),
                description: form.description.trim(),
                status: form.status,
                approximateDrawingsCount: Number(form.approximateDrawingsCount) || 0,
                location: form.location,
                sequences: sequenceNames.map(name => ({ name, status: 'Not Completed' }))
            });

            const newProject = {
                ...project,
                id: project._id || project.id
            };

            setProjects((prev) => [newProject, ...prev]);
            setShowCreate(false);
            setForm(DEFAULT_FORM);
            setSequenceNames([]);
        } catch (err: any) {
            setError(`Create failed: ${err.message}`);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleDelete(id: string) {
        try {
            setActionLoading(true);
            setError('');
            await adminDeleteProject(id);
            setProjects((prev) => prev.filter((p) => p.id !== id));
            setDeleteTarget(null);
        } catch (err: any) {
            setError(`Delete failed: ${err.message}`);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleEditSave() {
        if (!editTarget || !editTarget.location) return;
        try {
            setActionLoading(true);
            setError('');
            const { project } = await adminUpdateProject(editTarget.id, {
                name: editTarget.name,
                clientName: editTarget.clientName,
                description: editTarget.description,
                status: editTarget.status,
                approximateDrawingsCount: editTarget.approximateDrawingsCount,
                location: editTarget.location,
                sequences: editTarget.sequences
            });

            // Re-map with consistent ID
            const updatedProject = {
                ...project,
                id: project._id || project.id
            };

            setProjects((prev) =>
                prev.map((p) => (p.id === updatedProject.id ? updatedProject : p))
            );
            setEditTarget(null);
        } catch (err: any) {
            setError(`Update failed: ${err.message}`);
        } finally {
            setActionLoading(false);
        }
    }

    const SearchIcon = () => (
        <svg viewBox="0 0 16 16" fill="none" strokeWidth="1.5" stroke="currentColor" width="14" height="14">
            <circle cx="6.5" cy="6.5" r="4.5" />
            <path d="M10 10l3.5 3.5" strokeLinecap="round" />
        </svg>
    );

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h2 className="page-title">Projects</h2>
                    <p className="page-subtitle">Manage all steel detailing projects</p>
                </div>
                <button className="btn btn-primary" onClick={() => { setShowCreate(true); setSeqInput('0'); }}>
                    <IconPlus /> New Project
                </button>
            </div>

            {/* Quick stats row */}
            <div className="stats-grid mb-lg" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                {[
                    { label: 'Total', value: projects.length, cls: 'accent-blue' },
                    { label: 'Active', value: projects.filter((p) => p.status === 'active').length, cls: 'accent-green' },
                    { label: 'On Hold', value: projects.filter((p) => p.status === 'on_hold').length, cls: 'accent-amber' },
                    { label: 'Completed', value: projects.filter((p) => p.status === 'completed').length, cls: 'accent-slate' },
                ].map(({ label, value, cls }) => (
                    <div className={`stat-card ${cls}`} key={label}>
                        <div className="stat-card-label">{label}</div>
                        <div className="stat-card-value">{value}</div>
                    </div>
                ))}
            </div>

            {/* Filter */}
            <div className="filter-toolbar mb-md">
                <div className="search-input-wrapper">
                    <SearchIcon />
                    <input
                        type="text"
                        className="form-control"
                        placeholder="Search projects or clients…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ paddingLeft: 34 }}
                        disabled={loading}
                    />
                </div>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                    {filtered.length} of {projects.length} projects
                </span>
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
                        <p>Loading projects from server...</p>
                    </div>
                ) : (
                    <table>
                        <thead>
                            <tr>
                                <th style={{ width: 40 }}>#</th>
                                <th>Project Name</th>
                                <th>Client Name</th>
                                <th>Created</th>
                                <th>Approx. DWGs</th>                                <th>Approval %</th>
                                <th>Fabrication %</th>
                                <th>Sequence</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr><td colSpan={10} className="table-empty">No projects match your search.</td></tr>
                            ) : (
                                filtered.map((p, i) => (
                                    <tr key={p.id}>
                                        <td className="text-muted font-mono" style={{ fontSize: 12 }}>{i + 1}</td>
                                        <td>
                                            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)' }}>
                                                {p.name}
                                            </span>
                                        </td>
                                        <td style={{ color: 'var(--color-text-secondary)' }}>{p.clientName}</td>
                                        <td className="text-muted font-mono" style={{ fontSize: 12.5 }}>
                                            {new Date(p.createdAt).toLocaleDateString()}
                                        </td>
                                        <td className="font-mono" style={{ fontWeight: 600 }}>{p.approximateDrawingsCount || 0}</td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <div style={{flex: 1, height: 6, background: 'var(--color-bg-page)', borderRadius: 3, overflow: 'hidden'}}>
                                                    <div style={{width: `${p.approvalPercentage || 0}%`, height: '100%', background: 'var(--color-primary)'}} />
                                                </div>
                                                <span className="font-mono" style={{fontSize: 12, fontWeight: 700}}>{p.approvalPercentage || 0}%</span>
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <div style={{flex: 1, height: 6, background: 'var(--color-bg-page)', borderRadius: 3, overflow: 'hidden'}}>
                                                    <div style={{width: `${p.fabricationPercentage || 0}%`, height: '100%', background: 'var(--color-success-mid)'}} />
                                                </div>
                                                <span className="font-mono" style={{fontSize: 12, fontWeight: 700}}>{p.fabricationPercentage || 0}%</span>
                                            </div>
                                        </td>
                                        <td>
                                            <div 
                                                onClick={() => {
                                                    setEditTarget({ ...p });
                                                    setSeqInput((p.sequences?.length || 0).toString());
                                                }}
                                                title="Manage Sequences"
                                                style={{ 
                                                    cursor: 'pointer', 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    justifyContent: 'center',
                                                    gap: 6, 
                                                    background: '#f1f5f9', 
                                                    padding: '6px 10px', 
                                                    borderRadius: 8, 
                                                    border: '1px solid #e2e8f0',
                                                    width: 'fit-content',
                                                    transition: 'all 0.15s ease'
                                                }}
                                                onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--color-primary-light)'}
                                                onMouseOut={(e) => e.currentTarget.style.borderColor = '#e2e8f0'}
                                            >
                                                <span style={{ fontSize: 13, fontWeight: 700, color: '#475569' }}>{p.sequences?.length || 0}</span>
                                                <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Seq</span>
                                                <div style={{ color: '#94a3b8', marginLeft: 2, display: 'flex', width: 14, height: 14 }}><IconEdit /></div>
                                            </div>
                                        </td>
                                        <td>
                                            <span className={`badge ${STATUS_CLS[p.status]}`}>
                                                {STATUS_LABEL[p.status]}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="btn-group">
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => navigate(`/admin/project/${p.id}`)}
                                                    title="Open Project"
                                                >
                                                    <IconOpen /> Open
                                                </button>
                                                <button
                                                    className="btn btn-ghost btn-sm btn-icon"
                                                    onClick={() => {
                                                        setEditTarget({ ...p });
                                                        setSeqInput((p.sequences?.length || 0).toString());
                                                    }}
                                                    title="Edit"
                                                >
                                                    <IconEdit />
                                                </button>
                                                <button
                                                    className="btn btn-danger btn-sm btn-icon"
                                                    onClick={() => setDeleteTarget(p)}
                                                    title="Delete"
                                                >
                                                    <IconTrash />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                        </table>
                    )}
                </div>

            {/* ── Create Modal ── */}
            {showCreate && (
                <div className="modal-overlay" onClick={() => setShowCreate(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">Create New Project</span>
                            <button className="modal-close" onClick={() => setShowCreate(false)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label required">Project Name</label>
                                <input className="form-control" placeholder="e.g. SteelFrame Tower B"
                                    value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label required">Client Name</label>
                                <input className="form-control" placeholder="e.g. Infra Corp Ltd."
                                    value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
                            </div>
                             <div className="form-group">
                                <label className="form-label">Description</label>
                                <textarea className="form-control" placeholder="Brief project description…" rows={3}
                                    value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label required">Approximate Drawings Count</label>
                                <input className="form-control" type="number" placeholder="e.g. 50"
                                    value={form.approximateDrawingsCount} onChange={(e) => setForm({ ...form, approximateDrawingsCount: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label required">Location</label>
                                <select className="form-control" value={form.location}
                                    onChange={(e) => setForm({ ...form, location: e.target.value })}>
                                    <option value="">Select Location</option>
                                    <option value="Chennai">Chennai</option>
                                    <option value="Hosur">Hosur</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Initial Status</label>
                                <select className="form-control" value={form.status}
                                    onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}>
                                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Number of Sequences</label>
                                <input 
                                    className="form-control" 
                                    type="number" 
                                    placeholder="e.g. 10"
                                    value={seqInput} 
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setSeqInput(val);
                                        const count = Math.max(0, parseInt(val) || 0);
                                        
                                        // Update the form string for submission
                                        setForm(f => ({ ...f, sequenceCount: val }));

                                        // Sync boxes with the new count
                                        setSequenceNames(prev => {
                                            if (count > prev.length) {
                                                const next = [...prev];
                                                for (let i = prev.length; i < count; i++) {
                                                    next.push('');
                                                }
                                                return next;
                                            } else {
                                                return prev.slice(0, count);
                                            }
                                        });
                                    }} 
                                />
                            </div>
                            {sequenceNames.length > 0 && (
                                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                    {sequenceNames.map((name, idx) => (
                                        <div key={idx} className="form-group" style={{ marginBottom: 8 }}>
                                            <label className="form-label" style={{ fontSize: 11 }}>Sequence {idx + 1} Name</label>
                                            <input 
                                                className="form-control form-control-sm" 
                                                placeholder={`Seq ${idx + 1}`}
                                                value={name}
                                                onChange={(e) => {
                                                    const newNames = [...sequenceNames];
                                                    newNames[idx] = e.target.value;
                                                    setSequenceNames(newNames);
                                                }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="form-actions">
                                <button className="btn btn-secondary"
                                    onClick={() => { setShowCreate(false); setForm(DEFAULT_FORM); }}>Cancel</button>
                                <button className="btn btn-primary"
                                    onClick={handleCreate}
                                    disabled={!form.name.trim() || !form.clientName.trim() || !form.location || actionLoading}>
                                    {actionLoading ? 'Creating...' : 'Create Project'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Edit Modal ── */}
            {editTarget && (
                <div className="modal-overlay" onClick={() => setEditTarget(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">Edit Project</span>
                            <button className="modal-close" onClick={() => setEditTarget(null)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label required">Project Name</label>
                                <input className="form-control" value={editTarget.name}
                                    onChange={(e) => setEditTarget({ ...editTarget, name: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label required">Client Name</label>
                                <input className="form-control" value={editTarget.clientName}
                                    onChange={(e) => setEditTarget({ ...editTarget, clientName: e.target.value })} />
                            </div>
                             <div className="form-group">
                                <label className="form-label">Description</label>
                                <textarea className="form-control" rows={3} value={editTarget.description}
                                    onChange={(e) => setEditTarget({ ...editTarget, description: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label required">Approximate Drawings Count</label>
                                <input className="form-control" type="number" value={editTarget.approximateDrawingsCount}
                                    onChange={(e) => setEditTarget({ ...editTarget, approximateDrawingsCount: Number(e.target.value) })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Location</label>
                                <select className="form-control" value={editTarget.location}
                                    onChange={(e) => setEditTarget({ ...editTarget, location: e.target.value })}>
                                    <option value="">Select Location</option>
                                    <option value="Chennai">Chennai</option>
                                    <option value="Hosur">Hosur</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Status</label>
                                <select className="form-control" value={editTarget.status}
                                    onChange={(e) => setEditTarget({ ...editTarget, status: e.target.value as ProjectStatus })}>
                                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Number of Sequences</label>
                                <input 
                                    className="form-control" 
                                    type="number" 
                                    value={seqInput}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setSeqInput(val);
                                        const count = Math.max(0, parseInt(val) || 0);
                                        const current = editTarget.sequences || [];
                                        
                                        if (count > current.length) {
                                            const newSeqs = [...current];
                                            for (let i = current.length; i < count; i++) {
                                                newSeqs.push({ name: '', status: 'Not Completed' });
                                            }
                                            setEditTarget({ ...editTarget, sequences: newSeqs });
                                        } else if (count < current.length) {
                                            setEditTarget({ ...editTarget, sequences: current.slice(0, count) });
                                        }
                                    }} 
                                />
                            </div>
                            {editTarget.sequences && editTarget.sequences.length > 0 && (
                                <div className="form-group">
                                    <label className="form-label">Edit Sequence Names</label>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                                        {editTarget.sequences.map((seq, idx) => (
                                            <div key={idx}>
                                                <input 
                                                    className="form-control form-control-sm" 
                                                    value={seq.name}
                                                    onChange={(e) => {
                                                        const newSeqs = [...editTarget.sequences];
                                                        newSeqs[idx] = { ...newSeqs[idx], name: e.target.value };
                                                        setEditTarget({ ...editTarget, sequences: newSeqs });
                                                    }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="form-actions">
                                <button className="btn btn-secondary" disabled={actionLoading} onClick={() => setEditTarget(null)}>Cancel</button>
                                <button 
                                    className="btn btn-primary" 
                                    disabled={actionLoading || (parseInt(seqInput) || 0) < (projects.find(p => p.id === editTarget.id)?.sequences?.length || 0)} 
                                    onClick={handleEditSave}
                                >
                                    {actionLoading ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Delete Confirm ── */}
            {deleteTarget && (
                <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
                    <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">Confirm Deletion</span>
                            <button className="modal-close" onClick={() => setDeleteTarget(null)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <p className="confirm-dialog-text">
                                Are you sure you want to permanently delete project{' '}
                                <strong>"{deleteTarget.name}"</strong>? All associated drawings and user
                                assignments will be removed. This cannot be undone.
                            </p>
                            <div className="form-actions">
                                <button className="btn btn-secondary" disabled={actionLoading} onClick={() => setDeleteTarget(null)}>Cancel</button>
                                <button className="btn btn-danger btn-lg" disabled={actionLoading} onClick={() => handleDelete(deleteTarget.id)}>
                                    {actionLoading ? 'Deleting...' : 'Delete Project'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
