import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useState, useEffect, useRef } from 'react';
import { useSettings } from '../context/SettingsContext';

const PAGE_TITLES: Record<string, string> = {
    '/admin': 'Dashboard Overview',
    '/admin/projects': 'Project Management',
    '/admin/users': 'User Management',
    '/admin/permissions': 'Permission Assignment',
    '/admin/status': 'Project Status',
    '/admin/settings': 'System Settings',
    '/admin/reports': 'Reports & Analytics',
    '/dashboard': 'My Dashboard',
    '/dashboard/projects': 'My Projects',
    '/dashboard/rfi': 'My RFIs',
    '/dashboard/settings': 'Account Settings',
};

function LiveClock() {
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const { settings } = useSettings();

    const timeStr = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: settings.timezone,
    });

    // Handle dynamic date format
    const formatDate = (date: Date, fmt: string, tz: string) => {
        const parts = new Intl.DateTimeFormat('en-US', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            weekday: 'short',
            timeZone: tz
        }).formatToParts(date);

        const d = parts.find(p => p.type === 'day')?.value || '';
        const m = parts.find(p => p.type === 'month')?.value || '';
        const y = parts.find(p => p.type === 'year')?.value || '';
        const wd = parts.find(p => p.type === 'weekday')?.value || '';

        if (fmt === 'DD/MM/YYYY') return `${wd}, ${d}/${m}/${y}`;
        if (fmt === 'MM/DD/YYYY') return `${wd}, ${m}/${d}/${y}`;
        if (fmt === 'YYYY-MM-DD') return `${wd}, ${y}-${m}-${d}`;
        return `${wd}, ${m} ${d}, ${y}`; // Fallback
    };

    const dateStr = formatDate(now, settings.dateFormat, settings.timezone);

    return (
        <div className="topbar-clock">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="topbar-clock-time">{timeStr}</span>
            <span className="topbar-clock-sep">·</span>
            <span className="topbar-clock-date">{dateStr}</span>
        </div>
    );
}

function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();
    const isDark = theme === 'dark';

    return (
        <button
            className="topbar-theme-btn"
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
        >
            {isDark ? (
                /* Sun icon for dark mode (click to go light) */
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="5" />
                    <line x1="12" y1="1" x2="12" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="23" />
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                    <line x1="1" y1="12" x2="3" y2="12" />
                    <line x1="21" y1="12" x2="23" y2="12" />
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
            ) : (
                /* Moon icon for light mode (click to go dark) */
                <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
                    <path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
                </svg>
            )}
        </button>
    );
}

export default function AppLayout() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const pageTitle =
        PAGE_TITLES[pathname] ??
        (pathname.includes('/projects/') ? 'Project View' : 'Steel Detailing DMS');

    const initials = user?.username?.slice(0, 2).toUpperCase() ?? 'U';
    const isAdmin = user?.role === 'admin';

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    // Close dropdown on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setDropdownOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="app-shell">
            <Sidebar 
                collapsed={sidebarCollapsed} 
                onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} 
            />
            <div className={`main-content ${sidebarCollapsed ? 'expanded' : ''}`}>
                {/* Topbar */}
                <header className="topbar">
                    <span className="topbar-title">{pageTitle}</span>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <LiveClock />
                        <ThemeToggle />
                        <span className={`topbar-badge ${isAdmin ? 'admin-badge' : ''}`}>
                            {isAdmin ? 'Admin' : 'User'}
                        </span>
                        
                        {/* User Avatar & Settings Dropdown */}
                        <div className="pr" ref={dropdownRef}>
                            <button 
                                className="topbar-user-avatar-btn" 
                                onClick={() => setDropdownOpen(!dropdownOpen)}
                                title="User settings"
                            >
                                <div className="topbar-user-avatar" style={{ border: dropdownOpen ? '2px solid var(--color-primary)' : 'none' }}>
                                    {initials}
                                </div>
                            </button>

                            {dropdownOpen && (
                                <div className="user-dropdown-menu">
                                    <div className="dropdown-header">
                                        <div className="user-info">
                                            <div className="user-name">{user?.username}</div>
                                            <div className="user-email">{user?.email || 'System Account'}</div>
                                        </div>
                                    </div>
                                    <div className="dropdown-divider"></div>
                                    <div className="dropdown-body">
                                        <Link to={isAdmin ? "/admin/settings" : "/dashboard/settings"} className="dropdown-item" onClick={() => setDropdownOpen(false)}>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                                <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                                                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                                            </svg>
                                            Manage Profile
                                        </Link>
                                        {isAdmin && (
                                            <Link to="/admin/reports" className="dropdown-item" onClick={() => setDropdownOpen(false)}>
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                                    <path d="M12 20V10M18 20V4M6 20v-4" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                                System Analytics
                                            </Link>
                                        )}
                                        <div className="dropdown-divider"></div>
                                        <button className="dropdown-item logout-item" onClick={handleLogout}>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                            Logout
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                {/* Page */}
                <main className="page-content">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
