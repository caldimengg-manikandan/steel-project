import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { adminListProjects, adminCreateProject, adminDeleteProject, adminUpdateProject } from '../../services/projectApi';
import { adminListClients } from '../../services/adminClientApi';
import { IconPlus, IconEdit, IconTrash, IconOpen, IconClose } from '../../components/Icons';
import { formatDate } from '../../utils/dateUtils';
import type { Project, ProjectStatus, Client, ClientContact } from '../../types';

const STATUS_OPTIONS: ProjectStatus[] = ['in_progress', 'on_hold', 'completed', 'archived'];
const STATUS_LABEL: Record<ProjectStatus, string> = {
    in_progress: 'In-progress', on_hold: 'On Hold', completed: 'Completed', archived: 'Archived',
};

const STATUS_CLS: Record<ProjectStatus, string> = {
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

const getOriginalCategory = (p: any) => {
    if (!p.rawStatus) return p.status || 'active';
    const s = p.rawStatus.toLowerCase();
    if (s.includes('hold') || s.includes('pause') || s.includes('stop')) return 'on_hold';
    if (s.includes('complete') || s.includes('finish') && !s.includes('not')) return 'completed';
    if (s.includes('archiv')) return 'archived';
    return 'in_progress';
};

interface CreateProjectForm {
    name: string;
    clientName: string;
    clientId: string;
    contactPerson: ClientContact | null;
    description: string;
    status: ProjectStatus;
    location: string;
    scopeOfWork: Array<{ name: string; percentage: number; approval: number; fabrication: number; status: string }>;
    sequenceCount: string;
    connectionDesignVendor: string;
    connectionDesignContact: string;
    connectionDesignEmail: string;
    year: string;
    startingTransmittalNumber: string;
}
const DEFAULT_FORM: CreateProjectForm = {
    name: '',
    clientName: '',
    clientId: '',
    contactPerson: null,
    description: '',
    status: 'in_progress',
    location: '',
    scopeOfWork: [],
    sequenceCount: '0',
    connectionDesignVendor: '',
    connectionDesignContact: '',
    connectionDesignEmail: '',
    year: String(new Date().getFullYear()),
    startingTransmittalNumber: '1',
};

export default function AdminProjects() {
    const navigate = useNavigate();
    const [projects, setProjects] = useState<Project[]>([]);
    const [totalProjectsCount, setTotalProjectsCount] = useState<number>(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [modalError, setModalError] = useState('');
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
            setError('');

            const [projData, clientData] = await Promise.all([
                adminListProjects(),
                adminListClients()
            ]);

            if (!projData || !Array.isArray(projData.projects)) {
                throw new Error('Invalid project data received from server');
            }

            setClients(clientData.clients || []);

            const mapped = projData.projects.map((p: any) => ({
                ...p,
                id: String(p._id || p.id),
            }));
            setProjects(mapped);
            setTotalProjectsCount(projData.count || mapped.length);
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

    const allProjects = projects.map(p => ({ ...p, isExternal: false }));

    const filtered = allProjects.filter(
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
        if (!form.name.trim() || !form.clientId) return;

        const selectedClient = clients.find(c => (c.id || c._id) === form.clientId);
        if (!selectedClient) return;

        try {
            setActionLoading(true);
            setModalError('');
            const { project } = await adminCreateProject({
                name: form.name.trim(),
                clientName: selectedClient.name,
                clientId: form.clientId,
                contactPerson: form.contactPerson,
                description: form.description.trim(),
                status: form.status,
                scopeOfWork: form.scopeOfWork || [],
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
                connectionDesignEmail: form.connectionDesignEmail,
                year: Number(form.year),
                startingTransmittalNumber: Number(form.year) <= 2026 ? Number(form.startingTransmittalNumber) || 1 : 1,
            } as any);

            const newProject = {
                ...project,
                id: project._id || project.id
            };

            setProjects((prev) => [newProject, ...prev]);
            setShowCreate(false);
            setForm(DEFAULT_FORM);
            setSequenceNames([]);
            setSeqInput('0');
        } catch (err: any) {
            setModalError(`Create failed: ${err.message}`);
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
        if (!editTarget) return;
        try {
            setActionLoading(true);
            setError('');
            const { project } = await adminUpdateProject(editTarget.id, {
                name: editTarget.name,
                clientName: editTarget.clientName,
                clientId: editTarget.clientId,
                contactPerson: editTarget.contactPerson,
                description: editTarget.description,
                status: editTarget.status,
                scopeOfWork: editTarget.scopeOfWork || [],
                location: editTarget.location,
                sequences: editTarget.sequences,
                connectionDesignVendor: editTarget.connectionDesignVendor,
                connectionDesignContact: editTarget.connectionDesignContact,
                connectionDesignEmail: editTarget.connectionDesignEmail
            } as any);

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

    const handleProjectNavigation = (project: Project | any) => {
        const projectId = String(project?.id || project?._id || '').trim();
        if (!projectId || projectId === 'undefined') return;

        navigate(`/admin/projects/${projectId}`);
    };

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
                    { label: 'Total Projects', value: Math.max(totalProjectsCount, allProjects.length), cls: 'accent-blue' },
                    { label: 'In-progress', value: allProjects.filter((p) => getOriginalCategory(p) === 'in_progress').length, cls: 'accent-green' },
                    { label: 'On Hold', value: allProjects.filter((p) => getOriginalCategory(p) === 'on_hold').length, cls: 'accent-amber' },
                    { label: 'Completed', value: allProjects.filter((p) => getOriginalCategory(p) === 'completed').length, cls: 'accent-slate' },
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
                    {filtered.length} of {allProjects.length} projects
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
                                <th>Approval %</th>
                                <th>Fabrication %</th>
                                <th>Sequence</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr><td colSpan={9} className="table-empty">No projects match your search.</td></tr>
                            ) : (
                                filtered.map((p, i) => (
                                    <tr key={p.id}>
                                        <td className="text-muted font-mono" style={{ fontSize: 12 }}>{i + 1}</td>
                                        <td style={{ color: 'var(--color-text-secondary)' }}>{p.clientName}</td>
                                        <td>
                                            <span
                                                onClick={() => handleProjectNavigation(p)}
                                                style={{
                                                    fontWeight: 700,
                                                    fontSize: 14,
                                                    color: 'var(--color-text-primary)',
                                                    cursor: 'pointer',
                                                    textDecoration: 'underline',
                                                    textUnderlineOffset: '2px'
                                                }}
                                            >
                                                {p.name}
                                            </span>
                                        </td>
                                        <td className="text-muted font-mono" style={{ fontSize: 12.5 }}>
                                            {formatDate(p.createdAt)}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 100 }}>
                                                <div style={{ flex: 1, height: 3, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                                                    <div style={{ width: `${p.approvalPercentage || 0}%`, height: '100%', background: 'var(--color-primary)', opacity: 0.8 }} />
                                                </div>
                                                <span className="font-mono" style={{ fontSize: 12, fontWeight: 750, color: '#1e293b' }}>{p.approvalPercentage || 0}%</span>
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 100 }}>
                                                <div style={{ flex: 1, height: 3, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                                                    <div style={{ width: `${p.fabricationPercentage || 0}%`, height: '100%', background: '#10b981', opacity: 0.8 }} />
                                                </div>
                                                <span className="font-mono" style={{ fontSize: 12, fontWeight: 750, color: '#1e293b' }}>{p.fabricationPercentage || 0}%</span>
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
                                                    gap: 6,
                                                    background: '#f8fafc',
                                                    padding: '4px 12px',
                                                    borderRadius: '8px',
                                                    border: '1px solid #e2e8f0',
                                                    width: 'fit-content'
                                                }}
                                            >
                                                <span style={{ fontSize: 13, fontWeight: 800, color: '#1e293b' }}>{p.sequences?.length || 0}</span>
                                                <span style={{ fontSize: 10, fontWeight: 650, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.02em' }}>SEQ</span>
                                                <div style={{ color: '#94a3b8', display: 'flex', width: 12, height: 12, marginLeft: 2 }}><IconEdit /></div>
                                            </div>
                                        </td>
                                        <td>
                                            <span className={`badge ${getBadgeClass(p.rawStatus || STATUS_LABEL[p.status as ProjectStatus] || p.status)}`}>
                                                {formatBadgeText(p.rawStatus || STATUS_LABEL[p.status as ProjectStatus] || p.status)}
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
                                                    <IconOpen /> Open
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
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
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
                                        setForm({ ...form, clientId: cId, contactPerson: null });
                                    }}
                                >
                                    <option value="">Select a Client</option>
                                    {clients.map(c => (
                                        <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>

                            {form.clientId && (
                                <div className="form-group">
                                    <label className="form-label required">Contact Person</label>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                                        {clients.find(c => (c.id || c._id) === form.clientId)?.contacts.map((con, idx) => {
                                            const isSelected = form.contactPerson?.email === con.email;
                                            return (
                                                <label
                                                    key={idx}
                                                    style={{
                                                        display: 'flex', alignItems: 'flex-start', gap: 10,
                                                        padding: '10px 14px', border: `1px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                                        borderRadius: 6, cursor: 'pointer', background: isSelected ? 'var(--color-primary-light)' : '#fff',
                                                        transition: 'all 0.2s', margin: 0
                                                    }}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="contactPersonRadio"
                                                        checked={isSelected}
                                                        onChange={() => setForm({ ...form, contactPerson: con })}
                                                        style={{ marginTop: 2, cursor: 'pointer' }}
                                                    />
                                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>{con.name}</span>
                                                        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{con.email}</span>
                                                    </div>
                                                </label>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}

                            <div className="form-group">
                                <label className="form-label required">Project Name</label>
                                <input className="form-control" placeholder="e.g. SteelFrame Tower B"
                                    value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label required">Project Year</label>
                                <input
                                    className="form-control"
                                    type="number"
                                    placeholder="e.g. 2025"
                                    min="2000"
                                    max="2100"
                                    value={form.year}
                                    onChange={(e) => setForm({ ...form, year: e.target.value, startingTransmittalNumber: '1' })}
                                />
                            </div>

                            {Number(form.year) <= 2026 && Number(form.year) >= 2000 && (
                                <div className="form-group" style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '14px 16px' }}>
                                    <label className="form-label required" style={{ color: '#c2410c' }}>Starting Transmittal Number</label>
                                    <p style={{ fontSize: 12, color: '#9a3412', marginBottom: 8, marginTop: 2 }}>
                                        Since this is a {form.year} project, enter the first transmittal number to use (e.g. if previous transmittals went up to 12, enter 13).
                                    </p>
                                    <input
                                        className="form-control"
                                        type="number"
                                        placeholder="e.g. 1"
                                        min="1"
                                        value={form.startingTransmittalNumber}
                                        onChange={(e) => setForm({ ...form, startingTransmittalNumber: e.target.value })}
                                    />
                                </div>
                            )}

                            <div className="form-group">
                                <label className="form-label">Description</label>
                                <textarea className="form-control" placeholder="Brief project description…" rows={3}
                                    value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                            </div>
                            {/* ── Scope of Work Builder (Create Project) ── */}
                            <div style={{ marginTop: 16, padding: '16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        Scope of Work
                                    </div>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => {
                                            const currentSow = form.scopeOfWork || [];
                                            const nextNum = String(currentSow.length + 1).padStart(2, '0');
                                            const newItem = {
                                                name: `SOW ${nextNum}`,
                                                percentage: 0,
                                                approval: 0,
                                                fabrication: 0,
                                                status: 'Yet to Start'
                                            };
                                            setForm({ ...form, scopeOfWork: [...currentSow, newItem] });
                                        }}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 12, fontWeight: 700 }}
                                    >
                                        + Add SOW
                                    </button>
                                </div>

                                {(!form.scopeOfWork || form.scopeOfWork.length === 0) ? (
                                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                        No Scope of Work items added yet. Click "+ Add SOW" to add one.
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        {form.scopeOfWork.map((item, idx) => (
                                            <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 6 }}>
                                                <div style={{ flex: 2 }}>
                                                    <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Name</label>
                                                    <input
                                                        className="form-control form-control-sm"
                                                        value={item.name}
                                                        onChange={(e) => {
                                                            const newSow = [...(form.scopeOfWork || [])];
                                                            newSow[idx] = { ...newSow[idx], name: e.target.value };
                                                            setForm({ ...form, scopeOfWork: newSow });
                                                        }}
                                                    />
                                                </div>
                                                <div style={{ flex: 1.8 }}>
                                                    <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Percentage of Total Work (%)</label>
                                                    <input
                                                        type="number"
                                                        className="form-control form-control-sm"
                                                        value={item.percentage || ''}
                                                        onChange={(e) => {
                                                            const newSow = [...(form.scopeOfWork || [])];
                                                            newSow[idx] = { ...newSow[idx], percentage: Number(e.target.value) };
                                                            setForm({ ...form, scopeOfWork: newSow });
                                                        }}
                                                    />
                                                </div>
                                                <div style={{ flex: 1.2 }}>
                                                    <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Approval (%)</label>
                                                    <input
                                                        type="number"
                                                        className="form-control form-control-sm"
                                                        value={item.approval || ''}
                                                        onChange={(e) => {
                                                            const newSow = [...(form.scopeOfWork || [])];
                                                            newSow[idx] = { ...newSow[idx], approval: Number(e.target.value) };
                                                            setForm({ ...form, scopeOfWork: newSow });
                                                        }}
                                                    />
                                                </div>
                                                <div style={{ flex: 1.2 }}>
                                                    <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Fabrication (%)</label>
                                                    <input
                                                        type="number"
                                                        className="form-control form-control-sm"
                                                        value={item.fabrication || ''}
                                                        onChange={(e) => {
                                                            const newSow = [...(form.scopeOfWork || [])];
                                                            newSow[idx] = { ...newSow[idx], fabrication: Number(e.target.value) };
                                                            setForm({ ...form, scopeOfWork: newSow });
                                                        }}
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const newSow = (form.scopeOfWork || []).filter((_, i) => i !== idx);
                                                        setForm({ ...form, scopeOfWork: newSow });
                                                    }}
                                                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4, marginTop: 14, fontSize: 14, fontWeight: 700 }}
                                                    title="Remove SOW item"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="form-group">
                                <label className="form-label">Location</label>
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
                                <label className="form-label">Number of Sequences <span style={{ color: 'red' }}>*</span></label>
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
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">Contact Number</label>
                                    <input
                                        type="tel"
                                        className="form-control"
                                        placeholder="e.g., 9876543210"
                                        pattern="^[0-9]{10}$"
                                        maxLength={10}
                                        title="Please enter exactly 10 digits."
                                        value={form.connectionDesignContact}
                                        onChange={(e) => {
                                            const onlyDigits = e.target.value.replace(/\D/g, '');
                                            setForm({ ...form, connectionDesignContact: onlyDigits });
                                        }}
                                    />
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">Email Address</label>
                                    <input
                                        type="email"
                                        className="form-control"
                                        placeholder="john@example.com"
                                        pattern="^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
                                        title="Please enter a valid email address."
                                        value={form.connectionDesignEmail}
                                        onChange={(e) => setForm({ ...form, connectionDesignEmail: e.target.value })}
                                    />
                                </div>
                            </div>

                            {modalError && (
                                <div className="info-box danger mb-md" style={{ fontSize: 13, padding: '10px 14px' }}>
                                    {modalError}
                                </div>
                            )}

                            <div className="form-actions">
                                <button className="btn btn-secondary"
                                    onClick={() => { setShowCreate(false); setForm(DEFAULT_FORM); setError(''); setModalError(''); }}>Cancel</button>
                                <button className="btn btn-primary"
                                    onClick={() => {
                                        // Validate required fields and sequences before creating
                                        if (!form.name.trim() || !form.clientId) {
                                            setModalError('Please provide: ' + (!form.name.trim() ? 'Project Name' : 'Client'));
                                            return;
                                        }
                                        if (!form.year || isNaN(Number(form.year))) {
                                            setModalError('Please provide: Year');
                                            return;
                                        }
                                        if (Number(form.year) <= 2026 && Number(form.year) >= 2000 && (!form.startingTransmittalNumber || Number(form.startingTransmittalNumber) < 1)) {
                                            setModalError('Please provide: Starting Transmittal Number');
                                            return;
                                        }
                                        if (sequenceNames.length === 0) {
                                            setModalError('Please add at least one Sequence');
                                            return;
                                        }
                                        // All validations passed, proceed with creation
                                        handleCreate();
                                    }}
                                    disabled={actionLoading}
                                >
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
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
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
                                        <select
                                            className="form-control"
                                            value={editTarget.clientName}
                                            onChange={(e) => {
                                                const selectedName = e.target.value;
                                                const selectedClient = clients.find(c => c.name === selectedName);
                                                setEditTarget({
                                                    ...editTarget,
                                                    clientName: selectedName,
                                                    clientId: selectedClient ? (selectedClient.id || selectedClient._id) : editTarget.clientId,
                                                    contactPerson: undefined
                                                });
                                            }}
                                        >
                                            <option value="">Select a Client</option>
                                            {clients.map(c => (
                                                <option key={c.id || c._id} value={c.name}>{c.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {editTarget.clientId && (
                                        <div className="form-group">
                                            <label className="form-label required">Contact Person</label>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                                                {clients.find(c => (c.id || c._id) === editTarget.clientId)?.contacts.map((con, idx) => {
                                                    const isSelected = editTarget.contactPerson?.email === con.email;
                                                    return (
                                                        <label
                                                            key={idx}
                                                            style={{
                                                                display: 'flex', alignItems: 'flex-start', gap: 10,
                                                                padding: '10px 14px', border: `1px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                                                borderRadius: 6, cursor: 'pointer', background: isSelected ? 'var(--color-primary-light)' : '#fff',
                                                                transition: 'all 0.2s', margin: 0
                                                            }}
                                                        >
                                                            <input
                                                                type="radio"
                                                                name="editContactPersonRadio"
                                                                checked={isSelected}
                                                                onChange={() => setEditTarget({ ...editTarget, contactPerson: con })}
                                                                style={{ marginTop: 2, cursor: 'pointer' }}
                                                            />
                                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>{con.name}</span>
                                                                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{con.email}</span>
                                                            </div>
                                                        </label>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    <div className="form-group">
                                        <label className="form-label">Description</label>
                                        <textarea className="form-control" rows={3} value={editTarget.description}
                                            onChange={(e) => setEditTarget({ ...editTarget, description: e.target.value })} />
                                    </div>
                                    {/* ── Scope of Work Builder ── */}
                                     <div style={{ marginTop: 16, padding: '16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                                         <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                             <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                 Scope of Work
                                             </div>
                                             <button
                                                 type="button"
                                                 className="btn btn-secondary btn-sm"
                                                 onClick={() => {
                                                     const currentSow = editTarget.scopeOfWork || [];
                                                     const nextNum = String(currentSow.length + 1).padStart(2, '0');
                                                     const newItem = {
                                                         name: `SOW ${nextNum}`,
                                                         percentage: 0,
                                                         approval: 0,
                                                         fabrication: 0,
                                                         status: 'Yet to Start'
                                                     };
                                                     setEditTarget({ ...editTarget, scopeOfWork: [...currentSow, newItem] });
                                                 }}
                                                 style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 12, fontWeight: 700 }}
                                             >
                                                 + Add SOW
                                             </button>
                                         </div>

                                         {(!editTarget.scopeOfWork || editTarget.scopeOfWork.length === 0) ? (
                                             <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                                 No Scope of Work items added yet. Click "+ Add SOW" to add one.
                                             </div>
                                         ) : (
                                             <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                                 {editTarget.scopeOfWork.map((item, idx) => (
                                                     <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 6 }}>
                                                         <div style={{ flex: 2 }}>
                                                             <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Name</label>
                                                             <input
                                                                 className="form-control form-control-sm"
                                                                 value={item.name}
                                                                 onChange={(e) => {
                                                                     const newSow = [...(editTarget.scopeOfWork || [])];
                                                                     newSow[idx] = { ...newSow[idx], name: e.target.value };
                                                                     setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                 }}
                                                             />
                                                         </div>
                                                         <div style={{ flex: 1.8 }}>
                                                              <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Percentage of Total Work (%)</label>
                                                              <input
                                                                  type="number"
                                                                  className="form-control form-control-sm"
                                                                  value={item.percentage || ''}
                                                                  onChange={(e) => {
                                                                      const newSow = [...(editTarget.scopeOfWork || [])];
                                                                      newSow[idx] = { ...newSow[idx], percentage: Number(e.target.value) };
                                                                      setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                  }}
                                                              />
                                                          </div>
                                                         <div style={{ flex: 1.2 }}>
                                                             <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Approval (%)</label>
                                                             <input
                                                                 type="number"
                                                                 className="form-control form-control-sm"
                                                                 value={item.approval || ''}
                                                                 onChange={(e) => {
                                                                     const newSow = [...(editTarget.scopeOfWork || [])];
                                                                     newSow[idx] = { ...newSow[idx], approval: Number(e.target.value) };
                                                                     setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                 }}
                                                             />
                                                         </div>
                                                         <div style={{ flex: 1.2 }}>
                                                             <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 2 }}>Fabrication (%)</label>
                                                             <input
                                                                 type="number"
                                                                 className="form-control form-control-sm"
                                                                 value={item.fabrication || ''}
                                                                 onChange={(e) => {
                                                                     const newSow = [...(editTarget.scopeOfWork || [])];
                                                                     newSow[idx] = { ...newSow[idx], fabrication: Number(e.target.value) };
                                                                     setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                                 }}
                                                             />
                                                         </div>
                                                         <button
                                                             type="button"
                                                             onClick={() => {
                                                                 const newSow = (editTarget.scopeOfWork || []).filter((_, i) => i !== idx);
                                                                 setEditTarget({ ...editTarget, scopeOfWork: newSow });
                                                             }}
                                                             style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4, marginTop: 14, fontSize: 14, fontWeight: 700 }}
                                                             title="Remove SOW item"
                                                         >
                                                             ✕
                                                         </button>
                                                     </div>
                                                 ))}
                                             </div>
                                         )}
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
                                                type="tel"
                                                className="form-control"
                                                placeholder="e.g., 9876543210"
                                                pattern="^[0-9]{10}$"
                                                maxLength={10}
                                                title="Please enter exactly 10 digits."
                                                value={editTarget.connectionDesignContact || ''}
                                                onChange={(e) => {
                                                    const onlyDigits = e.target.value.replace(/\D/g, '');
                                                    setEditTarget({ ...editTarget, connectionDesignContact: onlyDigits });
                                                }}
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">Email Address</label>
                                            <input
                                                type="email"
                                                className="form-control"
                                                placeholder="john@example.com"
                                                pattern="^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
                                                title="Please enter a valid email address."
                                                value={editTarget.connectionDesignEmail || ''}
                                                onChange={(e) => setEditTarget({ ...editTarget, connectionDesignEmail: e.target.value })}
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
