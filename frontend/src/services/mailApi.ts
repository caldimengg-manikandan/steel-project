// ============================================================
// Mail Router API Service
// Wraps all /api/mail/* backend endpoints
// ============================================================

const BASE = import.meta.env.VITE_API_URL || '/steel/api';

async function handleResponse(res: Response) {
    const text = await res.text();
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        if (!res.ok) throw new Error(`API Error ${res.status}: ${text || res.statusText}`);
        throw new Error('Malformed JSON response from server');
    }
    if (!res.ok) {
        throw new Error(data.error || data.message || `API Request failed (${res.status})`);
    }
    return data;
}

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Types ──────────────────────────────────────────────────

export interface MailFolder {
    id: string;
    name: string;
    icon: string; // icon identifier: 'inbox' | 'send' | 'spam' | 'draft' | 'trash' | 'archive' | string
    type: 'system' | 'custom';
    order: number;
    count: number | null;
    mappingId?: string;
    remoteFolderId?: string;
    provider?: string;
}

export interface MailAccount {
    _id: string;
    id?: string;
    userId: string;
    provider: 'MICROSOFT' | 'ZOHO';
    email: string;
    displayName?: string;
    isActive: boolean;
    accessToken?: string;
    tokenExpiresAt?: string;
}

export interface ExtractedLink {
    url: string;
    text?: string | null;
}

export interface MailAttachment {
    id?: string;
    _id?: string;
    filename?: string;
    name?: string;
    contentType?: string;
    sizeBytes?: number;
    size?: number;
    providerAttachmentId?: string;
}

export interface MailMessage {
    _id: string;
    id?: string;
    accountId: string;
    providerId: string;
    subject: string;
    from: { name?: string; email: string };
    to?: Array<{ name?: string; email: string }> | { name?: string; email: string };
    toName?: string;
    toAddress?: string;
    fromName?: string;
    fromAddress?: string;
    bodyHtml?: string;
    bodyText?: string;
    receivedAt: string;
    attachments?: MailAttachment[];
    hasAttachments?: boolean;
    links?: Array<string | ExtractedLink>;
    forwardedTo?: string[];
    isForwarded?: boolean;
    folder?: string;
    isSpam?: boolean;
    snippetText?: string;
    provider?: string;
}

export interface SyncJob {
    _id: string;
    accountId: string;
    status: 'RUNNING' | 'COMPLETED' | 'FAILED';
    startedAt: string;
    completedAt?: string;
    emailsSynced?: number;
    error?: string;
}

export interface InboxItem {
    _id: string;
    id?: string;
    forwardingId?: string;
    emailId: string;
    forwardedTo: string;
    forwardedBy: string;
    forwardedByName?: string;
    forwardedAt?: string;
    note?: string;
    projectId?: string;
    projectName?: string;
    isRead: boolean;
    createdAt: string;
    email?: MailMessage;
    attachments?: MailAttachment[];
}

export interface ProjectInfo {
    id: string;
    _id?: string;
    name: string;
    clientName?: string;
    status?: string;
    assignedUserIds: string[];
    memberCount: number;
}

export interface Employee {
    id: string;
    _id?: string;
    username: string;
    name?: string;
    email: string;
    role: string;
    displayName?: string;
    projectIds?: string[];
    projects?: Array<{ id: string; name: string; permission?: string }>;
}

// ── Accounts ────────────────────────────────────────────────

