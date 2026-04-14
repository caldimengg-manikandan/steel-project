/**
 * ============================================================
 * useAdminScope
 * ============================================================
 * Central hook that returns ALL data pre-filtered to the
 * logged-in admin's scope.
 *
 * Usage:
 *   const { myProjects, myUsers, myStats } = useAdminScope();
 *
 * When connected to the real API, replace the mock-data
 * filters with API calls that already return scoped data.
 * The hook's interface (myProjects, myUsers) stays the same.
 */
import { useMemo } from 'react';
import { useAuth } from './AuthContext';
import { MOCK_PROJECTS, MOCK_USERS } from '../data/mockData';
import type { Project, User } from '../types';

export interface AdminScopeData {
    /** Projects created by the logged-in admin only */
    myProjects: Project[];
    /** Users owned by the logged-in admin only (excludes admin accounts) */
    myUsers: User[];
    /** Quick stats for admin dashboard */
    myStats: {
        totalProjects: number;
        activeProjects: number;
        onHoldProjects: number;
        totalUsers: number;
        activeUsers: number;
        totalDrawings: number;
    };
}

export function useAdminScope(): AdminScopeData {
    const { user } = useAuth();
    const adminId = user?.adminId ?? '';

    const myProjects = useMemo<Project[]>(
        () => MOCK_PROJECTS.filter((p) => p.createdByAdminId === adminId),
        [adminId]
    );

    const myUsers = useMemo<User[]>(
        () => MOCK_USERS.filter((u) => u.role === 'user' && u.adminId === adminId),
        [adminId]
    );

    const myStats = useMemo(() => ({
        totalProjects: myProjects.length,
        activeProjects: myProjects.filter((p) => p.status === 'active').length,
        onHoldProjects: myProjects.filter((p) => p.status === 'on_hold').length,
        totalUsers: myUsers.length,
        activeUsers: myUsers.filter((u) => u.status === 'active').length,
        totalDrawings: myProjects.reduce((s, p) => s + p.drawingCount, 0),
    }), [myProjects, myUsers]);

    return { myProjects, myUsers, myStats };
}
