// MailSidebar.tsx
// Gmail-style collapsible sidebar for the Mail Router page.
//
// Layout contract:
//   COLLAPSED: a narrow strip (48px) that takes real layout space.
//   EXPANDED (hover): inner panel is position:absolute so it overlays
//   the page content — the underlying layout never shifts.

import React, { useState, useEffect, useCallback } from 'react';
import {
    listMailFolders,
    listRemoteFolders,
    addCustomFolder,
    deleteCustomFolder,
    type MailFolder,
    type RemoteFolder,
} from '../services/mailApi';

// ─── dimensions ──────────────────────────────────────────────────────────────
const COLLAPSED_W = 48;
const EXPANDED_W  = 220;

// ─── icon map ────────────────────────────────────────────────────────────────
function FolderIcon({ id }: { id: string }) {
    const base = {
        width: 18, height: 18,
        viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    };
    switch (id) {
        case 'inbox':
            return (
                <svg {...base}>
                    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                    <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
                </svg>
            );
        case 'send':
        case 'sent':
            return (
                <svg {...base}>
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
            );
        case 'spam':
            return (
                <svg {...base}>
                    <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
            );
        case 'history':
            return (
                <svg {...base}>
                    <circle cx="12" cy="12" r="9" />
                    <polyline points="12 7 12 12 15 15" />
                </svg>
            );
        case 'draft':
        case 'drafts':
            return (
                <svg {...base}>
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
            );
        case 'outbox':
            return (
                <svg {...base}>
                    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                    <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
                    <line x1="12" y1="2" x2="12" y2="10" />
                    <polyline points="15 5 12 2 9 5" />
                </svg>
            );
        case 'trash':
            return (
                <svg {...base}>
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                </svg>
            );
        case 'archive':
            return (
                <svg {...base}>
                    <polyline points="21 8 21 21 3 21 3 8" />
                    <rect x="1" y="3" width="22" height="5" />
                    <line x1="10" y1="12" x2="14" y2="12" />
                </svg>
            );
        case 'add':
        case 'plus':
            return (
                <svg {...base}>
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
            );
        default:
            return (
                <svg {...base}>
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
            );
    }
}

function fmtCount(n: number | null): string | null {
    if (n === null || n === 0) return null;
    return n > 999 ? '999+' : String(n);
}

// ─── Fallback when API fails ──────────────────────────────────────────────────
const FALLBACK_MICROSOFT: { id: string; name: string; icon: string; type: 'system' }[] = [
    { id: 'inbox',   name: 'Inbox',   icon: 'inbox',   type: 'system' },
    { id: 'sent',    name: 'Sent',    icon: 'send',    type: 'system' },
    { id: 'drafts',  name: 'Drafts',  icon: 'drafts',  type: 'system' },
    { id: 'spam',    name: 'Spam',    icon: 'spam',    type: 'system' },
    { id: 'history', name: 'History', icon: 'history', type: 'system' },
];

const FALLBACK_ZOHO: { id: string; name: string; icon: string; type: 'system' }[] = [
    { id: 'inbox',   name: 'Inbox',   icon: 'inbox',   type: 'system' },
    { id: 'sent',    name: 'Sent',    icon: 'send',    type: 'system' },
    { id: 'drafts',  name: 'Drafts',  icon: 'drafts',  type: 'system' },
    { id: 'outbox',  name: 'Outbox',  icon: 'outbox',  type: 'system' },
    { id: 'spam',    name: 'Spam',    icon: 'spam',    type: 'system' },
    { id: 'history', name: 'History', icon: 'history', type: 'system' },
];

