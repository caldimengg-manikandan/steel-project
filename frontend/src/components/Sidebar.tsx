import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import logoImg from '../assets/logo/caldim_engineering_logo.jpg';
import { useSettings } from '../context/SettingsContext';
import {
    IconDashboard, IconFolder, IconUsers,
    IconPermissions, IconSettings, IconChart
} from './Icons';

interface NavItem {
    label: string;
    to: string;
    icon: React.ReactNode;
}

// Project Status icon
const IconProjectStatus = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
);

// RFI menu icon
const IconRfi = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

const adminNav: NavItem[] = [
    { label: 'Dashboard', to: '/admin', icon: <IconDashboard /> },
    { label: 'Projects', to: '/admin/projects', icon: <IconFolder /> },
    { label: 'Project Status', to: '/admin/status', icon: <IconProjectStatus /> },
    { label: 'Users', to: '/admin/users', icon: <IconUsers /> },
    { label: 'Permissions', to: '/admin/permissions', icon: <IconPermissions /> },
    { label: 'Clients', to: '/admin/clients', icon: <IconUsers /> },
    { label: 'RFI', to: '/admin/rfi', icon: <IconRfi /> },
    { label: 'Reports', to: '/admin/reports', icon: <IconChart /> },
    { label: 'Settings', to: '/admin/settings', icon: <IconSettings /> },
];

const userNav: NavItem[] = [
    { label: 'Dashboard', to: '/dashboard', icon: <IconDashboard /> },
    { label: 'My Projects', to: '/dashboard/projects', icon: <IconFolder /> },
    { label: 'RFI', to: '/dashboard/rfi', icon: <IconRfi /> },
    { label: 'Settings', to: '/dashboard/settings', icon: <IconSettings /> },
];

interface SidebarProps {
    collapsed: boolean;
    onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
    const { user } = useAuth();
    const FULL_ACCESS_ROLES = ['admin', 'superadmin', 'project_manager', 'team_lead'];
    const { settings } = useSettings();
    const isFullAccess = FULL_ACCESS_ROLES.includes(user?.role || '');
    
    let baseNav = isFullAccess ? [...adminNav] : [...userNav];

    // Filter based on global module toggles
    const navItems = baseNav.filter(item => {
        if (!settings.moduleProjects && (item.label.includes('Project') || item.to.includes('project'))) return false;
        if (!settings.moduleRfi && item.label.includes('RFI')) return false;
        if (!settings.moduleReports && item.label.includes('Reports')) return false;
        return true;
    });

    return (
        <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
            <button className="sidebar-toggle-btn" onClick={onToggle}>
                <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                    <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                </svg>
            </button>

            {/* Brand */}
            <div className="sidebar-header">
                <div className="sidebar-logo">
                    <img src={logoImg} alt="CALDIM Logo" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />
                </div>
                {!collapsed && (
                    <div className="sidebar-brand">
                        <span className="sidebar-brand-name">CALDIM</span>
                        <span className="sidebar-brand-sub">steel dwf</span>
                    </div>
                )}
            </div>

            {/* Nav */}
            <nav className="sidebar-nav">
                {!collapsed && <div className="sidebar-section-label">Main Menu</div>}
                {navItems.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === '/admin' || item.to === '/dashboard'}
                        className={({ isActive }) =>
                            'sidebar-nav-item' + (isActive ? ' active' : '')
                        }
                        title={collapsed ? item.label : ''}
                    >
                        <span className="icon-only">{item.icon}</span>
                        {!collapsed && <span>{item.label}</span>}
                    </NavLink>
                ))}
            </nav>

        </aside>
    );
}
