// ============================================================
// Types for Steel Detailing Document Management System
// ============================================================

export type UserRole = 'admin' | 'user';
export type ProjectPermission = 'viewer' | 'editor' | 'admin';
export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived';
export type UserStatus = 'active' | 'inactive';

export interface User {
    id: string;
    _id?: string;
    username: string;
    email: string;
    role: UserRole;
    status: UserStatus;
    createdAt: string;
    /** Multi-tenant key: the admin who owns this user */
    adminId: string;
}

export interface ProjectAssignment {
    userId: string;
    username: string;
    permission: ProjectPermission;
}

export interface Drawing {
    id: string;
    sheetNo: string;
    description: string;
    revisionMark: string;
    date: string;
    remarks: string;
    uploadedBy: string;
    uploadedAt: string;
    fileName: string;
}

export interface RevisionEntry {
    id: string;
    drawingId: string;
    revMark: string;
    date: string;
    description: string;
    revisedBy: string;
}

export interface Project {
    id: string;
    _id?: string;
    name: string;
    clientName: string;
    description: string;
    status: ProjectStatus;
    location: string;
    createdAt: string;
    updatedAt: string;
    assignments: ProjectAssignment[];
    drawingCount: number;
    approximateDrawingsCount: number;
    approvalPercentage?: number;
    fabricationPercentage?: number;
    openRfiCount?: number;
    closedRfiCount?: number;
    totalCO?: number;
    approvedCO?: number;
    workCompletedCO?: number;
    pendingCO?: number;
    sequences: Array<{ name: string; status: 'Completed' | 'Not Completed' }>;
    /** Multi-tenant key: the admin who created this project */
    createdByAdminId: string;
    /** User-specific permission (injected for user dashboard) */
    permission?: ProjectPermission;
}

export interface AuthUser {
    id: string;
    username: string;
    email: string;
    role: UserRole;
    adminId: string;
    token?: string;
}

export interface ActivityEntry {
    id: string;
    action: string;
    user: string;
    target: string;
    timestamp: string;
}

// ============================================================
// Drawing Extraction Types (AI Agentic Extraction Feature)
// ============================================================

export type ExtractionStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface ExtractedFields {
    drawingNumber: string;
    drawingTitle: string;
    description: string;
    drawingDescription: string;
    revision: string;
    date: string;
    remarks: string;
    scale: string;
    clientName: string;
    projectName: string;
    revisionHistory: Array<{ mark: string; date: string; remarks: string }>;
}

export interface ValidationResult {
    drawingNumberValid: boolean | null;
    revisionValid: boolean | null;
    dateValid: boolean | null;
    warnings: string[];
}

export interface DrawingExtraction {
    _id: string;
    projectId: string;
    createdByAdminId: string;
    originalFileName: string;
    fileUrl: string;
    fileSize: number;
    uploadedBy: string;
    status: ExtractionStatus;
    errorMessage: string;
    extractionConfidence: number;        // 0–1
    processingTimeMs: number;
    extractedFields: ExtractedFields;
    validationResult: ValidationResult;
    excelPath: string;
    excelUrl: string;
    createdAt: string;
    updatedAt: string;
}

