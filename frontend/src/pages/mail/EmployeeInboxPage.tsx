import React, { Component, type ErrorInfo, useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
    listInbox, getInboxItem, getAttachmentUrl,
    type InboxItem, type MailMessage, type MailAttachment,
} from '../../services/mailApi';
import { FileViewer, type FileViewerFile } from '../../components/file-viewer';

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
    const allAtts = ((email?.attachments && email.attachments.length > 0) ? email.attachments : (item.attachments || [])).filter((a: any) => !(a as any).isInline);
    const attCount = allAtts.length;
    const hasAtt = attCount > 0;
    const rawLinks: any[] = email?.links || (item as any)?.links || [];
    const linkCount = rawLinks.map(normalizeLink).filter(l => Boolean(l.url)).length;
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
                        {item.projectName && (
                            <span style={{ fontSize: 11, background: 'var(--color-primary-glow)', color: 'var(--color-primary)', border: '1px solid var(--color-primary)', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                                📁 {item.projectName}
                            </span>
                        )}
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

function InboxDetail({ item, loadingAttachments = false }: { item: InboxItem; loadingAttachments?: boolean }) {
    const [copiedNote, setCopiedNote] = useState(false);
    const [copiedLink, setCopiedLink] = useState<string | null>(null);
    const [copiedAllLinks, setCopiedAllLinks] = useState(false);
    const [showAttachments, setShowAttachments] = useState(false);
    const [showLinks, setShowLinks] = useState(false);
    const [linkFilter, setLinkFilter] = useState('');
    const [previewFile, setPreviewFile] = useState<FileViewerFile | null>(null);

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

    const allAttachments: MailAttachment[] = ((email.attachments && email.attachments.length > 0)
        ? email.attachments
        : (item.attachments || [])
    ).filter(att => !(att as any).isInline);

    const hasAttachmentsFlag = Boolean(
        (item as any).hasAttachments ||
        item.email?.hasAttachments ||
        email.hasAttachments ||
        (item as any).attachmentCount > 0 ||
        (item as any).attachmentsCount > 0 ||
        (email as any).attachmentCount > 0 ||
        (email as any).attachmentsCount > 0 ||
        allAttachments.length > 0
    );
    const isAttLoading = loadingAttachments && allAttachments.length === 0;

    const preparedHtml = React.useMemo(() => {
        if (!email.bodyHtml) return '';
        const baseStyle = `
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
                /* Hide any unresolvable cid: references so broken image icon + machine alt text never appear */
                img[src^="cid:"] {
                    display: none !important;
                }
                a {
                    color: #1e4fd8;
                }
            </style>
        `;
        if (email.bodyHtml.includes('<head>')) {
            return email.bodyHtml.replace('<head>', `<head>${baseStyle}`);
        }
        return `${baseStyle}${email.bodyHtml}`;
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

    const copyNote = () => {
        if (item.note) {
            navigator.clipboard.writeText(item.note).catch(() => { });
            setCopiedNote(true);
            setTimeout(() => setCopiedNote(false), 2000);
        }
    };

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

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '100%', overflow: 'hidden', minHeight: 0 }}>


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

                            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Forwarded at</span>
                            <span>{formatDateTime(item.createdAt || (item as any).forwardedAt)}</span>

                            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Email received</span>
                            <span>{formatDateTime(email.receivedAt)}</span>

                            {item.projectName && (
                                <>
                                    <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Project</span>
                                    <span>
                                        <span style={{
                                            fontSize: 12,
                                            background: 'var(--color-primary-glow)',
                                            color: 'var(--color-primary)',
                                            border: '1px solid var(--color-primary)',
                                            padding: '2px 8px',
                                            borderRadius: 4,
                                            fontWeight: 700,
                                        }}>
                                            📁 {item.projectName}
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

                {/* Collapsible Resources Bar (Attachments & Links) */}
                {(allAttachments.length > 0 || validLinks.length > 0 || (hasAttachmentsFlag && isAttLoading)) && (
                    <div style={{
                        marginBottom: 18,
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
                                <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginRight: 2 }}>
                                    Resources:
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
                                            color: 'var(--color-text-muted)',
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
                                        <span>Reference Links</span>
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
                                                ? `${allAttachments.length} file${allAttachments.length > 1 ? 's' : ''} (${formatBytes(totalAttBytes)})`
                                                : null,
                                        validLinks.length > 0 ? `${validLinks.length} link${validLinks.length > 1 ? 's' : ''}` : null,
                                    ].filter(Boolean).join(' • ')}
                                </span>
                                {(showAttachments || showLinks) && (
                                    <button
                                        type="button"
                                        onClick={() => { setShowAttachments(false); setShowLinks(false); }}
                                        style={{
                                            border: 'none',
                                            background: 'transparent',
                                            color: 'var(--color-text-muted)',
                                            cursor: 'pointer',
                                            fontSize: 11.5,
                                            padding: '2px 6px',
                                            borderRadius: 4,
                                        }}
                                        title="Collapse all resources"
                                    >
                                        ✕ Collapse
                                    </button>
                                )}
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
                                        📎 Drawing & File Attachments ({allAttachments.length}) • <span style={{ fontWeight: 500, color: 'var(--color-text-muted)' }}>{formatBytes(totalAttBytes)}</span>
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
                                                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
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
                                                <a
                                                    href={att.id ? getAttachmentUrl(att.id) : '#'}
                                                    download={att.filename}
                                                    onClick={e => e.stopPropagation()}
                                                    title="Download file directly"
                                                    style={{
                                                        marginLeft: 6,
                                                        color: 'var(--color-text-muted)',
                                                        padding: '4px 6px',
                                                        borderRadius: 4,
                                                        fontSize: 13,
                                                        fontWeight: 700,
                                                        textDecoration: 'none',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                    }}
                                                    onMouseEnter={e => {
                                                        e.currentTarget.style.background = 'var(--color-border-light)';
                                                        e.currentTarget.style.color = 'var(--color-primary)';
                                                    }}
                                                    onMouseLeave={e => {
                                                        e.currentTarget.style.background = 'transparent';
                                                        e.currentTarget.style.color = 'var(--color-text-muted)';
                                                    }}
                                                >
                                                    ↓
                                                </a>
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
                                        🔗 Extracted Reference Links ({validLinks.length})
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
                    {email.bodyHtml ? (
                        <iframe
                            srcDoc={preparedHtml}
                            style={{ width: '100%', minHeight: 520, border: 'none', display: 'block', background: '#ffffff' }}
                            sandbox="allow-same-origin allow-popups"
                            title="Email body"
                        />
                    ) : (
                        <pre style={{
                            padding: 18,
                            fontSize: 13,
                            color: 'var(--color-text-secondary)',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontFamily: 'var(--font-mono)',
                            lineHeight: 1.6,
                            minHeight: 220,
                            margin: 0,
                            background: '#fafafa',
                        }}>
                            {email.bodyText || email.snippetText || '(No content)'}
                        </pre>
                    )}
                </div>
            </div>

            {/* Microsoft 365 File Viewer Modal */}
            <FileViewer file={previewFile} onClose={() => setPreviewFile(null)} />
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
                    return prev;
                }
                const first = list[0] || null;
                if (first) {
                    const firstId = first._id || (first as any).id || (first as any).forwardingId || first.emailId;
                    if (firstId) {
                        setLoadingDetail(true);
                        getInboxItem(firstId)
                            .then(d => {
                                if (d?.item) {
                                    setSelectedItem(curr => {
                                        if (!curr || (curr._id !== firstId && (curr as any).id !== firstId)) return curr;
                                        return {
                                            ...curr,
                                            ...d.item,
                                            email: d.item.email || curr.email,
                                            attachments: (d as any).attachments || d.item.attachments || d.item.email?.attachments || curr.attachments || [],
                                            isRead: true,
                                        };
                                    });
                                }
                            })
                            .catch(() => {})
                            .finally(() => setLoadingDetail(false));
                    }
                }
                return first;
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
        const alreadyHasLoaded = selectedItem && (selectedItem._id === itemId || (selectedItem as any).id === itemId) && (selectedItem.email?.bodyHtml || selectedItem.email?.bodyText) && (selectedItem.attachments && selectedItem.attachments.length > 0);
        if (alreadyHasLoaded) {
            return;
        }

        // Set selected immediately so UI responds with zero delay
        setSelectedItem(item);

        // Optimistically mark read in UI list
        setItems(prev => prev.map(i => (i._id === item._id || (i as any).id === itemId) ? { ...i, isRead: true } : i));
        if (!item.isRead) setUnread(u => Math.max(0, u - 1));

        // Fetch full email content and attachments from backend
        setLoadingDetail(true);
        try {
            const d = await getInboxItem(itemId);
            if (d?.item) {
                const fullItem: InboxItem = {
                    ...item,
                    ...d.item,
                    email: d.item.email || item.email,
                    attachments: (d as any).attachments || d.item.attachments || d.item.email?.attachments || item.attachments || [],
                    isRead: true,
                };
                setSelectedItem(fullItem);
                setItems(prev => prev.map(i => (i._id === item._id || (i as any).id === itemId) ? { ...i, ...fullItem } : i));
            }
        } catch (e) {
            console.warn('[handleSelect] Could not fetch detailed inbox item:', e);
        } finally {
            setLoadingDetail(false);
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
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
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
                        {selectedItem ? (
                            <InboxErrorBoundary>
                                <InboxDetail item={selectedItem} loadingAttachments={loadingDetail} />
                            </InboxErrorBoundary>
                        ) : loadingDetail ? (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                                <Spinner size={28} />
                            </div>
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
