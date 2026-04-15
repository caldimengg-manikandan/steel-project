import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMessage } from '../../context/MessageContext';
import {
    IconUsers, IconNotification,
    IconActivity, IconSettings,
    IconPlus, IconEdit, IconSearch
} from '../../components/Icons';
import { useSettings } from '../../context/SettingsContext';

type TabId = 'access' | 'notifications' | 'ui' | 'branding' | 'audit';

interface TabItem {
    id: TabId;
    label: string;
    icon: React.ReactNode;
    desc: string;
}

const TABS: TabItem[] = [
    { id: 'access', label: 'User & Access', icon: <IconUsers />, desc: 'Roles, permissions and user management' },
    { id: 'notifications', label: 'Notifications', icon: <IconNotification />, desc: 'Email alerts and reminder schedules' },
    { id: 'ui', label: 'System Preference', icon: <IconSettings />, desc: 'Theme, timezone and language' },
    { id: 'branding', label: 'Company Profile', icon: <IconSettings />, desc: 'Logo and branding' },

    { id: 'audit', label: 'Logs & Audit', icon: <IconActivity />, desc: 'System activity and change history' },
];

// ─── Sub-components ───

const Toggle = ({ enabled, onChange, disabled = false }: { enabled: boolean, onChange: (v: boolean) => void, disabled?: boolean }) => (
    <div
        onClick={() => !disabled && onChange(!enabled)}
        style={{
            width: 38,
            height: 20,
            borderRadius: 10,
            background: disabled ? 'var(--color-bg-page)' : (enabled ? 'var(--color-primary)' : 'var(--color-border)'),
            position: 'relative',
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s',
            flexShrink: 0,
            opacity: disabled ? 0.5 : 1
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
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const { settings, updateSettings, refreshSettings } = useSettings();
    const { showMessage } = useMessage();
    const navigate = useNavigate();

    const handleSettingChange = (key: string, value: any) => {
        updateSettings({ [key]: value });
    };

    const handleLogoUpload = async () => {
        if (!logoFile) return;
        setUploadingLogo(true);
        try {
            const formData = new FormData();
            formData.append('logo', logoFile);
            
            const token = sessionStorage.getItem('sdms_user') ? JSON.parse(sessionStorage.getItem('sdms_user')!).token : '';
            const res = await fetch('/steel/api/settings/logo', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            
            if (res.ok) {
                showMessage('Success', 'Logo updated successfully!', 'success');
                setLogoFile(null);
                refreshSettings();
            } else {
                const err = await res.json();
                showMessage('Upload Failed', err.error || 'Unknown error occurred during logo upload.', 'error');
            }
        } catch (err) {
            console.error('Logo upload error:', err);
            showMessage('Error', 'An unexpected error occurred during the upload process. Please try again.', 'error');
        } finally {
            setUploadingLogo(false);
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
                .settings-content {
                    min-width: 0;
                }
            `}</style>

            <div className="page-header">
                <div className="page-header-left">
                    <h2 className="page-title">System Settings</h2>
                    <p className="page-subtitle">Turn menu options on or off and manage your preferences</p>
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
                                                <td>
                                                    <div style={{ fontWeight: 700, fontSize: 14 }}>Super Admin</div>
                                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>Full system access — all modules</div>
                                                </td>
                                                <td><span className="badge badge-success">Full</span></td>
                                                <td><span className="badge badge-success">Full</span></td>
                                                <td><span className="badge badge-success">Full</span></td>
                                                <td><button className="btn btn-ghost btn-sm btn-icon" onClick={() => navigate('/admin/permissions')}><IconEdit /></button></td>
                                            </tr>
                                            <tr>
                                                <td>
                                                    <div style={{ fontWeight: 700, fontSize: 14 }}>Project Manager</div>
                                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>Full system access — all modules</div>
                                                </td>
                                                <td><span className="badge badge-success">Full</span></td>
                                                <td><span className="badge badge-success">Full</span></td>
                                                <td><span className="badge badge-success">Full</span></td>
                                                <td><button className="btn btn-ghost btn-sm btn-icon" onClick={() => navigate('/admin/permissions')}><IconEdit /></button></td>
                                            </tr>
                                            <tr>
                                                <td>
                                                    <div style={{ fontWeight: 700, fontSize: 14 }}>Team Lead</div>
                                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>Full system access — all modules</div>
                                                </td>
                                                <td><span className="badge badge-success">Full</span></td>
                                                <td><span className="badge badge-success">Full</span></td>
                                                <td><span className="badge badge-success">Full</span></td>
                                                <td><button className="btn btn-ghost btn-sm btn-icon" onClick={() => navigate('/admin/permissions')}><IconEdit /></button></td>
                                            </tr>
                                            <tr>
                                                <td>
                                                    <div style={{ fontWeight: 700, fontSize: 14 }}>Team Member</div>
                                                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>Editor access — assigned projects only</div>
                                                </td>
                                                <td><span className="badge badge-info">Editor</span></td>
                                                <td><span className="badge badge-info">Editor</span></td>
                                                <td><span className="badge badge-info">Editor</span></td>
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


                    {activeTab === 'notifications' && (
                        <Card title="System Reports">
                            <SettingRow title="Weekly Summary Reports" desc="Send a project status summary to all managers every Friday at 12:00 PM">
                                <Toggle 
                                    enabled={settings.weeklyReports} 
                                    onChange={(v) => handleSettingChange('weeklyReports', v)} 
                                />
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

                    {activeTab === 'branding' && (
                        <Card title="Company Branding">
                           <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                               <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                                    <div style={{ 
                                        width: 100, height: 60, 
                                        border: '2px dashed var(--color-border)', 
                                        borderRadius: 8,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        overflow: 'hidden', background: 'var(--color-bg-page)'
                                    }}>
                                        {settings.logoPath ? (
                                            <img src={settings.logoPath} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                                        ) : (
                                            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>No Logo</span>
                                        )}
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 14, fontWeight: 600 }}>System Logo</div>
                                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>This logo will appear in Transmittals and Drawing Logs.</div>
                                    </div>
                               </div>

                               <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
                                   <input 
                                        type="file" 
                                        id="logo-upload" 
                                        accept="image/*" 
                                        style={{ display: 'none' }} 
                                        onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                                   />
                                   <label htmlFor="logo-upload" className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                                       {logoFile ? 'Change File' : 'Select Logo'}
                                   </label>
                                   {logoFile && (
                                       <div style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 500 }}>
                                           {logoFile.name}
                                       </div>
                                   )}
                                   <button 
                                        className="btn btn-primary btn-sm" 
                                        disabled={!logoFile || uploadingLogo}
                                        onClick={handleLogoUpload}
                                   >
                                       {uploadingLogo ? 'Uploading...' : 'Upload & Save'}
                                   </button>
                               </div>
                           </div>
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
