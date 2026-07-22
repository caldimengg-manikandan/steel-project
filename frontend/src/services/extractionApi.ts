/**
 * ============================================================
 * Extraction API Service (Frontend)
 * ============================================================
 * Wraps all backend extraction endpoints.
 * While JWT/real auth is wired up, the app falls back to
 * mock data in demo mode (no backend running).
 */

import type { DrawingExtraction } from '../types';

const BASE = import.meta.env.VITE_API_URL || '/steel/api';

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
    sequences?: string[],
    purpose?: string
): Promise<{ message: string; extractionIds: string[]; status: string }> {
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

    if (purpose) {
        form.append('purpose', purpose);
    }

    const res = await fetch(`${BASE}/extractions/${String(projectId)}/upload`, {
        method: 'POST',
        credentials: 'include',
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
    const res = await fetch(`${BASE}/extractions/${String(projectId)}`, {
        credentials: 'include'
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
        { method: 'POST', credentials: 'include' }
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
        { method: 'DELETE', credentials: 'include' }
    );
    return handleResponse(res);
}

// ── PDF view URL (GridFS stream) ───────────────────────────
export function getDrawingViewUrl(projectId: string, extractionId: string): string {
    return `${BASE}/extractions/${String(projectId)}/${String(extractionId)}/view.pdf`;
}

// ── Excel download URL ────────────────────────────────────
export function getExcelDownloadUrl(projectId: string, type?: 'transmittal' | 'log'): string {
    const params = [];
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
    const res = await fetch(`${BASE}/extractions/${String(projectId)}/check-duplicates`, {
        method: 'POST',
        credentials: 'include',
        headers: {
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
    const res = await fetch(`${BASE}/admin/projects/${String(projectId)}/reserve-transmittal`, {
        method: 'POST',
        credentials: 'include'
    });
    return handleResponse(res);
}
