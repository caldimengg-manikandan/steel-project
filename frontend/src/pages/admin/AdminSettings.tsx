import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    IconUsers, IconShieldTick, IconNotification, IconLayout,
    IconDatabase, IconLock, IconActivity, IconSettings,
    IconPlus, IconEdit, IconSearch, IconDownload
} from '../../components/Icons';
import { useSettings } from '../../context/SettingsContext';

type TabId = 'access' | 'project' | 'notifications' | 'ui' | 'data' | 'security' | 'audit' | 'admin';

interface TabItem {
    id: TabId;
    label: string;
    icon: React.ReactNode;
    desc: string;
}

const TABS: TabItem[] = [
    { id: 'access', label: 'User & Access', icon: <IconUsers />, desc: 'Roles, permissions and user management' },
    { id: 'project', label: 'Project Config', icon: <IconLayout />, desc: 'Templates, workflows and numbering' },
    { id: 'notifications', label: 'Notifications', icon: <IconNotification />, desc: 'Email alerts and reminder schedules' },
    { id: 'ui', label: 'System Prefs', icon: <IconSettings />, desc: 'Theme, timezone and language' },
    { id: 'data', label: 'Data & Sync', icon: <IconDatabase />, desc: 'Exports, API and backups' },
    { id: 'security', label: 'Security', icon: <IconLock />, desc: '2FA, password policy and sessions' },
    { id: 'audit', label: 'Logs & Audit', icon: <IconActivity />, desc: 'System activity and change history' },
    { id: 'admin', label: 'Admin Controls', icon: <IconShieldTick />, desc: 'License and global module toggles' },
];

// ─── Sub-components ───

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

const Card = ({ title, children, action }: { title: string, children: React.ReactNode, action?: React.ReactNode }) => (
    <div className="card mb-lg">
        <div className="card-header">
            <span className="card-header-title">{title}</span>
            {action}
        </div>
        <div className="card-body">
            {children}
        </div>
    </div>
);

// ─── Main Page ───

