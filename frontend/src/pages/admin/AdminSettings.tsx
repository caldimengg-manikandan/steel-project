import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMessage } from '../../context/MessageContext';
import {
    IconUsers, IconNotification,
    IconActivity, IconSettings,
    IconPlus, IconEdit, IconSearch
} from '../../components/Icons';
import { useSettings } from '../../context/SettingsContext';

type TabId = 'access' | 'notifications' | 'email' | 'ui' | 'branding' | 'audit';

interface TabItem {
    id: TabId;
    label: string;
    icon: React.ReactNode;
    desc: string;
}

const TABS: TabItem[] = [
    { id: 'access', label: 'User & Access', icon: <IconUsers />, desc: 'Roles, permissions and user management' },
    { id: 'notifications', label: 'Notifications', icon: <IconNotification />, desc: 'Email alerts and reminder schedules' },
    { id: 'email', label: 'Email Settings', icon: <IconNotification />, desc: 'SMTP sender config and recipient lists' },
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
    const [logs, setLogs] = useState<any[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const { settings, updateSettings, refreshSettings } = useSettings();
    const { showMessage } = useMessage();
    const navigate = useNavigate();

    // Email settings state
    const [emailForm, setEmailForm] = useState({
        emailEnabled: false,
        smtpHost: '',
        smtpPort: 587,
        smtpUser: '',
        smtpPass: '',
        smtpFromName: 'Steel Project',
        superAdminEmails: [] as string[],
        projectManagerEmails: [] as string[],
        teamLeadEmails: [] as string[],
    });
    const [emailInputs, setEmailInputs] = useState({ superAdmin: '', projectManager: '', teamLead: '' });
    const [savingEmail, setSavingEmail] = useState(false);
    const [testingEmail, setTestingEmail] = useState(false);
    const [testEmailAddr, setTestEmailAddr] = useState('');

    useEffect(() => {
        // Load email settings from existing settings
        if (settings) {
            setEmailForm(prev => ({
                ...prev,
                emailEnabled: (settings as any).emailEnabled || false,
                smtpHost: (settings as any).smtpHost || '',
                smtpPort: (settings as any).smtpPort || 587,
                smtpUser: (settings as any).smtpUser || '',
                smtpPass: (settings as any).smtpPass || '',
                smtpFromName: (settings as any).smtpFromName || 'Steel Project',
                superAdminEmails: (settings as any).superAdminEmails || [],
                projectManagerEmails: (settings as any).projectManagerEmails || [],
                teamLeadEmails: (settings as any).teamLeadEmails || [],
            }));
        }
    }, [settings]);

    useEffect(() => {
        if (activeTab === 'audit') {
            fetchLogs();
        }
    }, [activeTab]);

    const fetchLogs = async () => {
        setLoadingLogs(true);
        try {
            const res = await fetch('/steel/api/admin/activity-logs', {
                credentials: 'include'
            });
            if (res.ok) {
                const data = await res.json();
                setLogs(data.logs || []);
            } else {
                showMessage('Error', 'Failed to fetch logs', 'error');
            }
        } catch (error) {
            console.error('Fetch logs error:', error);
            showMessage('Error', 'An unexpected error occurred while fetching logs', 'error');
        } finally {
            setLoadingLogs(false);
        }
    };

    const handleSettingChange = (key: string, value: any) => {
        updateSettings({ [key]: value });
    };

    const handleLogoUpload = async () => {
        if (!logoFile) return;
        setUploadingLogo(true);
        try {
            const formData = new FormData();
            formData.append('logo', logoFile);
            
            const res = await fetch('/steel/api/settings/logo', {
                method: 'POST',
                body: formData,
                credentials: 'include'
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
                            <SettingRow title="Weekly Summary Progress" desc="Send a project status summary to all managers every Friday at 12:00 PM">
                                <Toggle 
                                    enabled={settings.weeklyProgresss} 
                                    onChange={(v) => handleSettingChange('weeklyProgresss', v)} 
                                />
                            </SettingRow>
                        </Card>
                    )}

                    {activeTab === 'email' && (() => {
                        const addEmail = (role: 'superAdmin' | 'projectManager' | 'teamLead') => {
                            const key = role === 'superAdmin' ? 'superAdminEmails' : role === 'projectManager' ? 'projectManagerEmails' : 'teamLeadEmails';
                            const val = emailInputs[role].trim();
                            if (!val || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val)) {
                                showMessage('Invalid', 'Please enter a valid email address.', 'error');
                                return;
                            }
                            if (emailForm[key].includes(val)) {
                                showMessage('Duplicate', 'This email is already in the list.', 'error');
                                return;
                            }
                            setEmailForm(prev => ({ ...prev, [key]: [...prev[key as keyof typeof prev] as string[], val] }));
                            setEmailInputs(prev => ({ ...prev, [role]: '' }));
                        };

                        const removeEmail = (role: string, email: string) => {
                            setEmailForm(prev => ({ ...prev, [role]: (prev[role as keyof typeof prev] as string[]).filter(e => e !== email) }));
                        };

                        const handleSaveEmail = async () => {
                            setSavingEmail(true);
                            try {
                                const res = await fetch('/steel/api/settings/email', {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    credentials: 'include',
                                    body: JSON.stringify(emailForm)
                                });
                                if (res.ok) {
                                    showMessage('Saved', 'Email settings saved successfully.', 'success');
                                    refreshSettings();
                                } else {
                                    const err = await res.json();
                                    showMessage('Error', err.error || 'Failed to save.', 'error');
                                }
                            } catch (e) {
                                showMessage('Error', 'Network error.', 'error');
                            } finally {
                                setSavingEmail(false);
                            }
                        };

                        const handleTestEmail = async () => {
                            setTestingEmail(true);
                            try {
                                const res = await fetch('/steel/api/settings/email/test', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    credentials: 'include',
                                    body: JSON.stringify({ testEmail: testEmailAddr || emailForm.smtpUser })
                                });
                                const data = await res.json();
                                if (res.ok) showMessage('Success', data.message, 'success');
                                else showMessage('Failed', data.error, 'error');
                            } catch (e) {
                                showMessage('Error', 'Network error.', 'error');
                            } finally {
                                setTestingEmail(false);
                            }
                        };

                        const renderEmailList = (role: 'superAdmin' | 'projectManager' | 'teamLead', label: string, roleKey: string) => (
                            <div style={{ marginBottom: 28 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: 'var(--color-text-primary)' }}>{label} Recipients</div>
                                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                    <input
                                        type="email"
                                        className="form-control"
                                        placeholder={`Add ${label} email...`}
                                        value={emailInputs[role]}
                                        onChange={e => setEmailInputs(prev => ({ ...prev, [role]: e.target.value }))}
                                        onKeyDown={e => e.key === 'Enter' && addEmail(role)}
                                        style={{ flex: 1 }}
                                    />
                                    <button className="btn btn-primary btn-sm" onClick={() => addEmail(role)}>
                                        <IconPlus /> Add
                                    </button>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {(emailForm[roleKey as keyof typeof emailForm] as string[]).map(email => (
                                        <div key={email} style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 6,
                                            background: 'var(--color-primary-glow)', border: '1px solid var(--color-primary)',
                                            borderRadius: 20, padding: '4px 12px', fontSize: 13
                                        }}>
                                            <span style={{ color: 'var(--color-primary)' }}>{email}</span>
                                            <span
                                                onClick={() => removeEmail(roleKey, email)}
                                                style={{ cursor: 'pointer', color: 'var(--color-text-muted)', fontWeight: 700, lineHeight: 1 }}
                                            >×</span>
                                        </div>
                                    ))}
                                    {(emailForm[roleKey as keyof typeof emailForm] as string[]).length === 0 && (
                                        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No emails added yet.</span>
                                    )}
                                </div>
                            </div>
                        );

                        return (
                            <>
                                <Card title="SMTP Sender Configuration" action={
                                    <SettingRow title="" desc="">
                                        <Toggle enabled={emailForm.emailEnabled} onChange={v => setEmailForm(prev => ({ ...prev, emailEnabled: v }))} />
                                    </SettingRow>
                                }>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                        <div className="form-group">
                                            <label className="form-label">SMTP Host</label>
                                            <input type="text" className="form-control" placeholder="e.g. smtp.gmail.com" value={emailForm.smtpHost} onChange={e => setEmailForm(p => ({ ...p, smtpHost: e.target.value }))} />
                                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>For Gmail: smtp.gmail.com | For Outlook: smtp.office365.com</div>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">SMTP Port</label>
                                            <input type="number" className="form-control" value={emailForm.smtpPort} onChange={e => setEmailForm(p => ({ ...p, smtpPort: Number(e.target.value) }))} />
                                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>587 (TLS) or 465 (SSL)</div>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Sender Email Address</label>
                                            <input type="email" className="form-control" placeholder="yourapp@gmail.com" value={emailForm.smtpUser} onChange={e => setEmailForm(p => ({ ...p, smtpUser: e.target.value }))} />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">App Password / SMTP Password</label>
                                            <input type="password" className="form-control" placeholder="Enter app password" value={emailForm.smtpPass} onChange={e => setEmailForm(p => ({ ...p, smtpPass: e.target.value }))} />
                                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>Use an App Password, not your regular login password</div>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Display Name (From)</label>
                                            <input type="text" className="form-control" placeholder="Steel Project" value={emailForm.smtpFromName} onChange={e => setEmailForm(p => ({ ...p, smtpFromName: e.target.value }))} />
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--color-border-light)' }}>
                                        <input type="email" className="form-control" placeholder="Send test to..." value={testEmailAddr} onChange={e => setTestEmailAddr(e.target.value)} style={{ maxWidth: 280 }} />
                                        <button className="btn btn-secondary btn-sm" onClick={handleTestEmail} disabled={testingEmail}>
                                            {testingEmail ? 'Sending...' : '📧 Send Test Email'}
                                        </button>
                                        <button className="btn btn-primary" onClick={handleSaveEmail} disabled={savingEmail}>
                                            {savingEmail ? 'Saving...' : 'Save Email Settings'}
                                        </button>
                                    </div>
                                </Card>

                                <Card title="Recipient Email Lists">
                                    {renderEmailList("superAdmin", "Super Admin", "superAdminEmails")}
                                    {renderEmailList("projectManager", "Project Manager", "projectManagerEmails")}
                                    {renderEmailList("teamLead", "Team Lead", "teamLeadEmails")}
                                    <div style={{ paddingTop: 16, borderTop: '1px solid var(--color-border-light)' }}>
                                        <button className="btn btn-primary" onClick={handleSaveEmail} disabled={savingEmail}>
                                            {savingEmail ? 'Saving...' : 'Save Recipient Lists'}
                                        </button>
                                    </div>
                                </Card>
                            </>
                        );
                    })()}

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
                                        {loadingLogs ? (
                                            <tr><td colSpan={4} style={{ textAlign: 'center', padding: '20px 0' }}>Loading logs...</td></tr>
                                        ) : logs.length === 0 ? (
                                            <tr><td colSpan={4} style={{ textAlign: 'center', padding: '20px 0' }}>No activity logs found.</td></tr>
                                        ) : logs.filter(l => 
                                            (l.user && l.user.toLowerCase().includes(logSearch.toLowerCase())) || 
                                            (l.module && l.module.toLowerCase().includes(logSearch.toLowerCase())) || 
                                            (l.event && l.event.toLowerCase().includes(logSearch.toLowerCase()))
                                        ).map((l, i) => (
                                            <tr key={i}>
                                                <td className="font-mono" style={{ fontSize: 12 }}>{new Date(l.timestamp).toLocaleString()}</td>
                                                <td><span style={{ fontWeight: 600 }}>{l.user}</span></td>
                                                <td><span style={{ color: 'var(--color-text-muted)' }}>{l.module}</span></td>
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
