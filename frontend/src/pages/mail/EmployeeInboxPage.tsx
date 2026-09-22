import React, { Component, type ErrorInfo, useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
    listInbox, getInboxItem, getAttachmentUrl,
    type InboxItem, type MailMessage, type MailAttachment,
} from '../../services/mailApi';

// ── Helpers ──────────────────────────────────────────────────

function formatDateTime(s?: string) {
    if (!s) return '';
    try {
        return new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch { return s; }
}

function formatRelativeTime(s?: string) {
    if (!s) return '';
    try {
        const diff = Date.now() - new Date(s).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        return `${days}d ago`;
    } catch { return ''; }
}

function formatBytes(b?: number) {
    if (!b || isNaN(b)) return '0 B';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
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

// ── Error Boundary ────────────────────────────────────────────

class InboxErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; errorText: string }> {
    state = { hasError: false, errorText: '' };
    static getDerivedStateFromError(error: any) {
        return { hasError: true, errorText: error?.message || 'Error displaying email content' };
    }
    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[InboxErrorBoundary] Crash caught:', error, info);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 8 }}>Unable to display message</h3>
                    <p style={{ fontSize: 13, color: 'var(--color-danger-mid)', marginBottom: 16 }}>{this.state.errorText}</p>
                    <button className="btn btn-secondary btn-sm" onClick={() => this.setState({ hasError: false, errorText: '' })}>Retry</button>
                </div>
            );
        }
        return this.props.children;
    }
}

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

// ── Inbox Row ────────────────────────────────────────────────