export default function AdminSettings() {
    const [activeTab, setActiveTab] = useState<TabId>('access');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [logSearch, setLogSearch] = useState('');
    const { settings, updateSettings } = useSettings();
    const navigate = useNavigate();

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
                .settings-content {
                    min-width: 0;
                }
            `}</style>

            <div className="page-header">
                <div className="page-header-left">
                    <h2 className="page-title">System Settings</h2>
                    <p className="page-subtitle">Configure global preferences, security, and project modules</p>
                </div>
            </div>

            <div className="settings-layout">
                {/* Navigation */}
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

                {/* Content */}
                <main className="settings-content">
                    {activeTab === 'access' && (
                        <>
                            <Card title="Role-Based Access Control" action={
                                <button className="btn btn-primary btn-sm" onClick={() => setIsModalOpen(true)}><IconPlus /> Create Role</button>
                            }>
                                <div className="table-wrapper">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Role Name</th>
                                                <th>Projects</th>
                                                <th>RFI</th>
                                                <th>Drawings</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                <td><span style={{ fontWeight: 600 }}>System Admin</span></td>
                                                <td><span className="badge badge-success">Full</span></td>
                                                <td><span className="badge badge-success">Full</span></td>
                                                <td><span className="badge badge-success">Full</span></td>
                                                <td><button className="btn btn-ghost btn-sm btn-icon" onClick={() => navigate('/admin/permissions')}><IconEdit /></button></td>
                                            </tr>
                                            <tr>
                                                <td><span style={{ fontWeight: 600 }}>Project Manager</span></td>
                                                <td><span className="badge badge-info">Write</span></td>
                                                <td><span className="badge badge-info">Write</span></td>
                                                <td><span className="badge badge-info">Write</span></td>
                                                <td><button className="btn btn-ghost btn-sm btn-icon" onClick={() => navigate('/admin/permissions')}><IconEdit /></button></td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </Card>
                            <Card title="User Activity Tracking">
                                <SettingRow title="Log User Sessions" desc="Track when and where users log into the system">
                                    <Toggle enabled={settings.activityLogging} onChange={(v) => handleSettingChange('activityLogging', v)} />
                                </SettingRow>
                            </Card>
                        </>
                    )}

                    {activeTab === 'project' && (
                        <>
                            <Card title="Workflow Configuration">
                                <SettingRow title="RFI Auto-Numbering" desc="Generate RFI IDs automatically (e.g., RFI-001)">
                                    <Toggle enabled={settings.rfiAutoNumber} onChange={(v) => handleSettingChange('rfiAutoNumber', v)} />
                                </SettingRow>
                            </Card>
                        </>
                    )}

                    {activeTab === 'notifications' && (
                        <Card title="Email & System Alerts">
                            <SettingRow title="Master Email Notifications" desc="Enable or disable all outgoing system emails">
                                <Toggle enabled={settings.emailNotifications} onChange={(v) => handleSettingChange('emailNotifications', v)} />
                            </SettingRow>
                            <SettingRow title="Weekly Summary Reports" desc="Send a weekly overview of project status to all managers">
                                <Toggle enabled={settings.weeklyReports} onChange={(v) => handleSettingChange('weeklyReports', v)} />
                            </SettingRow>
                        </Card>
                    )}

                    {activeTab === 'ui' && (
                        <Card title="Regional & Appearance">
                            <SettingRow title="System Timezone" desc="Set the default timezone for logs and deadlines">
                                <select 
                                    className="form-control" 
                                    style={{ width: 220 }}
                                    value={settings.timezone}
                                    onChange={(e) => handleSettingChange('timezone', e.target.value)}
                                >
                                    <option value="Asia/Kolkata">(GMT+05:30) India Standard Time</option>
                                    <option value="UTC">(GMT+00:00) UTC</option>
                                    <option value="America/New_York">(GMT-05:00) Eastern Time</option>
                                    <option value="Europe/London">(GMT+00:00) London</option>
                                </select>
                            </SettingRow>
                            <SettingRow title="Date Format" desc="Preferred display for dates system-wide">
                                <select 
                                    className="form-control" 
                                    style={{ width: 220 }}
                                    value={settings.dateFormat}
                                    onChange={(e) => handleSettingChange('dateFormat', e.target.value)}
                                >
                                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                                </select>
                            </SettingRow>
                            <SettingRow title="Dark Mode" desc="Enable high-contrast dark interface">
                                <Toggle enabled={settings.darkMode} onChange={(v) => handleSettingChange('darkMode', v)} />
                            </SettingRow>
                        </Card>
                    )}

                    {activeTab === 'security' && (
                        <Card title="Account Security">
                            <SettingRow title="Require 2-Factor Authentication" desc="All admin users must use 2FA to login">
                                <Toggle enabled={settings.twoFactor} onChange={(v) => handleSettingChange('twoFactor', v)} />
                            </SettingRow>
                        </Card>
                    )}

                    {activeTab === 'audit' && (
                        <Card title="System Activity Log" action={
                            <div className="search-input-wrapper" style={{ width: 240, background: 'var(--color-bg-page)', border: '1px solid var(--color-border-light)', borderRadius: 20, display: 'flex', alignItems: 'center', padding: '0 12px' }}>
                                <span style={{ opacity: 0.5, flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}><IconSearch /></span>
                                <input 
                                    type="text" 
                                    className="form-control" 
                                    placeholder="Search logs..." 
                                    style={{ border: 'none', background: 'transparent', height: 32, fontSize: 13 }}
                                    value={logSearch}
                                    onChange={(e) => setLogSearch(e.target.value)}
                                />
                            </div>
                        }>
                            <div className="table-wrapper">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Timestamp</th>
                                            <th>User</th>
                                            <th>Module</th>
                                            <th>Event</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[
                                            { ts: new Date().toISOString(), user: 'System', mod: 'Config', event: 'Settings updated successfully' },
                                            { ts: new Date(Date.now() - 3600000).toISOString(), user: 'admin1', mod: 'Projects', event: 'Created project: Steel Bridge' },
                                            { ts: new Date(Date.now() - 7200000).toISOString(), user: 'admin1', mod: 'RFI', event: 'RFIs extracted from PDF' }
                                        ].filter(l => 
                                            l.user.toLowerCase().includes(logSearch.toLowerCase()) || 
                                            l.mod.toLowerCase().includes(logSearch.toLowerCase()) || 
                                            l.event.toLowerCase().includes(logSearch.toLowerCase())
                                        ).map((l, i) => (
                                            <tr key={i}>
                                                <td className="font-mono" style={{ fontSize: 12 }}>{new Date(l.ts).toLocaleString()}</td>
                                                <td><span style={{ fontWeight: 600 }}>{l.user}</span></td>
                                                <td><span style={{ color: 'var(--color-text-muted)' }}>{l.mod}</span></td>
                                                <td>{l.event}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    )}
                    {activeTab === 'data' && (
                        <Card title="Data Management & Integrations">
                            <SettingRow title="Export System Database" desc="Download a full JSON backup of all projects, RFIs and drawings">
                                <button className="btn btn-secondary btn-sm"><IconDownload /> Export Backup</button>
                            </SettingRow>
                            <SettingRow title="API Access Token" desc="Retrieve your unique token for third-party integrations">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <code style={{ background: 'var(--color-bg-page)', padding: '4px 8px', borderRadius: 4, fontStyle: 'normal' }}>sk_live_••••••••••••</code>
                                    <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px' }}>Copy</button>
                                </div>
                            </SettingRow>
                        </Card>
                    )}

                    {activeTab === 'admin' && (
                        <Card title="Global Module Toggles">
                            <SettingRow title="Project Management Module" desc="Enable or disable the core projects and drawing extraction feature">
                                <Toggle enabled={true} onChange={() => {}} />
                            </SettingRow>
                            <SettingRow title="RFI & Communication" desc="Enable the RFI tracking and PDF annotation extraction system">
                                <Toggle enabled={true} onChange={() => {}} />
                            </SettingRow>
                            <SettingRow title="Reports & Analytics" desc="Visible for all admins to see performance metrics">
                                <Toggle enabled={true} onChange={() => {}} />
                            </SettingRow>
                        </Card>
                    )}
                </main>
            </div>

            {isModalOpen && (
                <div className="modal-overlay">
                    <div className="modal" style={{ maxWidth: 480 }}>
                        <div className="modal-header">
                            <h3 className="modal-title">Create New System Role</h3>
                            <button className="modal-close" onClick={() => setIsModalOpen(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label required">Role Name</label>
                                <input type="text" className="form-control" placeholder="e.g. Quality Inspector" />
                            </div>
                            
                            <div style={{ marginTop: 20 }}>
                                <label className="form-label">Permission Matrix</label>
                                <table style={{ marginTop: 8 }}>
                                    <thead>
                                        <tr>
                                            <th style={{ background: 'none', border: 'none', fontSize: 11 }}>Module</th>
                                            <th style={{ background: 'none', border: 'none', fontSize: 11 }}>Level</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td style={{ border: 'none', padding: '8px 0' }}>Projects</td>
                                            <td style={{ border: 'none', padding: '8px 0' }}>
                                                <select className="form-control btn-sm">
                                                    <option>Full Access</option>
                                                    <option>Write</option>
                                                    <option>Read Only</option>
                                                    <option>No Access</option>
                                                </select>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td style={{ border: 'none', padding: '8px 0' }}>RFI</td>
                                            <td style={{ border: 'none', padding: '8px 0' }}>
                                                <select className="form-control btn-sm">
                                                    <option>Full Access</option>
                                                    <option>Write</option>
                                                    <option>Read Only</option>
                                                    <option>No Access</option>
                                                </select>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td style={{ border: 'none', padding: '8px 0' }}>Drawings</td>
                                            <td style={{ border: 'none', padding: '8px 0' }}>
                                                <select className="form-control btn-sm">
                                                    <option>Full Access</option>
                                                    <option>Write</option>
                                                    <option>Read Only</option>
                                                    <option>No Access</option>
                                                </select>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <div className="form-actions">
                                <button className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                                <button className="btn btn-primary" onClick={() => setIsModalOpen(false)}>Save Role</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