// ─── Styles (injected once as a <style> tag) ──────────────────────────────────
const CSS = `
.msb-root {
    position: relative;
    width: ${COLLAPSED_W}px;
    flex-shrink: 0;
    height: 100%;
}
.msb-panel {
    position: absolute;
    top: 0; left: 0;
    height: 100%;
    width: ${COLLAPSED_W}px;
    overflow-x: hidden;
    overflow-y: auto;
    background: var(--color-bg-sidebar);
    border-right: 1px solid var(--color-sidebar-border);
    display: flex;
    flex-direction: column;
    padding: 8px 0;
    box-sizing: border-box;
    transition: width 0.22s cubic-bezier(0.4,0,0.2,1),
                box-shadow 0.22s cubic-bezier(0.4,0,0.2,1);
    z-index: 200;
}
.msb-panel.open {
    width: ${EXPANDED_W}px;
    box-shadow: 4px 0 24px rgba(0,0,0,.24), 2px 0 8px rgba(0,0,0,.14);
}
.msb-item {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 40px;
    padding: 0 12px;
    cursor: pointer;
    border-radius: 0 20px 20px 0;
    margin-right: 8px;
    white-space: nowrap;
    transition: background .13s, color .13s;
    color: var(--color-text-sidebar);
    user-select: none;
    flex-shrink: 0;
    position: relative;
}
.msb-item:hover  { background: var(--color-bg-sidebar-hover); color: #e2e8f0; }
.msb-item.active { background: var(--color-bg-sidebar-active); color: #fff; font-weight: 600; }
.msb-icon {
    display: flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; flex-shrink: 0;
}
.msb-label {
    font-size: 13.5px; font-weight: 500; letter-spacing: .01em;
    opacity: 0; transform: translateX(-6px);
    transition: opacity .18s ease .04s, transform .18s ease .04s;
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
}
.msb-panel.open .msb-label { opacity: 1; transform: translateX(0); }
.msb-badge {
    font-size: 11px; font-weight: 700;
    background: var(--color-primary); color: #fff;
    border-radius: 10px; padding: 1px 6px; min-width: 20px; text-align: center;
    opacity: 0; transform: translateX(-4px) scale(.85);
    transition: opacity .16s ease .06s, transform .16s ease .06s;
    flex-shrink: 0;
}
.msb-panel.open .msb-badge { opacity: 1; transform: translateX(0) scale(1); }
.msb-divider { height: 1px; background: var(--color-sidebar-border); margin: 6px 12px; flex-shrink: 0; }
.msb-skel { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px; }
.msb-skel-row { height: 32px; border-radius: 16px; background: rgba(255,255,255,.06); animation: msb-pulse 1.4s ease-in-out infinite; }
@keyframes msb-pulse { 0%,100%{opacity:.5} 50%{opacity:.9} }

.msb-add-item {
    margin-top: 6px;
    color: var(--color-primary);
}
.msb-add-item:hover {
    background: rgba(59, 130, 246, 0.12);
    color: #60a5fa;
}
.msb-delete-btn {
    display: none;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    color: #94a3b8;
    font-size: 10px;
    margin-left: 4px;
    flex-shrink: 0;
    transition: all 0.15s ease;
}
.msb-panel.open .msb-item:hover .msb-delete-btn {
    display: flex;
}
.msb-delete-btn:hover {
    background: #ef4444;
    color: #ffffff;
}

/* Modal styles */
.msb-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
}
.msb-modal-card {
    background: var(--color-bg-card, #1e293b);
    border: 1px solid var(--color-border, #334155);
    border-radius: 12px;
    width: 100%;
    max-width: 480px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 45px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    animation: msb-scale-in 0.18s ease-out;
}
@keyframes msb-scale-in {
    from { opacity: 0; transform: scale(0.96); }
    to { opacity: 1; transform: scale(1); }
}
.msb-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--color-border, #334155);
}
.msb-modal-body {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.msb-modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 20px;
    border-top: 1px solid var(--color-border, #334155);
    background: rgba(0,0,0,0.15);
}
.msb-remote-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--color-border, #334155);
    background: var(--color-bg, #0f172a);
    cursor: pointer;
    transition: all 0.14s ease;
}
.msb-remote-row:hover:not(.disabled) {
    border-color: var(--color-primary, #3b82f6);
    background: rgba(59, 130, 246, 0.08);
}
.msb-remote-row.selected {
    border-color: var(--color-primary, #3b82f6);
    background: rgba(59, 130, 246, 0.16);
}
.msb-remote-row.disabled {
    opacity: 0.55;
    cursor: not-allowed;
}
`;

// ─── Component ────────────────────────────────────────────────────────────────
interface Props {
    activeFolder: string;
    onFolderSelect: (id: string) => void;
    refreshTrigger?: number;
    provider?: 'MICROSOFT' | 'ZOHO';
}