export async function listMailAccounts(): Promise<{ accounts: MailAccount[] }> {
    const res = await fetch(`${BASE}/mail/accounts`, {
        credentials: 'include',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export async function deleteMailAccount(id: string): Promise<void> {
    const res = await fetch(`${BASE}/mail/accounts?id=${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export async function setActiveMailAccount(accountIdOrProvider: string): Promise<{
    success: boolean;
    message: string;
    account?: MailAccount;
}> {
    const isId = /^[0-9a-fA-F]{24}$/.test(accountIdOrProvider);
    const body = isId ? { accountId: accountIdOrProvider } : { provider: accountIdOrProvider };
    const res = await fetch(`${BASE}/mail/accounts/active`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
    });
    return handleResponse(res);
}

function resolveReturnToUrl(returnTo?: string): string {
    if (returnTo && (returnTo.startsWith('http://') || returnTo.startsWith('https://'))) {
        return returnTo;
    }
    const origin = window.location.origin;
    if (!returnTo) {
        return `${origin}${window.location.pathname}${window.location.search}`;
    }
    const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
    const cleanPath = returnTo.startsWith('/') ? returnTo : `/${returnTo}`;
    const fullPath = (base && base !== '/') ? `${base}${cleanPath}` : cleanPath;
    return `${origin}${fullPath}`;
}

export function redirectToMicrosoftAuth(returnTo?: string) {
    const target = resolveReturnToUrl(returnTo);
    const params = new URLSearchParams({ returnTo: target });
    window.location.href = `${BASE}/mail/auth/microsoft?${params.toString()}`;
}

export function redirectToZohoAuth(returnTo?: string) {
    const target = resolveReturnToUrl(returnTo);
    const params = new URLSearchParams({ returnTo: target });
    window.location.href = `${BASE}/mail/auth/zoho?${params.toString()}`;
}

// ── Sync ────────────────────────────────────────────────────

export async function triggerSync(params: {
    accountId?: string;
    startDate?: string;
    endDate?: string;
    folder?: string;
}): Promise<{ job: SyncJob }> {
    const res = await fetch(`${BASE}/mail/sync`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(params),
    });
    return handleResponse(res);
}

export async function listSyncJobs(): Promise<{ jobs: SyncJob[] }> {
    const res = await fetch(`${BASE}/mail/sync`, {
        credentials: 'include',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export async function getAutoSyncStatus(): Promise<{
    enabled: boolean;
    cronExpression: string;
    intervalDescription: string;
    isCycleRunning: boolean;
    lastRunAt?: string;
    lastRunStatus?: string;
    lastRunResults?: any[];
    currentlySyncingAccounts?: string[];
    activeMailboxesCount?: number;
}> {
    const res = await fetch(`${BASE}/mail/autosync/status`, {
        credentials: 'include',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export async function triggerAutoSync(): Promise<{ success: boolean; results?: any[]; duration?: number }> {
    const res = await fetch(`${BASE}/mail/autosync/trigger`, {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

// ── Emails ──────────────────────────────────────────────────

export async function listEmails(params: {
    startDate?: string;
    endDate?: string;
    accountId?: string;
    provider?: string;
    folder?: string;
    page?: number;
    limit?: number;
    offset?: number;
}): Promise<{ emails: MailMessage[]; total?: number; hasMore?: boolean }> {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) q.set(k, String(v));
    });
    const res = await fetch(`${BASE}/mail/emails?${q.toString()}`, {
        credentials: 'include',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export async function clearDownloadedEmails(): Promise<{ success: boolean; message: string; deleted?: any }> {
    const res = await fetch(`${BASE}/mail/emails`, {
        method: 'DELETE',
        credentials: 'include',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export async function getEmail(id: string): Promise<{ email: MailMessage; attachments?: MailAttachment[] }> {
    const res = await fetch(`${BASE}/mail/emails/${id}`, {
        credentials: 'include',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export async function forwardEmail(
    emailId: string,
    recipientIds: string[],
    note?: string,
    projectId?: string,
    projectName?: string
): Promise<{ forwarded?: number; success?: boolean; count?: number }> {
    const res = await fetch(`${BASE}/mail/emails/${emailId}/forward`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ recipientIds, note, projectId, projectName }),
    });
    return handleResponse(res);
}

// ── Employees & Projects ───────────────────────────────────

export async function listEmployees(): Promise<{ employees: Employee[]; projects?: ProjectInfo[] }> {
    const res = await fetch(`${BASE}/mail/employees`, {
        credentials: 'include',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export async function listProjects(): Promise<{ projects: ProjectInfo[]; employees?: Employee[] }> {
    const res = await fetch(`${BASE}/mail/projects`, {
        credentials: 'include',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

// ── Attachments ─────────────────────────────────────────────

export function getAttachmentUrl(id: string): string {
    const token = localStorage.getItem('token');
    const q = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${BASE}/mail/attachments/${id}${q}`;
}

// ── Inbox (Employee) ────────────────────────────────────────

export async function listInbox(params?: {
    page?: number;
    limit?: number;
}): Promise<{ items: InboxItem[]; total?: number; unreadCount?: number }> {
    const q = new URLSearchParams();
    if (params?.page !== undefined) q.set('page', String(params.page));
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    const res = await fetch(`${BASE}/mail/inbox?${q.toString()}`, {
        credentials: 'include',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export async function getInboxItem(id: string): Promise<{ item: InboxItem }> {
    const res = await fetch(`${BASE}/mail/inbox/${id}`, {
        credentials: 'include',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export async function getUnreadCount(): Promise<{ unreadCount: number }> {
    const res = await fetch(`${BASE}/mail/inbox/unread-count`, {
        credentials: 'include',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

// ── Folders ─────────────────────────────────────────────

export async function listMailFolders(provider?: string, startDate?: string, endDate?: string): Promise<{ folders: MailFolder[] }> {
    const params = new URLSearchParams();
    if (provider) params.set('provider', provider);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    const q = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${BASE}/mail/folders${q}`, {
        credentials: 'include',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export interface RemoteFolder {
    id: string;
    name: string;
    totalItemCount?: number;
    unreadItemCount?: number;
    isSystem?: boolean;
    provider: 'MICROSOFT' | 'ZOHO';
    isAdded?: boolean;
}

export async function listRemoteFolders(provider: string): Promise<{ folders: RemoteFolder[] }> {
    const res = await fetch(`${BASE}/mail/remote-folders?provider=${encodeURIComponent(provider)}`, {
        credentials: 'include',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export async function addCustomFolder(payload: {
    provider: string;
    remoteFolderId: string;
    name: string;
    icon?: string;
}): Promise<{ success: boolean; folder: MailFolder }> {
    const res = await fetch(`${BASE}/mail/custom-folders`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
    });
    return handleResponse(res);
}

export async function deleteCustomFolder(id: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${BASE}/mail/custom-folders/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

export async function updateEmailFolder(emailId: string, folder: string): Promise<{ success: boolean; id: string; folder: string; isSpam: boolean }> {
    const res = await fetch(`${BASE}/mail/emails/${emailId}/folder`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ folder }),
    });
    return handleResponse(res);
}

