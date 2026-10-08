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

/* Custom Folders in Sidebar */
.msb-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    max-height: 0;
    opacity: 0;
    overflow: hidden;
    pointer-events: none;
    transition: max-height 0.2s ease, opacity 0.18s ease 0.04s, padding 0.2s ease;
    white-space: nowrap;
    box-sizing: border-box;
}
.msb-panel.open .msb-section-header {
    max-height: 40px;
    opacity: 1;
    pointer-events: auto;
    padding: 10px 12px 6px 12px;
    margin-top: 2px;
}
.msb-section-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #94a3b8;
    user-select: none;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
    gap: 5px;
}
.msb-new-folder-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10.5px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 4px;
    border: 1px solid rgba(59, 130, 246, 0.45);
    background: rgba(59, 130, 246, 0.12);
    color: #60a5fa;
    cursor: pointer;
    transition: all 0.14s ease;
    white-space: nowrap;
    flex-shrink: 0;
}
.msb-new-folder-btn:hover {
    background: rgba(59, 130, 246, 0.25);
    border-color: #60a5fa;
    color: #93c5fd;
}
.msb-create-folder-box {
    padding: 4px 12px 8px 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
}
.msb-create-input {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #ffffff;
    font-size: 12px;
    padding: 5px 8px;
    border-radius: 5px;
    flex: 1;
    min-width: 0;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.12s, background 0.12s;
}
.msb-create-input:focus {
    border-color: #3b82f6;
    background: rgba(255, 255, 255, 0.14);
}
.msb-create-action-btn {
    font-size: 11px;
    font-weight: 600;
    padding: 5px 9px;
    border-radius: 5px;
    border: none;
    background: #2563eb;
    color: #ffffff;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.12s;
}
.msb-create-action-btn:hover:not(:disabled) {
    background: #1d4ed8;
}
.msb-create-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.msb-empty-hint {
    padding: 4px 14px 8px 14px;
    font-size: 11px;
    color: #64748b;
    font-style: italic;
    opacity: 0;
    display: none;
    line-height: 1.35;
    white-space: normal;
}
.msb-panel.open .msb-empty-hint {
    display: block;
    opacity: 1;
}
.msb-drag-hint {
    padding: 3px 14px 6px 14px;
    font-size: 10px;
    color: #64748b;
    font-style: italic;
    display: none;
    white-space: nowrap;
}
.msb-panel.open .msb-drag-hint {
    display: block;
}
.msb-item.drag-over {
    background: rgba(59, 130, 246, 0.25) !important;
    outline: 1.5px dashed #3b82f6 !important;
}
.msb-item.drop-success {
    background: rgba(34, 197, 94, 0.22) !important;
    color: #4ade80 !important;
}
.msb-dropped-badge {
    font-size: 11px;
    font-weight: 700;
    color: #4ade80;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.16s ease;
}
.msb-panel.open .msb-dropped-badge {
    opacity: 1;
}
.msb-custom-badge {
    background: rgba(255, 255, 255, 0.14);
    color: #cbd5e1;
}
.msb-item.active .msb-custom-badge {
    background: #2563eb;
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
    background: var(--color-bg-card, #ffffff);
    color: var(--color-text-primary, #0f1623);
    border: 1px solid var(--color-border, #d0d7e3);
    border-radius: 12px;
    width: 100%;
    max-width: 480px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 45px rgba(0, 0, 0, 0.25);
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
    border-bottom: 1px solid var(--color-border, #d0d7e3);
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
    border-top: 1px solid var(--color-border, #d0d7e3);
    background: var(--color-table-row-alt, #f9fafc);
}
.msb-remote-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid var(--color-border, #e2e8f0);
    background: var(--color-surface, #ffffff);
    color: var(--color-text, #1e293b);
    cursor: pointer;
    transition: all 0.14s ease;
}
.msb-remote-row:hover:not(.disabled) {
    border-color: var(--color-primary, #1e4fd8);
    background: var(--color-primary-glow, rgba(30, 79, 216, 0.08));
}
.msb-remote-row.selected {
    border-color: var(--color-primary, #1e4fd8);
    background: var(--color-primary-glow, rgba(30, 79, 216, 0.14));
    color: var(--color-primary, #1e4fd8);
}
.msb-remote-row.disabled {
    opacity: 0.6;
    background: var(--color-bg-page, #f1f4f9);
    cursor: not-allowed;
    color: var(--color-text-muted, #6b7280);
}
.msb-modal-tabs {
    display: flex;
    gap: 6px;
    padding: 4px;
    background: var(--color-bg-page, #f1f5f9);
    border-radius: 8px;
    border: 1px solid var(--color-border, #e2e8f0);
}
.msb-modal-tab {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 12px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--color-text-muted, #64748b);
    cursor: pointer;
    transition: all 0.15s ease;
}
.msb-modal-tab:hover {
    color: var(--color-text, #1e293b);
}
.msb-modal-tab.active {
    background: var(--color-surface, #ffffff);
    color: var(--color-primary, #1e4fd8);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
`;

// ─── Custom Folders Types and Storage ─────────────────────────────────────────
export interface CustomFolder {
    id: string;
    name: string;
    emailIds: string[];
}

export const CUSTOM_FOLDERS_KEY = 'mailRouter_customFolders';

export function loadCustomFolders(): CustomFolder[] {
    try { return JSON.parse(localStorage.getItem(CUSTOM_FOLDERS_KEY) || '[]'); }
    catch { return []; }
}
export function saveCustomFolders(folders: CustomFolder[]) {
    localStorage.setItem(CUSTOM_FOLDERS_KEY, JSON.stringify(folders));
}

// ─── Component ────────────────────────────────────────────────────────────────
interface Props {
    activeFolder: string;
    onFolderSelect: (id: string) => void;
    refreshTrigger?: number;
    provider?: 'MICROSOFT' | 'ZOHO';
    startDate?: string;
    endDate?: string;
    customFolders?: CustomFolder[];
    onCustomFoldersChange?: (folders: CustomFolder[]) => void;
}

export default function MailSidebar({
    activeFolder,
    onFolderSelect,
    refreshTrigger,
    provider,
    startDate,
    endDate,
    customFolders: propsCustomFolders,
    onCustomFoldersChange,
}: Props) {
    const [open,    setOpen]    = useState(false);
    const [folders, setFolders] = useState<MailFolder[]>([]);
    const [loading, setLoading] = useState(true);
    const [errored, setErrored] = useState(false);

    // Custom user-created folders state
    const [internalCustomFolders, setInternalCustomFolders] = useState<CustomFolder[]>(loadCustomFolders);
    useEffect(() => {
        if (propsCustomFolders) {
            setInternalCustomFolders(propsCustomFolders);
        }
    }, [propsCustomFolders]);

    const userFolders = propsCustomFolders ?? internalCustomFolders;
    const [modalTab, setModalTab] = useState<'custom' | 'remote'>('custom');
    const [newFolderName, setNewFolderName] = useState('');
    const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
    const [folderDropSuccess, setFolderDropSuccess] = useState<string | null>(null);

    const updateCustomFolders = (updated: CustomFolder[]) => {
        saveCustomFolders(updated);
        setInternalCustomFolders(updated);
        onCustomFoldersChange?.(updated);
    };

    const handleCreateFolder = () => {
        const trimmed = newFolderName.trim();
        if (!trimmed) return;
        const newFolder: CustomFolder = {
            id: `cf_${Date.now()}`,
            name: trimmed,
            emailIds: [],
        };
        const updated = [...userFolders, newFolder];
        updateCustomFolders(updated);
        setNewFolderName('');
        setShowAddModal(false);
        onFolderSelect(newFolder.id);
    };

    const handleDeleteUserFolder = (folder: CustomFolder, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm(`Delete folder "${folder.name}"?`)) return;
        const updated = userFolders.filter(f => f.id !== folder.id);
        updateCustomFolders(updated);
        if (activeFolder === folder.id) {
            onFolderSelect('inbox');
        }
    };

    const handleDropOnCustomFolder = (folderId: string, e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverFolderId(null);
        const emailId = e.dataTransfer.getData('emailId');
        if (!emailId) return;
        const updated = userFolders.map(f =>
            f.id === folderId
                ? { ...f, emailIds: Array.from(new Set([...f.emailIds, emailId])) }
                : f
        );
        updateCustomFolders(updated);
        setFolderDropSuccess(folderId);
        setTimeout(() => setFolderDropSuccess(null), 1500);
    };

    // Modal state for "Add Folder"
    const [showAddModal, setShowAddModal] = useState(false);
    const [remoteFolders, setRemoteFolders] = useState<RemoteFolder[]>([]);
    const [loadingRemote, setLoadingRemote] = useState(false);
    const [remoteError, setRemoteError] = useState('');
    const [searchFilter, setSearchFilter] = useState('');
    const [selectedRemote, setSelectedRemote] = useState<RemoteFolder | null>(null);
    const [customDisplayName, setCustomDisplayName] = useState('');
    const [submittingAdd, setSubmittingAdd] = useState(false);

    const loadRemoteFolders = async () => {
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

    const handleSwitchToRemoteTab = () => {
        setModalTab('remote');
        if (remoteFolders.length === 0 && !loadingRemote) {
            loadRemoteFolders();
        }
    };

    const load = useCallback(async () => {
        try {
            const d = await listMailFolders(provider, startDate, endDate);
            setFolders(d.folders || []);
        } catch {
            setErrored(true);
        } finally {
            setLoading(false);
        }
    }, [provider, startDate, endDate]);

    useEffect(() => { load(); }, [load, refreshTrigger, provider, startDate, endDate]);

    // Ensure outbox is strictly omitted if provider is MICROSOFT
    const displayedFolders = (folders || []).filter(f => {
        if (provider === 'MICROSOFT' && f.id === 'outbox') return false;
        return true;
    });

    const systemFolders = displayedFolders.filter(f => f.type !== 'custom');
    const remoteFoldersList = displayedFolders.filter(f => f.type === 'custom');

    const fallbackList = provider === 'MICROSOFT' ? FALLBACK_MICROSOFT : FALLBACK_ZOHO;

    const handleOpenAddModal = async () => {
        setModalTab('remote');
        setShowAddModal(true);
        await loadRemoteFolders();
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
                onMouseLeave={() => {
                    setOpen(false);
                }}
                onDragEnter={() => setOpen(true)}
                onDragOver={e => {
                    e.preventDefault();
                    if (!open) setOpen(true);
                }}
            >
                <div
                    className={`msb-panel${open ? ' open' : ''}`}
                    onDragOver={e => {
                        e.preventDefault();
                        if (!open) setOpen(true);
                    }}
                >
                    {loading ? (
                        <div className="msb-skel">
                            {[0, 1, 2].map(i => <div key={i} className="msb-skel-row" />)}
                        </div>
                    ) : (
                        <>
                            {/* System Folders */}
                            {renderItems(systemFolders.length > 0 ? systemFolders : fallbackList)}

                            {/* Remote folders (if any) */}
                            {remoteFoldersList.length > 0 && (
                                <>
                                    <div className="msb-divider" />
                                    {renderItems(remoteFoldersList)}
                                </>
                            )}

                            {/* Divider and + Add Folder from mailbox */}
                            <div
                                className="msb-item msb-add-item"
                                onClick={handleOpenAddModal}
                                title={`Add folder from ${provider === 'MICROSOFT' ? 'Outlook' : 'Zoho Mail'}`}
                                role="button"
                                tabIndex={0}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleOpenAddModal(); }}
                            >
                                <span className="msb-icon"><FolderIcon id="add" /></span>
                                <span className="msb-label">+ Add from {provider === 'MICROSOFT' ? 'Outlook' : 'Zoho'}</span>
                            </div>

                            {/* Divider */}
                            <div className="msb-divider" />

                            {/* ── My Folders Section ── */}
                            <div className="msb-section-header">
                                <span className="msb-section-title">My Folders</span>
                                <button
                                    type="button"
                                    className="msb-new-folder-btn"
                                    title="Add or create folder"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setModalTab('custom');
                                        setNewFolderName('');
                                        setShowAddModal(true);
                                    }}
                                >
                                    + New Folder
                                </button>
                            </div>

                            {/* Folder list — droppable targets */}
                            {userFolders.length > 0 ? (
                                <>
                                    {userFolders.map(folder => {
                                        const isActive = activeFolder === folder.id;
                                        const isDragOver = dragOverFolderId === folder.id;
                                        const wasJustDropped = folderDropSuccess === folder.id;
                                        const count = folder.emailIds.length;
                                        return (
                                            <div
                                                key={folder.id}
                                                className={`msb-item${isActive ? ' active' : ''}${isDragOver ? ' drag-over' : ''}${wasJustDropped ? ' drop-success' : ''}`}
                                                onClick={() => onFolderSelect(folder.id)}
                                                onDragOver={e => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setDragOverFolderId(folder.id);
                                                }}
                                                onDragLeave={e => {
                                                    e.stopPropagation();
                                                    setDragOverFolderId(null);
                                                }}
                                                onDrop={e => handleDropOnCustomFolder(folder.id, e)}
                                                title={`${folder.name} (${count} email${count !== 1 ? 's' : ''})`}
                                                role="button"
                                                tabIndex={0}
                                                aria-label={`${folder.name}${count ? ` (${count})` : ''}`}
                                                aria-current={isActive ? 'page' : undefined}
                                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onFolderSelect(folder.id); }}
                                            >
                                                <span className="msb-icon"><FolderIcon id="folder" /></span>
                                                <span className="msb-label">{folder.name}</span>
                                                {wasJustDropped ? (
                                                    <span className="msb-dropped-badge">✓ Added</span>
                                                ) : (
                                                    count > 0 && <span className="msb-badge msb-custom-badge">{count}</span>
                                                )}
                                                <span
                                                    className="msb-delete-btn"
                                                    title={`Delete folder "${folder.name}"`}
                                                    onClick={(e) => handleDeleteUserFolder(folder, e)}
                                                >
                                                    ✕
                                                </span>
                                            </div>
                                        );
                                    })}
                                    <div className="msb-drag-hint">
                                        Drag &amp; drop emails to organise
                                    </div>
                                </>
                            ) : (
                                <div className="msb-empty-hint">
                                    Click "+ New Folder" above, then drag emails into it
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* ─── Add / Create Folder Modal ───────────────────────────────────────── */}
            {showAddModal && (
                <div className="msb-modal-backdrop" onClick={() => setShowAddModal(false)}>
                    <div className="msb-modal-card" onClick={e => e.stopPropagation()}>
                        <div className="msb-modal-header">
                            <div>
                                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                                    {modalTab === 'custom'
                                        ? 'Create New Folder'
                                        : `+ Add Folder from ${provider === 'MICROSOFT' ? 'Outlook' : 'Zoho Mail'}`}
                                </h3>
                                <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--color-text-muted, #94a3b8)' }}>
                                    {modalTab === 'custom'
                                        ? 'Create a custom folder to organize emails with drag and drop.'
                                        : 'Select a folder from your connected mailbox to add to your sidebar.'}
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

                        {/* Modal Tabs */}
                        <div style={{ padding: '12px 20px 0 20px' }}>
                            <div className="msb-modal-tabs">
                                <button
                                    type="button"
                                    className={`msb-modal-tab${modalTab === 'custom' ? ' active' : ''}`}
                                    onClick={() => setModalTab('custom')}
                                >
                                    Custom Folder
                                </button>
                                <button
                                    type="button"
                                    className={`msb-modal-tab${modalTab === 'remote' ? ' active' : ''}`}
                                    onClick={handleSwitchToRemoteTab}
                                >
                                    From {provider === 'MICROSOFT' ? 'Outlook' : 'Zoho'}
                                </button>
                            </div>
                        </div>

                        <div className="msb-modal-body">
                            {modalTab === 'custom' ? (
                                <>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-primary)' }}>
                                            Folder Name
                                        </label>
                                        <input
                                            autoFocus
                                            type="text"
                                            className="form-control"
                                            placeholder="e.g. Invoices, Projects, Urgent…"
                                            value={newFolderName}
                                            onChange={e => setNewFolderName(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') handleCreateFolder();
                                                if (e.key === 'Escape') setShowAddModal(false);
                                            }}
                                            style={{ fontSize: 13.5, padding: '9px 12px' }}
                                        />
                                    </div>
                                </>
                            ) : (
                                <>
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
                                                                            {rf.totalItemCount} {rf.totalItemCount === 1 ? 'email' : 'emails'}
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
                                                    background: 'var(--color-table-row-alt, #f9fafc)',
                                                    border: '1px solid var(--color-border, #d0d7e3)',
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
                            {modalTab === 'custom' ? (
                                <button
                                    className="btn btn-primary"
                                    onClick={handleCreateFolder}
                                    disabled={!newFolderName.trim()}
                                    style={{ fontSize: 13, minWidth: 115 }}
                                >
                                    Create Folder
                                </button>
                            ) : (
                                <button
                                    className="btn btn-primary"
                                    onClick={handleConfirmAdd}
                                    disabled={!selectedRemote || submittingAdd}
                                    style={{ fontSize: 13, minWidth: 105 }}
                                >
                                    {submittingAdd ? 'Adding…' : 'Add Folder'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
