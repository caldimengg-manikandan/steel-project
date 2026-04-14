import type { Project, User, ActivityEntry, Drawing, RevisionEntry } from '../types';

// ── Projects ────────────────────────────────────────────────
export const MOCK_PROJECTS: Project[] = [
    // ── Admin1 (a001) projects ──
    {
        id: 'p001',
        name: 'SteelFrame Tower A',
        clientName: 'Infra Corp Ltd.',
        description: 'Structural steel detailing for 18-storey tower block.',
        status: 'active',
        createdAt: '2025-11-01',
        updatedAt: '2026-02-20',
        approximateDrawingsCount: 50,
        location: 'Chennai',
        sequences: [],
        createdByAdminId: 'a001',
        assignments: [
            { userId: 'u002', username: 'keerthi', permission: 'editor' },
            { userId: 'u003', username: 'rajesh', permission: 'viewer' },
        ],
        drawingCount: 42,
    },
    {
        id: 'p002',
        name: 'Bridge Fabrication \u2013 NH44',
        clientName: 'NHAI Projects',
        description: 'Fabrication drawings for steel girder bridge.',
        status: 'active',
        createdAt: '2025-12-10',
        updatedAt: '2026-02-18',
        approximateDrawingsCount: 30,
        location: 'Hosur',
        sequences: [],
        createdByAdminId: 'a001',
        assignments: [
            { userId: 'u002', username: 'keerthi', permission: 'admin' },
        ],
        drawingCount: 18,
    },
    {
        id: 'p003',
        name: 'Industrial Shed \u2013 Phase II',
        clientName: 'Bharat Manufacturing',
        description: 'Pre-engineered building drawings, Phase 2 expansion.',
        status: 'on_hold',
        createdAt: '2025-09-15',
        updatedAt: '2026-01-05',
        approximateDrawingsCount: 40,
        location: 'Chennai',
        sequences: [],
        createdByAdminId: 'a001',
        assignments: [
            { userId: 'u003', username: 'rajesh', permission: 'editor' },
        ],
        drawingCount: 31,
    },

    // ── Admin2 (a002) projects — Admin1 should NEVER see these ──
    {
        id: 'p004',
        name: 'Warehouse Complex \u2013 WH7',
        clientName: 'Logistics India Pvt.',
        description: 'Cold-chain warehouse structural steel.',
        status: 'completed',
        createdAt: '2025-07-01',
        updatedAt: '2025-12-30',
        approximateDrawingsCount: 80,
        location: 'Chennai',
        sequences: [],
        createdByAdminId: 'a002',
        assignments: [
            { userId: 'u006', username: 'kumar', permission: 'viewer' },
        ],
        drawingCount: 67,
    },
    {
        id: 'p005',
        name: 'Substation Canopy',
        clientName: 'PowerGrid Corp',
        description: 'Canopy structure over 220kV substation.',
        status: 'active',
        createdAt: '2026-01-10',
        updatedAt: '2026-02-22',
        approximateDrawingsCount: 20,
        location: 'Hosur',
        sequences: [],
        createdByAdminId: 'a002',
        assignments: [
            { userId: 'u005', username: 'jas', permission: 'editor' },
            { userId: 'u007', username: 'leo', permission: 'viewer' },
        ],
        drawingCount: 9,
    },
];

// ── Users ────────────────────────────────────────────────────
export const MOCK_USERS: User[] = [
    // Admin accounts
    { id: 'a001', username: 'admin', email: 'admin@steeldetailing.com', role: 'admin', status: 'active', createdAt: '2025-06-01', adminId: 'a001' },
    { id: 'a002', username: 'admin2', email: 'admin2@steeldetailing.com', role: 'admin', status: 'active', createdAt: '2025-07-01', adminId: 'a002' },

    // Admin1 (a001) owns: keerthi, rajesh, priya
    { id: 'u002', username: 'keerthi', email: 'keerthi@steeldetailing.com', role: 'user', status: 'active', createdAt: '2025-10-15', adminId: 'a001' },
    { id: 'u003', username: 'rajesh', email: 'rajesh@steeldetailing.com', role: 'user', status: 'active', createdAt: '2025-11-03', adminId: 'a001' },
    { id: 'u004', username: 'priya', email: 'priya@steeldetailing.com', role: 'user', status: 'inactive', createdAt: '2025-08-20', adminId: 'a001' },

    // Admin2 (a002) owns: jas, kumar, leo — Admin1 should NEVER see these
    { id: 'u005', username: 'jas', email: 'jas@firm2.com', role: 'user', status: 'active', createdAt: '2025-10-20', adminId: 'a002' },
    { id: 'u006', username: 'kumar', email: 'kumar@firm2.com', role: 'user', status: 'active', createdAt: '2025-11-10', adminId: 'a002' },
    { id: 'u007', username: 'leo', email: 'leo@firm2.com', role: 'user', status: 'active', createdAt: '2025-12-01', adminId: 'a002' },
];

