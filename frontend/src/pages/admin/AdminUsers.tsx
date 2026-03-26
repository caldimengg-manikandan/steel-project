import { useState, useEffect, useCallback } from 'react';
import type { User, Project } from '../../types';
import { adminListUsers, adminCreateUser, adminDeleteUser, adminUpdateUser, adminBulkCreateUsers } from '../../services/adminUserApi';
import { adminListProjects, adminAssignUser } from '../../services/projectApi';
import { IconTrash, IconClose, IconAssign, IconPlus, IconUpload } from '../../components/Icons';

interface CreateUserForm {
    username: string; email: string; password: string; displayName: string;
}
const DEFAULT_FORM: CreateUserForm = { username: '', email: '', password: '', displayName: '' };

export default function AdminUsers() {
    const [users, setUsers] = useState<User[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
    const [assignTarget, setAssignTarget] = useState<User | null>(null);
    const [assignProject, setAssignProject] = useState('');
    const [assignRole, setAssignRole] = useState<'viewer' | 'editor' | 'admin'>('viewer');

    const [showCreate, setShowCreate] = useState(false);
    const [showBulk, setShowBulk] = useState(false);
    const [form, setForm] = useState<CreateUserForm>(DEFAULT_FORM);
    const [creating, setCreating] = useState(false);
    const [bulkFile, setBulkFile] = useState<File | null>(null);
    const [bulkResult, setBulkResult] = useState<any>(null);
    const [bulkError, setBulkError] = useState('');

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const [userData, projectData] = await Promise.all([
                adminListUsers(),
                adminListProjects()
            ]);

            setUsers(userData.users.map((u: any) => ({ ...u, id: u._id || u.id })));
            setProjects(projectData.projects.map((p: any) => ({ ...p, id: p._id || p.id })));
        } catch (err: any) {
            setError(err.message || 'Failed to load data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const filtered = users.filter(
        (u) =>
            u.username.toLowerCase().includes(search.toLowerCase()) ||
            u.email.toLowerCase().includes(search.toLowerCase())
    );

    async function handleCreateUser() {
        if (!form.username || !form.email || !form.password) return;
        try {
            setCreating(true);
            const { user } = await adminCreateUser(form);
            setUsers((prev) => [{ ...user, id: user._id || user.id }, ...prev]);
            setShowCreate(false);
            setForm(DEFAULT_FORM);
        } catch (err: any) {
            setError(`Create failed: ${err.message}`);
        } finally {
            setCreating(false);
        }
    }

    async function handleDelete(id: string) {
        try {
            await adminDeleteUser(id);
            setUsers((prev) => prev.filter((u) => u.id !== id));
            setDeleteTarget(null);
        } catch (err: any) {
            setError(`Delete failed: ${err.message}`);
        }
    }

    async function handleToggleStatus(u: User) {
        const newStatus = u.status === 'active' ? 'inactive' : 'active';
        try {
            const { user } = await adminUpdateUser(u.id, { status: newStatus as any });
            setUsers((prev) =>
                prev.map((item) => (item.id === u.id ? { ...user, id: user._id || user.id } : item))
            );
        } catch (err: any) {
            setError(`Update failed: ${err.message}`);
        }
    }

    async function handleSaveAssignment() {
        if (!assignTarget || !assignProject) return;
        try {
            await adminAssignUser(assignProject, {
                userId: assignTarget.id,
                permission: assignRole
            });
            await fetchData(); // Refresh to get updated role counts
            setAssignTarget(null);
        } catch (err: any) {
            setError(`Assignment failed: ${err.message}`);
        }
    }

    async function handleBulkUpload() {
        if (!bulkFile) return;
        try {
            setBulkError('');
            setCreating(true);
            const result = await adminBulkCreateUsers(bulkFile);
            setBulkResult(result);
            await fetchData();
        } catch (err: any) {
            setBulkError(err.message || 'Unknown error occurred during upload.');
        } finally {
            setCreating(false);
        }
    }

    // Count project assignments within this admin's scope only
    function countRoles(userId: string) {
        return projects.reduce((n, p) => n + p.assignments.filter((a) => a.userId === userId).length, 0);
    }

    const SearchIcon = () => (
        <svg viewBox="0 0 16 16" fill="none" strokeWidth="1.5" stroke="currentColor" width="14" height="14">
            <circle cx="6.5" cy="6.5" r="4.5" />
            <path d="M10 10l3.5 3.5" strokeLinecap="round" />
        </svg>
    );

    const activeCount = users.filter((u) => u.status === 'active').length;
    const inactiveCount = users.filter((u) => u.status === 'inactive').length;
    const totalUsers = users.length;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h2 className="page-title">User Management</h2>
                    <p className="page-subtitle">Manage portal users, their accounts, and project access</p>
                </div>
                <div className="page-header-right" style={{ display: 'flex', gap: '12px' }}>
                    <button className="btn btn-secondary" onClick={() => { setShowBulk(true); setBulkResult(null); setBulkFile(null); setBulkError(''); }}>
                        <IconUpload /> Bulk Upload
                    </button>
                    <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                        <IconPlus /> New User
                    </button>
                </div>
            </div>

            {error && (
                <div className="info-box danger mb-md" style={{ padding: '12px 16px', borderRadius: 8 }}>
                    <strong>Error:</strong> {error}
                    <button onClick={fetchData} className="btn btn-ghost btn-sm" style={{ marginLeft: 12 }}>Retry</button>
                </div>
            )}

            {/* Stats */}
            <div className="stats-grid mb-lg" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {[
                    { label: 'Total Users', value: totalUsers, cls: 'accent-blue' },
                    { label: 'Active', value: activeCount, cls: 'accent-green' },
                    { label: 'Inactive', value: inactiveCount, cls: 'accent-amber' },
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
                        placeholder="Search by username or email…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ paddingLeft: 34 }}
                        disabled={loading}
                    />
                </div>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                    {filtered.length} user{filtered.length !== 1 ? 's' : ''}
                </span>
            </div>

            {/* Table */}
            <div className="table-wrapper">
                {loading ? (
                    <div className="table-empty" style={{ padding: '60px 0' }}>
                        <div className="spinner mb-sm"></div>
                        <p>Loading users...</p>
                    </div>
                ) : (
                    <table>
                        <thead>
                            <tr>
                                <th style={{ width: 40 }}>#</th>
                                <th>Username</th>
                                <th>Email</th>
                                <th>Project Roles</th>
                                <th>Status</th>
                                <th>Created</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr><td colSpan={7} className="table-empty">No users found.</td></tr>
                            ) : (
                                filtered.map((u, i) => (
                                    <tr key={u.id}>
                                        <td className="text-muted font-mono" style={{ fontSize: 12 }}>{i + 1}</td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <div style={{
                                                    width: 30, height: 30,
                                                    borderRadius: '50%',
                                                    background: u.status === 'active' ? 'var(--color-primary-light)' : '#f1f5f9',
                                                    color: u.status === 'active' ? 'var(--color-primary)' : '#94a3b8',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    fontSize: 11, fontWeight: 700,
                                                    border: '1px solid',
                                                    borderColor: u.status === 'active' ? '#93c5fd' : '#e2e8f0',
                                                    flexShrink: 0,
                                                }}>
                                                    {u.username.slice(0, 2).toUpperCase()}
                                                </div>
                                                <span style={{ fontWeight: 700, fontSize: 14 }}>{u.username}</span>
                                            </div>
                                        </td>
                                        <td style={{ color: 'var(--color-text-secondary)' }}>{u.email}</td>
                                        <td>
                                            <span style={{
                                                fontWeight: 500,
                                                color: countRoles(u.id) > 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                                            }}>
                                                {countRoles(u.id)} assignment{countRoles(u.id) !== 1 ? 's' : ''}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`badge ${u.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>
                                                {u.status === 'active' ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="text-muted font-mono" style={{ fontSize: 12.5 }}>
                                            {new Date(u.createdAt).toLocaleDateString()}
                                        </td>
                                        <td>
                                            <div className="btn-group">
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => { setAssignTarget(u); setAssignProject(''); setAssignRole('viewer'); }}
                                                    title="Assign Project"
                                                >
                                                    <IconAssign /> Assign
                                                </button>
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    onClick={() => handleToggleStatus(u)}
                                                    style={{ fontSize: 12 }}
                                                >
                                                    {u.status === 'active' ? 'Deactivate' : 'Activate'}
                                                </button>
                                                <button
                                                    className="btn btn-danger btn-sm btn-icon"
                                                    onClick={() => setDeleteTarget(u)}
                                                    title="Remove User"
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

            {/* ── Create User Modal ── */}
            {showCreate && (
                <div className="modal-overlay" onClick={() => setShowCreate(false)}>
                    <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">Create New User</span>
                            <button className="modal-close" onClick={() => setShowCreate(false)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label required">Username</label>
                                <input type="text" className="form-control" placeholder="e.g. john_doe"
                                    value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label required">Email Address</label>
                                <input type="email" className="form-control" placeholder="e.g. john@example.com"
                                    value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Display Name</label>
                                <input type="text" className="form-control" placeholder="e.g. John Doe"
                                    value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label required">Temporary Password</label>
                                <input type="password" className="form-control" placeholder="Password"
                                    value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
                            </div>
                            <div className="form-actions">
                                <button className="btn btn-secondary" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</button>
                                <button className="btn btn-primary" onClick={handleCreateUser} disabled={creating || !form.username || !form.email || !form.password}>
                                    {creating ? 'Creating...' : 'Create User Account'}
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
                            <span className="modal-title">Remove User</span>
                            <button className="modal-close" onClick={() => setDeleteTarget(null)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <p className="confirm-dialog-text">
                                Remove user <strong>"{deleteTarget.username}"</strong> from the system?
                                All project assignments for this user will also be removed. This cannot be undone.
                            </p>
                            <div className="form-actions">
                                <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
                                <button className="btn btn-danger btn-lg" onClick={() => handleDelete(deleteTarget.id)}>
                                    Remove User
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Assign Project Modal ── */}
            {assignTarget && (
                <div className="modal-overlay" onClick={() => setAssignTarget(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">Assign Project — {assignTarget.username}</span>
                            <button className="modal-close" onClick={() => setAssignTarget(null)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label required">Select Project</label>
                                <select className="form-control" value={assignProject}
                                    onChange={(e) => setAssignProject(e.target.value)}>
                                    <option value="">— Select a project —</option>
                                    {projects.map((p) => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label required">Permission Level</label>
                                <select className="form-control" value={assignRole}
                                    onChange={(e) => setAssignRole(e.target.value as 'viewer' | 'editor' | 'admin')}>
                                    <option value="viewer">Viewer — Read-only access</option>
                                    <option value="editor">Editor — Upload and edit drawings</option>
                                    <option value="admin">Admin — Full project control</option>
                                </select>
                            </div>
                            <div className="info-box info">
                                If the user is already assigned to this project, their permission will be updated.
                            </div>
                            <div className="form-actions">
                                <button className="btn btn-secondary" onClick={() => setAssignTarget(null)}>Cancel</button>
                                <button className="btn btn-primary" disabled={!assignProject}
                                    onClick={handleSaveAssignment}>
                                    Save Assignment
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* ── Bulk Upload Modal ── */}
            {showBulk && (
                <div className="modal-overlay" onClick={() => setShowBulk(false)}>
                    <div className="modal" style={{ maxWidth: 550 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">Bulk User Upload</span>
                            <button className="modal-close" onClick={() => setShowBulk(false)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            {bulkError && (
                                <div className="info-box danger mb-md" style={{ padding: '8px 12px', fontSize: 13 }}>
                                    <strong>Error:</strong> {bulkError}
                                </div>
                            )}
                            {!bulkResult ? (
                                <>
                                    <div className="info-box info mb-md">
                                        <h4 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Required Excel Format</h4>
                                        <p style={{ margin: '0 0 12px 0', fontSize: 13, opacity: 0.9 }}>
                                            Please upload an Excel file (<code>.xlsx</code>) with the following headers in the first row:
                                        </p>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
                                            <div>
                                                <strong>Required Columns:</strong>
                                                <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                                                    <li><code>username</code></li>
                                                    <li><code>email</code></li>
                                                    <li><code>password</code></li>
                                                </ul>
                                            </div>
                                            <div>
                                                <strong>Optional Columns:</strong>
                                                <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                                                    <li><code>displayName</code></li>
                                                </ul>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Select Excel File</label>
                                        <input 
                                            type="file" 
                                            accept=".xlsx"
                                            className="form-control" 
                                            onChange={e => setBulkFile(e.target.files?.[0] || null)}
                                            style={{ padding: '8px' }}
                                        />
                                    </div>

                                    <div className="form-actions mt-lg">
                                        <button className="btn btn-secondary" onClick={() => setShowBulk(false)} disabled={creating}>Cancel</button>
                                        <button 
                                            className="btn btn-primary" 
                                            onClick={handleBulkUpload} 
                                            disabled={creating || !bulkFile}
                                        >
                                            {creating ? 'Uploading & Processing...' : 'Upload & Create Users'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div>
                                    <div className={`info-box ${bulkResult.results.created > 0 ? 'success' : 'warning'} mb-md`}>
                                        <p style={{ fontWeight: 600, margin: 0 }}>{bulkResult.message}</p>
                                    </div>
                                    
                                    {bulkResult.results.failedRows.length > 0 && (
                                        <div className="form-group">
                                            <label className="form-label">Issues / Errors:</label>
                                            <div style={{ 
                                                maxHeight: 200, 
                                                overflowY: 'auto', 
                                                background: '#f8fafc', 
                                                padding: '12px', 
                                                borderRadius: 6,
                                                fontSize: 12,
                                                border: '1px solid #e2e8f0',
                                                color: 'var(--color-danger)'
                                            }}>
                                                {bulkResult.results.failedRows.map((err: string, idx: number) => (
                                                    <div key={idx} style={{ marginBottom: 4 }}>• {err}</div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="form-actions mt-lg">
                                        <button className="btn btn-primary" onClick={() => setShowBulk(false)}>Close</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