function InboxRow({
    item, active, onClick,
}: {
    item: InboxItem; active: boolean; onClick: () => void;
}) {
    const email = item.email || (item as any);
    const subject = email?.subject || (item as any)?.subject || '(No subject)';
    const senderName = email?.from?.name || (email as any)?.fromName;
    const senderEmail = email?.from?.email || (email as any)?.fromAddress;
    const sender = senderName || senderEmail || 'Unknown sender';
    const snippet = email?.snippetText || (email as any)?.bodyPreview || (email?.bodyText ? email.bodyText.slice(0, 100) : '') || '';
    const allAtts = (email?.attachments && email.attachments.length > 0) ? email.attachments : (item.attachments || []);
    const attCount = allAtts.length;
    const hasAtt = Boolean(email?.hasAttachments || (item as any)?.hasAttachments || attCount > 0);
    const linkCount = email?.links?.length || (item as any)?.links?.length || 0;
    const timestamp = item.createdAt || (item as any).forwardedAt || email?.receivedAt;

    return (
        <div
            onClick={onClick}
            style={{
                padding: '14px 18px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--color-border-light)',
                background: active ? 'var(--color-primary-glow)' : item.isRead ? 'var(--color-bg-card)' : 'rgba(30, 79, 216, 0.04)',
                borderLeft: active ? '3px solid var(--color-primary)' : item.isRead ? '3px solid transparent' : '3px solid var(--color-primary)',
                transition: 'all 0.12s',
                position: 'relative',
            }}
            onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-table-row-hover)'; }}
            onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = item.isRead ? 'var(--color-bg-card)' : 'rgba(30, 79, 216, 0.04)'; }}
        >
            {/* Unread dot */}
            {!item.isRead && !active && (
                <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', width: 8, height: 8, borderRadius: '50%', background: 'var(--color-primary)' }} />
            )}

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                {/* Avatar */}
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--color-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>
                    {initials(senderName, senderEmail)}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
                        <span style={{ fontWeight: item.isRead ? 500 : 700, fontSize: 13, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
                            {sender}
                        </span>
                        <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', flexShrink: 0 }}>
                            {formatRelativeTime(timestamp)}
                        </span>
                    </div>

                    <div style={{ fontWeight: item.isRead ? 500 : 700, fontSize: 13.5, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
                        {subject}
                    </div>

                    {item.note && (
                        <div style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            📝 {item.note}
                        </div>
                    )}

                    <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', marginTop: 2, lineHeight: 1.4 }}>
                        {snippet}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                            Forwarded by: <strong style={{ color: 'var(--color-text-primary)' }}>{item.forwardedByName || item.forwardedBy || 'Project Manager'}</strong>
                        </span>
                        {hasAtt && (
                            <span style={{ fontSize: 11.5, background: 'var(--color-info-bg)', color: 'var(--color-info-mid)', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>
                                📎 {attCount > 0 ? attCount : 'Attachment'}
                            </span>
                        )}
                        {linkCount > 0 && (
                            <span style={{ fontSize: 11.5, background: 'var(--color-warning-bg)', color: 'var(--color-warning-mid)', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>
                                🔗 {linkCount}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Inbox Detail ──────────────────────────────────────────────

function InboxDetail({ item }: { item: InboxItem }) {
    const [viewMode, setViewMode] = useState<'html' | 'text'>('html');
    const [copiedSubject, setCopiedSubject] = useState(false);
    const [copiedNote, setCopiedNote] = useState(false);

    // Resolve email object with full fallbacks
    const email: MailMessage = item.email || {
        _id: item.emailId || item._id,
        accountId: '',
        providerId: '',
        subject: (item as any).subject || '(No subject)',
        from: {
            name: (item as any).fromName || (item as any).from?.name,
            email: (item as any).fromAddress || (item as any).from?.email || '',
        },
        fromName: (item as any).fromName,
        fromAddress: (item as any).fromAddress,
        receivedAt: (item as any).receivedAt || item.createdAt,
        bodyHtml: (item as any).bodyHtml || '',
        bodyText: (item as any).bodyText || (item as any).snippetText || '',
        snippetText: (item as any).snippetText || '',
        links: (item as any).links || [],
        attachments: (item as any).attachments || item.attachments || [],
        hasAttachments: Boolean((item as any).hasAttachments || item.attachments?.length),
        provider: (item as any).provider || 'MICROSOFT',
    };

    const senderName = email.from?.name || (email as any).fromName;
    const senderEmail = email.from?.email || (email as any).fromAddress;
    const senderLabel = senderName && senderEmail ? `${senderName} <${senderEmail}>` : (senderName || senderEmail || 'Unknown sender');

    const allAttachments: MailAttachment[] = (email.attachments && email.attachments.length > 0)
        ? email.attachments
        : (item.attachments || []);

    const copySubject = () => {
        if (email.subject) {
            navigator.clipboard.writeText(email.subject).catch(() => {});
            setCopiedSubject(true);
            setTimeout(() => setCopiedSubject(false), 2000);
        }
    };

    const copyNote = () => {
        if (item.note) {
            navigator.clipboard.writeText(item.note).catch(() => {});
            setCopiedNote(true);
            setTimeout(() => setCopiedNote(false), 2000);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '100%', overflow: 'hidden', minHeight: 0 }}>
            {/* Action bar (strictly read-only) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderBottom: '1px solid var(--color-border-light)', background: 'var(--color-table-header-bg)', flexShrink: 0 }}>
                <span style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: 4,
                    background: 'var(--color-table-row-alt)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-muted)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5
                }}>
                    🔒 Read Only
                </span>

                <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {email.subject || '(No subject)'}
                </span>

                <button
                    className="btn btn-secondary btn-sm"
                    onClick={copySubject}
                    title="Copy subject text"
                    style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                    {copiedSubject ? '✓ Copied' : '📋 Copy Subject'}
                </button>

                <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => navigator.clipboard.writeText(window.location.href).catch(() => {})}
                    title="Copy URL"
                    style={{ fontSize: 12 }}
                >
                    🔗 Link
                </button>

                <div style={{ display: 'flex', gap: 0, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                    {(['html', 'text'] as const).map(m => (
                        <button
                            key={m}
                            onClick={() => setViewMode(m)}
                            style={{
                                padding: '5px 12px',
                                fontSize: 12.5,
                                border: 'none',
                                background: viewMode === m ? 'var(--color-primary)' : 'var(--color-bg-card)',
                                color: viewMode === m ? '#fff' : 'var(--color-text-secondary)',
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                                fontWeight: 600,
                                transition: 'all 0.12s'
                            }}
                        >
                            {m === 'html' ? 'HTML' : 'Plain'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px' }}>
                {/* Title Header */}
                <div style={{ marginBottom: 18 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-text-primary)', marginBottom: 12, lineHeight: 1.35 }}>
                        {email.subject || '(No subject)'}
                    </h2>

                    {/* Metadata Card */}
                    <div style={{ background: 'var(--color-table-row-alt)', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)', padding: '12px 16px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: 13.5 }}>
                            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>From</span>
                            <span>{senderLabel}</span>

                            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Forwarded by</span>
                            <span>
                                <strong style={{ color: 'var(--color-text-primary)' }}>
                                    {item.forwardedByName || item.forwardedBy || 'Project Manager'}
                                </strong>
                            </span>

                            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Forwarded at</span>
                            <span>{formatDateTime(item.createdAt || (item as any).forwardedAt)}</span>

                            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Email received</span>
                            <span>{formatDateTime(email.receivedAt)}</span>

                            {email.provider && (
                                <>
                                    <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Mailbox Provider</span>
                                    <span>
                                        <span style={{
                                            fontSize: 11,
                                            background: email.provider === 'MICROSOFT' ? '#dbeafe' : '#fef3c7',
                                            color: email.provider === 'MICROSOFT' ? '#1d4ed8' : '#92400e',
                                            padding: '2px 7px',
                                            borderRadius: 4,
                                            fontWeight: 700,
                                            letterSpacing: '0.03em'
                                        }}>
                                            {email.provider}
                                        </span>
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* PM note callout (Instructions from Project Manager) */}
                {item.note && (
                    <div style={{ background: 'var(--color-primary-glow)', border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 18 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13.5, color: 'var(--color-primary)' }}>
                                <span style={{ fontSize: 16 }}>📝</span> Instructions from Project Manager
                            </div>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={copyNote}
                                style={{ fontSize: 11.5, padding: '2px 8px' }}
                            >
                                {copiedNote ? '✓ Copied' : 'Copy Note'}
                            </button>
                        </div>
                        <div style={{ fontSize: 13.5, color: 'var(--color-text-primary)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                            {item.note}
                        </div>
                    </div>
                )}

                {/* Reference Links */}
                {email.links && email.links.length > 0 && (
                    <div style={{ background: 'var(--color-info-bg)', border: '1px solid #93c5fd', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 18 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-info)', marginBottom: 8 }}>
                            🔗 Reference Links ({email.links.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {email.links.map((rawLink, i) => {
                                const { url, text } = normalizeLink(rawLink);
                                if (!url) return null;
                                return (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <a
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{ fontSize: 12.5, color: 'var(--color-info-mid)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                                            title={url}
                                        >
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
                {allAttachments.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
                            📎 Drawing & File Attachments ({allAttachments.length})
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {allAttachments.map((rawAtt, i) => {
                                const att = normalizeAttachment(rawAtt);
                                return (
                                    <a
                                        key={att.id || i}
                                        href={att.id ? getAttachmentUrl(att.id) : '#'}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        download={att.filename}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            padding: '8px 12px',
                                            border: '1px solid var(--color-border)',
                                            borderRadius: 'var(--radius-md)',
                                            background: 'var(--color-bg-card)',
                                            textDecoration: 'none',
                                            color: 'var(--color-text-primary)',
                                            fontSize: 13,
                                            transition: 'all 0.12s',
                                            boxShadow: 'var(--shadow-xs)',
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
                                    >
                                        <span style={{ fontSize: 18 }}>📄</span>
                                        <div>
                                            <div style={{ fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {att.filename}
                                            </div>
                                            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                                                {formatBytes(att.sizeBytes)}
                                            </div>
                                        </div>
                                        <span style={{ marginLeft: 4, color: 'var(--color-primary)', fontSize: 11.5 }}>↓</span>
                                    </a>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Email Body */}
                <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-card)', overflow: 'hidden' }}>
                    {viewMode === 'html' && (email.bodyHtml || email.bodyText) ? (
                        email.bodyHtml ? (
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
                        )
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

// ── Main ──────────────────────────────────────────────────────

const PAGE_SIZE = 25;

export default function EmployeeInboxPage() {
    const { user } = useAuth();
    const [items, setItems] = useState<InboxItem[]>([]);
    const [total, setTotal] = useState(0);
    const [unread, setUnread] = useState(0);
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(true);
    const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'unread'>('all');

    const fetchItems = useCallback(async () => {
        setLoading(true);
        try {
            const d = await listInbox({ page, limit: PAGE_SIZE });
            const list = d.items || [];
            setItems(list);
            setTotal(d.total ?? list.length);
            setUnread(d.unreadCount ?? 0);

            // Auto-select first item if none is selected
            setSelectedItem(prev => {
                if (prev) {
                    const match = list.find(i => (i._id === prev._id || (i as any).id === prev._id));
                    if (match) return { ...prev, ...match };
                }
                return list[0] || null;
            });
        } catch {
            /* silently fail */
        } finally {
            setLoading(false);
        }
    }, [page]);

    useEffect(() => {
        fetchItems();
    }, [fetchItems]);

    async function handleSelect(item: InboxItem) {
        const itemId = item._id || (item as any).id || (item as any).forwardingId || item.emailId;
        if (selectedItem?._id === itemId && (selectedItem.email?.bodyHtml || selectedItem.email?.bodyText)) {
            return;
        }

        // Set selected immediately so UI responds with zero delay
        setSelectedItem(item);

        // Optimistically mark read in UI list
        setItems(prev => prev.map(i => (i._id === item._id || (i as any).id === itemId) ? { ...i, isRead: true } : i));
        if (!item.isRead) setUnread(u => Math.max(0, u - 1));

        // Fetch full email content and attachments from backend
        try {
            const d = await getInboxItem(itemId);
            if (d?.item) {
                const fullItem: InboxItem = {
                    ...item,
                    ...d.item,
                    email: d.item.email || item.email,
                    attachments: d.attachments || d.item.attachments || d.item.email?.attachments || item.attachments || [],
                    isRead: true,
                };
                setSelectedItem(fullItem);
                setItems(prev => prev.map(i => (i._id === item._id || (i as any).id === itemId) ? { ...i, ...fullItem } : i));
            }
        } catch (e) {
            console.warn('[handleSelect] Could not fetch detailed inbox item:', e);
        }
    }

    const displayItems = items.filter(item => {
        if (filter === 'unread' && item.isRead) return false;
        if (!search) return true;
        const s = search.toLowerCase();
        const e = item.email;
        return (
            (e?.subject || (item as any)?.subject || '').toLowerCase().includes(s) ||
            (e?.from?.email || (item as any)?.fromAddress || '').toLowerCase().includes(s) ||
            (e?.from?.name || (item as any)?.fromName || '').toLowerCase().includes(s) ||
            (item.forwardedByName || item.forwardedBy || '').toLowerCase().includes(s) ||
            (item.note || '').toLowerCase().includes(s)
        );
    });

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return (
        <>
            <style>{`@keyframes mail-spin { to { transform: rotate(360deg); } }`}</style>

            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '100%', overflow: 'hidden', flex: 1 }}>
                {/* ── Header ───────────────────────────────── */}
                <div style={{ padding: '16px 24px 10px 24px', flexShrink: 0, borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-page)' }}>
                    <div className="page-header" style={{ marginBottom: 10 }}>
                        <div className="page-header-left">
                            <h1 className="page-title" style={{ fontSize: 22 }}>
                                📬 My Inbox
                                {unread > 0 && (
                                    <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 700, background: 'var(--color-primary)', color: '#fff', padding: '2px 9px', borderRadius: 20, verticalAlign: 'middle' }}>
                                        {unread} unread
                                    </span>
                                )}
                            </h1>
                            <p className="page-subtitle" style={{ fontSize: 13 }}>
                                Drawing instructions and project emails forwarded by your project manager
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button className="btn btn-secondary btn-sm" onClick={fetchItems} disabled={loading} title="Refresh">
                                {loading ? <Spinner size={13} /> : '↻ Refresh'}
                            </button>
                        </div>
                    </div>

                    {/* Filter + search bar */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                            {(['all', 'unread'] as const).map(f => (
                                <button
                                    key={f}
                                    onClick={() => setFilter(f)}
                                    style={{
                                        padding: '6px 14px',
                                        fontSize: 12.5,
                                        border: 'none',
                                        background: filter === f ? 'var(--color-primary)' : 'var(--color-bg-card)',
                                        color: filter === f ? '#fff' : 'var(--color-text-secondary)',
                                        cursor: 'pointer',
                                        fontFamily: 'inherit',
                                        fontWeight: 600,
                                        transition: 'all 0.12s'
                                    }}
                                >
                                    {f === 'all' ? 'All' : `Unread${unread > 0 ? ` (${unread})` : ''}`}
                                </button>
                            ))}
                        </div>
                        <div className="search-input-wrapper" style={{ flex: 1, minWidth: 160 }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                            <input
                                className="form-control"
                                placeholder="Search subject, sender, instructions, or forwarder…"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                style={{ paddingLeft: 32, fontSize: 13 }}
                            />
                        </div>
                    </div>
                </div>

                {/* ── Master-detail ─────────────────────────── */}
                <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
                    {/* Left: inbox list (independent scroll) */}
                    <div style={{ width: 380, flexShrink: 0, height: '100%', minHeight: 0, borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', background: 'var(--color-bg-card)' }}>
                        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                            {loading && items.length === 0 ? (
                                <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                    <Spinner size={24} />
                                </div>
                            ) : displayItems.length === 0 ? (
                                <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>
                                    <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
                                    {filter === 'unread' ? 'No unread messages.' : 'Your inbox is empty.'}
                                    <br /><span style={{ fontSize: 12 }}>Emails forwarded by your PM will appear here.</span>
                                </div>
                            ) : displayItems.map(item => (
                                <InboxRow
                                    key={item._id || (item as any).id}
                                    item={item}
                                    active={selectedItem?._id === item._id || (selectedItem as any)?.id === item._id}
                                    onClick={() => handleSelect(item)}
                                />
                            ))}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--color-border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                                <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
                                <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>Page {page + 1} of {totalPages}</span>
                                <button className="btn btn-secondary btn-sm" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
                            </div>
                        )}
                    </div>

                    {/* Right: detail (independent scroll) */}
                    <div style={{ flex: 1, minWidth: 0, height: '100%', minHeight: 0, overflow: 'hidden', background: 'var(--color-bg-page)', display: 'flex', flexDirection: 'column' }}>
                        {loadingDetail ? (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                                <Spinner size={28} />
                            </div>
                        ) : selectedItem ? (
                            <InboxErrorBoundary>
                                <InboxDetail item={selectedItem} />
                            </InboxErrorBoundary>
                        ) : (
                            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                                <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.4 }}>📬</div>
                                <p style={{ fontSize: 14, fontWeight: 500 }}>Select a message to view drawing instructions</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
