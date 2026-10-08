import { useState, useEffect, useCallback } from 'react';
import type { User, Project, Client } from '../../types';
import { adminListUsers, adminCreateUser, adminDeleteUser, adminUpdateUser, adminBulkCreateUsers } from '../../services/adminUserApi';
import { formatDate } from '../../utils/dateUtils';
import { adminListProjects, adminAssignUser } from '../../services/projectApi';
import { adminListClients } from '../../services/adminClientApi';
import { adminListTeams, adminCreateTeam, adminDeleteTeam, type Team } from '../../services/adminTeamApi';
import { useMessage } from '../../context/MessageContext';
import { IconTrash, IconClose, IconAssign, IconPlus, IconUpload, IconEdit } from '../../components/Icons';

interface CreateUserForm {
    username: string; 
    employeeId: string;
    email: string; 
    password: string; 
    displayName: string;
    role: 'superadmin' | 'project_manager' | 'assistant_project_manager' | 'team_lead' | 'assistant_team_lead' | 'team_member' | 'user' | '';
    division: string;
    project_manager: string;
    assistant_project_manager: string;
    team_lead: string[];
    assistant_team_lead?: string;
}
const DEFAULT_FORM: CreateUserForm = {
    username: '',
    employeeId: '',
    email: '',
    password: '',
    displayName: '',
    role: '',
    division: '',
    project_manager: '',
    assistant_project_manager: '',
    team_lead: [],
    assistant_team_lead: ''
};

