import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { IconFolder, IconActivity } from '../../components/Icons';

interface Notification {
    _id: string;
    title: string;
    body: string;
    type: string;
    read: boolean;
    createdAt: string;
}

export default function NotificationsPage() {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const { user } = useAuth();
    const token = user?.token;

    useEffect(() => {
        if (token) {
            fetch('/steeldms/api/notifications', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            .then(res => res.json())
            .then(data => {
                if (data.notifications) {
                    setNotifications(data.notifications);
                }
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to fetch notifications:', err);
                setLoading(false);
            });
        }
    }, [token]);

    const handleMarkRead = async (id: string) => {
        // Just local for now, could be an API call
        setNotifications(notifications.map(n => n._id === id ? { ...n, read: true } : n));
    };

    return (
        <div className="notifications-container">
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Notifications</h1>
                    <p className="page-subtitle">View and manage your recent activity and assignments.</p>
                </div>
            </div>

            <div className="card">
                <div className="card-body" style={{ padding: 0 }}>
                    {loading ? (
                        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading...</div>
                    ) : notifications.length > 0 ? (
                        <div className="notification-list">
                            {notifications.map((n) => (
                                <div 
                                    key={n._id} 
                                    style={{ 
                                        padding: '20px 24px', 
                                        display: 'flex', 
                                        gap: 20, 
                                        borderBottom: '1px solid var(--color-border-light)',
                                        background: n.read ? 'transparent' : 'rgba(30, 79, 216, 0.02)',
                                        position: 'relative'
                                    }}
                                >
                                    <div style={{ 
                                        width: 44, 
                                        height: 44, 
                                        borderRadius: '12px', 
                                        background: n.type === 'assignment' ? 'var(--color-primary-glow)' : 'var(--color-bg-page)',
                                        color: n.type === 'assignment' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                        fontSize: 20
                                    }}>
                                        {n.type === 'assignment' ? <IconFolder /> : <IconActivity />}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)' }}>{n.title}</div>
                                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                                {new Date(n.createdAt).toLocaleString()}
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                                            {n.body}
                                        </div>
                                        {!n.read && (
                                            <button 
                                                onClick={() => handleMarkRead(n._id)}
                                                style={{ 
                                                    marginTop: 12, 
                                                    fontSize: 12, 
                                                    color: 'var(--color-primary)', 
                                                    background: 'none', 
                                                    border: 'none', 
                                                    cursor: 'pointer',
                                                    padding: 0,
                                                    fontWeight: 600
                                                }}
                                            >
                                                Mark as read
                                            </button>
                                        )}
                                    </div>
                                    {!n.read && (
                                        <div style={{ 
                                            position: 'absolute', 
                                            left: 0, 
                                            top: 0, 
                                            bottom: 0, 
                                            width: 3, 
                                            background: 'var(--color-primary)' 
                                        }} />
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ padding: 60, textAlign: 'center' }}>
                            <div style={{ fontSize: 40, marginBottom: 16 }}>🔔</div>
                            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>No notifications yet</div>
                            <div style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 4 }}>
                                When you have new assignments or updates, they'll appear here.
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