export default function MailSidebar({ activeFolder, onFolderSelect, refreshTrigger, provider }: Props) {
    const [open,    setOpen]    = useState(false);
    const [folders, setFolders] = useState<MailFolder[]>([]);
    const [loading, setLoading] = useState(true);
    const [errored, setErrored] = useState(false);

    // Modal state for "+ Add Folder"
    const [showAddModal, setShowAddModal] = useState(false);
    const [remoteFolders, setRemoteFolders] = useState<RemoteFolder[]>([]);
    const [loadingRemote, setLoadingRemote] = useState(false);
    const [remoteError, setRemoteError] = useState('');
    const [searchFilter, setSearchFilter] = useState('');
    const [selectedRemote, setSelectedRemote] = useState<RemoteFolder | null>(null);
    const [customDisplayName, setCustomDisplayName] = useState('');
    const [submittingAdd, setSubmittingAdd] = useState(false);

    const load = useCallback(async () => {
        try {
            const d = await listMailFolders(provider);
            setFolders(d.folders || []);
        } catch {
            setErrored(true);
        } finally {
            setLoading(false);
        }
    }, [provider]);

    useEffect(() => { load(); }, [load, refreshTrigger, provider]);

    // Ensure outbox is strictly omitted if provider is MICROSOFT
    const displayedFolders = (folders || []).filter(f => {
        if (provider === 'MICROSOFT' && f.id === 'outbox') return false;
        return true;
    });

    const fallbackList = provider === 'MICROSOFT' ? FALLBACK_MICROSOFT : FALLBACK_ZOHO;

    const handleOpenAddModal = async () => {
        setShowAddModal(true);
        setLoadingRemote(true);
        setRemoteError('');
        setSelectedRemote(null);
        setCustomDisplayName('');
        setSearchFilter('');
        try {
            const res = await listRemoteFolders(provider || 'MICROSOFT');
            setRemoteFolders(res.folders || []);
        } catch (err: any) {
            setRemoteError(err.message || 'Failed to fetch remote folders');
        } finally {
            setLoadingRemote(false);
        }
    };

    const handleConfirmAdd = async () => {
        if (!selectedRemote) return;
        setSubmittingAdd(true);
        setRemoteError('');
        try {
            const res = await addCustomFolder({
                provider: provider || 'MICROSOFT',
                remoteFolderId: selectedRemote.id,
                name: customDisplayName.trim() || selectedRemote.name,
                icon: 'folder',
            });
            await load();
            setShowAddModal(false);
            if (res.folder?.id) {
                onFolderSelect(res.folder.id);
            }
        } catch (err: any) {
            setRemoteError(err.message || 'Failed to add folder');
        } finally {
            setSubmittingAdd(false);
        }
    };

    const handleDeleteFolder = async (f: MailFolder, e: React.MouseEvent) => {
        e.stopPropagation();
        const idToDelete = f.mappingId || f.id;
        if (!idToDelete) return;
        if (!window.confirm(`Remove folder "${f.name}" from sidebar? Emails will remain safely stored in your remote mailbox.`)) {
            return;
        }
        try {
            await deleteCustomFolder(idToDelete);
            await load();
            if (activeFolder === f.id) {
                onFolderSelect('inbox');
            }
        } catch (err: any) {
            alert(err.message || 'Failed to remove folder');
        }
    };

    const renderItems = (list: { id: string; name: string; icon: string; count?: number | null; type?: string; mappingId?: string }[]) =>
        list.map((f, idx) => {
            const badge = fmtCount((f as MailFolder).count ?? null);
            const isActive = f.id === activeFolder;
            const prev = list[idx - 1] as MailFolder | undefined;
            const showDiv = idx > 0 && prev?.type === 'system' && (f as MailFolder).type === 'custom';
            return (
                <React.Fragment key={f.id}>
                    {showDiv && <div className="msb-divider" />}
                    <div
                        className={`msb-item${isActive ? ' active' : ''}`}
                        onClick={() => onFolderSelect(f.id)}
                        title={f.name}
                        role="button"
                        tabIndex={0}
                        aria-label={`${f.name}${f.count ? ` (${f.count})` : ''}`}
                        aria-current={isActive ? 'page' : undefined}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onFolderSelect(f.id); }}
                    >
                        <span className="msb-icon"><FolderIcon id={f.icon} /></span>
                        <span className="msb-label">{f.name}</span>
                        {badge && <span className="msb-badge">{badge}</span>}
                        {f.type === 'custom' && (
                            <span
                                className="msb-delete-btn"
                                title="Remove folder from sidebar"
                                onClick={(e) => handleDeleteFolder(f as MailFolder, e)}
                            >
                                ✕
                            </span>
                        )}
                    </div>
                </React.Fragment>
            );
        });

    const filteredRemoteList = (remoteFolders || []).filter(rf => {
        if (!searchFilter.trim()) return true;
        return rf.name.toLowerCase().includes(searchFilter.toLowerCase());
    });

    return (
        <>
            <style>{CSS}</style>
            <div
                className="msb-root"
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
            >
                <div className={`msb-panel${open ? ' open' : ''}`}>
                    {loading ? (
                        <div className="msb-skel">
                            {[0, 1, 2].map(i => <div key={i} className="msb-skel-row" />)}
                        </div>
                    ) : (errored || displayedFolders.length === 0) ? (
                        <>
                            {renderItems(fallbackList)}
                            <div className="msb-divider" />
                            <div
                                className="msb-item msb-add-item"
                                onClick={handleOpenAddModal}
                                title="Add Folder"
                                role="button"
                                tabIndex={0}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleOpenAddModal(); }}
                            >
                                <span className="msb-icon"><FolderIcon id="add" /></span>
                                <span className="msb-label">+ Add Folder</span>
                            </div>
                        </>
                    ) : (
                        <>
                            {renderItems(displayedFolders)}
                            <div className="msb-divider" />
                            <div
                                className="msb-item msb-add-item"
                                onClick={handleOpenAddModal}
                                title="Add Folder from mailbox"
                                role="button"
                                tabIndex={0}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleOpenAddModal(); }}
                            >
                                <span className="msb-icon"><FolderIcon id="add" /></span>
                                <span className="msb-label">+ Add Folder</span>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ─── Add Remote Folder Modal ───────────────────────────────────────── */}
            {showAddModal && (
                <div className="msb-modal-backdrop" onClick={() => setShowAddModal(false)}>
                    <div className="msb-modal-card" onClick={e => e.stopPropagation()}>
                        <div className="msb-modal-header">
                            <div>
                                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                                    + Add Folder from {provider === 'MICROSOFT' ? 'Outlook' : 'Zoho Mail'}
                                </h3>
                                <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--color-text-muted, #94a3b8)' }}>
                                    Select a folder from your connected mailbox to add to your sidebar.
                                </p>
                            </div>
                            <button
                                className="btn btn-ghost btn-xs"
                                onClick={() => setShowAddModal(false)}
                                style={{ fontSize: 16, padding: '4px 8px' }}
                            >
                                ✕
                            </button>
                        </div>

                        <div className="msb-modal-body">
                            {remoteError && (
                                <div style={{
                                    padding: '10px 12px',
                                    borderRadius: 6,
                                    background: 'rgba(239, 68, 68, 0.12)',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    color: '#f87171',
                                    fontSize: 13,
                                }}>
                                    ⚠️ {remoteError}
                                </div>
                            )}

                            {loadingRemote ? (
                                <div style={{ padding: 36, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                    <div className="spinner" style={{ margin: '0 auto 12px' }} />
                                    <span>Scanning remote folders…</span>
                                </div>
                            ) : (
                                <>
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder="Search remote folders…"
                                        value={searchFilter}
                                        onChange={e => setSearchFilter(e.target.value)}
                                        style={{ fontSize: 13, padding: '7px 12px' }}
                                    />

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                                        {filteredRemoteList.length === 0 ? (
                                            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                                                No remote folders found.
                                            </div>
                                        ) : (
                                            filteredRemoteList.map(rf => {
                                                const isSel = selectedRemote?.id === rf.id;
                                                const isAdded = Boolean(rf.isAdded);
                                                return (
                                                    <div
                                                        key={rf.id}
                                                        className={`msb-remote-row${isSel ? ' selected' : ''}${isAdded ? ' disabled' : ''}`}
                                                        onClick={() => {
                                                            if (isAdded) return;
                                                            setSelectedRemote(rf);
                                                            setCustomDisplayName(rf.name);
                                                        }}
                                                    >
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                                            <FolderIcon id="folder" />
                                                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                <span style={{ fontSize: 13.5, fontWeight: isSel ? 600 : 500 }}>
                                                                    {rf.name}
                                                                </span>
                                                                {rf.isSystem && (
                                                                    <span style={{ fontSize: 11, marginLeft: 6, color: 'var(--color-text-muted)' }}>
                                                                        (System)
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div>
                                                            {isAdded ? (
                                                                <span style={{
                                                                    fontSize: 11,
                                                                    fontWeight: 600,
                                                                    padding: '2px 8px',
                                                                    borderRadius: 10,
                                                                    background: 'rgba(34, 197, 94, 0.15)',
                                                                    color: '#4ade80',
                                                                }}>
                                                                    ✓ Added
                                                                </span>
                                                            ) : rf.totalItemCount !== undefined ? (
                                                                <span style={{
                                                                    fontSize: 11,
                                                                    color: 'var(--color-text-muted)',
                                                                }}>
                                                                    {rf.totalItemCount} emails
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>

                                    {selectedRemote && (
                                        <div style={{
                                            marginTop: 6,
                                            padding: 12,
                                            borderRadius: 8,
                                            background: 'rgba(255, 255, 255, 0.03)',
                                            border: '1px solid var(--color-border)',
                                        }}>
                                            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-muted)' }}>
                                                Display Name in Sidebar
                                            </label>
                                            <input
                                                type="text"
                                                className="form-control"
                                                value={customDisplayName}
                                                onChange={e => setCustomDisplayName(e.target.value)}
                                                style={{ fontSize: 13, padding: '7px 10px' }}
                                                placeholder="Folder name"
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="msb-modal-footer">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowAddModal(false)}
                                disabled={submittingAdd}
                                style={{ fontSize: 13 }}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleConfirmAdd}
                                disabled={!selectedRemote || submittingAdd}
                                style={{ fontSize: 13, minWidth: 105 }}
                            >
                                {submittingAdd ? 'Adding…' : 'Add Folder'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