// ── Activity ─────────────────────────────────────────────────
export const MOCK_ACTIVITY: ActivityEntry[] = [
    { id: 'a1', action: 'Uploaded drawing', user: 'keerthi', target: 'A-101 Rev 0', timestamp: '2026-02-23 14:22' },
    { id: 'a2', action: 'Created project', user: 'admin', target: 'Substation Canopy', timestamp: '2026-02-22 09:14' },
    { id: 'a3', action: 'Assigned user', user: 'admin', target: 'keerthi → Bridge NH44', timestamp: '2026-02-21 16:45' },
    { id: 'a4', action: 'Revised drawing', user: 'rajesh', target: 'S-014 Rev A', timestamp: '2026-02-20 11:30' },
    { id: 'a5', action: 'Status changed', user: 'admin', target: 'Industrial Shed → On Hold', timestamp: '2026-01-05 08:00' },
];

// ── Drawings ─────────────────────────────────────────────────
export const MOCK_DRAWINGS: Record<string, Drawing[]> = {
    p001: [
        { id: 'd1', sheetNo: 'A-101', description: 'General Arrangement – Ground Floor', revisionMark: 'Rev 0', date: '2025-11-15', remarks: 'For Fabrication', uploadedBy: 'keerthi', uploadedAt: '2025-11-16', fileName: 'A-101_Rev0.pdf' },
        { id: 'd2', sheetNo: 'A-102', description: 'Column Schedule – Levels 1-6', revisionMark: 'Rev A', date: '2025-12-02', remarks: 'For Approval', uploadedBy: 'keerthi', uploadedAt: '2025-12-03', fileName: 'A-102_RevA.pdf' },
        { id: 'd3', sheetNo: 'S-011', description: 'Beam Connection Details', revisionMark: 'Rev 0', date: '2026-01-10', remarks: 'For Fabrication', uploadedBy: 'keerthi', uploadedAt: '2026-01-11', fileName: 'S-011_Rev0.pdf' },
        { id: 'd4', sheetNo: 'S-012', description: 'Base Plate Details', revisionMark: 'Rev A', date: '2026-01-18', remarks: 'For Approval', uploadedBy: 'keerthi', uploadedAt: '2026-01-19', fileName: 'S-012_RevA.pdf' },
    ],
    p002: [
        { id: 'd5', sheetNo: 'BR-001', description: 'Bridge General Arrangement', revisionMark: 'Rev 0', date: '2026-01-25', remarks: 'For Fabrication', uploadedBy: 'keerthi', uploadedAt: '2026-01-26', fileName: 'BR-001_Rev0.pdf' },
        { id: 'd6', sheetNo: 'BR-002', description: 'Girder Fabrication Details', revisionMark: 'Rev A', date: '2026-02-01', remarks: 'For Approval', uploadedBy: 'keerthi', uploadedAt: '2026-02-02', fileName: 'BR-002_RevA.pdf' },
    ],
};

// ── Revisions ─────────────────────────────────────────────────
export const MOCK_REVISIONS: Record<string, RevisionEntry[]> = {
    d1: [
        { id: 'r1', drawingId: 'd1', revMark: 'Rev 0', date: '2025-11-15', description: 'Initial issue for fabrication', revisedBy: 'keerthi' },
    ],
    d2: [
        { id: 'r2', drawingId: 'd2', revMark: 'Rev A', date: '2025-12-02', description: 'Client comments incorporated', revisedBy: 'keerthi' },
        { id: 'r3', drawingId: 'd2', revMark: 'Rev B', date: '2026-01-20', description: 'Dimension corrections', revisedBy: 'rajesh' },
    ],
};
