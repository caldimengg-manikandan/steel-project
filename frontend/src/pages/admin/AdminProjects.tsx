import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { adminListProjects, adminCreateProject, adminDeleteProject, adminUpdateProject } from '../../services/projectApi';
import { adminListClients } from '../../services/adminClientApi';
import { IconPlus, IconEdit, IconTrash, IconClose } from '../../components/Icons';
import type { Project, ProjectStatus, Client } from '../../types';

const STATUS_OPTIONS: ProjectStatus[] = ['active', 'on_hold', 'completed', 'archived'];
const STATUS_LABEL: Record<ProjectStatus, string> = {
    active: 'Active', on_hold: 'On Hold', completed: 'Completed', archived: 'Archived',
};

const STATUS_CLS: Record<ProjectStatus, string> = {
    active: 'badge-success', on_hold: 'badge-warning', completed: 'badge-info', archived: 'badge-neutral',
};

interface CreateProjectForm {
    name: string; 
    clientName: string; 
    clientId: string;
    contactName: string;
    contactEmail: string;
    description: string; 
    status: ProjectStatus;
    approximateDrawingsCount: string;
    location: string;
    sequenceCount: string;
    connectionDesignVendor: string;
    connectionDesignContact: string;
    connectionDesignEmail: string;
}
const DEFAULT_FORM: CreateProjectForm = { 
    name: '', 
    clientName: '', 
    clientId: '',
    contactName: '',
    contactEmail: '',
    description: '', 
    status: 'active', 
    approximateDrawingsCount: '0', 
    location: '', 
    sequenceCount: '0',
    connectionDesignVendor: '',
    connectionDesignContact: '',
    connectionDesignEmail: ''
};

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
    const [editMode, setEditMode] = useState<'full' | 'sequences'>('full');
    const [actionLoading, setActionLoading] = useState(false);
    const [clients, setClients] = useState<Client[]>([]);
    const [sequenceNames, setSequenceNames] = useState<Array<{ name: string; deadline?: string; approvalDate?: string; fabricationDate?: string }>>([]);
    const [seqInput, setSeqInput] = useState<string>('');
    const { logout } = useAuth();

    const fetchProjects = useCallback(async () => {
        try {
            setLoading(true);
            const [projData, clientData] = await Promise.all([
                adminListProjects(),
                adminListClients()
            ]);
            
            if (!projData || !Array.isArray(projData.projects)) {
                throw new Error('Invalid project data received from server');
            }
            
            setClients(clientData.clients || []);

            const mapped = projData.projects.map((p: any) => {
                const idStr = String(p._id || p.id || '');
                return {
                    ...p,
                    id: idStr,
                    _id: idStr
                };
            });
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

    const distinctVendors = Array.from(
        new Set(
            projects
                .map(p => p.connectionDesignVendor)
                .filter(v => typeof v === 'string' && v.trim() !== '')
        )
    );

    async function handleCreate() {
        if (!form.name.trim() || !form.clientId || !form.location) return;
        
        const selectedClient = clients.find(c => (c.id || c._id) === form.clientId);
        if (!selectedClient) return;

        try {
            setActionLoading(true);
            setError('');
            const { project } = await adminCreateProject({
                name: form.name.trim(),
                clientName: selectedClient.name,
                clientId: form.clientId,
                contactPerson: {
                    name: form.contactName,
                    email: form.contactEmail
                },
                description: form.description.trim(),
                status: form.status,
                approximateDrawingsCount: Number(form.approximateDrawingsCount) || 0,
                location: form.location,
                sequences: sequenceNames.map(s => ({ 
                    name: s.name, 
                    status: 'Not Completed', 
                    deadline: s.deadline,
                    approvalDate: s.approvalDate,
                    fabricationDate: s.fabricationDate
                })),
                connectionDesignVendor: form.connectionDesignVendor,
                connectionDesignContact: form.connectionDesignContact,
                connectionDesignEmail: form.connectionDesignEmail
            });

            const idStr = String(project._id || project.id);
            const newProject = {
                ...project,
                id: idStr,
                _id: idStr
            };

            setProjects((prev) => [newProject, ...prev]);
            setShowCreate(false);
            setForm(DEFAULT_FORM);
            setSequenceNames([]);
            setSeqInput('0');
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
            const projectId = editTarget.id || (editTarget as any)._id;
            const { project } = await adminUpdateProject(projectId, {
                name: editTarget.name,
                clientName: editTarget.clientName,
                description: editTarget.description,
                status: editTarget.status,
                approximateDrawingsCount: editTarget.approximateDrawingsCount,
                location: editTarget.location,
                sequences: editTarget.sequences,
                connectionDesignVendor: editTarget.connectionDesignVendor,
                connectionDesignContact: editTarget.connectionDesignContact,
                connectionDesignEmail: editTarget.connectionDesignEmail
            });

            const idStr = String(project._id || project.id);
            // Re-map with consistent ID
            const updatedProject = {
                ...project,
                id: idStr,
                _id: idStr
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
                                <th>Client Name</th>
                                <th>Project Name</th>
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
                                        <td style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>{p.clientName}</td>
                                        <td>
                                            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)' }}>
                                                {p.name}
                                            </span>
                                        </td>
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
                                                    setEditMode('sequences');
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
                                                    onClick={() => p.id && p.id !== 'undefined' && navigate(`/admin/projects/${p.id}`)}

                                                    title="Open Project"
                                                    disabled={!p.id || p.id === 'undefined'}
                                                >
                                                    Open
                                                </button>

                                                <button
                                                    className="btn btn-ghost btn-sm btn-icon"
                                                    onClick={() => {
                                                        setEditTarget({ ...p });
                                                        setEditMode('full');
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
                                <label className="form-label required">Client / Organization</label>
                                <select 
                                    className="form-control"
                                    value={form.clientId}
                                    onChange={(e) => {
                                        const cId = e.target.value;
                                        setForm({ ...form, clientId: cId, contactName: '', contactEmail: '' });
                                    }}
                                >
                                    <option value="">Select a Client</option>
                                    {clients.map(c => (
                                        <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>

                            {form.clientId && (
                                <>
                                    <div className="form-group">
                                        <label className="form-label required" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            Select Contact Person
                                            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 400 }}>Auto-populates fields below</span>
                                        </label>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                                            {clients.find(c => (c.id || c._id) === form.clientId)?.contacts.map((con, idx) => {
                                                const isPicked = form.contactEmail === con.email;
                                                return (
                                                    <label 
                                                        key={idx} 
                                                        style={{ 
                                                            display: 'flex', alignItems: 'center', gap: 10, 
                                                            padding: '8px 12px', border: `1px solid ${isPicked ? 'var(--color-primary)' : 'var(--color-border)'}`, 
                                                            borderRadius: 6, cursor: 'pointer', background: isPicked ? 'var(--color-primary-light)' : '#f8fafc',
                                                            transition: 'all 0.15s', margin: 0
                                                        }}
                                                    >
                                                        <input 
                                                            type="radio" 
                                                            name="contactPersonRadio"
                                                            checked={isPicked}
                                                            onChange={() => setForm({ ...form, contactName: con.name, contactEmail: con.email })}
                                                            style={{ cursor: 'pointer' }}
                                                        />
                                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>{con.name}</span>
                                                            <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{con.email}</span>
                                                        </div>
                                                    </label>
                                                )
                                            })}
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label required">Contact Name</label>
                                            <input 
                                                className="form-control" 
                                                value={form.contactName} 
                                                onChange={(e) => setForm({ ...form, contactName: e.target.value })} 
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label required">Contact Email</label>
                                            <input 
                                                className="form-control" 
                                                value={form.contactEmail} 
                                                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} 
                                            />
                                        </div>
                                    </div>
                                </>
                            )}

                            <div className="form-group">
                                <label className="form-label required">Project Name</label>
                                <input className="form-control" placeholder="e.g. SteelFrame Tower B"
                                    value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
                                        const count = parseInt(val);
                                        if (isNaN(count)) return;
                                        
                                        const effectiveCount = Math.max(0, count);
                                        setForm(f => ({ ...f, sequenceCount: val }));

                                        setSequenceNames(prev => {
                                            if (effectiveCount > prev.length) {
                                                const next = [...prev];
                                                const today = new Date().toISOString().split('T')[0];
                                                for (let i = prev.length; i < effectiveCount; i++) {
                                                    next.push({ 
                                                        name: '', 
                                                        approvalDate: today,
                                                        fabricationDate: ''
                                                    });
                                                }
                                                return next;
                                            } else {
                                                return prev.slice(0, effectiveCount);
                                            }
                                        });
                                    }} 
                                />
                            </div>
                            {sequenceNames.length > 0 && (
                                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    {sequenceNames.map((s, idx) => (
                                        <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>
                                            <div style={{ flex: 1 }}>
                                                <label className="form-label" style={{ fontSize: 10 }}>Seq {idx + 1} Name</label>
                                                <input 
                                                    className="form-control form-control-sm" 
                                                    placeholder={`Seq ${idx + 1}`}
                                                    value={s.name}
                                                    onChange={(e) => {
                                                        const newNames = [...sequenceNames];
                                                        newNames[idx] = { ...newNames[idx], name: e.target.value };
                                                        setSequenceNames(newNames);
                                                    }}
                                                />
                                            </div>
                                            <div style={{ width: 140 }}>
                                                <label className="form-label" style={{ fontSize: 10 }}>Approval Date</label>
                                                <input 
                                                    className="form-control form-control-sm" 
                                                    type="date"
                                                    value={s.approvalDate ? s.approvalDate.split('T')[0] : ''}
                                                    onChange={(e) => {
                                                        const newNames = [...sequenceNames];
                                                        newNames[idx] = { ...newNames[idx], approvalDate: e.target.value };
                                                        setSequenceNames(newNames);
                                                    }}
                                                />
                                            </div>
                                            <div style={{ width: 140 }}>
                                                <label className="form-label" style={{ fontSize: 10 }}>Fab Date</label>
                                                <input 
                                                    className="form-control form-control-sm" 
                                                    type="date"
                                                    value={s.fabricationDate ? s.fabricationDate.split('T')[0] : ''}
                                                    onChange={(e) => {
                                                        const newNames = [...sequenceNames];
                                                        newNames[idx] = { ...newNames[idx], fabricationDate: e.target.value };
                                                        setSequenceNames(newNames);
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div style={{ marginTop: 24, padding: '16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
                                    Connection Design
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Vendor / Client Name</label>
                                    <input 
                                        className="form-control" 
                                        placeholder="Enter vendor details" 
                                        list="client-list-create"
                                        value={form.connectionDesignVendor}
                                        onChange={(e) => setForm({ ...form, connectionDesignVendor: e.target.value })} 
                                    />
                                    <datalist id="client-list-create">
                                        {distinctVendors.map((v, i) => <option key={`vendor-${i}`} value={v} />)}
                                    </datalist>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Contact Number</label>
                                    <input 
                                        className="form-control" 
                                        placeholder="Phone number" 
                                        value={form.connectionDesignContact}
                                        onChange={(e) => setForm({ ...form, connectionDesignContact: e.target.value })} 
                                    />
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">Email Address (Connection Design)</label>
                                    <textarea 
                                        className="form-control" 
                                        placeholder="Enter email IDs (one per line or comma separated)" 
                                        rows={2}
                                        value={form.connectionDesignEmail}
                                        onChange={(e) => setForm({ ...form, connectionDesignEmail: e.target.value })} 
                                    />
                                </div>
                            </div>

                            <div className="form-actions">
                                <button className="btn btn-secondary"
                                    onClick={() => { setShowCreate(false); setForm(DEFAULT_FORM); }}>Cancel</button>
                                <button className="btn btn-primary"
                                    onClick={handleCreate}
                                    disabled={!form.name.trim() || !form.clientId || !form.location || actionLoading}>
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
                            <span className="modal-title">{editMode === 'sequences' ? `Manage Sequences: ${editTarget.name}` : 'Edit Project'}</span>
                            <button className="modal-close" onClick={() => setEditTarget(null)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            {editMode === 'full' && (
                                <>
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
                                    <div style={{ marginTop: 20, padding: '16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
                                            Connection Design
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Vendor / Client Name</label>
                                            <input 
                                                className="form-control" 
                                                placeholder="Enter vendor details" 
                                                list="client-list-edit"
                                                value={editTarget.connectionDesignVendor || ''}
                                                onChange={(e) => setEditTarget({ ...editTarget, connectionDesignVendor: e.target.value })} 
                                            />
                                            <datalist id="client-list-edit">
                                                {distinctVendors.map((v, i) => <option key={`edit-vendor-${i}`} value={v} />)}
                                            </datalist>
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">Contact Number</label>
                                            <input 
                                                className="form-control" 
                                                placeholder="Phone number" 
                                                value={editTarget.connectionDesignContact || ''}
                                                onChange={(e) => setEditTarget({ ...editTarget, connectionDesignContact: e.target.value })} 
                                            />
                                        </div>
                                    </div>
                                </>
                            )}

                            <div className="form-group">
                                <label className="form-label">Number of Sequences</label>
                                <input 
                                    className="form-control" 
                                    type="number" 
                                    value={seqInput}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setSeqInput(val);
                                        if (val === '') return; 
                                        
                                        const count = parseInt(val);
                                        if (isNaN(count)) return;

                                        const current = editTarget.sequences || [];
                                        const orig = projects.find(p => p.id === editTarget.id)?.sequences || [];
                                        const originalCount = orig.length;
                                        
                                        // Lock the original sequences while allowing growth
                                        const effectiveCount = Math.max(count, originalCount);
                                        
                                        if (effectiveCount > current.length) {
                                            const newSeqs = [...current];
                                            const today = new Date().toISOString().split('T')[0];
                                            for (let i = current.length; i < effectiveCount; i++) {
                                                newSeqs.push({ 
                                                    name: '', 
                                                    status: 'Not Completed',
                                                    deadline: today,
                                                    approvalDate: '',
                                                    fabricationDate: ''
                                                });
                                            }
                                            setEditTarget({ ...editTarget, sequences: newSeqs });
                                        } else if (effectiveCount < current.length) {
                                            setEditTarget({ ...editTarget, sequences: current.slice(0, effectiveCount) });
                                        }
                                    }} 
                                />
                            </div>

                            {editTarget.sequences && editTarget.sequences.length > 0 && (
                                <div className="form-group" style={{ marginTop: 20 }}>
                                    <label className="form-label" style={{ fontWeight: 700, display: 'block', borderBottom: '1px solid var(--color-border)', paddingBottom: 8, marginBottom: 12 }}>
                                        Configure Sequence Names & Deadlines
                                    </label>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                        {editTarget.sequences.map((seq, idx) => (
                                            <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', paddingBottom: 10, borderBottom: '1px dashed #f1f5f9' }}>
                                                <div style={{ flex: 1 }}>
                                                    <label className="form-label" style={{ fontSize: 10 }}>Sequence {idx + 1} Name</label>
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
                                                <div style={{ width: 140 }}>
                                                    <label className="form-label" style={{ fontSize: 10 }}>Approval Date</label>
                                                    <input 
                                                        className="form-control form-control-sm" 
                                                        type="date"
                                                        value={seq.approvalDate ? seq.approvalDate.split('T')[0] : ''}
                                                        onChange={(e) => {
                                                            const newSeqs = [...editTarget.sequences];
                                                            newSeqs[idx] = { ...newSeqs[idx], approvalDate: e.target.value };
                                                            setEditTarget({ ...editTarget, sequences: newSeqs });
                                                        }}
                                                    />
                                                </div>
                                                <div style={{ width: 140 }}>
                                                    <label className="form-label" style={{ fontSize: 10 }}>Fab Date</label>
                                                    <input 
                                                        className="form-control form-control-sm" 
                                                        type="date"
                                                        value={seq.fabricationDate ? seq.fabricationDate.split('T')[0] : ''}
                                                        onChange={(e) => {
                                                            const newSeqs = [...editTarget.sequences];
                                                            newSeqs[idx] = { ...newSeqs[idx], fabricationDate: e.target.value };
                                                            setEditTarget({ ...editTarget, sequences: newSeqs });
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div style={{ marginTop: 24, padding: '16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
                                    Connection Design
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Vendor / Client Name</label>
                                    <input 
                                        className="form-control" 
                                        placeholder="Enter vendor details" 
                                        list="client-list-edit"
                                        value={editTarget.connectionDesignVendor || ''}
                                        onChange={(e) => setEditTarget({ ...editTarget, connectionDesignVendor: e.target.value })} 
                                    />
                                    <datalist id="client-list-edit">
                                        {distinctVendors.map((v, i) => <option key={`vendor-edit-${i}`} value={v} />)}
                                    </datalist>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Contact Number</label>
                                    <input 
                                        className="form-control" 
                                        placeholder="Phone number" 
                                        value={editTarget.connectionDesignContact || ''}
                                        onChange={(e) => setEditTarget({ ...editTarget, connectionDesignContact: e.target.value })} 
                                    />
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">Email Address (Connection Design)</label>
                                    <textarea 
                                        className="form-control" 
                                        placeholder="Enter email IDs" 
                                        rows={2}
                                        value={editTarget.connectionDesignEmail || ''}
                                        onChange={(e) => setEditTarget({ ...editTarget, connectionDesignEmail: e.target.value })} 
                                    />
                                </div>
                            </div>

                            <div className="form-actions">
                                <button className="btn btn-secondary" disabled={actionLoading} onClick={() => setEditTarget(null)}>Cancel</button>
                                <button 
                                    className="btn btn-primary" 
                                    disabled={actionLoading || (parseInt(seqInput) || 0) < (projects.find(p => p.id === (editTarget.id || (editTarget as any)._id))?.sequences?.length || 0)} 
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
