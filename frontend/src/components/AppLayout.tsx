import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { 
    IconNotification, IconFolder, IconActivity 
} from './Icons';
import { useAuth } from '../context/AuthContext';
import { useState, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useMessage } from '../context/MessageContext';

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
    '/admin/clients': 'Client Management',
    '/admin/rfi': 'RFI Management',
    '/dashboard/settings': 'Account Settings',
    '/dashboard/notifications': 'Notifications Hub',
};

interface AppNotification {
    id: string;
    title: string;
    body: string;
    type: string;
    read: boolean;
    createdAt: string;
    icon?: React.ReactNode;
    time?: string;
}

function NotificationBell() {
    const navigate = useNavigate();
    const [showNotifications, setShowNotifications] = useState(false);
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const { user } = useAuth();
    const token = user?.token;

    useEffect(() => {
        if (token) {
            fetch('/steel/api/notifications', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            .then(res => res.json())
            .then(data => {
                if (data.notifications) {
                    // Map backend data to UI icons
                    const mapped = data.notifications.map((n: any) => ({
                        ...n,
                        id: n._id,
                        icon: n.type === 'assignment' ? <IconFolder /> : <IconActivity />,
                        time: new Date(n.createdAt).toLocaleDateString() === new Date().toLocaleDateString() ? 'Today' : new Date(n.createdAt).toLocaleDateString()
                    }));
                    setNotifications(mapped);
                }
            })
            .catch(err => console.error('Failed to fetch notifications:', err));
        }
    }, [token]);

    const handleMarkAllRead = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await fetch('/steel/api/notifications/mark-read', {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setNotifications([]);
        } catch (err) {
            console.error('Failed to mark all read:', err);
        }
    };

    return (
        <div style={{ position: 'relative' }}>
            <button 
                className="btn-icon" 
                onClick={() => setShowNotifications(!showNotifications)}
                style={{ 
                    position: 'relative',
                    color: showNotifications ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    background: showNotifications ? 'var(--color-primary-glow)' : 'transparent',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 32,
                    height: 32,
                    padding: 0
                }}
            >
                <div style={{ width: 18, height: 18 }}>
                    <IconNotification />
                </div>
                {notifications.length > 0 && (
                    <span style={{
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        background: 'var(--color-danger)',
                        border: '2px solid var(--color-bg-card)'
                    }} />
                )}
            </button>

            {showNotifications && (
                <>
                    <div 
                        style={{ position: 'fixed', inset: 0, zIndex: 999 }} 
                        onClick={() => setShowNotifications(false)} 
                    />
                    <div 
                        className="topbar-dropdown" 
                        style={{ 
                            position: 'absolute',
                            top: '50px',
                            right: '-10px', 
                            width: '380px', 
                            zIndex: 9999, 
                            display: 'block',
                            background: 'white',
                            boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
                            borderRadius: '16px',
                            border: '1px solid #e2e8f0',
                            overflow: 'hidden',
                            animation: 'dropdownScale 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                    >
                        <div className="dropdown-header" style={{ 
                            padding: '16px 20px',
                            borderBottom: '1px solid #f1f5f9',
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center',
                            background: '#f8fafc'
                        }}>
                            <span style={{ fontWeight: 700, fontSize: '15px', color: '#1e293b' }}>Notifications</span>
                            <span style={{ 
                                fontSize: '12px', 
                                fontWeight: 500, 
                                color: 'var(--color-primary)', 
                                cursor: 'pointer'
                            }}
                                onClick={handleMarkAllRead}
                            >Mark all read</span>
                        </div>
                        <div className="dropdown-list" style={{ maxHeight: 380, overflowY: 'auto' }}>
                            {notifications.length > 0 ? notifications.map(n => (
                                <div key={n.id} className="dropdown-item" style={{ 
                                    padding: '16px 20px', 
                                    display: 'flex', 
                                    gap: 16, 
                                    borderBottom: '1px solid var(--color-border-light)',
                                    cursor: 'pointer',
                                    transition: 'background 0.2s'
                                }}>
                                    <div style={{ 
                                        width: 40, 
                                        height: 40, 
                                        borderRadius: '12px', 
                                        background: n.type === 'assignment' ? 'var(--color-primary-glow)' : 'var(--color-bg-page)',
                                        color: n.type === 'assignment' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                        fontSize: 18
                                    }}>
                                        {n.icon}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>{n.title}</div>
                                        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{n.body}</div>
                                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--color-primary)' }}></span>
                                            {n.time}
                                        </div>
                                    </div>
                                </div>
                            )) : (
                                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                    <div style={{ fontSize: 32, marginBottom: 12 }}>🔔</div>
                                    <div style={{ fontSize: 14 }}>No new notifications</div>
                                </div>
                            )}
                        </div>
                        <div style={{ padding: '12px 20px', background: 'var(--color-bg-page)' }}>
                            <button 
                                className="btn-primary w-full" 
                                style={{ padding: '8px', fontSize: 13 }}
                                onClick={() => {
                                    navigate('/dashboard/notifications');
                                    setShowNotifications(false);
                                }}
                            >
                                View all notifications
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

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
    const { settings, updateSettings } = useSettings();
    const isDark = settings.darkMode;

    const toggleTheme = () => {
        updateSettings({ darkMode: !isDark });
    };

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
    const { showConfirm } = useMessage();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [showUserDropdown, setShowUserDropdown] = useState(false);

    const pageTitle =
        PAGE_TITLES[pathname] ??
        (pathname.includes('/projects/') ? 'Project View' : 'CALDIM steel dwf');

    const initials = user?.username?.slice(0, 2).toUpperCase() ?? 'U';
    const isAdmin = user?.role === 'admin';

    return (
        <div className="app-shell">
            <Sidebar 
                collapsed={sidebarCollapsed} 
                onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} 
            />
            <div className={`main-content ${sidebarCollapsed ? 'expanded' : ''}`}>
                {/* Topbar */}
                <header className="topbar">
                    <style>{`
                        @keyframes dropdownScale {
                            0% { opacity: 0; transform: translateY(-5px) scale(0.98); }
                            100% { opacity: 1; transform: translateY(0) scale(1); }
                        }
                    `}</style>
                    <span className="topbar-title">{pageTitle}</span>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <LiveClock />
                        <ThemeToggle />
                        <NotificationBell />
                        
                        <div 
                            className="topbar-profile"
                            onClick={() => setShowUserDropdown(!showUserDropdown)}
                            style={{ 
                                position: 'relative',
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: 10, 
                                cursor: 'pointer',
                                padding: '4px 8px',
                                borderRadius: '12px',
                                transition: 'background 0.2s',
                            }}
                        >
                            <span className={`topbar-badge ${isAdmin ? 'admin-badge' : ''}`} style={{ margin: 0 }}>
                                {isAdmin ? 'Admin' : 'User'}
                            </span>
                            <div className="topbar-user-avatar" style={{ margin: 0 }}>{initials}</div>
                            
                            {/* Dropdown Menu */}
                            {showUserDropdown && (
                                <div style={{
                                    position: 'absolute',
                                    top: 'calc(100% + 8px)',
                                    right: 0,
                                    width: '180px',
                                    background: '#ffffff',
                                    borderRadius: '16px',
                                    boxShadow: '0 12px 30px rgba(0,0,0,0.12), 0 4px 6px -2px rgba(0,0,0,0.05)',
                                    border: '1px solid var(--color-border-light)',
                                    padding: '8px',
                                    zIndex: 1000,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '2px',
                                    animation: 'dropdownIn 0.2s ease-out'
                                }}>
                                    <div style={{ padding: '8px 12px', marginBottom: '4px', borderBottom: '1px solid #f1f5f9' }}>
                                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>{user?.username}</div>
                                        <div style={{ fontSize: '10px', color: '#64748b' }}>{user?.email}</div>
                                    </div>
                                    
                                    <button 
                                        className="btn btn-ghost" 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            navigate(isAdmin ? '/admin/settings' : '/dashboard/settings');
                                            setShowUserDropdown(false);
                                        }}
                                        style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 12px', fontSize: '13px', borderRadius: '8px' }}
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ marginRight: '8px' }}>
                                            <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                                            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V11a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                                        </svg>
                                        Settings
                                    </button>

                                    <button 
                                        className="btn btn-ghost" 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            showConfirm('Logout', 'Are you sure you want to log out of the system?', () => {
                                                logout();
                                                navigate('/login');
                                            });
                                        }}
                                        style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 12px', fontSize: '13px', borderRadius: '8px', color: '#dc2626' }}
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ marginRight: '8px' }}>
                                            <path d="M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                                        </svg>
                                        Logout
                                    </button>
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