export default function AdminUsers() {
    const { showMessage, showConfirm } = useMessage();
    const [users, setUsers] = useState<User[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [teams, setTeams] = useState<Team[]>([]);
    const [activeTab, setActiveTab] = useState<'users' | 'teams'>('users');
    const [showCreateTeam, setShowCreateTeam] = useState(false);
    const [teamForm, setTeamForm] = useState<{name: string, lead: string, members: string[]}>({name: '', lead: '', members: []});
    const [assignTarget, setAssignTarget] = useState<User | null>(null);
    const [assignProject, setAssignProject] = useState('');
    const [assignRole, setAssignRole] = useState<'viewer' | 'editor' | 'admin'>('viewer');
    const [assignClient, setAssignClient] = useState('ALL');

    const [editTarget, setEditTarget] = useState<User | null>(null);
    const [editForm, setEditForm] = useState<{
        displayName: string;
        employeeId: string;
        email: string;
        role: 'superadmin' | 'project_manager' | 'assistant_project_manager' | 'team_lead' | 'assistant_team_lead' | 'team_member' | 'user' | '';
        password?: string;
        division: string;
        project_manager: string;
        assistant_project_manager: string;
        team_lead: string[];
        assistant_team_lead?: string;
    }>({
        displayName: '',
        employeeId: '',
        email: '',
        role: 'team_member',
        password: '',
        division: '',
        project_manager: '',
        assistant_project_manager: '',
        team_lead: [],
        assistant_team_lead: ''
    });
    const [savingEdit, setSavingEdit] = useState(false);

    const [showCreate, setShowCreate] = useState(false);
    const [showBulk, setShowBulk] = useState(false);
    const [form, setForm] = useState<CreateUserForm>(DEFAULT_FORM);
    const [duplicateError, setDuplicateError] = useState('');
    const [duplicateFields, setDuplicateFields] = useState<string[]>([]);
    const [creating, setCreating] = useState(false);
    const [bulkFile, setBulkFile] = useState<File | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [bulkResult, setBulkResult] = useState<any>(null);
    const [bulkError, setBulkError] = useState('');

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const [userData, projectData, clientData, teamsData] = await Promise.all([
                adminListUsers(),
                adminListProjects(),
                adminListClients(),
                adminListTeams()
            ]);

            setUsers(userData.users.map((u: any) => ({ ...u, id: u._id || u.id })));
            setProjects(projectData.projects.map((p: any) => ({ ...p, id: p._id || p.id })));
            setClients(clientData.clients || []);
            setTeams(teamsData || []);
        } catch (err: any) {
            setError(err.message || 'Failed to load data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const filtered = users
        .filter(
            (u) =>
                u.username.toLowerCase().includes(search.toLowerCase()) ||
                (u.email || '').toLowerCase().includes(search.toLowerCase())
        )
        .sort((a, b) => a.username.localeCompare(b.username));

    async function handleCreateUser() {
        if (!form.username || !form.password) return;
        try {
            setCreating(true);
            const { user } = await adminCreateUser(form);
            setUsers((prev) => [{ ...user, id: user._id || user.id }, ...prev]);
            setShowCreate(false);
            setForm(DEFAULT_FORM);
            showMessage('Success', 'User account created successfully.', 'success');
            setDuplicateError('');
            setDuplicateFields([]);
        } catch (err: any) {
            const msg = err.message || '';
            const match = msg.match(/Duplicate value for field:\s*(.+)/i);
            if (match) {
                const fields = match[1].split(',').map((f: string) => f.trim());
                setDuplicateFields(fields);
                
                // Construct a human-readable message without technical database key names like adminId
                let cleanMsg = '';
                const duplicateKeys = fields.filter((f: string) => f !== 'adminId');
                if (duplicateKeys.includes('email') && duplicateKeys.includes('username')) {
                    cleanMsg = 'This Username and Email Address already exist in your system.';
                } else if (duplicateKeys.includes('email')) {
                    cleanMsg = 'This Email Address already exists in your system.';
                } else if (duplicateKeys.includes('username')) {
                    cleanMsg = 'This Username already exists in your system.';
                } else {
                    cleanMsg = `Duplicate value for field: ${duplicateKeys.join(', ')}.`;
                }
                
                setDuplicateError(cleanMsg);
                showMessage('Error', cleanMsg, 'error');
            } else {
                setDuplicateFields([]);
                setDuplicateError(msg);
                showMessage('Error', msg, 'error');
            }
        } finally {
            setCreating(false);
        }
    }

    async function handleDelete(id: string, username: string) {
        showConfirm('Remove User', `Remove user "${username}" from the system? All project assignments for this user will also be removed. This cannot be undone.`, async () => {
            try {
                await adminDeleteUser(id);
                setUsers((prev) => prev.filter((u) => u.id !== id));
                showMessage('Deleted', 'User has been removed successfully.', 'success');
            } catch (err: any) {
                showMessage('Error', err.message, 'error');
            }
        });
    }

    async function handleUpdateUser() {
        if (!editTarget) return;
        try {
            setSavingEdit(true);
            const updateData: any = {
                displayName: editForm.displayName,
                employeeId: editForm.employeeId,
                email: editForm.email,
                role: editForm.role || 'team_member',
                division: editForm.division,
                project_manager: editForm.project_manager,
                assistant_project_manager: editForm.assistant_project_manager,
                team_lead: editForm.team_lead,
                assistant_team_lead: editForm.assistant_team_lead
            };
            if (editForm.password && editForm.password.trim()) {
                updateData.password = editForm.password;
            }

            const { user: updated } = await adminUpdateUser(editTarget.id, updateData);
            setUsers((prev) => prev.map((u) => (u.id === editTarget.id ? { ...updated, id: updated._id || updated.id } : u)));
            setEditTarget(null);
            showMessage('Success', `User "${updated.username}" updated successfully.`, 'success');
        } catch (err: any) {
            showMessage('Error', err.message || 'Failed to update user', 'error');
        } finally {
            setSavingEdit(false);
        }
    }

    async function handleToggleStatus(u: User) {
        const newStatus = u.status === 'active' ? 'inactive' : 'active';
        try {
            const { user } = await adminUpdateUser(u.id, { status: newStatus as any });
            setUsers((prev) =>
                prev.map((item) => (item.id === u.id ? { ...user, id: user._id || user.id } : item))
            );
            showMessage('Status Updated', `User is now ${newStatus}.`, 'success');
        } catch (err: any) {
            showMessage('Error', err.message, 'error');
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
            showMessage('Success', 'Project assigned successfully.', 'success');
        } catch (err: any) {
            showMessage('Error', err.message, 'error');
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
                    {activeTab === 'users' ? (
                        <>
                            <button className="btn btn-secondary" onClick={() => { setShowBulk(true); setBulkResult(null); setBulkFile(null); setBulkError(''); }}>
                                <IconUpload /> Bulk Upload
                            </button>
                            <button className="btn btn-primary" onClick={() => { setShowCreate(true); setForm(DEFAULT_FORM); setShowPassword(false); setDuplicateFields([]); setDuplicateError(''); }}>
                                <IconPlus /> New User
                            </button>
                        </>
                    ) : (
                        <button className="btn btn-primary" onClick={() => { setShowCreateTeam(true); setTeamForm({name: '', lead: '', members: []}); }}>
                            <IconPlus /> Create Team
                        </button>
                    )}
                </div>
            </div>

            <div style={{ display: 'flex', gap: 20, borderBottom: '1px solid var(--color-border-light)', marginBottom: 20 }}>
                <button
                    onClick={() => setActiveTab('users')}
                    style={{
                        background: 'none', border: 'none', padding: '10px 4px', fontSize: 14, fontWeight: 600,
                        cursor: 'pointer', borderBottom: activeTab === 'users' ? '2px solid var(--color-primary)' : '2px solid transparent',
                        color: activeTab === 'users' ? 'var(--color-primary)' : 'var(--color-text-muted)'
                    }}
                >
                    Users
                </button>
                <button
                    onClick={() => setActiveTab('teams')}
                    style={{
                        background: 'none', border: 'none', padding: '10px 4px', fontSize: 14, fontWeight: 600,
                        cursor: 'pointer', borderBottom: activeTab === 'teams' ? '2px solid var(--color-primary)' : '2px solid transparent',
                        color: activeTab === 'teams' ? 'var(--color-primary)' : 'var(--color-text-muted)'
                    }}
                >
                    Teams
                </button>
            </div>

            {error && (
                <div className="info-box danger mb-md" style={{ padding: '12px 16px', borderRadius: 8 }}>
                    <strong>Error:</strong> {error}
                    <button onClick={fetchData} className="btn btn-ghost btn-sm" style={{ marginLeft: 12 }}>Retry</button>
                </div>
            )}

            {activeTab === 'users' ? (
            <>
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
                                <th>Employee ID</th>
                                <th>Email</th>
                                <th>Account Role</th>
                                <th>Project Roles</th>
                                <th>Status</th>
                                <th>Created</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr><td colSpan={8} className="table-empty">No users found.</td></tr>
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
                                        <td><span className="font-mono text-muted">{u.employeeId || '-'}</span></td>
                                        <td style={{ color: 'var(--color-text-secondary)' }}>{u.email}</td>
                                        <td>
                                             <span style={{ 
                                                 textTransform: 'capitalize', 
                                                 fontWeight: 600, 
                                                 fontSize: 12,
                                                 color: u.role === 'superadmin' ? 'var(--color-danger-mid)' : 
                                                        u.role === 'project_manager' ? 'var(--color-primary)' : 
                                                        u.role === 'team_lead' ? 'var(--color-success-mid)' : 
                                                        u.role === 'assistant_team_lead' ? 'var(--color-info)' : 'var(--color-text-secondary)'
                                             }}>
                                                 {(!u.role || u.role === 'user') ? 'Team Member' : u.role.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                             </span>
                                         </td>
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
                                             {formatDate(u.createdAt)}
                                         </td>
                                         <td>
                                             <div className="btn-group">
                                                 <button
                                                     className="btn btn-secondary btn-sm"
                                                     onClick={() => {
                                                         setEditTarget(u);
                                                         setEditForm({
                                                             displayName: u.displayName || '',
                                                             employeeId: u.employeeId || '',
                                                             email: u.email || '',
                                                             role: (u.role as any) || 'team_member',
                                                             password: '',
                                                             division: u.division || '',
                                                             project_manager: typeof u.project_manager === 'object' ? (u.project_manager as any)?._id : (u.project_manager || ''),
                                                             assistant_project_manager: typeof u.assistant_project_manager === 'object' ? (u.assistant_project_manager as any)?._id : (u.assistant_project_manager || ''),
                                                             team_lead: Array.isArray(u.team_lead) ? u.team_lead.map(tl => typeof tl === 'object' ? (tl as any)._id : tl) : (typeof u.team_lead === 'object' ? [(u.team_lead as any)._id] : (u.team_lead ? [u.team_lead as string] : []))
                                                         });
                                                     }}
                                                     title="Edit User & Role"
                                                 >
                                                     <IconEdit /> Edit
                                                 </button>
                                                 <button
                                                     className="btn btn-secondary btn-sm"
                                                     onClick={() => { 
                                                         setAssignTarget(u); 
                                                         setAssignProject(''); 
                                                         // team_member defaults to editor per role design
                                                         setAssignRole(u.role === 'team_member' ? 'editor' : 'viewer'); 
                                                         setAssignClient('ALL'); 
                                                     }}
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
                                                    onClick={() => handleDelete(u.id, u.username)}
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
            </>
            ) : (
                <div className="card">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>TEAM NAME</th>
                                <th>TEAM LEAD</th>
                                <th>MEMBERS</th>
                                <th>ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {teams.map((t, idx) => (
                                <tr key={t.id || t._id}>
                                    <td>{idx + 1}</td>
                                    <td>{t.name}</td>
                                    <td>{t.lead?.username}</td>
                                    <td>{t.members?.length || 0} Members</td>
                                    <td>
                                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => {
                                            showConfirm('Delete Team', 'Are you sure you want to delete this team?', async () => {
                                                try {
                                                    await adminDeleteTeam(t._id || t.id);
                                                    setTeams(teams.filter(team => (team._id || team.id) !== (t._id || t.id)));
                                                    showMessage('Success', 'Team deleted.', 'success');
                                                } catch(err: any) {
                                                    showMessage('Error', err.message, 'error');
                                                }
                                            });
                                        }}>
                                            <IconTrash />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {teams.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="text-center text-muted" style={{ padding: 40 }}>No teams created yet.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* ── Create Team Modal ── */}
            {showCreateTeam && (
                <div className="modal-overlay" onMouseDown={(e) => { if(e.target === e.currentTarget) setShowCreateTeam(false) }}>
                    <div className="modal" style={{ width: 500 }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">Create Team</span>
                            <button className="modal-close" onClick={() => setShowCreateTeam(false)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Team Name</label>
                                <input className="form-control" value={teamForm.name} onChange={e => setTeamForm({...teamForm, name: e.target.value})} placeholder="Enter team name" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Team Lead</label>
                                <select className="form-control" value={teamForm.lead} onChange={e => setTeamForm({...teamForm, lead: e.target.value})}>
                                    <option value="">Select a Lead</option>
                                    {users.filter(u => u.role === 'team_lead').map(u => (
                                        <option key={u.id} value={u.id}>{u.username} ({u.role})</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Team Members</label>
                                <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 10, maxHeight: 150, overflowY: 'auto' }}>
                                    {users.filter(u => u.role === 'team_member').map(u => (
                                        <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                            <input 
                                                type="checkbox" 
                                                checked={teamForm.members.includes(u.id)} 
                                                onChange={(e) => {
                                                    const m = new Set(teamForm.members);
                                                    if (e.target.checked) m.add(u.id);
                                                    else m.delete(u.id);
                                                    setTeamForm({...teamForm, members: Array.from(m)});
                                                }}
                                            />
                                            {u.username}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-ghost" onClick={() => setShowCreateTeam(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={async () => {
                                if (!teamForm.name || !teamForm.lead) {
                                    return showMessage('Error', 'Name and Lead are required', 'error');
                                }
                                try {
                                    setCreating(true);
                                    await adminCreateTeam(teamForm);
                                    setShowCreateTeam(false);
                                    fetchData();
                                    showMessage('Success', 'Team created', 'success');
                                } catch(err: any) {
                                    showMessage('Error', err.message, 'error');
                                } finally {
                                    setCreating(false);
                                }
                            }} disabled={creating}>
                                {creating ? 'Creating...' : 'Create Team'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Create User Modal ── */}
            {showCreate && (
                <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setShowCreate(false); setForm(DEFAULT_FORM); setShowPassword(false); setDuplicateError(''); setDuplicateFields([]); } }}>
                    <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">Create New User</span>
                            <button className="modal-close" onClick={() => setShowCreate(false)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <form 
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    handleCreateUser();
                                }}
                                autoComplete="off"
                            >
                                {/* Dummy hidden inputs to intercept Chrome auto-fill */}
                                <input 
                                    type="text" 
                                    name="prevent_autofill_username" 
                                    style={{ position: 'absolute', top: -1000, left: -1000, opacity: 0, height: 0, width: 0 }} 
                                    tabIndex={-1} 
                                    autoComplete="off" 
                                />
                                <input 
                                    type="password" 
                                    name="prevent_autofill_password" 
                                    style={{ position: 'absolute', top: -1000, left: -1000, opacity: 0, height: 0, width: 0 }} 
                                    tabIndex={-1} 
                                    autoComplete="off" 
                                />

                                {duplicateError && (
                                    <div className="info-box danger" style={{ marginBottom: 16, fontSize: 13 }}>
                                        {duplicateError}
                                    </div>
                                )}

                                {/* Username */}
                                <div className="form-group">
                                    <label className="form-label required">Username</label>
                                    <input 
                                        type="text"
                                        name="portal-new-username"
                                        className="form-control" 
                                        placeholder="e.g. john_doe"
                                        autoComplete="new-username"
                                        value={form.username} 
                                        onChange={e => setForm({ ...form, username: e.target.value })} 
                                    />
                                    {duplicateFields.includes('username') && (
                                        <div className="text-danger" style={{ fontSize: 12, marginTop: 4, fontWeight: 500 }}>
                                            Username already exists in this admin scope.
                                        </div>
                                    )}
                                </div>

                                {/* Employee ID */}
                                <div className="form-group">
                                    <label className="form-label required">Employee ID</label>
                                    <input 
                                        type="text"
                                        name="portal-new-employee-id"
                                        className="form-control" 
                                        placeholder="e.g. EMP123"
                                        autoComplete="off"
                                        value={form.employeeId} 
                                        onChange={e => setForm({ ...form, employeeId: e.target.value })} 
                                    />
                                    {duplicateFields.includes('employeeId') && (
                                        <div className="text-danger" style={{ fontSize: 12, marginTop: 4, fontWeight: 500 }}>
                                            Employee ID already exists in this admin scope.
                                        </div>
                                    )}
                                </div>

                                {/* Email Address */}
                                <div className="form-group">
                                    <label className="form-label">Email Address (Optional)</label>
                                    <input 
                                        type="email"
                                        name="portal-new-email"
                                        className="form-control" 
                                        placeholder="e.g. john@example.com"
                                        autoComplete="new-email"
                                        pattern="^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
                                        title="Please enter a valid email address."
                                        value={form.email} 
                                        onChange={e => setForm({ ...form, email: e.target.value })} 
                                    />
                                    {duplicateFields.includes('email') && (
                                        <div className="text-danger" style={{ fontSize: 12, marginTop: 4, fontWeight: 500 }}>
                                            Email address already exists in this admin scope.
                                        </div>
                                    )}
                                </div>


                                {/* Temporary Password */}
                                <div className="form-group">
                                    <label className="form-label required">Temporary Password</label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            type={showPassword ? "text" : "password"}
                                            name="portal-new-password"
                                            className="form-control"
                                            placeholder="Temporary Password"
                                            autoComplete="new-password"
                                            value={form.password}
                                            onChange={e => setForm({ ...form, password: e.target.value })}
                                            style={{ paddingRight: '40px' }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="btn btn-ghost btn-sm"
                                            style={{
                                                position: 'absolute',
                                                right: 8,
                                                top: '50%',
                                                transform: 'translateY(-50%)',
                                                padding: 0,
                                                border: 'none',
                                                background: 'transparent',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                zIndex: 2
                                            }}
                                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                                        >
                                            {showPassword ? (
                                                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                                    <line x1="1" y1="1" x2="23" y2="23"></line>
                                                </svg>
                                            ) : (
                                                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                                    <circle cx="12" cy="12" r="3"></circle>
                                                </svg>
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Division */}
                                <div className="form-group">
                                    <label className="form-label required">Division</label>
                                    <select className="form-control" value={form.division} onChange={e => setForm({ ...form, division: e.target.value })}>
                                        <option value="">Select division</option>
                                        <option value="SDS2">SDS2</option>
                                        <option value="Tekla">Tekla</option>
                                    </select>
                                </div>

                                {/* Account Role */}
                                <div className="form-group">
                                    <label className="form-label required">Account Role</label>
                                    <select className="form-control" value={form.role} onChange={e => {
                                        setForm({ ...form, role: e.target.value as any, project_manager: '', assistant_project_manager: '', team_lead: '' });
                                    }}>
                                        <option value="">Select role</option>
                                        <option value="superadmin">Super Admin — Full system access</option>
                                        <option value="project_manager">Project Manager — Full system access</option>
                                        <option value="assistant_project_manager">Assistant Project Manager — Full system access</option>
                                        <option value="team_lead">Team Lead — Full system access</option>
                                        <option value="assistant_team_lead">Asst. Team Lead — Full system access</option>
                                        <option value="team_member">Team Member — Editor access (assigned)</option>
                                    </select>
                                </div>

                                {/* Managers Selection */}
                                {(form.role === 'team_member' || form.role === 'team_lead' || form.role === 'assistant_team_lead' || form.role === 'assistant_project_manager') && (
                                    <div className="form-group">
                                        <label className="form-label required">Project Manager</label>
                                        <select className="form-control" value={form.project_manager} onChange={e => setForm({ ...form, project_manager: e.target.value })}>
                                            <option value="">Select Project Manager</option>
                                            {users.filter(u => u.role === 'project_manager').map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
                                        </select>
                                    </div>
                                )}
                                {(form.role === 'team_member' || form.role === 'team_lead' || form.role === 'assistant_team_lead') && (
                                    <div className="form-group">
                                        <label className="form-label">Assistant Project Manager</label>
                                        <select className="form-control" value={form.assistant_project_manager} onChange={e => setForm({ ...form, assistant_project_manager: e.target.value })}>
                                            <option value="">Select Assistant Project Manager</option>
                                            {users.filter(u => u.role === 'assistant_project_manager').map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
                                        </select>
                                    </div>
                                )}
                                {form.role === 'team_member' && (
                                    <div className="form-group">
                                        <label className="form-label required">Team Lead</label>
                                        <div className="form-control" style={{ minHeight: 80, maxHeight: 150, overflowY: 'auto', padding: '8px' }}>
                                            {users.filter(u => u.role === 'team_lead' || u.role === 'assistant_team_lead').map(u => (
                                                <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                                                    <input 
                                                        type="checkbox" 
                                                        style={{ margin: 0, width: 16, height: 16 }}
                                                        checked={form.team_lead.includes(u.id)}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setForm({ ...form, team_lead: [...form.team_lead, u.id] });
                                                            } else {
                                                                setForm({ ...form, team_lead: form.team_lead.filter(id => id !== u.id) });
                                                            }
                                                        }}
                                                    />
                                                    <span>{u.username}</span>
                                                </label>
                                            ))}
                                            {users.filter(u => u.role === 'team_lead' || u.role === 'assistant_team_lead').length === 0 && (
                                                <div style={{ color: '#666', fontStyle: 'italic', fontSize: 13 }}>No Team Leads available</div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="form-actions" style={{ marginTop: 24 }}>
                                    <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</button>
                                    <button type="submit" className="btn btn-primary" disabled={creating || !form.username || !form.employeeId || !form.password}>
                                        {creating ? 'Creating...' : 'Create User Account'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Edit User Modal ── */}
            {editTarget && (
                <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditTarget(null) }}>
                    <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">Edit User — {editTarget.username}</span>
                            <button className="modal-close" onClick={() => setEditTarget(null)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    handleUpdateUser();
                                }}
                                autoComplete="off"
                            >
                                {/* Employee ID */}
                                <div className="form-group">
                                    <label className="form-label required">Employee ID</label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder="e.g. EMP123"
                                        value={editForm.employeeId}
                                        onChange={(e) => setEditForm({ ...editForm, employeeId: e.target.value })}
                                        required
                                    />
                                </div>

                                {/* Account Role */}
                                <div className="form-group">
                                    <label className="form-label required">Account Role</label>
                                    <select
                                        className="form-control"
                                        value={editForm.role === 'user' ? 'team_member' : editForm.role}
                                        onChange={(e) => setEditForm({ ...editForm, role: e.target.value as any })}
                                    >
                                        <option value="team_member">Team Member — Editor access (assigned)</option>
                                        <option value="assistant_team_lead">Asst. Team Lead — Full system access</option>
                                        <option value="team_lead">Team Lead — Full system access</option>
                                        <option value="assistant_project_manager">Assistant Project Manager — Full system access</option>
                                        <option value="project_manager">Project Manager — Full system access</option>
                                        <option value="superadmin">Superadmin — Full system access</option>
                                    </select>
                                </div>

                                {/* Division */}
                                <div className="form-group">
                                    <label className="form-label required">Division</label>
                                    <select className="form-control" value={editForm.division} onChange={e => setEditForm({ ...editForm, division: e.target.value })}>
                                        <option value="">Select division</option>
                                        <option value="SDS2">SDS2</option>
                                        <option value="Tekla">Tekla</option>
                                    </select>
                                </div>

                                {/* Managers Selection */}
                                {(editForm.role === 'team_member' || editForm.role === 'team_lead' || editForm.role === 'assistant_team_lead' || editForm.role === 'assistant_project_manager') && (
                                    <div className="form-group">
                                        <label className="form-label required">Project Manager</label>
                                        <select className="form-control" value={editForm.project_manager} onChange={e => setEditForm({ ...editForm, project_manager: e.target.value })}>
                                            <option value="">Select Project Manager</option>
                                            {users.filter(u => u.role === 'project_manager').map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
                                        </select>
                                    </div>
                                )}
                                {(editForm.role === 'team_member' || editForm.role === 'team_lead' || editForm.role === 'assistant_team_lead') && (
                                    <div className="form-group">
                                        <label className="form-label">Assistant Project Manager</label>
                                        <select className="form-control" value={editForm.assistant_project_manager} onChange={e => setEditForm({ ...editForm, assistant_project_manager: e.target.value })}>
                                            <option value="">Select Assistant Project Manager</option>
                                            {users.filter(u => u.role === 'assistant_project_manager').map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
                                        </select>
                                    </div>
                                )}
                                {editForm.role === 'team_member' && (
                                    <div className="form-group">
                                        <label className="form-label required">Team Lead</label>
                                        <div className="form-control" style={{ minHeight: 80, maxHeight: 150, overflowY: 'auto', padding: '8px' }}>
                                            {users.filter(u => u.role === 'team_lead' || u.role === 'assistant_team_lead').map(u => (
                                                <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                                                    <input 
                                                        type="checkbox" 
                                                        style={{ margin: 0, width: 16, height: 16 }}
                                                        checked={editForm.team_lead.includes(u.id)}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setEditForm({ ...editForm, team_lead: [...editForm.team_lead, u.id] });
                                                            } else {
                                                                setEditForm({ ...editForm, team_lead: editForm.team_lead.filter(id => id !== u.id) });
                                                            }
                                                        }}
                                                    />
                                                    <span>{u.username}</span>
                                                </label>
                                            ))}
                                            {users.filter(u => u.role === 'team_lead' || u.role === 'assistant_team_lead').length === 0 && (
                                                <div style={{ color: '#666', fontStyle: 'italic', fontSize: 13 }}>No Team Leads available</div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Email Address */}
                                <div className="form-group">
                                    <label className="form-label">Email Address (Optional)</label>
                                    <input
                                        type="email"
                                        className="form-control"
                                        value={editForm.email}
                                        onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                                        required
                                    />
                                </div>

                                {/* Display Name */}
                                <div className="form-group">
                                    <label className="form-label">Display Name</label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder="Display Name"
                                        value={editForm.displayName}
                                        onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                                    />
                                </div>

                                {/* New Password (Optional) */}
                                <div className="form-group">
                                    <label className="form-label">New Password (Leave blank to keep unchanged)</label>
                                    <input
                                        type="password"
                                        className="form-control"
                                        placeholder="New Password (optional)"
                                        value={editForm.password || ''}
                                        onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                                    />
                                </div>

                                <div className="form-actions" style={{ marginTop: 24 }}>
                                    <button type="button" className="btn btn-secondary" onClick={() => setEditTarget(null)} disabled={savingEdit}>
                                        Cancel
                                    </button>
                                    <button type="submit" className="btn btn-primary" disabled={savingEdit}>
                                        {savingEdit ? 'Saving...' : 'Save Changes'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}


            {/* ── Assign Project Modal ── */}
            {assignTarget && (
                <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setAssignTarget(null) }}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">Assign Project — {assignTarget.username}</span>
                            <button className="modal-close" onClick={() => setAssignTarget(null)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Filter by Client</label>
                                <select 
                                    className="form-control" 
                                    value={assignClient}
                                    onChange={(e) => {
                                        setAssignClient(e.target.value);
                                        setAssignProject(''); // Reset project when client changes
                                    }}
                                >
                                    <option value="ALL">All Clients</option>
                                    {clients
                                        .map(client => client.name)
                                        .sort()
                                        .map(clientName => (
                                            <option key={clientName} value={clientName}>{clientName}</option>
                                        ))
                                    }
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label required">Select Project</label>
                                <select className="form-control" value={assignProject}
                                    onChange={(e) => setAssignProject(e.target.value)}>
                                    <option value="">— Select a project —</option>
                                    {projects
                                        .filter(p => assignClient === 'ALL' || p.clientName === assignClient)
                                        .map((p) => (
                                            <option key={p.id} value={p.id}>{p.name} ({p.clientName})</option>
                                        ))
                                    }
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
                <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowBulk(false) }}>
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
