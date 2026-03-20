import { useState } from 'react';
import {
    IconNotification, IconLock, IconSettings
} from '../../components/Icons';
import { useSettings } from '../../context/SettingsContext';

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
    { id: 'security', label: 'Security', icon: <IconLock />, desc: 'Password and session management' },
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

export default function UserSettings() {
    const [activeTab, setActiveTab] = useState<TabId>('notifications');
    const { settings, updateSettings } = useSettings();

    const handleSettingChange = (key: string, value: any) => {
        updateSettings({ [key]: value });
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
                        <Card title="Email & In-App Alerts">
                            <SettingRow title="Receive Notifications" desc="Get alerted when new RFIs are assigned to your projects">
                                <Toggle enabled={settings.emailNotifications} onChange={(v) => handleSettingChange('emailNotifications', v)} />
                            </SettingRow>
                            <SettingRow title="Weekly Dashboard Summary" desc="A summarized overview of your project progress">
                                <Toggle enabled={settings.weeklyReports} onChange={(v) => handleSettingChange('weeklyReports', v)} />
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
                        <Card title="Account Security">
                            <SettingRow title="Two-Factor Authentication" desc="Add an extra layer of security to your account">
                                <Toggle enabled={settings.twoFactor} onChange={(v) => handleSettingChange('twoFactor', v)} />
                            </SettingRow>
                            <div style={{ marginTop: 24, padding: '20px', background: 'var(--color-bg-page)', borderRadius: 10, border: '1px solid var(--color-border-light)' }}>
                                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Change Password</div>
                                <button className="btn btn-secondary btn-sm">Reset Password via Email</button>
                            </div>
                        </Card>
                    )}
                </main>
            </div>
        </div>
    );
}
