import React, { Component, type ErrorInfo, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DateRangePicker } from 'rsuite';
import 'rsuite/DateRangePicker/styles/index.css';
import { useAuth } from '../../context/AuthContext';
import {
    listMailAccounts, deleteMailAccount, setActiveMailAccount,
    redirectToMicrosoftAuth, redirectToZohoAuth,
    triggerSync, listSyncJobs, listEmails, getEmail, forwardEmail,
    listEmployees, getAttachmentUrl, getAutoSyncStatus, triggerAutoSync, clearDownloadedEmails,
    type MailAccount, type MailMessage, type SyncJob, type Employee, type ProjectInfo, type MailAttachment,
} from '../../services/mailApi';
import { FileViewer, type FileViewerFile, prefetchFile, getCachedFile, setCachedFile } from '../../components/file-viewer';
import MailSidebar from '../../components/MailSidebar';

// ── Helpers ─────────────────────────────────────────────────

function formatBytes(b: number) {
    if (!b || isNaN(b)) return '0 B';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(s: string) {
    if (!s) return '';
    try {
        return new Date(s).toLocaleString(undefined, {
            dateStyle: 'medium', timeStyle: 'short',
        });
    } catch { return s; }
}

function formatDateToYMD(d: Date | null | undefined): string {
    if (!d || isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function todayStr() {
    return formatDateToYMD(new Date());
}

function daysAgoStr(days: number) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().substring(0, 10);
}

function initials(name?: string, email?: string): string {
    const n = (name || email || '?').trim();
    if (!n) return '?';
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return n.slice(0, 2).toUpperCase();
}

function normalizeLink(link: any): { url: string; text: string } {
    let url = '';
    let text = '';
    if (typeof link === 'string') {
        url = link.trim();
        text = url;
    } else if (link && typeof link === 'object') {
        url = String(link.url || link.href || '').trim();
        text = String(link.text || link.title || link.url || link.href || '').trim();
    }
    // Filter out mailto:, tel:, and javascript: non-web links
    if (!url || /^mailto:/i.test(url) || /^tel:/i.test(url) || /^javascript:/i.test(url)) {
        return { url: '', text: '' };
    }
    return { url, text: text || url };
}

function normalizeAttachment(att: any): { id: string; filename: string; sizeBytes: number } {
    const id = String(att?.id || att?._id || '');
    const filename = String(att?.filename || att?.name || 'Attachment');
    const sizeBytes = Number(att?.sizeBytes || att?.size || 0);
    return { id, filename, sizeBytes };
}

function getFileIcon(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (['dwg', 'dxf'].includes(ext)) return '📐';
    if (['pdf'].includes(ext)) return '📄';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
    if (['xlsx', 'xls', 'csv'].includes(ext)) return '📊';
    if (['ppt', 'pptx', 'potx', 'ppsx', 'pptm'].includes(ext)) return '📽️';
    if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️';
    if (['doc', 'docx'].includes(ext)) return '📝';
    return '📎';
}

function getDomain(urlString: string): string {
    try {
        const u = new URL(urlString);
        return u.hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

// ── Error Boundary for Email Detail ──────────────────────────

class DetailErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; errorText: string }> {
    state = { hasError: false, errorText: '' };
    static getDerivedStateFromError(error: any) {
        return { hasError: true, errorText: error?.message || 'Error displaying email content' };
    }
    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[DetailErrorBoundary] Render crash caught:', error, info);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 8 }}>Unable to display email</h3>
                    <p style={{ fontSize: 13, color: 'var(--color-danger-mid)', marginBottom: 16 }}>{this.state.errorText}</p>
                    <button className="btn btn-secondary btn-sm" onClick={() => this.setState({ hasError: false, errorText: '' })}>Retry</button>
                </div>
            );
        }
        return this.props.children;
    }
}

// ── Mini Spinner ─────────────────────────────────────────────

function Spinner({ size = 16 }: { size?: number }) {
    return (
        <span style={{
            display: 'inline-block', width: size, height: size,
            border: `2px solid currentColor`, borderTopColor: 'transparent',
            borderRadius: '50%', animation: 'mail-spin 0.7s linear infinite',
            flexShrink: 0,
        }} />
    );
}

// ── Connect Modal ────────────────────────────────────────────

