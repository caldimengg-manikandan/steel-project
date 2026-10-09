import { useState } from 'react';
import {
    IconNotification, IconSettings, IconActivity
} from '../../components/Icons';
import { useSettings } from '../../context/SettingsContext';
import { useMessage } from '../../context/MessageContext';

type TabId = 'notifications' | 'ui' | 'security';

interface TabItem {
    id: TabId;
    label: string;
    icon: React.ReactNode;
    desc: string;
}

const TABS: TabItem[] = [
    { id: 'notifications', label: 'Notifications', icon: <IconNotification />, desc: 'Personal alerts and email schedules' },
    { id: 'ui', label: 'Preferences', icon: <IconSettings />, desc: 'Theme, timezone and language' },
    { id: 'security', label: 'Security', icon: <IconActivity />, desc: 'Change your account password' },
];

const Toggle = ({ enabled, onChange }: { enabled: boolean, onChange: (v: boolean) => void }) => (
    <div
        onClick={() => onChange(!enabled)}
        style={{
            width: 38,
            height: 20,
            borderRadius: 10,
            background: enabled ? 'var(--color-primary)' : 'var(--color-border)',
            position: 'relative',
            cursor: 'pointer',
            transition: 'background 0.2s',
            flexShrink: 0
        }}
    >
        <div style={{
            width: 14,
            height: 14,
            background: 'white',
            borderRadius: '50%',
            position: 'absolute',
            top: 3,
            left: enabled ? 21 : 3,
            transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
        }} />
    </div>
);

const SettingRow = ({ title, desc, children }: { title: string, desc: string, children: React.ReactNode }) => (
    <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 0',
        borderBottom: '1px solid var(--color-border-light)'
    }}>
        <div style={{ paddingRight: 24 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--color-text-primary)' }}>{title}</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>{desc}</div>
        </div>
        {children}
    </div>
);

const Card = ({ title, children }: { title: string, children: React.ReactNode }) => (
    <div className="card mb-lg">
        <div className="card-header">
            <span className="card-header-title">{title}</span>
        </div>
        <div className="card-body">
            {children}
        </div>
    </div>
);

const EyeIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
);

const EyeOffIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
);

const BASE = import.meta.env.VITE_API_URL || '/steel/api';

