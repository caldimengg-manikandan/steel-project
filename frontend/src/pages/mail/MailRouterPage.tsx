import React, { Component, type ErrorInfo, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
    listMailAccounts, deleteMailAccount,
    redirectToMicrosoftAuth, redirectToZohoAuth,
    triggerSync, listSyncJobs, listEmails, getEmail, forwardEmail,
    listEmployees, getAttachmentUrl,
    type MailAccount, type MailMessage, type SyncJob, type Employee,
} from '../../services/mailApi';

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

function todayStr() {
    return new Date().toISOString().substring(0, 10);
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
    if (typeof link === 'string') {
        const u = link.trim();
        return { url: u, text: u };
    }
    if (link && typeof link === 'object') {
        const url = String(link.url || link.href || '').trim();
        const text = String(link.text || link.title || link.url || link.href || '').trim();
        return { url, text: text || url };
    }
    return { url: '', text: '' };
}

function normalizeAttachment(att: any): { id: string; filename: string; sizeBytes: number } {
    const id = String(att?.id || att?._id || '');
    const filename = String(att?.filename || att?.name || 'Attachment');
    const sizeBytes = Number(att?.sizeBytes || att?.size || 0);
    return { id, filename, sizeBytes };
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
                    <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
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
                                        {p === 'auto' ? '🔍 Auto-detect from email domain' : p === 'MICROSOFT' ? '🔵 Microsoft 365 / Outlook' : '🟠 Zoho Mail'}
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

function ForwardModal({
    email, onClose, onSent,
}: {
    email: MailMessage; onClose: () => void; onSent: () => void;
}) {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        setLoading(true);
        listEmployees()
            .then(d => setEmployees(d.employees || []))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const filtered = employees.filter(e =>
        `${e.username} ${e.email} ${e.role}`.toLowerCase().includes(search.toLowerCase())
    );

    function toggle(id: string) {
        setSelected(prev => {
            const n = new Set(prev);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });
    }

    async function handleForward() {
        if (selected.size === 0) return;
        setSending(true);
        setError('');
        try {
            await forwardEmail(email._id, Array.from(selected), note || undefined);
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
                    <span className="modal-title">📤 Forward to Detailers</span>
                    <button className="modal-close" onClick={onClose}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                <div className="modal-body">
                    {/* Email summary */}
                    <div style={{ background: 'var(--color-table-row-alt)', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 16 }}>
                        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Forwarding:</div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{email.subject || '(No subject)'}</div>
                        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>From: {email.from?.name || email.from?.email}</div>
                    </div>

                    {/* Search employees */}
                    <div className="form-group">
                        <label className="form-label">Select Team Members</label>
                        <input
                            className="form-control"
                            placeholder="Search by name, email or role..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>

                    {/* Select All / Clear */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set(filtered.map(e => e.id || e._id || '')))}>Select All</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
                    </div>

                    {/* Employee list */}
                    <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 16 }}>
                        {loading ? (
                            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}><Spinner size={20} /></div>
                        ) : filtered.length === 0 ? (
                            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>No team members found</div>
                        ) : filtered.map(emp => {
                            const id = emp.id || emp._id || '';
                            const isChecked = selected.has(id);
                            return (
                                <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', background: isChecked ? 'var(--color-primary-glow)' : 'transparent', borderBottom: '1px solid var(--color-border-light)', transition: 'background 0.12s' }}>
                                    <input type="checkbox" checked={isChecked} onChange={() => toggle(id)} style={{ accentColor: 'var(--color-primary)' }} />
                                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                                        {initials(emp.displayName || emp.username, emp.email)}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{emp.displayName || emp.username}</div>
                                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{emp.email}</div>
                                    </div>
                                    <span className="role-chip viewer" style={{ fontSize: 10.5, padding: '2px 7px' }}>{emp.role}</span>
                                </label>
                            );
                        })}
                    </div>

                    {/* PM Notes */}
                    <div className="form-group">
                        <label className="form-label">PM Notes / Drawing Instructions</label>
                        <textarea
                            className="form-control"
                            rows={3}
                            placeholder='e.g. "Review structural beam drawing rev 2 — check column grid lines"'
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
    const senderName = msg.from?.name || (msg as any).fromName;
    const senderEmail = msg.from?.email || (msg as any).fromAddress || '';
    const sender = senderName || senderEmail || 'Unknown';
    const time = msg.receivedAt ? new Date(msg.receivedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
    const attCount = msg.attachments?.length || 0;
    const hasAtt = Boolean(msg.hasAttachments || attCount > 0);
    const linkCount = msg.links?.length || 0;
    const snippet = msg.snippetText || msg.bodyText?.slice(0, 100) || '';

    return (
        <div
            onClick={onClick}
            style={{
                padding: '14px 16px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--color-border-light)',
                background: active ? 'var(--color-primary-glow)' : 'var(--color-bg-card)',
                borderLeft: active ? '3px solid var(--color-primary)' : '3px solid transparent',
                transition: 'all 0.12s',
            }}
            onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-table-row-hover)'; }}
            onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-card)'; }}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--color-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>
                    {initials(senderName, senderEmail)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '65%' }}>{sender}</span>
                        <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', flexShrink: 0 }}>{time}</span>
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
                        {msg.subject || '(No subject)'}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', marginTop: 3, lineHeight: 1.4 }}>
                        {snippet}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                        {hasAtt && <span style={{ fontSize: 11.5, background: 'var(--color-info-bg)', color: 'var(--color-info-mid)', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>📎 {attCount > 0 ? attCount : 'Attachment'}</span>}
                        {linkCount > 0 && <span style={{ fontSize: 11.5, background: 'var(--color-warning-bg)', color: 'var(--color-warning-mid)', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>🔗 {linkCount}</span>}
                        {msg.isForwarded && <span style={{ fontSize: 11.5, background: 'var(--color-success-bg)', color: 'var(--color-success-mid)', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>✓ Forwarded</span>}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Email Detail Panel ────────────────────────────────────────

function EmailDetail({
    email, accounts, onForwardClick,
}: {
    email: MailMessage; accounts: MailAccount[]; onForwardClick: () => void;
}) {
    const [viewMode, setViewMode] = useState<'html' | 'text'>('html');
    const account = accounts.find(a => a._id === email.accountId);
    const senderName = email.from?.name || (email as any).fromName;
    const senderEmail = email.from?.email || (email as any).fromAddress;
    const senderLabel = senderName && senderEmail ? `${senderName} <${senderEmail}>` : (senderName || senderEmail || 'Unknown');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '100%', overflow: 'hidden', minHeight: 0 }}>
            {/* Action bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--color-border-light)', background: 'var(--color-table-header-bg)', flexShrink: 0 }}>
                <button className="btn btn-primary" onClick={onForwardClick}>
                    📤 Forward to Detailers
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(window.location.href).catch(() => {})}>
                    🔗 Copy Link
                </button>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 0, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                    {(['html', 'text'] as const).map(m => (
                        <button key={m} onClick={() => setViewMode(m)} style={{ padding: '5px 12px', fontSize: 12.5, border: 'none', background: viewMode === m ? 'var(--color-primary)' : 'var(--color-bg-card)', color: viewMode === m ? '#fff' : 'var(--color-text-secondary)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, transition: 'all 0.12s' }}>
                            {m === 'html' ? 'HTML' : 'Plain'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px' }}>
                {/* Header */}
                <div style={{ marginBottom: 20 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-text-primary)', marginBottom: 12, lineHeight: 1.3 }}>
                        {email.subject || '(No subject)'}
                    </h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: 13.5 }}>
                        <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>From</span>
                        <span>{senderLabel}</span>
                        {account && <>
                            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Mailbox</span>
                            <span>{account.email} <span style={{ fontSize: 11, background: account.provider === 'MICROSOFT' ? '#dbeafe' : '#fef3c7', color: account.provider === 'MICROSOFT' ? '#1d4ed8' : '#92400e', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>{account.provider}</span></span>
                        </>}
                        <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Received</span>
                        <span>{formatDateTime(email.receivedAt)}</span>
                    </div>
                </div>

                {/* Links box */}
                {email.links && email.links.length > 0 && (
                    <div style={{ background: 'var(--color-info-bg)', border: '1px solid #93c5fd', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 16 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-info)', marginBottom: 8 }}>🔗 Extracted Links ({email.links.length})</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {email.links.map((rawLink, i) => {
                                const { url, text } = normalizeLink(rawLink);
                                if (!url) return null;
                                return (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: 'var(--color-info-mid)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={url}>
                                            {text || url}
                                        </a>
                                        <button
                                            type="button"
                                            onClick={() => navigator.clipboard.writeText(url).catch(() => {})}
                                            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-info-mid)', fontSize: 12, padding: '2px 6px', borderRadius: 3, flexShrink: 0 }}
                                        >
                                            Copy
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Attachments */}
                {email.attachments && email.attachments.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 10 }}>📎 Attachments ({email.attachments.length})</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {email.attachments.map((rawAtt, i) => {
                                const att = normalizeAttachment(rawAtt);
                                return (
                                    <a
                                        key={att.id || i}
                                        href={att.id ? getAttachmentUrl(att.id) : '#'}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-card)', textDecoration: 'none', color: 'var(--color-text-primary)', fontSize: 13, transition: 'all 0.12s', boxShadow: 'var(--shadow-xs)' }}
                                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
                                    >
                                        <span style={{ fontSize: 18 }}>📄</span>
                                        <div>
                                            <div style={{ fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.filename}</div>
                                            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{formatBytes(att.sizeBytes)}</div>
                                        </div>
                                        <span style={{ marginLeft: 4, color: 'var(--color-primary)', fontSize: 11.5 }}>↓</span>
                                    </a>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Body */}
                <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-card)', overflow: 'hidden' }}>
                    {viewMode === 'html' && email.bodyHtml ? (
                        <iframe
                            srcDoc={email.bodyHtml}
                            style={{ width: '100%', minHeight: 450, border: 'none', display: 'block' }}
                            sandbox="allow-same-origin"
                            title="Email body"
                        />
                    ) : (
                        <pre style={{ padding: 16, fontSize: 13, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-mono)', lineHeight: 1.6, minHeight: 200, margin: 0 }}>
                            {email.bodyText || email.snippetText || '(No content)'}
                        </pre>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────

export default function MailRouterPage() {
    const { user } = useAuth();
    const [accounts, setAccounts] = useState<MailAccount[]>([]);
    const [emails, setEmails] = useState<MailMessage[]>([]);
    const [syncJobs, setSyncJobs] = useState<SyncJob[]>([]);
    const [activeTab, setActiveTab] = useState<'ZOHO' | 'MICROSOFT'>('MICROSOFT');
    const [selectedEmail, setSelectedEmail] = useState<MailMessage | null>(null);
    const [search, setSearch] = useState('');
    const [startDate, setStartDate] = useState(daysAgoStr(14));
    const [endDate, setEndDate] = useState(todayStr());

    const [loadingAccounts, setLoadingAccounts] = useState(true);
    const [loadingEmails, setLoadingEmails] = useState(false);
    const [syncing, setSyncing] = useState(false);

    const [showConnect, setShowConnect] = useState(false);
    const [showDisconnect, setShowDisconnect] = useState<MailAccount | null>(null);
    const [disconnecting, setDisconnecting] = useState(false);
    const [showForward, setShowForward] = useState<MailMessage | null>(null);

    const [searchParams, setSearchParams] = useSearchParams();
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    const fetchAccounts = useCallback(async () => {
        setLoadingAccounts(true);
        try {
            const d = await listMailAccounts();
            setAccounts(d.accounts || []);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoadingAccounts(false);
        }
    }, []);

    const fetchEmails = useCallback(async () => {
        setLoadingEmails(true);
        try {
            const d = await listEmails({
                startDate,
                endDate,
                provider: activeTab,
                limit: 200,
            });
            const list = d.emails || [];
            setEmails(list);
            setSelectedEmail(prev => (prev && list.some(e => e._id === prev._id)) ? prev : (list[0] || null));
        } catch { /* silently fail if no emails yet */ } finally {
            setLoadingEmails(false);
        }
    }, [startDate, endDate, activeTab]);

    const fetchSyncJobs = useCallback(async () => {
        try {
            const d = await listSyncJobs();
            setSyncJobs(d.jobs || []);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        fetchAccounts();
        fetchSyncJobs();
        fetchEmails();
    }, [fetchAccounts, fetchSyncJobs, fetchEmails]);

    useEffect(() => {
        const connected = searchParams.get('connected');
        const err = searchParams.get('error');
        if (connected === '1') {
            setSuccessMsg('Mailbox connected successfully!');
            fetchAccounts();
            const next = new URLSearchParams(searchParams);
            next.delete('connected');
            setSearchParams(next, { replace: true });
        }
        if (err) {
            setError(decodeURIComponent(err));
            const next = new URLSearchParams(searchParams);
            next.delete('error');
            setSearchParams(next, { replace: true });
        }
    }, [searchParams, setSearchParams, fetchAccounts]);

    const activeAccount = accounts.find(a => a.provider === activeTab && a.isActive);

    async function handleSync() {
        setSyncing(true);
        setError('');
        try {
            const accountId = activeAccount?._id;
            await triggerSync({ accountId, startDate, endDate });
            await fetchEmails();
            await fetchSyncJobs();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSyncing(false);
        }
    }

    async function handleDisconnect() {
        if (!showDisconnect) return;
        setDisconnecting(true);
        try {
            await deleteMailAccount(showDisconnect._id);
            setShowDisconnect(null);
            await fetchAccounts();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setDisconnecting(false);
        }
    }

    const latestJob = syncJobs[0];

    const filteredEmails = emails.filter(e => {
        if (!search) return true;
        const s = search.toLowerCase();
        return (
            (e.from?.email || '').toLowerCase().includes(s) ||
            (e.from?.name || '').toLowerCase().includes(s) ||
            (e.subject || '').toLowerCase().includes(s) ||
            (e.snippetText || '').toLowerCase().includes(s) ||
            (e.bodyText || '').toLowerCase().includes(s)
        );
    });

    // Load full details & attachments whenever an email is selected
    useEffect(() => {
        const id = selectedEmail?._id || selectedEmail?.id;
        if (!id) return;
        let active = true;
        getEmail(id)
            .then(data => {
                if (!active || !data) return;
                setSelectedEmail(prev => {
                    if (!prev) return null;
                    const prevId = prev._id || prev.id;
                    if (prevId !== id) return prev;
                    return {
                        ...prev,
                        ...data.email,
                        attachments: data.attachments || (data.email as any)?.attachments || prev.attachments || [],
                    };
                });
            })
            .catch(() => {});
        return () => { active = false; };
    }, [selectedEmail?._id, selectedEmail?.id]);

    return (
        <>
            <style>{`@keyframes mail-spin { to { transform: rotate(360deg); } }`}</style>

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

            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '100%', overflow: 'hidden', flex: 1 }}>
                {/* ── Page Header (Sticky/Pinned at top) ──── */}
                <div style={{ padding: '16px 24px 10px 24px', flexShrink: 0, borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-page)' }}>
                    <div className="page-header" style={{ marginBottom: 10 }}>
                        <div className="page-header-left">
                            <h1 className="page-title" style={{ fontSize: 22 }}>✉️ Mail Router</h1>
                            <p className="page-subtitle" style={{ fontSize: 13 }}>Connect mailboxes, sync emails, and forward drawing instructions to detailers</p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {/* Sync status */}
                            {latestJob && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, background: 'var(--color-table-row-alt)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '4px 10px' }}>
                                    <span style={{ color: 'var(--color-text-muted)' }}>Last sync:</span>
                                    <span style={{ fontWeight: 600, color: latestJob.status === 'COMPLETED' ? 'var(--color-success-mid)' : latestJob.status === 'RUNNING' ? 'var(--color-primary)' : 'var(--color-danger-mid)' }}>
                                        {latestJob.status}
                                    </span>
                                    <span style={{ color: 'var(--color-text-muted)' }}>{formatDateTime(latestJob.completedAt || latestJob.startedAt)}</span>
                                </div>
                            )}
                            <button className="btn btn-primary" onClick={() => setShowConnect(true)}>+ Connect Mailbox</button>
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

                    {/* Provider tabs */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                        {(['MICROSOFT', 'ZOHO'] as const).map(provider => {
                            const acc = accounts.find(a => a.provider === provider && a.isActive);
                            const isActive = activeTab === provider;
                            return (
                                <div key={provider} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 'var(--radius-md)', border: `1.5px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'}`, background: isActive ? 'var(--color-primary-glow)' : 'var(--color-bg-card)', cursor: 'pointer', transition: 'all 0.13s', boxShadow: isActive ? '0 0 0 1px var(--color-primary-glow)' : 'var(--shadow-xs)' }}
                                    onClick={() => setActiveTab(provider)}
                                >
                                    <span style={{ fontSize: 16 }}>{provider === 'MICROSOFT' ? '🔵' : '🟠'}</span>
                                    <span style={{ fontWeight: 700, fontSize: 13 }}>{provider === 'MICROSOFT' ? 'Microsoft 365' : 'Zoho Mail'}</span>
                                    {acc ? (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
                                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--color-success-mid)', display: 'inline-block' }} />
                                            {acc.email}
                                        </span>
                                    ) : (
                                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500 }}>Not connected</span>
                                    )}
                                    {acc && isActive && (
                                        <button className="btn btn-danger btn-sm" style={{ marginLeft: 4 }} onClick={e => { e.stopPropagation(); setShowDisconnect(acc); }}>
                                            Disconnect
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <label style={{ fontSize: 12.5, color: 'var(--color-text-muted)', fontWeight: 600 }}>From</label>
                            <input type="date" className="form-control" style={{ width: 145, fontSize: 12.5 }} value={startDate} onChange={e => setStartDate(e.target.value)} max={endDate} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <label style={{ fontSize: 12.5, color: 'var(--color-text-muted)', fontWeight: 600 }}>To</label>
                            <input type="date" className="form-control" style={{ width: 145, fontSize: 12.5 }} value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} />
                        </div>
                        <button className="btn btn-primary" onClick={handleSync} disabled={syncing} style={{ fontSize: 13 }}>
                            {syncing ? <><Spinner size={14} /> Syncing…</> : '🔄 Sync Emails'}
                        </button>
                        <div className="search-input-wrapper" style={{ flex: 1, minWidth: 180 }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                            <input className="form-control" placeholder="Search sender, subject, snippet…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, fontSize: 13 }} />
                        </div>
                        <button className="btn btn-secondary" onClick={fetchEmails} disabled={loadingEmails} title="Refresh">
                            {loadingEmails ? <Spinner size={13} /> : '↻'}
                        </button>
                    </div>
                </div>

                {/* ── Master-detail (Fills remaining height, scrolls independently) ── */}
                <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
                    {/* Left: email list (independent vertical scroll) */}
                    <div style={{ width: 380, flexShrink: 0, height: '100%', minHeight: 0, borderRight: '1px solid var(--color-border)', overflowY: 'auto', background: 'var(--color-bg-card)' }}>
                        {loadingEmails ? (
                            <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}><Spinner size={24} /></div>
                        ) : filteredEmails.length === 0 ? (
                            <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>
                                <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
                                No emails in this date window.<br />
                                <span style={{ fontSize: 12.5 }}>Click <strong>Sync Emails</strong> to fetch from the connected mailbox.</span>
                            </div>
                        ) : filteredEmails.map(msg => (
                            <EmailCard
                                key={msg._id}
                                msg={msg}
                                active={selectedEmail?._id === msg._id}
                                onClick={() => setSelectedEmail(msg)}
                            />
                        ))}
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
                                />
                            </DetailErrorBoundary>
                        ) : (
                            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                                <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.4 }}>✉️</div>
                                <p style={{ fontSize: 14, fontWeight: 500 }}>Select an email from the left to view details and triage</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
