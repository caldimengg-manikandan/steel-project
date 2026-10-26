import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types';

// Roles that have full system access (equivalent to admin)
const FULL_ACCESS_ROLES: UserRole[] = ['admin', 'superadmin', 'project_manager', 'team_lead', 'assistant_project_manager', 'assistant_team_lead'];

interface ProtectedRouteProps {
    children: React.ReactNode;
    requiredRole?: UserRole;
}

export default function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
    const { user, isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--color-bg-page, #f8fafc)' }}>
                <div style={{ fontSize: 14, color: '#64748b' }}>Loading session...</div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    // If admin access is required, allow any full-access role
    if (requiredRole === 'admin' && user?.role && !FULL_ACCESS_ROLES.includes(user.role)) {
        return <Navigate to="/dashboard" replace />;
    }

    return <>{children}</>;
}