export default function UserSettings() {
    const [activeTab, setActiveTab] = useState<TabId>('notifications');
    const { settings, updateSettings } = useSettings();
    const { showMessage } = useMessage();

    // Local preferences for toggles
    const [localPrefs, setLocalPrefs] = useState(() => {
        const saved = localStorage.getItem('user_local_prefs');
        return saved ? JSON.parse(saved) : { inAppNotifications: true, weeklySummary: true };
    });

    const handleLocalPrefChange = (key: string, value: boolean) => {
        const updated = { ...localPrefs, [key]: value };
        setLocalPrefs(updated);
        localStorage.setItem('user_local_prefs', JSON.stringify(updated));
    };

    const handleSettingChange = (key: string, value: any) => {
        updateSettings({ [key]: value });
    };

    const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
    const [savingPw, setSavingPw] = useState(false);
    const [showPw, setShowPw] = useState({ current: false, newPw: false, confirm: false });

    const toggleBtnStyle: React.CSSProperties = {
        position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)',
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--color-text-muted)', padding: 4, display: 'flex'
    };

    const handleChangePassword = async () => {
        if (pwForm.newPassword.length < 6) {
            showMessage('Validation', 'New password must be at least 6 characters.', 'error');
            return;
        }
        setSavingPw(true);
        try {
            const res = await fetch(`${BASE}/auth/change-password`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword })
            });
            const data = await res.json();
            if (res.ok) {
                showMessage('Success', 'Password updated successfully! Use it next time you log in.', 'success');
                setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
            } else {
                showMessage('Failed', data.error || 'Failed to update password.', 'error');
            }
        } catch {
            showMessage('Error', 'Network error. Please try again.', 'error');
        } finally {
            setSavingPw(false);
        }
    };

    return (
        <div>
            <style>{`
                .settings-layout {
                    display: grid;
                    grid-template-columns: 260px 1fr;
                    gap: 32px;
                    align-items: flex-start;
                }
                .settings-nav {
                    background: var(--color-bg-card);
                    border: 1px solid var(--color-border);
                    border-radius: var(--radius-lg);
                    padding: 8px 0;
                    box-shadow: var(--shadow-sm);
                    position: sticky;
                    top: 80px;
                }
                .settings-nav-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 20px;
                    font-size: 14px;
                    color: var(--color-text-secondary);
                    cursor: pointer;
                    transition: all 0.2s;
                    border-left: 3px solid transparent;
                }
                .settings-nav-item:hover {
                    background: var(--color-bg-page);
                    color: var(--color-text-primary);
                }
                .settings-nav-item.active {
                    background: var(--color-primary-glow);
                    color: var(--color-primary);
                    border-left-color: var(--color-primary);
                    font-weight: 600;
                }
                .settings-nav-item svg {
                    width: 16px;
                    height: 16px;
                    opacity: 0.7;
                    flex-shrink: 0;
                }
                .settings-nav-item.active svg {
                    opacity: 1;
                }
            `}</style>

            <div className="page-header">
                <div className="page-header-left">
                    <h2 className="page-title">Personal Settings</h2>
                    <p className="page-subtitle">Manage your account preferences and security</p>
                </div>
            </div>

            <div className="settings-layout">
                <aside className="settings-nav">
                    {TABS.map(tab => (
                        <div
                            key={tab.id}
                            className={`settings-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.icon}
                            <span>{tab.label}</span>
                        </div>
                    ))}
                </aside>

                <main className="settings-content">
                    {activeTab === 'notifications' && (
                        <Card title="Project Alerts">
                            <SettingRow title="In-App Notifications" desc="Show an alert in the top bar bell when a new project is assigned to you">
                                <Toggle enabled={localPrefs.inAppNotifications} onChange={(v) => handleLocalPrefChange('inAppNotifications', v)} />
                            </SettingRow>
                            <SettingRow title="Weekly Dashboard Summary" desc="A summarized overview of your project progress">
                                <Toggle enabled={localPrefs.weeklySummary} onChange={(v) => handleLocalPrefChange('weeklySummary', v)} />
                            </SettingRow>
                        </Card>
                    )}

                    {activeTab === 'ui' && (
                        <Card title="Regional & Appearance">
                            <SettingRow title="Your Timezone" desc="Used for accurate activity timelines">
                                <select
                                    className="form-control"
                                    style={{ width: 220 }}
                                    value={settings.timezone}
                                    onChange={(e) => handleSettingChange('timezone', e.target.value)}
                                >
                                    <option value="Asia/Kolkata">India Standard Time (GMT+5:30)</option>
                                    <option value="UTC">Universal Coordinated Time (UTC)</option>
                                    <option value="America/New_York">Eastern Time (GMT-5:00)</option>
                                </select>
                            </SettingRow>
                            <SettingRow title="Dark Mode" desc="Switch to a dark color palette">
                                <Toggle enabled={settings.darkMode} onChange={(v) => handleSettingChange('darkMode', v)} />
                            </SettingRow>
                        </Card>
                    )}

                    {activeTab === 'security' && (
                        <Card title="Change Your Password">
                            <div style={{ maxWidth: 480 }}>
                                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>
                                    Update your account password. You will need to use the new password next time you log in.
                                </p>
                                <div className="form-group">
                                    <label className="form-label required">Current Password</label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            id="user-current-password"
                                            type={showPw.current ? 'text' : 'password'}
                                            className="form-control"
                                            placeholder="Enter current password"
                                            value={pwForm.currentPassword}
                                            onChange={e => setPwForm(p => ({ ...p, currentPassword: e.target.value }))}
                                            style={{ paddingRight: '2.5rem' }}
                                        />
                                        <button type="button" onClick={() => setShowPw(p => ({ ...p, current: !p.current }))} style={toggleBtnStyle}>
                                            {showPw.current ? <EyeOffIcon /> : <EyeIcon />}
                                        </button>
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label required">New Password</label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            id="user-new-password"
                                            type={showPw.newPw ? 'text' : 'password'}
                                            className="form-control"
                                            placeholder="Minimum 6 characters"
                                            value={pwForm.newPassword}
                                            onChange={e => setPwForm(p => ({ ...p, newPassword: e.target.value }))}
                                            style={{ paddingRight: '2.5rem' }}
                                        />
                                        <button type="button" onClick={() => setShowPw(p => ({ ...p, newPw: !p.newPw }))} style={toggleBtnStyle}>
                                            {showPw.newPw ? <EyeOffIcon /> : <EyeIcon />}
                                        </button>
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label required">Confirm New Password</label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            id="user-confirm-password"
                                            type={showPw.confirm ? 'text' : 'password'}
                                            className="form-control"
                                            placeholder="Re-enter new password"
                                            value={pwForm.confirmPassword}
                                            onChange={e => setPwForm(p => ({ ...p, confirmPassword: e.target.value }))}
                                            style={{ paddingRight: '2.5rem' }}
                                        />
                                        <button type="button" onClick={() => setShowPw(p => ({ ...p, confirm: !p.confirm }))} style={toggleBtnStyle}>
                                            {showPw.confirm ? <EyeOffIcon /> : <EyeIcon />}
                                        </button>
                                    </div>
                                    {pwForm.confirmPassword && pwForm.newPassword !== pwForm.confirmPassword && (
                                        <div style={{ fontSize: 12, color: 'var(--color-danger, #ef4444)', marginTop: 4 }}>Passwords do not match.</div>
                                    )}
                                </div>
                                <button
                                    className="btn btn-primary"
                                    disabled={savingPw || !pwForm.currentPassword || !pwForm.newPassword || pwForm.newPassword !== pwForm.confirmPassword}
                                    onClick={handleChangePassword}
                                >
                                    {savingPw ? 'Updating...' : 'Update Password'}
                                </button>
                            </div>
                        </Card>
                    )}
                </main>
            </div>
        </div>
    );
}
