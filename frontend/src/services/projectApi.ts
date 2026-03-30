import type { AuthUser, Project, ProjectStatus } from '../types';

const BASE = import.meta.env.VITE_API_URL || 'https://steel-dms-backend.onrender.com/api';

function authHeaders(): Record<string, string> {
    const stored = sessionStorage.getItem('sdms_user');
    if (!stored) return {};
    const user: AuthUser = JSON.parse(stored);
    return {
        'Authorization': `Bearer ${user.token || ''}`,
        'Content-Type': 'application/json',
    };
}

async function handleResponse(res: Response) {
    const text = await res.text();
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch (e) {
        if (!res.ok) throw new Error(`API Error ${res.status}: ${text || res.statusText}`);
        throw new Error('Malformed JSON response from server');
    }

    if (!res.ok) {
        throw new Error(data.error || data.message || `API Request failed (${res.status})`);
    }
    return data;
}

/**
 * List all projects for the admin
 */
export async function adminListProjects(status?: string, search?: string): Promise<{ projects: Project[] }> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (search) params.append('search', search);

    const res = await fetch(`${BASE}/admin/projects?${params.toString()}`, {
        headers: authHeaders(),
    });
    return handleResponse(res);
}

/**
 * Create a new project
 */
export async function adminCreateProject(data: {
    name: string;
    clientName: string;
    clientId?: string;
    contactPerson?: any;
    description?: string;
    status?: ProjectStatus;
    approximateDrawingsCount?: number;
    location?: string;
    sequences?: Array<{ 
        name: string; 
        status: 'Completed' | 'Not Completed';
        approvalDate?: string;
        fabricationDate?: string;
        deadline?: string;
    }>;
    connectionDesignVendor?: string;
    connectionDesignContact?: string;
}): Promise<{ project: Project }> {
    const res = await fetch(`${BASE}/admin/projects`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(data),
    });
    return handleResponse(res);
}

/**
 * Assign a user to a project
 */
export async function adminAssignUser(projectId: string, data: {
    userId: string;
    permission: 'viewer' | 'editor' | 'admin';
}): Promise<{ project: Project }> {
    const res = await fetch(`${BASE}/admin/projects/${String(projectId)}/assignments`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(data),
    });
    return handleResponse(res);
}

/**
 * List projects for regular user (assigned to them)
 */
export async function userListProjects(): Promise<{ projects: Project[] }> {
    const res = await fetch(`${BASE}/user/projects`, {
        headers: authHeaders(),
    });
    return handleResponse(res);
}

/**
 * Get a single project by ID (scoped check on backend)
 */
export async function getProjectById(id: string): Promise<{ project: Project }> {
    const res = await fetch(`${BASE}/admin/projects/${String(id)}`, {
        headers: authHeaders(),
    });
    // Fallback try user route if admin fails (or just simplify backend)
    if (!res.ok && res.status === 403) {
        const resUser = await fetch(`${BASE}/user/projects/${String(id)}`, {
            headers: authHeaders(),
        });
        return handleResponse(resUser);
    }
    return handleResponse(res);
}

/**
 * Remove a user from a project
 */
export async function adminRemoveUserAssignment(projectId: string, userId: string): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE}/admin/projects/${String(projectId)}/assignments/${String(userId)}`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

/**
 * Delete a project (Admin)
 */
export async function adminDeleteProject(projectId: string): Promise<{ message: string }> {
    const res = await fetch(`${BASE}/admin/projects/${String(projectId)}`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    return handleResponse(res);
}

/**
 * Update a project (Admin)
 */
export async function adminUpdateProject(projectId: string, data: Partial<CreateProjectForm>): Promise<{ project: Project }> {
    const res = await fetch(`${BASE}/admin/projects/${String(projectId)}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(data),
    });
    return handleResponse(res);
}

/**
 * Update project sequences (Unified Admin/User)
 */
export async function updateProjectSequences(projectId: string, sequences: Array<{ 
    name: string; 
    status: 'Completed' | 'Not Completed';
    approvalDate?: string;
    fabricationDate?: string;
    deadline?: string;
}>): Promise<{ project: Project }> {
    // Try Admin endpoint first
    const res = await fetch(`${BASE}/admin/projects/${String(projectId)}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ sequences }),
    });

    if (res.status === 403) {
        // Try User endpoint specifically for sequences
        const resUser = await fetch(`${BASE}/user/projects/${String(projectId)}/sequences`, {
            method: 'PATCH',
            headers: authHeaders(),
            body: JSON.stringify({ sequences }),
        });
        return handleResponse(resUser);
    }
    
    return handleResponse(res);
}

interface CreateProjectForm {
    name: string;
    clientName: string;
    clientId?: string;
    contactPerson?: any;
    description: string;
    status: ProjectStatus;
    approximateDrawingsCount: number;
    location: string;
    sequences?: Array<{ 
        name: string; 
        status: 'Completed' | 'Not Completed';
        approvalDate?: string;
        fabricationDate?: string;
        deadline?: string;
    }>;
    connectionDesignVendor?: string;
    connectionDesignContact?: string;
}

/**
 * Upload COR Excel (Admin)
 */
export async function adminUploadCOR(projectId: string, file: File): Promise<{ message: string }> {
    const stored = sessionStorage.getItem('sdms_user');
    const token = stored ? JSON.parse(stored).token : '';

    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${BASE}/admin/projects/${String(projectId)}/cor`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`
            // Note: browser sets boundary if Content-Type is NOT set manually for FormData
        },
        body: formData
    });
    return handleResponse(res);
}

/**
 * Download the Project Status Excel report for all projects.
 * Triggers a browser download using a temporary anchor element.
 */
export async function downloadProjectStatusExcel(): Promise<void> {
    const stored = sessionStorage.getItem('sdms_user');
    const token = stored ? JSON.parse(stored).token : '';

    const res = await fetch(`${BASE}/admin/projects/status/excel`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Failed to download status report');
    }

    // Extract filename from Content-Disposition header
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : 'Project_Status_Report.xlsx';

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