function ConnectModal({ onClose }: { onClose: () => void }) {
    const [email, setEmail] = useState('');
    const [provider, setProvider] = useState<'auto' | 'MICROSOFT' | 'ZOHO'>('auto');

    function handleConnect() {
        const detected = provider === 'auto'
            ? (email.includes('outlook') || email.includes('microsoft') || email.includes('hotmail') || email.includes('live') ? 'MICROSOFT' : 'ZOHO')
            : provider;
        if (detected === 'MICROSOFT') redirectToMicrosoftAuth();
        else redirectToZohoAuth();
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <span className="modal-title">🔗 Connect Mailbox</span>
                    <button className="modal-close" onClick={onClose}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                <div className="modal-body">
                    <div className="form-group">
                        <label className="form-label">Work Email Address</label>
                        <input
                            type="email"
                            className="form-control"
                            placeholder="you@company.com"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Provider</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                            {(['auto', 'MICROSOFT', 'ZOHO'] as const).map(p => (
                                <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, padding: '10px 14px', border: `1.5px solid ${provider === p ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-md)', background: provider === p ? 'var(--color-primary-glow)' : 'var(--color-bg-card)', transition: 'all 0.13s' }}>
                                    <input type="radio" name="provider" value={p} checked={provider === p} onChange={() => setProvider(p)} style={{ accentColor: 'var(--color-primary)' }} />
                                    <span style={{ fontWeight: 600 }}>
                                        {p === 'auto' ? '🔍 Auto-detect from email domain' : p === 'MICROSOFT' ? '🔵 Outlook' : '🟠 Zoho Mail'}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                    <div className="form-actions">
                        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                        <button className="btn btn-primary" onClick={handleConnect}>
                            Proceed to Login →
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Disconnect Modal ─────────────────────────────────────────

function DisconnectModal({
    account, onClose, onConfirm, loading,
}: {
    account: MailAccount; onClose: () => void; onConfirm: () => void; loading: boolean;
}) {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <span className="modal-title">⚠️ Disconnect Mailbox</span>
                    <button className="modal-close" onClick={onClose}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                <div className="modal-body">
                    <div className="info-box warning" style={{ marginBottom: 16 }}>
                        <strong>Disconnecting <em>{account.email}</em> will stop automatic synchronisation for this mailbox.</strong>
                        <br />Emails already synced will remain in the database.
                    </div>
                    <div className="form-actions">
                        <button className="btn btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
                        <button className="btn btn-danger btn-primary" onClick={onConfirm} disabled={loading} style={{ background: 'var(--color-danger-mid)', color: '#fff', borderColor: 'var(--color-danger-mid)' }}>
                            {loading ? <Spinner /> : 'Disconnect'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Forward Modal ────────────────────────────────────────────

function normalizeRole(role?: string): string {
    const r = String(role || '').toLowerCase().trim();
    if (['project_manager', 'pm'].includes(r)) return 'project_manager';
    if (['team_lead', 'tl', 'lead'].includes(r)) return 'team_lead';
    if (['team_member', 'member', 'detailer', 'engineer', 'user', 'employee'].includes(r)) return 'team_member';
    return r || 'team_member';
}

function getRoleLabel(roleKey: string): string {
    switch (roleKey) {
        case 'project_manager':
            return 'Project Manager';
        case 'team_lead':
            return 'Team Lead';
        case 'team_member':
            return 'Team Member / Detailer';
        default:
            return roleKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
}


function ForwardModal({
    email, onClose, onSent,
}: {
    email: MailMessage; onClose: () => void; onSent: () => void;
}) {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [projects, setProjects] = useState<ProjectInfo[]>([]);
    const [teams, setTeams] = useState<any[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
    const [selectedTeamId, setSelectedTeamId] = useState<string>('all');
    const [selectedRole, setSelectedRole] = useState<string>('all');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        setLoading(true);
        listEmployees()
            .then(d => {
                setEmployees(d.employees || []);
                setProjects(d.projects || []);
                setTeams(d.teams || []);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    // Currently active project if one is selected
    const activeProject = selectedProjectId === 'all'
        ? null
        : projects.find(p => (p.id === selectedProjectId || (p as any)._id === selectedProjectId));

    // Filter employees by project and team (strictly PMs, TLs, and team members; excluding admin/superadmin)
    const projectMembers = useMemo(() => {
        return employees.filter(emp => {
            const role = String(emp.role || '').toLowerCase();
            if (role === 'admin' || role === 'superadmin') return false;

            const empId = emp.id || emp._id || '';

            // Filter by team
            if (selectedTeamId !== 'all') {
                const team = teams.find(t => String(t.id) === selectedTeamId);
                if (team) {
                    const isLead = String(team.lead) === empId;
                    const isMember = team.members && team.members.includes(empId);
                    if (!isLead && !isMember) return false;
                }
            }

            // Filter by project
            if (selectedProjectId !== 'all') {
                let inProj = false;
                if (emp.projectIds && emp.projectIds.includes(selectedProjectId)) inProj = true;
                if (activeProject && activeProject.assignedUserIds && activeProject.assignedUserIds.includes(empId)) inProj = true;
                if (!inProj) return false;
            }

            return true;
        });
    }, [employees, selectedProjectId, activeProject, selectedTeamId, teams]);

    // Role counts within the current project
    const roleCounts = useMemo(() => {
        const counts: Record<string, number> = { all: projectMembers.length };
        for (const emp of projectMembers) {
            const r = normalizeRole(emp.role);
            counts[r] = (counts[r] || 0) + 1;
        }
        return counts;
    }, [projectMembers]);

function getRoleIcon(roleKey: string): string {
    switch (roleKey) {
        case 'project_manager':
            return '👑';
        case 'team_lead':
            return '⭐';
        case 'team_member':
            return '👤';
        default:
            return '👥';
    }
}

    // Available role options formatted for dropdown & quick pills
    const availableRoleOptions = useMemo(() => {
        const presentRoles = new Set(projectMembers.map(e => normalizeRole(e.role)));
        const standardOrder = ['project_manager', 'team_lead', 'team_member'];
        const options: Array<{ id: string; label: string; count: number; icon: string }> = [
            { id: 'all', label: 'All Roles', count: projectMembers.length, icon: '👥' }
        ];

        for (const r of standardOrder) {
            if (presentRoles.has(r)) {
                options.push({
                    id: r,
                    label: getRoleLabel(r),
                    count: roleCounts[r] || 0,
                    icon: getRoleIcon(r),
                });
            }
        }

        for (const r of presentRoles) {
            if (!standardOrder.includes(r)) {
                options.push({
                    id: r,
                    label: getRoleLabel(r),
                    count: roleCounts[r] || 0,
                    icon: getRoleIcon(r),
                });
            }
        }

        return options;
    }, [projectMembers, roleCounts]);

    // Filter by role
    const roleFiltered = useMemo(() => {
        if (selectedRole === 'all') return projectMembers;
        return projectMembers.filter(e => normalizeRole(e.role) === selectedRole);
    }, [projectMembers, selectedRole]);

    // Filter by search text
    const filtered = useMemo(() => {
        if (!search) return roleFiltered;
        const s = search.toLowerCase();
        return roleFiltered.filter(e =>
            (e.displayName || '').toLowerCase().includes(s) ||
            (e.username || '').toLowerCase().includes(s) ||
            (e.name || '').toLowerCase().includes(s) ||
            (e.email || '').toLowerCase().includes(s) ||
            (e.role || '').toLowerCase().includes(s)
        );
    }, [roleFiltered, search]);

    const allFilteredSelected = filtered.length > 0 && filtered.every(e => selected.has(e.id || e._id || ''));

    function toggle(id: string) {
        setSelected(prev => {
            const n = new Set(prev);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });
    }

    function toggleSelectAllFiltered() {
        if (allFilteredSelected) {
            // Deselect all visible
            setSelected(prev => {
                const next = new Set(prev);
                for (const e of filtered) {
                    const id = e.id || e._id;
                    if (id) next.delete(id);
                }
                return next;
            });
        } else {
            // Select all visible
            setSelected(prev => {
                const next = new Set(prev);
                for (const e of filtered) {
                    const id = e.id || e._id;
                    if (id) next.add(id);
                }
                return next;
            });
        }
    }

    async function handleForward() {
        if (selected.size === 0) return;
        setSending(true);
        setError('');
        try {
            await forwardEmail(
                email._id,
                Array.from(selected),
                note || undefined,
                activeProject ? activeProject.id : undefined,
                activeProject ? activeProject.name : undefined
            );
            onSent();
        } catch (e: any) {
            setError(e.message || 'Forward failed');
        } finally {
            setSending(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <span className="modal-title">📤 Forward to Detailers & Engineers</span>
                    <button className="modal-close" onClick={onClose}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                <div className="modal-body">
                    {/* Email summary */}
                    <div style={{ background: 'var(--color-table-row-alt)', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 14 }}>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Forwarding message:</div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)' }}>{email.subject || '(No subject)'}</div>
                        <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>From: {email.from?.name || email.from?.email}</div>
                    </div>

                    {/* Project, Team & Role Filter Selectors */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 10, marginBottom: 8 }}>
                        {/* Project Selector */}
                        <div className="form-group" style={{ margin: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                <label className="form-label" style={{ margin: 0, fontWeight: 700, fontSize: 12.5 }}>
                                    Filter by Project
                                </label>
                                {activeProject && (
                                    <span style={{ fontSize: 11, color: 'var(--color-primary)', fontWeight: 600 }}>
                                        {projectMembers.length} member{projectMembers.length !== 1 ? 's' : ''}
                                    </span>
                                )}
                            </div>
                            <select
                                className="form-control"
                                value={selectedProjectId}
                                onChange={e => setSelectedProjectId(e.target.value)}
                                style={{ fontSize: 13, fontWeight: 500 }}
                            >
                                <option value="all">All Projects</option>
                                {projects.map(p => (
                                    <option key={p.id} value={p.id}>
                                        📁 {p.name} {p.clientName ? `(${p.clientName})` : ''} ({p.memberCount || 0})
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Team Selector */}
                        <div className="form-group" style={{ margin: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                <label className="form-label" style={{ margin: 0, fontWeight: 700, fontSize: 12.5 }}>
                                    Filter by Team
                                </label>
                            </div>
                            <select
                                className="form-control"
                                value={selectedTeamId}
                                onChange={e => setSelectedTeamId(e.target.value)}
                                style={{ fontSize: 13, fontWeight: 500 }}
                            >
                                <option value="all">All Teams</option>
                                {teams && teams.map(t => (
                                    <option key={t.id} value={t.id}>
                                        👥 {t.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Role Selector */}
                        <div className="form-group" style={{ margin: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                <label className="form-label" style={{ margin: 0, fontWeight: 700, fontSize: 12.5 }}>
                                    Filter by Role
                                </label>
                                {selectedRole !== 'all' && (
                                    <button
                                        type="button"
                                        className="btn btn-ghost btn-xs"
                                        onClick={() => setSelectedRole('all')}
                                        style={{ fontSize: 11, padding: '0 4px', color: 'var(--color-primary)' }}
                                    >
                                        Reset
                                    </button>
                                )}
                            </div>
                            <select
                                className="form-control"
                                value={selectedRole}
                                onChange={e => setSelectedRole(e.target.value)}
                                style={{ fontSize: 13, fontWeight: 500 }}
                            >
                                {availableRoleOptions.map(opt => (
                                    <option key={opt.id} value={opt.id}>
                                        {opt.label} ({opt.count})
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Quick Role Filter Pills */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 2 }}>
                            Quick Role:
                        </span>
                        {availableRoleOptions.map(opt => {
                            const isActive = selectedRole === opt.id;
                            return (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => setSelectedRole(opt.id)}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 5,
                                        padding: '3px 9px',
                                        borderRadius: 16,
                                        fontSize: 11.5,
                                        fontWeight: isActive ? 700 : 500,
                                        border: `1.5px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                        background: isActive ? 'var(--color-primary-glow)' : 'var(--color-bg-card)',
                                        color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                        cursor: 'pointer',
                                        transition: 'all 0.12s ease',
                                    }}
                                >
                                    <span>{opt.label}</span>
                                    <span style={{
                                        fontSize: 10.5,
                                        background: isActive ? 'var(--color-primary)' : 'var(--color-border-light)',
                                        color: isActive ? '#fff' : 'var(--color-text-muted)',
                                        borderRadius: 10,
                                        padding: '0.5px 5px',
                                        fontWeight: 600,
                                    }}>
                                        {opt.count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Search & Bulk Select Controls */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 160 }}>
                            <input
                                className="form-control"
                                placeholder={
                                    selectedRole !== 'all'
                                        ? `Search ${getRoleLabel(selectedRole)}s…`
                                        : activeProject
                                        ? `Search within ${activeProject.name}…`
                                        : 'Search by name, email or role…'
                                }
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                style={{ fontSize: 13 }}
                            />
                        </div>
                        <button
                            type="button"
                            className={`btn ${allFilteredSelected ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                            onClick={toggleSelectAllFiltered}
                            disabled={filtered.length === 0}
                            style={{ fontSize: 12.5, whiteSpace: 'nowrap', fontWeight: 600 }}
                        >
                            {allFilteredSelected
                                ? `✓ Deselect All (${filtered.length})`
                                : `☑ Select All (${filtered.length})`}
                        </button>
                        {selected.size > 0 && (
                            <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => setSelected(new Set())}
                                style={{ fontSize: 12, color: 'var(--color-danger-mid)', whiteSpace: 'nowrap' }}
                            >
                                Clear ({selected.size})
                            </button>
                        )}
                    </div>

                    {/* Active Selected Recipients Chips Strip */}
                    {selected.size > 0 && (
                        <div style={{ background: 'var(--color-table-row-alt)', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', padding: '8px 12px', marginBottom: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                                    Selected Recipients ({selected.size}):
                                </span>
                                <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>Click ✕ to remove</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 80, overflowY: 'auto' }}>
                                {Array.from(selected).map(id => {
                                    const emp = employees.find(e => (e.id === id || e._id === id));
                                    const label = emp?.displayName || emp?.name || emp?.username || emp?.email || id;
                                    return (
                                        <span
                                            key={id}
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 5,
                                                background: 'var(--color-primary-glow)',
                                                border: '1px solid var(--color-primary)',
                                                borderRadius: 16,
                                                padding: '2px 8px 2px 10px',
                                                fontSize: 12,
                                                color: 'var(--color-primary)',
                                                fontWeight: 600,
                                            }}
                                        >
                                            {label}
                                            <button
                                                type="button"
                                                onClick={() => toggle(id)}
                                                style={{
                                                    border: 'none',
                                                    background: 'none',
                                                    cursor: 'pointer',
                                                    color: 'var(--color-primary)',
                                                    fontSize: 14,
                                                    fontWeight: 700,
                                                    padding: '0 2px',
                                                    lineHeight: 1,
                                                }}
                                                title="Remove recipient"
                                            >
                                                ×
                                            </button>
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Employee list */}
                    <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 14 }}>
                        {loading ? (
                            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}><Spinner size={20} /></div>
                        ) : filtered.length === 0 ? (
                            <div style={{ padding: 28, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                                <div style={{ fontSize: 24, marginBottom: 6 }}>👥</div>
                                {activeProject && selectedRole !== 'all' ? (
                                    <>
                                        <div>No <strong>{getRoleLabel(selectedRole)}s</strong> found assigned to <strong>{activeProject.name}</strong>.</div>
                                        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => setSelectedRole('all')}
                                                style={{ fontSize: 12 }}
                                            >
                                                Show All Roles in {activeProject.name} ({projectMembers.length})
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => { setSelectedProjectId('all'); setSelectedRole('all'); }}
                                                style={{ fontSize: 12 }}
                                            >
                                                Show All Team Members
                                            </button>
                                        </div>
                                    </>
                                ) : selectedRole !== 'all' ? (
                                    <>
                                        <div>No team members found with role <strong>{getRoleLabel(selectedRole)}</strong>.</div>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setSelectedRole('all')}
                                            style={{ marginTop: 10, fontSize: 12 }}
                                        >
                                            Show All Roles ({projectMembers.length})
                                        </button>
                                    </>
                                ) : activeProject ? (
                                    <>
                                        <div>No team members are assigned to <strong>{activeProject.name}</strong> yet.</div>
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setSelectedProjectId('all')}
                                            style={{ marginTop: 10, fontSize: 12 }}
                                        >
                                            Show All Team Members ({employees.length})
                                        </button>
                                    </>
                                ) : (
                                    <div>No team members found matching "{search}"</div>
                                )}
                            </div>
                        ) : filtered.map(emp => {
                            const id = emp.id || emp._id || '';
                            const isChecked = selected.has(id);
                            const roleKey = normalizeRole(emp.role);
                            const isLeadOrPM = ['project_manager', 'team_lead'].includes(roleKey);
                            return (
                                <label
                                    key={id}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                        padding: '9px 14px',
                                        cursor: 'pointer',
                                        background: isChecked ? 'var(--color-primary-glow)' : 'transparent',
                                        borderBottom: '1px solid var(--color-border-light)',
                                        transition: 'background 0.12s'
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggle(id)}
                                        style={{ accentColor: 'var(--color-primary)', width: 16, height: 16, cursor: 'pointer' }}
                                    />
                                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                                        {initials(emp.displayName || emp.name || emp.username, emp.email)}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--color-text-primary)' }}>
                                                {emp.displayName || emp.name || emp.username}
                                            </span>
                                            {emp.projects && emp.projects.length > 0 && selectedProjectId === 'all' && (
                                                <span style={{ fontSize: 11, background: 'var(--color-table-row-alt)', color: 'var(--color-text-muted)', padding: '1px 6px', borderRadius: 4 }}>
                                                    📁 {emp.projects[0].name}{emp.projects.length > 1 ? ` +${emp.projects.length - 1}` : ''}
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{emp.email}</div>
                                    </div>
                                    <span
                                        className={`role-chip ${isLeadOrPM ? 'editor' : 'viewer'}`}
                                        style={{ fontSize: 10.5, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                    >
                                        <span>{emp.role === 'project_manager' ? 'PM' : emp.role === 'team_lead' ? 'Team Lead' : emp.role === 'team_member' ? 'Team Member' : (emp.role || 'Member').replace(/_/g, ' ')}</span>
                                    </span>
                                </label>
                            );
                        })}
                    </div>

                    {/* PM Notes */}
                    <div className="form-group" style={{ marginBottom: 12 }}>
                        <label className="form-label">
                            PM Notes / Drawing Instructions
                        </label>
                        <textarea
                            className="form-control"
                            rows={3}
                            placeholder={activeProject ? `e.g. "Drawings for ${activeProject.name} — please review sequence 1 structural beams"` : 'e.g. "Review structural beam drawing rev 2 — check column grid lines"'}
                            value={note}
                            onChange={e => setNote(e.target.value)}
                        />
                    </div>

                    {error && <div className="info-box warning" style={{ marginBottom: 12 }}>{error}</div>}

                    <div className="form-actions">
                        <button className="btn btn-secondary" onClick={onClose} disabled={sending}>Cancel</button>
                        <button className="btn btn-primary" onClick={handleForward} disabled={selected.size === 0 || sending}>
                            {sending ? <Spinner /> : `Forward to (${selected.size}) Detailer${selected.size !== 1 ? 's' : ''}`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Email Card (list item) ────────────────────────────────────

function EmailCard({
    msg, active, onClick,
}: {
    msg: MailMessage; active: boolean; onClick: () => void;
}) {
    const isSent = (msg as any).folder === 'sent';
    const isSpam = Boolean((msg as any).folder === 'spam' || (msg as any).isSpam);

    const senderName = msg.from?.name || (msg as any).fromName;
    const senderEmail = msg.from?.email || (msg as any).fromAddress || '';
    const sender = senderName || senderEmail || 'Unknown';

    // Extract recipient info for Sent folder view
    const toRecip = (msg as any).to;
    let recipientStr = '';
    if (Array.isArray(toRecip) && toRecip.length > 0) {
        recipientStr = toRecip.map(r => r.name || r.email).filter(Boolean).join(', ');
    } else if (toRecip && typeof toRecip === 'object') {
        recipientStr = toRecip.name || toRecip.email || '';
    } else if ((msg as any).toName || (msg as any).toAddress) {
        recipientStr = (msg as any).toName || (msg as any).toAddress || '';
    }

    const displaySender = isSent && recipientStr ? `To: ${recipientStr}` : sender;
    const avatarInitials = isSent && recipientStr ? initials(recipientStr, '') : initials(senderName, senderEmail);

    const time = msg.receivedAt ? new Date(msg.receivedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
    const validAtts = (msg.attachments || []).filter(att => !(att as any).isInline);
    const attCount = validAtts.length;
    const hasAtt = Boolean(attCount > 0 || (msg.hasAttachments && (!msg.attachments || msg.attachments.length === 0)));
    const validLinks = (msg.links || []).map(normalizeLink).filter(l => Boolean(l.url));
    const linkCount = validLinks.length;
    const snippet = msg.snippetText || msg.bodyText?.slice(0, 100) || '';

    return (
        <div
            onClick={onClick}
            style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '14px 16px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--color-border-light)',
                background: active ? 'var(--color-primary-glow)' : 'var(--color-bg-card)',
                borderLeft: active ? '3px solid var(--color-primary)' : '3px solid transparent',
                transition: 'all 0.12s',
                textAlign: 'left',
            }}
            onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-table-row-hover)'; }}
            onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-card)'; }}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', minWidth: 0 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: isSent ? '#059669' : isSpam ? '#dc2626' : 'var(--color-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>
                    {avatarInitials}
                </div>
                <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4, width: '100%' }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '65%' }}>{displaySender}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize:   11.6, color: 'var(--color-text-muted)', flexShrink: 0 }}>{time}</span>
                            <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', flexShrink: 0 }}>{msg.receivedAt?.slice(0, 10)}</span>
                        </div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1, width: '100%' }}>
                        {msg.subject || '(No subject)'}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', marginTop: 3, lineHeight: 1.4, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                        {snippet}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                        {isSpam && <span style={{ fontSize: 11.5, background: 'var(--color-danger-bg)', color: 'var(--color-danger-mid)', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>⚠️ Spam</span>}
                        {hasAtt && <span style={{ fontSize: 11.5, background: 'var(--color-info-bg)', color: 'var(--color-info-mid)', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>📎 {attCount > 0 ? attCount : 'Attachment'}</span>}
                        {linkCount > 0 && <span style={{ fontSize: 11.5, background: 'var(--color-warning-bg)', color: 'var(--color-warning-mid)', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>🔗 {linkCount}</span>}
                        {(msg.isForwarded || (msg as any).triageStatus === 'FORWARDED') && <span style={{ fontSize: 11.5, background: 'var(--color-success-bg)', color: 'var(--color-success-mid)', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>✓ Forwarded</span>}
                    </div>
                </div>
            </div>
        </div>
    );
}

function linkifyText(text: string): React.ReactNode {
    if (!text) return text;
    const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
    const parts = text.split(urlRegex);
    return parts.map((part, i) => {
        if (part.match(urlRegex)) {
            return (
                <a
                    key={i}
                    href={part}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#1e4fd8', textDecoration: 'underline' }}
                >
                    {part}
                </a>
            );
        }
        return part;
    });
}

// ── Email Detail Panel ────────────────────────────────────────



function EmailDetail({
    email, accounts, onForwardClick, onForwardToTeamsClick, loadingAttachments = false,
}: {
    email: MailMessage;
    accounts: MailAccount[];
    onForwardClick: () => void;
    onForwardToTeamsClick?: () => void;
    loadingAttachments?: boolean;
}) {
    const [copiedLink, setCopiedLink] = useState<string | null>(null);
    const [copiedAllLinks, setCopiedAllLinks] = useState(false);
    const [showAttachments, setShowAttachments] = useState(true);
    const [showLinks, setShowLinks] = useState(false);
    const [linkFilter, setLinkFilter] = useState('');
    const [previewFile, setPreviewFile] = useState<FileViewerFile | null>(null);

    const account = accounts.find(a => a._id === email.accountId);
    const senderName = email.from?.name || (email as any).fromName;
    const senderEmail = email.from?.email || (email as any).fromAddress;
    const senderLabel = senderName && senderEmail ? `${senderName} <${senderEmail}>` : (senderName || senderEmail || 'Unknown');

    const toRecip = (email as any).to;
    let recipientLabel = '';
    if (Array.isArray(toRecip) && toRecip.length > 0) {
        recipientLabel = toRecip.map(r => r.name && r.email && r.name !== r.email ? `${r.name} <${r.email}>` : (r.name || r.email || '')).filter(Boolean).join(', ');
    } else if (toRecip && typeof toRecip === 'object') {
        recipientLabel = toRecip.name && toRecip.email && toRecip.name !== toRecip.email ? `${toRecip.name} <${toRecip.email}>` : (toRecip.name || toRecip.email || '');
    } else if ((email as any).toName || (email as any).toAddress) {
        const toAddr = (email as any).toAddress || '';
        const toN = (email as any).toName || '';
        recipientLabel = toN && toAddr && toN !== toAddr ? `${toN} <${toAddr}>` : (toN || toAddr);
    }

    const isSpam = Boolean((email as any).folder === 'spam' || (email as any).isSpam);
    const isSent = (email as any).folder === 'sent';

    const allAttachments: MailAttachment[] = (email.attachments || []).filter(att => !((att as any).isInline && (att as any).contentId));
    const hasAttachmentsFlag = Boolean(
        email.hasAttachments ||
        (email as any).attachmentCount > 0 ||
        (email as any).attachmentsCount > 0 ||
        allAttachments.length > 0
    );
    const isAttLoading = loadingAttachments && allAttachments.length === 0;

    const preparedHtml = React.useMemo(() => {
        if (!email.bodyHtml) return '';
        const baseHead = `
            <base target="_blank">
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    margin: 16px;
                    color: #1e293b;
                    line-height: 1.5;
                }
                img {
                    max-width: 100%;
                    height: auto;
                }
                /* Hide any unresolvable cid: or ImageDisplay references so broken image icon + machine alt text never appear */
                img[src^="cid:"],
                img[src*="ImageDisplay"] {
                    display: none !important;
                }
                a {
                    color: #1e4fd8;
                }
            </style>
        `;
        let html = email.bodyHtml;
        if (html.includes('<head>')) {
            html = html.replace('<head>', `<head>${baseHead}`);
        } else {
            html = `${baseHead}${html}`;
        }
        // Force all links inside email to open in a new tab safely
        return html.replace(/<a\b([^>]*)>/gi, (_match, attrs) => {
            const cleanAttrs = attrs
                .replace(/\btarget=(['"])[^'"]*\1/gi, '')
                .replace(/\brel=(['"])[^'"]*\1/gi, '')
                .trim();
            return `<a target="_blank" rel="noopener noreferrer" ${cleanAttrs}>`;
        });
    }, [email.bodyHtml]);

    const rawLinks: any[] = email.links || [];
    const validLinks = rawLinks
        .map(normalizeLink)
        .filter(l => Boolean(l.url));

    const filteredLinks = linkFilter.trim()
        ? validLinks.filter(l =>
            l.url.toLowerCase().includes(linkFilter.toLowerCase()) ||
            l.text.toLowerCase().includes(linkFilter.toLowerCase())
        )
        : validLinks;

    const totalAttBytes = allAttachments.reduce((sum, att) => {
        const norm = normalizeAttachment(att);
        return sum + (norm.sizeBytes || 0);
    }, 0);

    const handleCopyLink = (url: string) => {
        navigator.clipboard.writeText(url).catch(() => { });
        setCopiedLink(url);
        setTimeout(() => setCopiedLink(null), 2000);
    };

    const handleCopyAllLinks = () => {
        const urls = validLinks.map(l => l.url).join('\n');
        navigator.clipboard.writeText(urls).catch(() => { });
        setCopiedAllLinks(true);
        setTimeout(() => setCopiedAllLinks(false), 2000);
    };

    const handleDirectDownload = (e: React.MouseEvent, att: MailAttachment) => {
        e.stopPropagation();
        if (!att.id) return;
        const url = getAttachmentUrl(att.id);
        const cached = getCachedFile(url);
        if (cached && cached.blobUrl) {
            e.preventDefault();
            const a = document.createElement('a');
            a.href = cached.blobUrl;
            a.download = att.filename || 'attachment';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '100%', overflow: 'hidden', minHeight: 0 }}>
            {/* Scrollable body */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px' }}>
                {/* Header */}
                <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                            <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-text-primary)', paddingLeft: 10, margin: 0, lineHeight: 1.35, wordBreak: 'break-word' }}>
                                {email.subject || '(No subject)'}
                            </h2>
                            {isSpam && (
                                <span style={{ fontSize: 12, background: 'var(--color-danger-bg)', color: 'var(--color-danger-mid)', padding: '2px 8px', borderRadius: 4, fontWeight: 600, flexShrink: 0 }}>
                                    ⚠️ Spam
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            {onForwardToTeamsClick && (
                                <button className="btn btn-secondary" onClick={onForwardToTeamsClick} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                                    Forward to Teams
                                </button>
                            )}
                            <button className="btn btn-primary" onClick={onForwardClick} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                                Forward to Detailers
                            </button>
                        </div>
                    </div>
                    <div style={{ background: 'var(--color-table-row-alt)', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', padding: '12px 16px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: 13.5 }}>
                            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>From</span>
                            <span>{senderLabel}</span>

                            {recipientLabel && (
                                <>
                                    <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>To</span>
                                    <span>{recipientLabel}</span>
                                </>
                            )}

                            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Received</span>
                            <span>{formatDateTime(email.receivedAt)}</span>
                        </div>
                    </div>
                </div>

                {/* Collapsible Resources Bar (Attachments & Links) */}
                {(hasAttachmentsFlag || allAttachments.length > 0 || validLinks.length > 0 || isAttLoading) && (
                    <div style={{
                        marginBottom: 10,
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-bg-card)',
                        overflow: 'hidden',
                        boxShadow: 'var(--shadow-xs)',
                    }}>
                        {/* Summary / Toggle Bar */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '9px 14px',
                            background: 'var(--color-table-header-bg)',
                            borderBottom: (showAttachments || showLinks) ? '1px solid var(--color-border-light)' : 'none',
                            flexWrap: 'wrap',
                            gap: 10,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{
                                    fontSize: 11.5,
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em',
                                    color: isAttLoading ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                    marginRight: 2,
                                    transition: 'color 0.2s ease',
                                }}>
                                    {isAttLoading ? 'Resources Loading…' : 'Resources:'}
                                </span>

                                {hasAttachmentsFlag && isAttLoading && (
                                    <div
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 7,
                                            padding: '5px 12px',
                                            borderRadius: 'var(--radius-sm)',
                                            border: '1px solid var(--color-border)',
                                            background: 'var(--color-bg-card)',
                                            color: '#000000',
                                            fontSize: 12.5,
                                            fontWeight: 600,
                                            userSelect: 'none',
                                        }}
                                    >
                                        <span style={{
                                            display: 'inline-block',
                                            width: 12,
                                            height: 12,
                                            border: '2px solid var(--color-border-light, #cbd5e1)',
                                            borderTopColor: 'var(--color-primary, #0284c7)',
                                            borderRadius: '50%',
                                            animation: 'mail-spin 0.8s linear infinite',
                                        }} />
                                        <span>Loading attachments...</span>
                                    </div>
                                )}

                                {!isAttLoading && hasAttachmentsFlag && allAttachments.length === 0 && (
                                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                                        No file attachments
                                    </span>
                                )}

                                {!isAttLoading && allAttachments.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setShowAttachments(prev => !prev)}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            padding: '5px 12px',
                                            borderRadius: 'var(--radius-sm)',
                                            border: showAttachments ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                            background: showAttachments ? 'var(--color-primary-glow)' : 'var(--color-bg-card)',
                                            color: showAttachments ? 'var(--color-primary)' : 'var(--color-text-primary)',
                                            fontSize: 12.5,
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease',
                                        }}
                                    >
                                        <span>📎</span>
                                        <span>Attachments</span>
                                        <span style={{
                                            background: showAttachments ? 'var(--color-primary)' : 'rgba(0,0,0,0.08)',
                                            color: showAttachments ? '#fff' : 'var(--color-text-secondary)',
                                            borderRadius: 10,
                                            padding: '1px 6px',
                                            fontSize: 11,
                                            fontWeight: 700
                                        }}>
                                            {allAttachments.length}
                                        </span>
                                        <span style={{ fontSize: 10, opacity: 0.7, transform: showAttachments ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                                            ▼
                                        </span>
                                    </button>
                                )}

                                {validLinks.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setShowLinks(prev => !prev)}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            padding: '5px 12px',
                                            borderRadius: 'var(--radius-sm)',
                                            border: showLinks ? '1px solid #3b82f6' : '1px solid var(--color-border)',
                                            background: showLinks ? 'rgba(59, 130, 246, 0.08)' : 'var(--color-bg-card)',
                                            color: showLinks ? '#2563eb' : 'var(--color-text-primary)',
                                            fontSize: 12.5,
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease',
                                        }}
                                    >
                                        <span>🔗</span>
                                        <span> Links</span>
                                        <span style={{
                                            background: showLinks ? '#2563eb' : 'rgba(0,0,0,0.08)',
                                            color: showLinks ? '#fff' : 'var(--color-text-secondary)',
                                            borderRadius: 10,
                                            padding: '1px 6px',
                                            fontSize: 11,
                                            fontWeight: 700
                                        }}>
                                            {validLinks.length}
                                        </span>
                                        <span style={{ fontSize: 10, opacity: 0.7, transform: showLinks ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                                            ▼
                                        </span>
                                    </button>
                                )}
                            </div>

                            {/* Summary info on the right when collapsed or active */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                                    {[
                                        isAttLoading
                                            ? 'Fetching attachments...'
                                            : allAttachments.length > 0
                                                ? `${allAttachments.length} ${allAttachments.length === 1 ? 'attachment' : 'attachments'}${totalAttBytes > 0 ? ` (${formatBytes(totalAttBytes)})` : ''}`
                                                : null,
                                        validLinks.length > 0 ? `${validLinks.length} link${validLinks.length > 1 ? 's' : ''}` : null,
                                    ].filter(Boolean).join(' • ')}
                                </span>

                            </div>
                        </div>

                        {/* Attachments Drawer */}
                        {showAttachments && allAttachments.length > 0 && (
                            <div style={{
                                padding: '14px 16px',
                                borderBottom: showLinks ? '1px solid var(--color-border-light)' : 'none',
                                background: 'var(--color-bg-card)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                                        Attachments ({allAttachments.length}){totalAttBytes > 0 && <> • <span style={{ fontWeight: 500, color: 'var(--color-text-muted)' }}>{formatBytes(totalAttBytes)}</span></>}
                                    </div>
                                </div>
                                <div style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: 8,
                                    maxHeight: 200,
                                    overflowY: 'auto',
                                    paddingRight: 4,
                                }}>
                                    {allAttachments.map((rawAtt, i) => {
                                        const att = normalizeAttachment(rawAtt);
                                        const icon = getFileIcon(att.filename);
                                        return (
                                            <div
                                                key={att.id || i}
                                                onClick={() => {
                                                    if (att.id) {
                                                        setPreviewFile({
                                                            id: att.id,
                                                            filename: att.filename,
                                                            url: getAttachmentUrl(att.id),
                                                            sizeBytes: att.sizeBytes,
                                                        });
                                                    }
                                                }}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 8,
                                                    padding: '8px 12px',
                                                    border: '1px solid var(--color-border)',
                                                    borderRadius: 'var(--radius-md)',
                                                    background: 'var(--color-table-row-alt)',
                                                    cursor: 'pointer',
                                                    color: 'var(--color-text-primary)',
                                                    fontSize: 12.5,
                                                    transition: 'all 0.12s',
                                                    boxShadow: 'var(--shadow-xs)',
                                                }}
                                                onMouseEnter={e => {
                                                    e.currentTarget.style.borderColor = 'var(--color-primary)';
                                                    if (att.id) prefetchFile(getAttachmentUrl(att.id), att.sizeBytes);
                                                }}
                                                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
                                                title="Click to preview in File Viewer"
                                            >
                                                <span style={{ fontSize: 18 }}>{icon}</span>
                                                <div>
                                                    <div style={{ fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {att.filename}
                                                    </div>
                                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                                        {formatBytes(att.sizeBytes)} • <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Preview</span>
                                                    </div>
                                                </div>
                                                {att.id && (
                                                    <a
                                                        href={`${getAttachmentUrl(att.id)}&download=1`}
                                                        download={att.filename}
                                                        onClick={e => handleDirectDownload(e, att)}
                                                        title="Download file directly"
                                                        style={{
                                                            marginLeft: 6,
                                                            color: 'var(--color-text-muted)',
                                                            padding: '3px 6px',
                                                            borderRadius: 4,
                                                            fontSize: 14,
                                                            fontWeight: 700,
                                                            textDecoration: 'none',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            transition: 'color 0.15s ease',
                                                        }}
                                                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--color-primary)'; }}
                                                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'; }}
                                                    >
                                                        ↓
                                                    </a>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Reference Links Drawer */}
                        {showLinks && validLinks.length > 0 && (
                            <div style={{
                                padding: '14px 16px',
                                background: 'var(--color-table-row-alt)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-info)' }}>
                                        🔗 Extracted Links ({validLinks.length})
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        {validLinks.length > 5 && (
                                            <input
                                                type="text"
                                                placeholder="Filter links..."
                                                value={linkFilter}
                                                onChange={e => setLinkFilter(e.target.value)}
                                                style={{
                                                    padding: '3px 8px',
                                                    fontSize: 12,
                                                    borderRadius: 'var(--radius-sm)',
                                                    border: '1px solid var(--color-border)',
                                                    background: 'var(--color-bg-card)',
                                                    color: 'var(--color-text-primary)',
                                                    outline: 'none',
                                                    width: 140,
                                                }}
                                            />
                                        )}
                                        <button
                                            type="button"
                                            onClick={handleCopyAllLinks}
                                            className="btn btn-secondary btn-sm"
                                            style={{ fontSize: 11.5, padding: '2px 8px' }}
                                        >
                                            {copiedAllLinks ? '✓ All Copied' : 'Copy All Links'}
                                        </button>
                                    </div>
                                </div>

                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 6,
                                    maxHeight: 220,
                                    overflowY: 'auto',
                                    paddingRight: 4,
                                }}>
                                    {filteredLinks.length === 0 ? (
                                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>
                                            No links matching "{linkFilter}"
                                        </div>
                                    ) : (
                                        filteredLinks.map((l, i) => {
                                            const domain = getDomain(l.url);
                                            const isCopied = copiedLink === l.url;
                                            return (
                                                <div
                                                    key={i}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 8,
                                                        padding: '6px 10px',
                                                        borderRadius: 'var(--radius-sm)',
                                                        background: 'var(--color-bg-card)',
                                                        border: '1px solid var(--color-border-light)',
                                                    }}
                                                >
                                                    {domain && (
                                                        <span style={{
                                                            fontSize: 10.5,
                                                            padding: '1px 6px',
                                                            borderRadius: 3,
                                                            background: 'rgba(59, 130, 246, 0.08)',
                                                            color: '#2563eb',
                                                            fontWeight: 600,
                                                            flexShrink: 0,
                                                        }}>
                                                            {domain}
                                                        </span>
                                                    )}
                                                    <a
                                                        href={l.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{
                                                            fontSize: 12,
                                                            color: 'var(--color-text-primary)',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            whiteSpace: 'nowrap',
                                                            flex: 1,
                                                            textDecoration: 'none',
                                                        }}
                                                        title={l.url}
                                                        onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                                                        onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                                                    >
                                                        {l.text !== l.url ? (
                                                            <span>
                                                                <strong style={{ marginRight: 6 }}>{l.text}</strong>
                                                                <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>({l.url})</span>
                                                            </span>
                                                        ) : (
                                                            l.url
                                                        )}
                                                    </a>
                                                    <a
                                                        href={l.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{
                                                            padding: '2px 6px',
                                                            fontSize: 11,
                                                            color: 'var(--color-primary)',
                                                            textDecoration: 'none',
                                                            fontWeight: 600,
                                                            flexShrink: 0,
                                                        }}
                                                        title="Open in new tab"
                                                    >
                                                        ↗ Open
                                                    </a>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyLink(l.url)}
                                                        style={{
                                                            border: 'none',
                                                            background: isCopied ? 'var(--color-primary-glow)' : 'transparent',
                                                            cursor: 'pointer',
                                                            color: isCopied ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                                            fontSize: 11,
                                                            padding: '2px 6px',
                                                            borderRadius: 3,
                                                            flexShrink: 0,
                                                            fontWeight: 600,
                                                        }}
                                                    >
                                                        {isCopied ? '✓ Copied' : 'Copy'}
                                                    </button>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Email Body (HTML rendering as-is) */}
                <div style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    background: '#ffffff',
                    overflow: 'hidden',
                    boxShadow: 'var(--shadow-xs)',
                }}>
                    {!email.bodyHtml && loadingAttachments && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'var(--color-bg-subtle, #f8fafc)', borderBottom: '1px solid var(--color-border)', fontSize: 12.5, color: 'var(--color-text-muted)' }}>
                            <Spinner size={12} /> Loading full email content...
                        </div>
                    )}
                    {email.bodyHtml ? (
                        <iframe
                            srcDoc={preparedHtml}
                            style={{
                                width: '100%',
                                minHeight: 600,
                                border: 'none',
                                display: 'block',
                                background: '#ffffff',
                            }}
                            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                            title="Email body"
                        />
                    ) : (
                        <pre style={{
                            padding: 20,
                            fontSize: 13.5,
                            color: 'var(--color-text-secondary)',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontFamily: 'var(--font-mono)',
                            lineHeight: 1.6,
                            minHeight: 250,
                            margin: 0,
                        }}>
                            {linkifyText(email.bodyText || email.snippetText || '(No content)')}
                        </pre>
                    )}
                </div>
            </div>

            {/* Microsoft 365 File Viewer Modal */}
            <FileViewer file={previewFile} onClose={() => setPreviewFile(null)} />
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────

// LocalStorage key for persisting last used mailbox
const LAST_USED_PROVIDER_KEY = 'mailRouter_lastUsedProvider';

// ── Forward to Teams Modal ────────────────────────────────────────────

function ForwardToTeamsModal({
    email, onClose, onSent,
}: {
    email: MailMessage; onClose: () => void; onSent: () => void;
}) {
    const [teams, setTeams] = useState<any[]>([]);
    const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        setLoading(true);
        listEmployees()
            .then(d => {
                setTeams(d.teams || []);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const toggleTeam = (id: string) => {
        const next = new Set(selectedTeams);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedTeams(next);
    };

    const handleSend = async () => {
        if (selectedTeams.size === 0) {
            setError('Please select at least one team.');
            return;
        }

        const selectedMembers = new Set<string>();
        for (const tid of Array.from(selectedTeams)) {
            const team = teams.find(t => String(t.id) === tid);
            if (team) {
                if (team.lead) selectedMembers.add(String(team.lead));
                if (team.members) {
                    team.members.forEach((m: any) => selectedMembers.add(String(m)));
                }
            }
        }

        if (selectedMembers.size === 0) {
            setError('The selected teams have no members.');
            return;
        }

        try {
            setSending(true);
            setError('');
            await forwardEmail(
                (email._id || email.id) as string,
                Array.from(selectedMembers),
                note,
                undefined,
                undefined
            );
            onSent();
        } catch (e: any) {
            setError(e.message || 'Forward failed');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <span className="modal-title">📤 Forward to Teams</span>
                    <button className="modal-close" onClick={onClose}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                <div className="modal-body">
                    <div style={{ background: 'var(--color-table-row-alt)', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 14 }}>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Forwarding message:</div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)' }}>{email.subject || '(No subject)'}</div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Select Teams</label>
                        {loading ? (
                            <div style={{ padding: 20, textAlign: 'center' }}><Spinner /></div>
                        ) : (
                            <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
                                {teams.length === 0 ? (
                                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)' }}>No teams available</div>
                                ) : (
                                    teams.map(t => (
                                        <div key={t.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-light)', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => toggleTeam(String(t.id))}>
                                            <input 
                                                type="checkbox" 
                                                checked={selectedTeams.has(String(t.id))}
                                                readOnly
                                                style={{ width: 16, height: 16, cursor: 'pointer' }}
                                            />
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontWeight: 600 }}>{t.name}</div>
                                                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                                    {((t.members?.length || 0) + (t.lead ? 1 : 0))} member{((t.members?.length || 0) + (t.lead ? 1 : 0)) !== 1 ? 's' : ''}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>

                    <div className="form-group" style={{ marginTop: 14 }}>
                        <label className="form-label">Notes / Instructions</label>
                        <textarea 
                            className="form-control" 
                            rows={3} 
                            placeholder="Optional notes for the team..."
                            value={note}
                            onChange={e => setNote(e.target.value)}
                        />
                    </div>

                    {error && (
                        <div className="info-box warning" style={{ marginTop: 14 }}>
                            {error}
                        </div>
                    )}
                </div>
                <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                    <button className="btn btn-secondary" onClick={onClose} disabled={sending}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleSend} disabled={sending || selectedTeams.size === 0}>
                        {sending ? <Spinner /> : 'Forward Email'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Custom Folder Types ───────────────────────────────────────
type CustomFolder = { id: string; name: string; emailIds: string[] };
const CUSTOM_FOLDERS_KEY = 'mailRouter_customFolders';

function loadCustomFolders(): CustomFolder[] {
    try { return JSON.parse(localStorage.getItem(CUSTOM_FOLDERS_KEY) || '[]'); }
    catch { return []; }
}
function saveCustomFolders(folders: CustomFolder[]) {
    localStorage.setItem(CUSTOM_FOLDERS_KEY, JSON.stringify(folders));
}

export default function MailRouterPage() {
    const { user } = useAuth();
    const [accounts, setAccounts] = useState<MailAccount[]>([]);
    const [emails, setEmails] = useState<MailMessage[]>([]);
    const [syncJobs, setSyncJobs] = useState<SyncJob[]>([]);
    const [activeTab, setActiveTab] = useState<'ZOHO' | 'MICROSOFT'>(() => {
        const saved = localStorage.getItem(LAST_USED_PROVIDER_KEY);
        if (saved === 'ZOHO' || saved === 'MICROSOFT') return saved;
        return 'MICROSOFT';
    });
    const [selectedEmail, setSelectedEmail] = useState<MailMessage | null>(null);
    // Active sidebar folder — 'inbox' is the default view (all emails)
    const [activeFolder, setActiveFolder] = useState<string>('inbox');

    // ── Custom folders ──────────────────────────────────────────
    const [customFolders, setCustomFolders] = useState<CustomFolder[]>(loadCustomFolders);
    const [showCreateFolder, setShowCreateFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
    const [folderDropSuccess, setFolderDropSuccess] = useState<string | null>(null);
    const activeCustomFolder = customFolders.find(f => f.id === activeFolder) || null;
    const [search, setSearch] = useState('');
    // Single unified date range — both dates must be selected before a fetch fires
    const today = new Date();
    const [dateRange, setDateRange] = useState<[Date, Date]>([today, today]);
    // Derived string helpers used by fetchEmails / handleSync
    const startDate = (dateRange && dateRange[0] && !isNaN(dateRange[0].getTime()))
        ? formatDateToYMD(dateRange[0])
        : todayStr();
    const endDate   = (dateRange && dateRange[1] && !isNaN(dateRange[1].getTime()))
        ? formatDateToYMD(dateRange[1])
        : todayStr();

    const [totalEmails, setTotalEmails] = useState<number>(0);
    const [hasMore, setHasMore] = useState<boolean>(false);
    const [loadingMore, setLoadingMore] = useState<boolean>(false);
    const loadingMoreRef = useRef(false);

    const lastFetchedKeyRef = useRef<string | null>(null);
    const inFlightFetchRef = useRef<string | null>(null);
    const syncInProgressRef = useRef<boolean>(false);
    const emailDetailCacheRef = useRef<Map<string, MailMessage>>(new Map());

    const [loadingAccounts, setLoadingAccounts] = useState(true);
    const [loadingEmails, setLoadingEmails] = useState(false);
    const [syncing, setSyncing] = useState(false);

    const [showConnect, setShowConnect] = useState(false);
    const [showDisconnect, setShowDisconnect] = useState<MailAccount | null>(null);
    const [disconnecting, setDisconnecting] = useState(false);
    const [showForward, setShowForward] = useState<MailMessage | null>(null);
    const [showForwardToTeams, setShowForwardToTeams] = useState<MailMessage | null>(null);

    const [searchParams, setSearchParams] = useSearchParams();
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [autoSyncInfo, setAutoSyncInfo] = useState<{
        enabled: boolean;
        cronExpression?: string;
        intervalDescription?: string;
        lastRunAt?: string;
        lastRunStatus?: string;
        isCycleRunning?: boolean;
    } | null>(null);

    const currentTabRef = useRef<'ZOHO' | 'MICROSOFT'>(activeTab);
    const currentFolderRef = useRef<string>(activeFolder);
    const [foldersRefreshKey, setFoldersRefreshKey] = useState<number>(0);
    const latestRequestIdRef = useRef<number>(0);
    const lastRunAtRef = useRef<string | undefined>(undefined);

    // Keep currentTabRef and currentFolderRef in sync with state
    useEffect(() => {
        currentTabRef.current = activeTab;
    }, [activeTab]);

    useEffect(() => {
        currentFolderRef.current = activeFolder;
    }, [activeFolder]);

    // DateRangePicker fires onChange only when the user has picked both dates.
    // This replaces the old draft→committed two-step flow cleanly.
    const handleDateRangeChange = (range: [Date, Date] | null) => {
        if (!range) return;
        setError('');
        setDateRange(range);
    };

    // Fetch lightweight email list with deduplication and progressive limit (50 emails per page)
    const fetchEmails = useCallback(async (force = false) => {
        const targetTab = currentTabRef.current;
        const targetFolder = currentFolderRef.current;
        const isSpam = targetFolder === 'spam';
        const isHistory = targetFolder === 'history';
        const isDrafts = targetFolder === 'drafts' || targetFolder === 'draft';
        const isOutbox = targetFolder === 'outbox';
        const isNoDateFilter = isSpam || isHistory || isDrafts || isOutbox;
        const queryKey = isNoDateFilter ? `${targetTab}_${targetFolder}` : `${targetTab}_${targetFolder}_${startDate}_${endDate}`;

        if (!force && lastFetchedKeyRef.current === queryKey) {
            return;
        }
        if (inFlightFetchRef.current === queryKey) {
            return;
        }

        inFlightFetchRef.current = queryKey;
        const reqId = ++latestRequestIdRef.current;
        setLoadingEmails(true);

        try {
            const d = await listEmails({
                startDate: isNoDateFilter ? undefined : startDate,
                endDate: isNoDateFilter ? undefined : endDate,
                provider: targetTab,
                folder: targetFolder,
                limit: 50,
                offset: 0,
            });

            if (reqId !== latestRequestIdRef.current || currentTabRef.current !== targetTab || currentFolderRef.current !== targetFolder) {
                return;
            }

            const list = (d.emails || []).filter(e => !e.provider || e.provider === targetTab);
            setEmails(list);
            const total = d.total ?? list.length;
            setTotalEmails(total);
            setHasMore(Boolean(d.hasMore ?? (total > list.length)));
            lastFetchedKeyRef.current = queryKey;

            setSelectedEmail(prev => {
                if (!prev) return list[0] || null;
                const found = list.find(e => e._id === prev._id);
                if (found) {
                    return prev.bodyHtml ? prev : found;
                }
                return list[0] || null;
            });
        } catch (err: any) {
            console.error('Failed to fetch emails:', err);
        } finally {
            if (inFlightFetchRef.current === queryKey) {
                inFlightFetchRef.current = null;
            }
            if (reqId === latestRequestIdRef.current) {
                setLoadingEmails(false);
            }
        }
    }, [startDate, endDate, activeFolder]);

    // Progressive pagination: load next 50 emails
    const loadMoreEmails = useCallback(async () => {
        if (loadingMoreRef.current || !hasMore) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
        try {
            const targetTab = currentTabRef.current;
            const targetFolder = currentFolderRef.current;
            const isSpam = targetFolder === 'spam';
            const isHistory = targetFolder === 'history';
            const isDrafts = targetFolder === 'drafts' || targetFolder === 'draft';
            const isOutbox = targetFolder === 'outbox';
            const isNoDateFilter = isSpam || isHistory || isDrafts || isOutbox;
            const currentCount = emails.length;
            const d = await listEmails({
                startDate: isNoDateFilter ? undefined : startDate,
                endDate: isNoDateFilter ? undefined : endDate,
                provider: targetTab,
                folder: targetFolder,
                limit: 50,
                offset: currentCount,
            });
            const moreList = (d.emails || []).filter(e => !e.provider || e.provider === targetTab);
            setEmails(prev => {
                const existingIds = new Set(prev.map(e => e._id));
                const novel = moreList.filter(e => !existingIds.has(e._id));
                const nextList = [...prev, ...novel];
                const total = d.total ?? (prev.length + moreList.length);
                setTotalEmails(total);
                setHasMore(Boolean(d.hasMore ?? (total > nextList.length)));
                return nextList;
            });
        } catch (err) {
            console.error('Failed to load more emails:', err);
        } finally {
            loadingMoreRef.current = false;
            setLoadingMore(false);
        }
    }, [hasMore, emails.length, startDate, endDate, activeFolder]);

    // Autosync status polling: avoids duplicate fetches and does not interfere with active manual sync
    const refreshAutoSyncStatus = useCallback(async () => {
        try {
            const d = await getAutoSyncStatus();
            setAutoSyncInfo(d);
            if (
                d?.lastRunAt &&
                lastRunAtRef.current &&
                d.lastRunAt !== lastRunAtRef.current &&
                !syncInProgressRef.current &&
                !syncing
            ) {
                const targetTab = currentTabRef.current;
                const ranForCurrent =
                    !d.lastRunResults ||
                    d.lastRunResults.length === 0 ||
                    d.lastRunResults.some((r: any) => r.provider === targetTab);
                if (ranForCurrent) {
                    fetchEmails(true);
                }
            }
            lastRunAtRef.current = d?.lastRunAt;
        } catch { /* ignore */ }
    }, [syncing, fetchEmails]);

    useEffect(() => {
        refreshAutoSyncStatus();
        const interval = setInterval(refreshAutoSyncStatus, 15000);
        return () => clearInterval(interval);
    }, [refreshAutoSyncStatus]);

    const fetchAccounts = useCallback(async () => {
        setLoadingAccounts(true);
        try {
            const d = await listMailAccounts();
            const list = d.accounts || [];
            setAccounts(list);

            const savedProvider = localStorage.getItem(LAST_USED_PROVIDER_KEY) as 'ZOHO' | 'MICROSOFT' | null;
            const currentTab = currentTabRef.current;
            const currentTabHasAccount = list.some(a => a.provider === currentTab);
            const otherConnected = list.find(a => a.provider !== currentTab);
            const activeAcc = list.find(a => a.isActive);

            let chosenProvider: 'MICROSOFT' | 'ZOHO' = currentTab;

            if (savedProvider && list.some(a => a.provider === savedProvider)) {
                chosenProvider = savedProvider;
            } else if (!currentTabHasAccount && otherConnected) {
                chosenProvider = otherConnected.provider;
            } else if (!savedProvider && activeAcc) {
                chosenProvider = activeAcc.provider;
            }

            if (chosenProvider !== currentTabRef.current) {
                currentTabRef.current = chosenProvider;
                setActiveTab(chosenProvider);
            }
            localStorage.setItem(LAST_USED_PROVIDER_KEY, chosenProvider);

            // Ensure server active mailbox matches currently chosen mailbox for autosync
            const target = list.find(a => a.provider === chosenProvider);
            if (target && !target.isActive) {
                setActiveMailAccount(target._id || chosenProvider).catch(() => {});
                setAccounts(prev => prev.map(a => ({
                    ...a,
                    isActive: a.provider === chosenProvider,
                })));
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoadingAccounts(false);
        }
    }, []);

    const fetchSyncJobs = useCallback(async () => {
        try {
            const d = await listSyncJobs();
            setSyncJobs(d.jobs || []);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        fetchAccounts();
        fetchSyncJobs();
    }, [fetchAccounts, fetchSyncJobs]);

    const handleSelectFolder = useCallback((folderId: string) => {
        // Custom folders are local-only — just set the active folder, no server fetch needed
        const isCustomFolder = folderId.startsWith('cf_');
        if (folderId === activeFolder) {
            if (!isCustomFolder) {
                lastFetchedKeyRef.current = null;
                inFlightFetchRef.current = null;
                fetchEmails(true);
                setFoldersRefreshKey(k => k + 1);
            }
            return;
        }
        currentFolderRef.current = folderId;
        if (!isCustomFolder) {
            latestRequestIdRef.current++;
            lastFetchedKeyRef.current = null;
            inFlightFetchRef.current = null;
            setEmails([]);
            setHasMore(false);
            setTotalEmails(0);
            setFoldersRefreshKey(k => k + 1);
        }
        setActiveFolder(folderId);
        setSelectedEmail(null);
    }, [activeFolder, fetchEmails]);

    useEffect(() => {
        fetchEmails(true);
    }, [activeTab, activeFolder, fetchEmails]);

    useEffect(() => {
        const connected = searchParams.get('connected');
        const providerParam = searchParams.get('provider') as 'MICROSOFT' | 'ZOHO' | null;
        const err = searchParams.get('error');
        if (connected === '1') {
            setSuccessMsg('Mailbox connected successfully!');
            if (providerParam === 'MICROSOFT' || providerParam === 'ZOHO') {
                currentTabRef.current = providerParam;
                setActiveTab(providerParam);
                if (providerParam === 'MICROSOFT' && currentFolderRef.current === 'outbox') {
                    currentFolderRef.current = 'inbox';
                    setActiveFolder('inbox');
                }
                localStorage.setItem(LAST_USED_PROVIDER_KEY, providerParam);
            }
            fetchAccounts();
            const next = new URLSearchParams(searchParams);
            next.delete('connected');
            next.delete('provider');
            setSearchParams(next, { replace: true });
        }
        if (err) {
            setError(decodeURIComponent(err));
            const next = new URLSearchParams(searchParams);
            next.delete('error');
            setSearchParams(next, { replace: true });
        }
    }, [searchParams, setSearchParams, fetchAccounts]);

    const handleSelectProvider = useCallback(async (provider: 'MICROSOFT' | 'ZOHO') => {
        if (provider === currentTabRef.current) return;
        currentTabRef.current = provider;
        latestRequestIdRef.current++;
        lastFetchedKeyRef.current = null;
        inFlightFetchRef.current = null;
        setActiveTab(provider);
        if (provider === 'MICROSOFT' && currentFolderRef.current === 'outbox') {
            currentFolderRef.current = 'inbox';
            setActiveFolder('inbox');
        }
        setEmails([]);
        setSelectedEmail(null);
        setHasMore(false);
        setTotalEmails(0);
        localStorage.setItem(LAST_USED_PROVIDER_KEY, provider);
        const targetAcc = accounts.find(a => a.provider === provider);
        if (targetAcc) {
            try {
                await setActiveMailAccount(targetAcc._id || provider);
                setAccounts(prev => prev.map(a => ({
                    ...a,
                    isActive: a.provider === provider,
                })));
            } catch (e: any) {
                console.error('Failed to update active mailbox on server:', e);
            }
        }
    }, [accounts]);

    const activeAccount = accounts.find(a => a.provider === activeTab);

    // 15 seconds cooldown after sync to prevent rapid API hammering
    const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
    const cooldownRef = useRef(0);

    useEffect(() => {
        if (cooldownRemaining <= 0) return;
        const timer = setInterval(() => {
            setCooldownRemaining(prev => {
                const next = Math.max(0, prev - 1);
                cooldownRef.current = next;
                return next;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [cooldownRemaining]);

    const handleSync = useCallback(async (customStart?: string, customEnd?: string) => {
        if (syncInProgressRef.current || syncing) return;
        if (cooldownRef.current > 0 && !customStart) return;

        const s = customStart || startDate;
        const e = customEnd || endDate;

        if (!s || !e || s > e) {
            setError('Please select a valid date range before syncing (From date must be on or before To date).');
            return;
        }

        const currentMailbox = accounts.find(a => a.provider === activeTab);
        if (activeFolder === 'history') {
            await fetchEmails(true);
            setFoldersRefreshKey(k => k + 1);
            return;
        }

        if (!currentMailbox) {
            setError(`Please connect your ${activeTab === 'MICROSOFT' ? 'Outlook' : 'Zoho Mail'} mailbox first.`);
            return;
        }

        syncInProgressRef.current = true;
        setSyncing(true);
        setError('');

        try {
            // Keep active range aligned with synced range
            if (s !== startDate || e !== endDate) {
                const sDate = new Date(s + 'T00:00:00');
                const eDate = new Date(e + 'T00:00:00');
                if (!isNaN(sDate.getTime()) && !isNaN(eDate.getTime())) {
                    setDateRange([sDate, eDate]);
                }
            }
            const accountId = currentMailbox._id;
            const isNoDateFolder = activeFolder === 'spam' || activeFolder === 'drafts' || activeFolder === 'draft' || activeFolder === 'outbox';
            await triggerSync({
                accountId,
                startDate: isNoDateFolder ? undefined : s,
                endDate: isNoDateFolder ? undefined : e,
                folder: activeFolder,
            });
            await fetchEmails(true);
            await fetchSyncJobs();
            setFoldersRefreshKey(k => k + 1);
        } catch (e: any) {
            setError(e.message || 'Sync failed');
        } finally {
            syncInProgressRef.current = false;
            setSyncing(false);
            setCooldownRemaining(15);
            cooldownRef.current = 15;
        }
    }, [accounts, activeTab, startDate, endDate, syncing, fetchEmails, fetchSyncJobs, activeFolder]);

    async function handleDisconnect() {
        if (!showDisconnect) return;
        setDisconnecting(true);
        try {
            await deleteMailAccount(showDisconnect._id);
            const remaining = accounts.filter(a => a._id !== showDisconnect._id);
            if (showDisconnect.provider === activeTab) {
                const nextProvider = remaining[0]?.provider || (activeTab === 'MICROSOFT' ? 'ZOHO' : 'MICROSOFT');
                setActiveTab(nextProvider);
                localStorage.setItem(LAST_USED_PROVIDER_KEY, nextProvider);
            }
            setShowDisconnect(null);
            await fetchAccounts();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setDisconnecting(false);
        }
    }

    const latestJob = syncJobs[0];

    // Filter emails by active provider, folder, and search query
    const filteredEmails = emails
        .filter(e => !e.provider || e.provider === activeTab)
        .filter(e => {
            // Custom folder: filter by emailIds stored in the folder
            if (activeCustomFolder) {
                return activeCustomFolder.emailIds.includes(String(e._id || e.id || ''));
            }
            if (activeFolder === 'sent') {
                return (e as any).folder === 'sent';
            }
            if (activeFolder === 'spam') {
                return Boolean((e as any).folder === 'spam' || (e as any).isSpam);
            }
            if (activeFolder === 'drafts' || activeFolder === 'draft') {
                return (e as any).folder === 'drafts' || (e as any).folder === 'draft';
            }
            if (activeFolder === 'outbox') {
                return (e as any).folder === 'outbox';
            }
            if (activeFolder === 'history') {
                return Boolean((e as any).isForwarded || (e as any).triageStatus === 'FORWARDED');
            }
            if (activeFolder !== 'inbox') {
                return (e as any).folder === activeFolder;
            }
            // 'inbox' or default: show inbox (or non-spam & non-sent & non-draft & non-outbox & non-custom)
            return (
                (e as any).folder !== 'spam' &&
                (e as any).folder !== 'sent' &&
                (e as any).folder !== 'drafts' &&
                (e as any).folder !== 'draft' &&
                (e as any).folder !== 'outbox' &&
                !(e as any).isSpam &&
                ((e as any).folder === 'inbox' || !(e as any).folder)
            );
        })
        .filter(e => {
            if (!search) return true;
            const s = search.toLowerCase();
            return (
                (e.from?.email || '').toLowerCase().includes(s) ||
                (e.from?.name || '').toLowerCase().includes(s) ||
                ((e as any).toAddress || (e as any).to?.email || '').toLowerCase().includes(s) ||
                ((e as any).toName || (e as any).to?.name || '').toLowerCase().includes(s) ||
                (e.subject || '').toLowerCase().includes(s) ||
                (e.snippetText || '').toLowerCase().includes(s) ||
                (e.bodyText || '').toLowerCase().includes(s)
            );
        });



    const [loadingAttachments, setLoadingAttachments] = useState(false);
    // Track which email IDs we've already resolved attachments for so we never re-spin
    const resolvedEmailIdsRef = useRef<Set<string>>(new Set());

    // Load full details & attachments on demand whenever an email is selected
    useEffect(() => {
        const id = selectedEmail?._id || selectedEmail?.id;
        if (!id) {
            setLoadingAttachments(false);
            return;
        }

        const hasAtt = Boolean(
            selectedEmail.hasAttachments ||
            (selectedEmail as any).attachmentCount > 0 ||
            (selectedEmail as any).attachmentsCount > 0 ||
            (selectedEmail.attachments && selectedEmail.attachments.length > 0)
        );

        // Check if we already have the fully hydrated version in memory cache with attachments resolved
        const cached = emailDetailCacheRef.current.get(String(id));
        if (cached && cached.bodyHtml && (!hasAtt || (cached.attachments && cached.attachments.length > 0))) {
            setSelectedEmail(cached);
            setLoadingAttachments(false);
            return;
        }

        // If this email already has full bodyHtml and attachments are resolved, no need to refetch
        if (selectedEmail.bodyHtml && resolvedEmailIdsRef.current.has(String(id))) {
            setLoadingAttachments(false);
            return;
        }

        setLoadingAttachments(hasAtt && (!selectedEmail.attachments || selectedEmail.attachments.length === 0));

        let active = true;
        getEmail(id)
            .then(data => {
                if (!active) return;
                resolvedEmailIdsRef.current.add(String(id));
                if (!data?.email) return;
                const fullEmail: MailMessage = {
                    ...selectedEmail,
                    ...data.email,
                    attachments: data.attachments || (data.email as any)?.attachments || selectedEmail.attachments || [],
                };
                emailDetailCacheRef.current.set(String(id), fullEmail);
                setSelectedEmail(prev => {
                    if (!prev) return null;
                    const prevId = prev._id || prev.id;
                    if (prevId !== id) return prev;
                    return fullEmail;
                });
            })
            .catch(() => {
                if (active) resolvedEmailIdsRef.current.add(String(id));
            })
            .finally(() => {
                if (active) setLoadingAttachments(false);
            });

        return () => {
            active = false;
        };
    }, [selectedEmail?._id, selectedEmail?.id]);

    return (
        <>
            <style>{`
                @keyframes mail-spin { to { transform: rotate(360deg); } }

                /* ── rsuite DateRangePicker — design system integration ── */
                /* Trigger button sizing & border to match app form controls  */
                .rs-picker-daterange .rs-picker-toggle {
                    height: 32px !important;
                    padding: 0 10px !important;
                    font-size: 13px !important;
                    border-radius: var(--radius-md) !important;
                    border: 1.5px solid var(--color-border) !important;
                    background: var(--color-bg-card) !important;
                    color: var(--color-text-primary) !important;
                    transition: border-color 0.13s ease, box-shadow 0.13s ease !important;
                    display: flex !important;
                    align-items: center !important;
                }
                .rs-picker-daterange .rs-picker-toggle:hover,
                .rs-picker-daterange.rs-picker-focused .rs-picker-toggle {
                    border-color: var(--color-primary) !important;
                    box-shadow: 0 0 0 2px var(--color-primary-glow) !important;
                }
                .rs-picker-daterange .rs-picker-toggle-value {
                    color: var(--color-text-primary) !important;
                    font-weight: 500 !important;
                }
                .rs-picker-daterange .rs-picker-toggle-caret,
                .rs-picker-daterange .rs-picker-toggle-clean {
                    color: var(--color-text-muted) !important;
                    top: 50% !important;
                    transform: translateY(-50%) !important;
                }
                /* Dropdown panel */
                .rs-picker-daterange-panel,
                .rs-picker-popup {
                    border: 1px solid var(--color-border) !important;
                    border-radius: var(--radius-lg) !important;
                    box-shadow: var(--shadow-lg) !important;
                    background: var(--color-bg-card) !important;
                    font-family: var(--font-family) !important;
                    font-size: 13px !important;
                }
                /* Calendar header */
                .rs-calendar-header-title,
                .rs-calendar-header-title:hover {
                    color: var(--color-text-primary) !important;
                    font-weight: 700 !important;
                }
                .rs-calendar-header-backward,
                .rs-calendar-header-forward {
                    color: var(--color-text-muted) !important;
                }
                /* Today highlight */
                .rs-calendar-table-cell-is-today .rs-calendar-table-cell-content {
                    border: 1.5px solid var(--color-primary) !important;
                }
                /* Selected range */
                .rs-calendar-table-cell-selected .rs-calendar-table-cell-content {
                    background: var(--color-primary) !important;
                    color: #fff !important;
                    border-radius: var(--radius-md) !important;
                }
                .rs-calendar-table-cell-in-range::before {
                    background: var(--color-primary-glow) !important;
                }
                /* Toolbar OK button */
                .rs-picker-toolbar .rs-btn-primary {
                    background: var(--color-primary) !important;
                    border-color: var(--color-primary) !important;
                    color: #fff !important;
                    border-radius: var(--radius-md) !important;
                    font-size: 12.5px !important;
                    font-weight: 600 !important;
                }
                .rs-picker-toolbar .rs-btn-primary:hover {
                    background: var(--color-primary-dark) !important;
                }
            `}</style>

            {/* Modals */}
            {showConnect && <ConnectModal onClose={() => setShowConnect(false)} />}
            {showDisconnect && (
                <DisconnectModal
                    account={showDisconnect}
                    onClose={() => setShowDisconnect(null)}
                    onConfirm={handleDisconnect}
                    loading={disconnecting}
                />
            )}
            {showForward && (
                <ForwardModal
                    email={showForward}
                    onClose={() => setShowForward(null)}
                    onSent={() => {
                        setShowForward(null);
                        setEmails(prev => prev.map(e => e._id === showForward._id ? { ...e, isForwarded: true } : e));
                    }}
                />
            )}
            {showForwardToTeams && (
                <ForwardToTeamsModal
                    email={showForwardToTeams}
                    onClose={() => setShowForwardToTeams(null)}
                    onSent={() => {
                        setShowForwardToTeams(null);
                        setEmails(prev => prev.map(e => e._id === showForwardToTeams._id ? { ...e, isForwarded: true } : e));
                    }}
                />
            )}

            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '100%', overflow: 'hidden', flex: 1 }}>
                {/* ── Page Header (Sticky/Pinned at top) ──── */}
                <div style={{ padding: '16px 24px 10px 24px', flexShrink: 0, borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-page)' }}>
                    <div className="page-header" style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                        <div className="page-header-left">
                            <h1 className="page-title" style={{ fontSize: 22 }}>Mail Router</h1>
                            <p className="page-subtitle" style={{ fontSize: 13 }}>Connect mailboxes, sync emails, and forward instructions to detailers</p>
                        </div>
                        {/* Provider tabs */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {(['MICROSOFT', 'ZOHO'] as const).map((provider, idx) => {
                                const acc = accounts.find(a => a.provider === provider);
                                const isCurrentTab = activeTab === provider;
                                return (
                                    <React.Fragment key={provider}>
                                        {idx > 0 && <span style={{ color: 'var(--color-border)', fontSize: 18, fontWeight: 300, margin: '0 2px' }}>|</span>}
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                padding: '6px 14px',
                                                borderRadius: 'var(--radius-md)',
                                                border: `1.5px solid ${isCurrentTab ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                                background: isCurrentTab ? 'var(--color-primary-glow)' : 'var(--color-bg-card)',
                                                cursor: 'pointer',
                                                transition: 'all 0.13s ease',
                                                boxShadow: isCurrentTab ? '0 0 0 1px var(--color-primary-glow)' : 'var(--shadow-xs)',
                                                userSelect: 'none',
                                            }}
                                            onClick={() => handleSelectProvider(provider)}
                                        >
                                            <span style={{ fontSize: 15 }}>{provider === 'MICROSOFT' ? '🔵' : '🟠'}</span>
                                            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-text-primary)' }}>
                                                {provider === 'MICROSOFT' ? 'Outlook' : 'Zoho Mail'}
                                            </span>
                                            {acc ? (
                                                isCurrentTab && (
                                                    <>
                                                        <span style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 5,
                                                            fontSize: 12,
                                                            background: 'var(--color-success-bg)',
                                                            color: 'var(--color-success)',
                                                            padding: '2px 8px',
                                                            borderRadius: 20,
                                                            fontWeight: 600,
                                                        }}>
                                                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-success-mid)', display: 'inline-block' }} />
                                                            {acc.email}
                                                        </span>
                                                        <button
                                                            className="btn btn-danger btn-sm"
                                                            style={{ marginLeft: 4, fontSize: 11.5, padding: '2px 8px' }}
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                setShowDisconnect(acc);
                                                            }}
                                                        >
                                                            Disconnect
                                                        </button>
                                                    </>
                                                )
                                            ) : (
                                                <button
                                                    className="btn btn-primary btn-sm"
                                                    style={{ marginLeft: 4, fontSize: 11.5, padding: '2px 10px' }}
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        if (provider === 'MICROSOFT') redirectToMicrosoftAuth();
                                                        else redirectToZohoAuth();
                                                    }}
                                                >
                                                    Connect
                                                </button>
                                            )}
                                        </div>
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    </div>

                    {successMsg && (
                        <div className="info-box success mb-sm" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px', fontSize: 13 }}>
                            <span>✓ {successMsg}</span>
                            <button className="btn btn-xs btn-ghost" onClick={() => setSuccessMsg('')} style={{ padding: '0 6px' }}>✕</button>
                        </div>
                    )}
                    {error && (
                        <div className="info-box warning mb-sm" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px', fontSize: 13 }}>
                            <span>⚠️ {error}</span>
                            <button className="btn btn-xs btn-ghost" onClick={() => setError('')} style={{ padding: '0 6px' }}>✕</button>
                        </div>
                    )}

                    {/* Controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {/* rsuite DateRangePicker — replaces the old two separate date inputs */}
                        <button className="btn btn-secondary" onClick={() => fetchEmails(true)} disabled={loadingEmails} title="Refresh">
                            {loadingEmails ? <Spinner size={13} /> : '↻'}
                        </button> 
                        <DateRangePicker
                            value={dateRange}
                            onChange={handleDateRangeChange}
                            format="dd MMM yyyy"
                            character=" – "
                            showOneCalendar
                            cleanable={false}
                            placeholder="Select date range"
                            size="sm"
                            style={{ width: 240, height: 30 }}
                        />
                        {activeFolder === 'history' ? (
                            <button
                                className="btn btn-secondary"
                                onClick={() => fetchEmails(true)}
                                disabled={loadingEmails}
                                title="History emails are indexed directly from your local database"
                                style={{
                                    textAlign: "center",
                                    fontSize: 13,
                                    minWidth: 125,
                                    cursor: loadingEmails ? 'not-allowed' : 'pointer',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {loadingEmails ? <><Spinner size={14} /> Refreshing…</> : '↻ Refresh History'}
                            </button>
                        ) : (
                            <button
                                className="btn btn-primary"
                                onClick={() => handleSync()}
                                disabled={syncing || cooldownRemaining > 0}
                                style={{
                                    textAlign: "center",
                                    fontSize: 13,
                                    minWidth: 115,
                                    opacity: (syncing || cooldownRemaining > 0) ? 0.5 : 1,
                                    cursor: (syncing || cooldownRemaining > 0) ? 'not-allowed' : 'pointer',
                                    transition: 'opacity 0.2s ease, background-color 0.2s ease',
                                }}
                            >
                                {syncing ? (
                                    <><Spinner size={14} /> Syncing {activeFolder}…</>
                                ) : cooldownRemaining > 0 ? (
                                    `Sync (${cooldownRemaining}s)`
                                ) : (
                                    `Sync ${activeFolder.charAt(0).toUpperCase() + activeFolder.slice(1)}`
                                )}
                            </button>
                        )}
                        <div className="search-input-wrapper" style={{ flex: 1, minWidth: 180 }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                            <input className="form-control" placeholder="Search sender, subject, snippet…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, fontSize: 13 }} />
                        </div>

                        <button
                            className="btn btn-danger btn-l"
                            title="Clear downloaded emails from database (leaves user accounts and mailbox connections intact)"
                            style={{ color: 'var(--color-text-muted)', fontSize: 12 }}
                            onClick={async () => {
                                if (window.confirm('Clear all downloaded emails from the database? User accounts and mailbox connections will remain intact.')) {
                                    try {
                                        await clearDownloadedEmails();
                                        emailDetailCacheRef.current.clear();
                                        resolvedEmailIdsRef.current.clear();
                                        lastFetchedKeyRef.current = null;
                                        await fetchEmails(true);
                                        await fetchSyncJobs();
                                        setSuccessMsg('Downloaded emails cleared successfully.');
                                        setFoldersRefreshKey(k => k + 1);
                                    } catch (err: any) {
                                        setError(err.message || 'Failed to clear emails');
                                    }
                                }
                            }}
                        >
                            🗑️ Clear Mails
                        </button>
                    </div>
                </div>

                {/* ── Master-detail (Fills remaining height, scrolls independently) ── */}
                {/*
                 * OVERLAY SIDEBAR LAYOUT:
                 * The outer wrapper is position:relative.
                 * MailSidebar's inner panel is position:absolute so it expands
                 * over the content on hover WITHOUT pushing anything to the right.
                 * The sidebar root only consumes 48px of layout width when collapsed.
                 */}
                <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', position: 'relative' }}>
                    {/* Gmail-style hover sidebar */}
                    <MailSidebar
                        activeFolder={activeFolder}
                        onFolderSelect={handleSelectFolder}
                        refreshTrigger={foldersRefreshKey}
                        provider={activeTab}
                    />
                    {/* Left: email list (independent vertical scroll) */}
                    <div
                        style={{
                            width: 380,
                            flexShrink: 0,
                            height: '100%',
                            minHeight: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'stretch',
                            justifyContent: 'flex-start',
                            borderRight: '1px solid var(--color-border)',
                            overflowY: 'auto',
                            background: 'var(--color-bg-card)',
                        }}
                        onScroll={e => {
                            const el = e.currentTarget;
                            if (hasMore && !loadingMore && el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
                                loadMoreEmails();
                            }
                        }}
                    >
                        {/* ── Custom Folders Panel ── */}
                        <div style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-page)', flexShrink: 0 }}>
                            {/* Header row */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px 6px 12px' }}>
                                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)' }}>
                                    📁 My Folders
                                </span>
                                <button
                                    type="button"
                                    title="Create new folder"
                                    onClick={() => { setShowCreateFolder(v => !v); setNewFolderName(''); }}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                        fontSize: 11.5, fontWeight: 600, padding: '3px 10px',
                                        borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--color-primary)',
                                        background: 'var(--color-primary-glow)', color: 'var(--color-primary)',
                                        cursor: 'pointer',
                                    }}
                                >
                                    {showCreateFolder ? '✕ Cancel' : '+ New Folder'}
                                </button>
                            </div>

                            {/* Create folder input */}
                            {showCreateFolder && (
                                <div style={{ padding: '4px 12px 8px 12px', display: 'flex', gap: 6 }}>
                                    <input
                                        autoFocus
                                        type="text"
                                        className="form-control"
                                        placeholder="Folder name…"
                                        value={newFolderName}
                                        onChange={e => setNewFolderName(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && newFolderName.trim()) {
                                                const folder: CustomFolder = {
                                                    id: `cf_${Date.now()}`,
                                                    name: newFolderName.trim(),
                                                    emailIds: [],
                                                };
                                                const updated = [...customFolders, folder];
                                                setCustomFolders(updated);
                                                saveCustomFolders(updated);
                                                setNewFolderName('');
                                                setShowCreateFolder(false);
                                            }
                                        }}
                                        style={{ fontSize: 12.5, flex: 1 }}
                                    />
                                    <button
                                        type="button"
                                        className="btn btn-primary btn-sm"
                                        disabled={!newFolderName.trim()}
                                        onClick={() => {
                                            if (!newFolderName.trim()) return;
                                            const folder: CustomFolder = {
                                                id: `cf_${Date.now()}`,
                                                name: newFolderName.trim(),
                                                emailIds: [],
                                            };
                                            const updated = [...customFolders, folder];
                                            setCustomFolders(updated);
                                            saveCustomFolders(updated);
                                            setNewFolderName('');
                                            setShowCreateFolder(false);
                                        }}
                                    >
                                        Create
                                    </button>
                                </div>
                            )}

                            {/* Folder list — droppable targets */}
                            {customFolders.length > 0 ? (
                                <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                                    {customFolders.map(folder => {
                                        const isActive = activeFolder === folder.id;
                                        const isDragOver = dragOverFolderId === folder.id;
                                        const wasJustDropped = folderDropSuccess === folder.id;
                                        return (
                                            <div
                                                key={folder.id}
                                                onDragOver={e => { e.preventDefault(); setDragOverFolderId(folder.id); }}
                                                onDragLeave={() => setDragOverFolderId(null)}
                                                onDrop={e => {
                                                    e.preventDefault();
                                                    setDragOverFolderId(null);
                                                    const emailId = e.dataTransfer.getData('emailId');
                                                    if (!emailId) return;
                                                    const updated = customFolders.map(f =>
                                                        f.id === folder.id
                                                            ? { ...f, emailIds: Array.from(new Set([...f.emailIds, emailId])) }
                                                            : f
                                                    );
                                                    setCustomFolders(updated);
                                                    saveCustomFolders(updated);
                                                    setFolderDropSuccess(folder.id);
                                                    setTimeout(() => setFolderDropSuccess(null), 1500);
                                                }}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 8,
                                                    padding: '7px 12px',
                                                    cursor: 'pointer',
                                                    background: wasJustDropped
                                                        ? 'var(--color-success-bg)'
                                                        : isDragOver
                                                        ? 'var(--color-primary-glow)'
                                                        : isActive
                                                        ? 'var(--color-primary-glow)'
                                                        : 'transparent',
                                                    borderLeft: `3px solid ${
                                                        wasJustDropped ? 'var(--color-success-mid)'
                                                        : isActive ? 'var(--color-primary)'
                                                        : 'transparent'
                                                    }`,
                                                    borderBottom: '1px solid var(--color-border-light)',
                                                    transition: 'background 0.12s',
                                                    outline: isDragOver ? '1.5px dashed var(--color-primary)' : 'none',
                                                    userSelect: 'none',
                                                }}
                                                onClick={() => handleSelectFolder(folder.id)}
                                            >
                                                <span style={{ fontSize: 13 }}>📁</span>
                                                <span style={{ flex: 1, fontSize: 12.5, fontWeight: isActive ? 700 : 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {folder.name}
                                                </span>
                                                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', background: 'var(--color-table-row-alt)', borderRadius: 10, padding: '1px 6px', flexShrink: 0 }}>
                                                    {folder.emailIds.length}
                                                </span>
                                                {wasJustDropped && (
                                                    <span style={{ fontSize: 11, color: 'var(--color-success-mid)', fontWeight: 700, flexShrink: 0 }}>✓ Added</span>
                                                )}
                                                <button
                                                    type="button"
                                                    title="Delete folder"
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        if (!window.confirm(`Delete folder "${folder.name}"?`)) return;
                                                        const updated = customFolders.filter(f => f.id !== folder.id);
                                                        setCustomFolders(updated);
                                                        saveCustomFolders(updated);
                                                        if (activeFolder === folder.id) handleSelectFolder('inbox');
                                                    }}
                                                    style={{
                                                        border: 'none', background: 'transparent',
                                                        color: 'var(--color-text-muted)', cursor: 'pointer',
                                                        fontSize: 13, padding: '0 2px', borderRadius: 4,
                                                        flexShrink: 0, lineHeight: 1,
                                                    }}
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        );
                                    })}
                                    {/* Drag hint */}
                                    <div style={{ padding: '5px 12px 6px', fontSize: 10.5, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                        Drag &amp; drop an email onto a folder to organise it
                                    </div>
                                </div>
                            ) : (
                                <div style={{ padding: '4px 12px 8px 12px', fontSize: 11.5, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                    No folders yet — create one above, then drag emails into it
                                </div>
                            )}
                        </div>
                        {loadingEmails ? (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--color-text-muted)' }}>
                                <Spinner size={24} />
                            </div>
                        ) : filteredEmails.length === 0 ? (
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>
                                {activeFolder === 'sent' ? (
                                    <>
                                        No sent emails in this date window<br />
                                        <span style={{ fontSize: 12.5, marginTop: 4 }}>Click <strong>Sync Sent</strong> to fetch latest outgoing mails</span>
                                    </>
                                ) : activeFolder === 'spam' ? (
                                    <>
                                        No spam emails found<br />
                                        <span style={{ fontSize: 12.5, marginTop: 4 }}>Mails flagged as junk by your provider or present in the Spam/Junk folder will appear here.</span>
                                    </>
                                ) : activeFolder === 'history' ? (
                                    <>
                                        No forwarded emails found in history<br />
                                        <span style={{ fontSize: 12.5, marginTop: 4 }}>Emails forwarded to detailers will appear here.</span>
                                    </>
                                ) : activeFolder === 'drafts' ? (
                                    <>
                                        No drafts found<br />
                                        <span style={{ fontSize: 12.5, marginTop: 4 }}>Click <strong>Sync Drafts</strong> to fetch latest draft messages</span>
                                    </>
                                ) : activeFolder === 'outbox' ? (
                                    <>
                                        No outbox messages<br />
                                        <span style={{ fontSize: 12.5, marginTop: 4 }}>Click <strong>Sync Outbox</strong> to check pending outgoing mails</span>
                                    </>
                                ) : activeFolder !== 'inbox' ? (
                                    <>
                                        No emails found in this folder<br />
                                        <span style={{ fontSize: 12.5, marginTop: 4 }}>Click <strong>Sync {activeFolder.charAt(0).toUpperCase() + activeFolder.slice(1)}</strong> to fetch latest mails</span>
                                    </>
                                ) : (
                                    <>
                                        No emails in this date window<br />
                                        <span style={{ fontSize: 12.5, marginTop: 4 }}>Click <strong>Sync Inbox</strong> to fetch latest mails</span>
                                    </>
                                )}
                            </div>
                        ) : (
                            <>
                                {/* Custom folder email filter notice */}
                                {activeCustomFolder && (
                                    <div style={{ padding: '7px 14px', background: 'var(--color-primary-glow)', borderBottom: '1px solid var(--color-border-light)', fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span>📁 {activeCustomFolder.name}</span>
                                        <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 2 }}>— {activeCustomFolder.emailIds.length} email{activeCustomFolder.emailIds.length !== 1 ? 's' : ''}</span>
                                        <button type="button" onClick={() => handleSelectFolder('inbox')} style={{ marginLeft: 'auto', fontSize: 11, border: 'none', background: 'transparent', color: 'var(--color-primary)', cursor: 'pointer', fontWeight: 700 }}>← Back to Inbox</button>
                                    </div>
                                )}
                                {filteredEmails.map(msg => (
                                    <div
                                        key={msg._id}
                                        msg={msg}
                                        active={selectedEmail?._id === msg._id}
                                        onClick={() => {
                                            const cached = emailDetailCacheRef.current.get(String(msg._id));
                                            setSelectedEmail(cached || msg);
                                        }}
                                    />
                                ))}
                                {hasMore && (
                                    <div style={{ padding: '12px 16px', textAlign: 'center', borderTop: '1px solid var(--color-border)' }}>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            style={{ width: '100%', fontSize: 12.5 }}
                                            onClick={loadMoreEmails}
                                            disabled={loadingMore}
                                        >
                                            {loadingMore ? <><Spinner size={12} /> Loading more…</> : `Load more emails (${emails.length} of ${totalEmails})`}
                                        </button>
                                    </div>
                                )}
                                {!hasMore && emails.length > 50 && (
                                    <div style={{ padding: '10px 16px', textAlign: 'center', fontSize: 12, color: 'var(--color-text-muted)' }}>
                                        All {emails.length} emails loaded
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Right: email detail (independent vertical scroll) */}
                    <div style={{ flex: 1, minWidth: 0, height: '100%', minHeight: 0, overflow: 'hidden', background: 'var(--color-bg-page)', display: 'flex', flexDirection: 'column' }}>
                        {selectedEmail ? (
                            <DetailErrorBoundary>
                                <EmailDetail
                                    key={selectedEmail._id || selectedEmail.id}
                                    email={selectedEmail}
                                    accounts={accounts}
                                    onForwardClick={() => setShowForward(selectedEmail)}
                                    onForwardToTeamsClick={() => setShowForwardToTeams(selectedEmail)}
                                    loadingAttachments={loadingAttachments}
                                />
                            </DetailErrorBoundary>
                        ) : (
                            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                                <p style={{ fontSize: 14, fontWeight: 500 }}>Select an email from the left to view details and triage</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
