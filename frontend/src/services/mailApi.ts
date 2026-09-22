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
    to?: Array<{ name?: string; email: string }>;
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
    isRead: boolean;
    createdAt: string;
    email?: MailMessage;
    attachments?: MailAttachment[];
}

export interface Employee {
    id: string;
    _id?: string;
    username: string;
    email: string;
    role: string;
    displayName?: string;
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

// ── OAuth Redirects (browser navigation) ───────────────────

export function redirectToMicrosoftAuth(returnTo = '/mail-router') {
    const target = returnTo.startsWith('http') ? returnTo : `${window.location.origin}${returnTo}`;
    const params = new URLSearchParams({ returnTo: target });
    window.location.href = `${BASE}/mail/auth/microsoft?${params.toString()}`;
}

export function redirectToZohoAuth(returnTo = '/mail-router') {
    const target = returnTo.startsWith('http') ? returnTo : `${window.location.origin}${returnTo}`;
    const params = new URLSearchParams({ returnTo: target });
    window.location.href = `${BASE}/mail/auth/zoho?${params.toString()}`;
}

// ── Sync ────────────────────────────────────────────────────

export async function triggerSync(params: {
    accountId?: string;
    startDate?: string;
    endDate?: string;
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

// ── Emails ──────────────────────────────────────────────────

export async function listEmails(params: {
    startDate?: string;
    endDate?: string;
    accountId?: string;
    provider?: string;
    page?: number;
    limit?: number;
}): Promise<{ emails: MailMessage[]; total?: number }> {
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
    note?: string
): Promise<{ forwarded: number }> {
    const res = await fetch(`${BASE}/mail/emails/${emailId}/forward`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ recipientIds, note }),
    });
    return handleResponse(res);
}

// ── Employees ───────────────────────────────────────────────

export async function listEmployees(): Promise<{ employees: Employee[] }> {
    const res = await fetch(`${BASE}/mail/employees`, {
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
