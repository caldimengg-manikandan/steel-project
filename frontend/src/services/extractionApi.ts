/**
 * ============================================================
 * Extraction API Service (Frontend)
 * ============================================================
 * Wraps all backend extraction endpoints.
 * While JWT/real auth is wired up, the app falls back to
 * mock data in demo mode (no backend running).
 */

import type { DrawingExtraction } from '../types';

const BASE = import.meta.env.VITE_API_URL || 'https://steel-dms-backend.onrender.com/api';

// ── Auth token helper ─────────────────────────────────────
function getToken(): string {
    try {
        const u = sessionStorage.getItem('sdms_user');
        return u ? JSON.parse(u).token ?? '' : '';
    } catch {
        return '';
    }
}

function authHeaders(): HeadersInit {
    const t = getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
}

// ── Response handler ─────────────────────────────────────
async function handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
}

// ── Upload a PDF drawing ──────────────────────────────────
export async function uploadDrawing(
    projectId: string,
    files: File[],
    localSavePath?: string,
    targetTransmittalNumber?: number | null,
    sequences?: string[]
): Promise<{ message: string; extractionIds: string[]; status: string }> {
    const token = getToken();
    if (!token) {
        throw new Error('No security token found. Please logout and login again using the "Real Portal Credentials" shown on the login page.');
    }

    const form = new FormData();
    files.forEach(file => {
        form.append('drawings', file);
        // If webkitRelativePath is available (from folder upload), keep it so backend sees the folder structure
        form.append('paths', (file as any).customRelativePath || file.webkitRelativePath || file.name);
    });

    if (localSavePath) {
        form.append('localSavePath', localSavePath);
    }

    if (targetTransmittalNumber != null) {
        form.append('targetTransmittalNumber', String(targetTransmittalNumber));
    }

    if (sequences && sequences.length > 0) {
        sequences.forEach(s => form.append('sequences', s));
    }

    const res = await fetch(`${BASE}/extractions/${String(projectId)}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
    });
    return handleResponse(res);
}

// ── List extractions for a project ───────────────────────
export async function listExtractions(projectId: string): Promise<{
    extractions: DrawingExtraction[];
    hasExcel: boolean;
    excelDownloadUrl: string | null;
}> {
    const token = getToken();
    if (!token) {
        throw new Error('No security token found.');
    }

    const res = await fetch(`${BASE}/extractions/${String(projectId)}`, {
        headers: {
            Authorization: `Bearer ${token}`
        },
    });
    return handleResponse(res);
}

// ── Reprocess a failed extraction ────────────────────────
export async function reprocessExtraction(
    projectId: string,
    extractionId: string
): Promise<{ message: string; status: string }> {
    const res = await fetch(
        `${BASE}/extractions/${String(projectId)}/${String(extractionId)}/reprocess`,
        { method: 'POST', headers: authHeaders() }
    );
    return handleResponse(res);
}

// ── Delete an extraction ─────────────────────────────────
export async function deleteExtraction(
    projectId: string,
    extractionId: string
): Promise<{ message: string }> {
    const res = await fetch(
        `${BASE}/extractions/${String(projectId)}/${String(extractionId)}`,
        { method: 'DELETE', headers: authHeaders() }
    );
    return handleResponse(res);
}

// ── PDF view URL (GridFS stream) ───────────────────────────
export function getDrawingViewUrl(projectId: string, extractionId: string): string {
    const t = getToken();
    const q = t ? `?token=${encodeURIComponent(t)}` : '';
    return `${BASE}/extractions/${String(projectId)}/${String(extractionId)}/view${q}`;
}

// ── Excel download URL ────────────────────────────────────
export function getExcelDownloadUrl(projectId: string, type?: 'transmittal' | 'log'): string {
    const t = getToken();
    const params = [];
    if (t) params.push(`token=${encodeURIComponent(t)}`);
    if (type) params.push(`type=${type}`);
    const q = params.length > 0 ? '?' + params.join('&') : '';
    return `${BASE}/extractions/${String(projectId)}/excel/download${q}`;
}

// ── Pre-flight Duplicate Check ────────────────────────────
/**
 * Check whether any of the given filenames already exist as completed
 * extractions in this project (same filename = same drawing).
 * Returns a list of confirmed duplicates with their sheet number and revision.
 */
export async function checkDuplicates(
    projectId: string,
    filenames: string[]
): Promise<{
    hasDuplicates: boolean;
    duplicateCount: number;
    duplicates: Array<{ filename: string; sheetNumber: string; revision: string }>;
}> {
    const token = getToken();
    const res = await fetch(`${BASE}/extractions/${String(projectId)}/check-duplicates`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filenames }),
    });
    return handleResponse(res);
}
// ── Reserve Transmittal Number ────────────────────────────
export async function reserveTransmittalNumber(
    projectId: string
): Promise<{ transmittalNumber: number }> {
    const token = getToken();
    const res = await fetch(`${BASE}/admin/projects/${String(projectId)}/reserve-transmittal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    });
    return handleResponse(res);
}
