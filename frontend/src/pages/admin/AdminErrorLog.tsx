import { useState, useEffect } from 'react';
import { fetchErrorLogs, saveErrorLogs, getErrorLogDownloadUrl } from '../../services/errorLogApi';
import { useAuth } from '../../context/AuthContext';

interface ErrorLogItem {
    _id: string;
    isCustomRow?: boolean;
    date: string;
    projectName: string;
    clientName: string;
    errorCategory: string;
    errorDescription: string;
    impact: string;
    pm: string;
    modeler: string;
    detailer: string;
    checker: string;
    rootCause: string;
    correctiveAction: string;
    severity: string;
    status: string;
    remarks: string;
    strikedOut?: boolean;
}

export default function AdminErrorLog() {
    const { user } = useAuth();
    const [logs, setLogs] = useState<ErrorLogItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editMode, setEditMode] = useState(false);

    useEffect(() => {
        loadLogs();
    }, []);

    const loadLogs = async () => {
        setLoading(true);
        try {
            const res = await fetchErrorLogs();
            if (res.success) {
                setLogs(res.logs || []);
            }
        } catch (error) {
            console.error('Error fetching logs', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const roleMap: Record<string, string> = {
                'super_admin': 'superAdmin',
                'superadmin': 'superAdmin',
                'admin': 'superAdmin',
                'project_manager': 'projectManager',
                'projectmanager': 'projectManager',
                'team_lead': 'teamLead',
                'teamlead': 'teamLead',
            };
            const addedByRole = roleMap[(user?.role || '').toLowerCase()] || 'superAdmin';
            const addedByName = user?.username || 'Admin';

            const res = await saveErrorLogs(logs, addedByRole, addedByName);
            if (res.success) {
                alert('Error Logs saved successfully.');
                setEditMode(false);
                loadLogs();
            } else {
                alert('Failed to save error logs.');
            }
        } catch (error) {
            console.error('Save error', error);
            alert('An error occurred while saving.');
        } finally {
            setSaving(false);
        }
    };

    const handleAddRow = () => {
        setLogs([...logs, {
            _id: 'new',
            isCustomRow: true,
            date: '',
            projectName: '',
            clientName: '',
            errorCategory: '',
            errorDescription: '',
            impact: '',
            pm: '',
            modeler: '',
            detailer: '',
            checker: '',
            rootCause: '',
            correctiveAction: '',
            severity: '',
            status: '',
            remarks: '',
            strikedOut: false
        }]);
    };

    const handleDeleteRow = (index: number) => {
        const newLogs = logs.filter((_, i) => i !== index);
        setLogs(newLogs);
    };

    const handleToggleStrikeout = async (index: number) => {
        const newLogs = [...logs];
        newLogs[index] = { ...newLogs[index], strikedOut: !newLogs[index].strikedOut };
        setLogs(newLogs);
        
        // Auto-save strikeout state to backend immediately so Excel export works without requiring manual save
        try {
            const roleMap: Record<string, string> = {
                'super_admin': 'superAdmin', 'superadmin': 'superAdmin', 'admin': 'superAdmin',
                'project_manager': 'projectManager', 'projectmanager': 'projectManager',
                'team_lead': 'teamLead', 'teamlead': 'teamLead',
            };
            const addedByRole = roleMap[(user?.role || '').toLowerCase()] || 'superAdmin';
            const addedByName = user?.username || 'Admin';
            await saveErrorLogs(newLogs, addedByRole, addedByName);
        } catch (err) {
            console.error('Failed to auto-save strikeout state', err);
        }
    };

    const handleDownload = () => {
        window.open(getErrorLogDownloadUrl(), '_blank');
    };

    const updateLog = (index: number, field: keyof ErrorLogItem, value: string) => {
        const newLogs = [...logs];
        newLogs[index] = { ...newLogs[index], [field]: value };
        setLogs(newLogs);
    };

    return (
        <div style={{ padding: 24, width: '100%', maxWidth: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <style>{`
                /* Global overrides to prevent the main page from scrolling horizontally */
                .page-content {
                    max-width: 100% !important;
                    overflow-x: hidden !important;
                    display: flex;
                    flex-direction: column;
                }
                .main-content {
                    max-width: 100% !important;
                    overflow-x: hidden !important;
                }

                .grid-container {
                    display: flex;
                    border: 1px solid var(--color-border);
                    border-radius: 8px;
                    overflow: hidden;
                    background: var(--color-bg-card, #fff);
                    max-height: calc(100vh - 200px);
                    width: 100%;
                    max-width: 100%;
                }
                
                /* Left static / frozen side */
                .grid-frozen-side {
                    flex: 0 0 auto;
                    width: 375px;
                    border-right: 2px solid var(--color-border);
                    background: var(--color-bg-card, #fff);
                    z-index: 10;
                    box-shadow: 4px 0 8px rgba(0,0,0,0.05);
                }

                /* Right scrollable side */
                .grid-scrollable-side {
                    flex: 1 1 auto;
                    overflow-x: auto;
                    overflow-y: hidden;
                    min-width: 0;
                }

                .grid-table {
                    border-collapse: collapse;
                    width: 100%;
                    table-layout: fixed;
                }

                .grid-table th {
                    background: var(--color-bg-card, #1e2533);
                    color: var(--color-text-primary, #e2e8f0);
                    font-weight: 600;
                    padding: 12px 8px;
                    border-bottom: 2px solid var(--color-border);
                    border-right: 1px solid var(--color-border);
                    text-align: left;
                    font-size: 13px;
                    height: 44px;
                    box-sizing: border-box;
                }

                .grid-table td {
                    padding: 3px 6px;
                    border-bottom: 1px solid var(--color-border-light);
                    border-right: 1px solid var(--color-border-light);
                    height: 40px;
                    box-sizing: border-box;
                    background: var(--color-bg-card, #fff);
                }

                .grid-table tr:hover td {
                    background: var(--color-bg-page, #f5f7fa);
                }

                /* Input styles */
                .grid-table .cell-input {
                    width: 100%;
                    height: 100%;
                    padding: 4px 6px;
                    border: none;
                    background: transparent;
                    color: inherit;
                    font-size: 13px;
                    outline: none;
                    box-sizing: border-box;
                }

                .grid-table .cell-input:focus {
                    background: var(--color-primary-glow, rgba(59,130,246,0.12));
                    border-radius: 4px;
                }

                .grid-table .cell-input:disabled {
                }

                .form-control:disabled {
                    cursor: default;
                    color: var(--color-text-primary);
                }
            `}</style>

            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 className="page-title">Global Error Log</h2>
                    <p className="page-subtitle">Track and manage project errors</p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                    {editMode ? (
                        <>
                            <button className="btn btn-secondary" onClick={() => { setEditMode(false); loadLogs(); }} disabled={saving}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                        </>
                    ) : (
                        <button className="btn btn-primary" onClick={() => setEditMode(true)}>Edit Mode</button>
                    )}
                    <button className="btn btn-secondary" onClick={handleDownload}>
                        <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" strokeWidth="2" fill="none" style={{ marginRight: 6 }}>
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        Download Excel
                    </button>
                </div>
            </div>

            <div className="card" style={{ padding: 'var(--space-lg)' }}>
                {loading ? (
                    <p style={{ color: 'var(--color-text-muted)', padding: 20 }}>Loading Error Logs...</p>
                ) : (
                    <>
                        <div className="table-wrapper" style={{ overflowX: 'auto', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                            <table className="excel-table" style={{ width: '100%', minWidth: 'max-content', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        <th style={{ width: 65, minWidth: 65, position: 'sticky', left: 0, zIndex: 10, background: 'var(--color-bg-card, #1e2533)' }}>S.No</th>
                                        <th style={{ width: 130, minWidth: 130, position: 'sticky', left: 65, zIndex: 10, background: 'var(--color-bg-card, #1e2533)' }}>Date</th>
                                        <th style={{ width: 180, minWidth: 180, position: 'sticky', left: 195, zIndex: 10, background: 'var(--color-bg-card, #1e2533)', boxShadow: '2px 0 5px -2px rgba(0,0,0,0.3)' }}>Project / Job Name</th>
                                        <th style={{ minWidth: 180 }}>Client / Fabricator</th>
                                        <th style={{ minWidth: 150 }}>Error Category</th>
                                        <th style={{ minWidth: 250 }}>Error Description</th>
                                        <th style={{ minWidth: 140 }}>Impact (Shop/Fld)</th>
                                        <th style={{ minWidth: 120 }}>PM</th>
                                        <th style={{ minWidth: 120 }}>Modeler</th>
                                        <th style={{ minWidth: 120 }}>Detailer</th>
                                        <th style={{ minWidth: 120 }}>Checker</th>
                                        <th style={{ minWidth: 200 }}>Root Cause</th>
                                        <th style={{ minWidth: 250 }}>Corrective/Preventive Action</th>
                                        <th style={{ minWidth: 110 }}>Severity</th>
                                        <th style={{ minWidth: 110 }}>Status</th>
                                        <th style={{ minWidth: 200 }}>Remarks</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((row, idx) => (
                                        <tr key={idx} style={row.strikedOut ? { background: '#e8e8e8', opacity: 0.75 } : {}}>
                                            <td style={{ position: 'sticky', left: 0, zIndex: 5, background: 'var(--color-bg-card, #fff)', textAlign: 'center', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 12 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                                                    {editMode && (
                                                        <button 
                                                            onClick={() => handleDeleteRow(idx)}
                                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                                                            title="Delete Row"
                                                        >
                                                            <svg viewBox="0 0 24 24" width="14" height="14" stroke="#dc2626" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                                                <polyline points="3 6 5 6 21 6"></polyline>
                                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                                                <line x1="14" y1="11" x2="14" y2="17"></line>
                                                            </svg>
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleToggleStrikeout(idx)}
                                                        title={row.strikedOut ? 'Remove Strikeout' : 'Mark as Strikeout'}
                                                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', color: row.strikedOut ? '#6b7280' : '#9ca3af', textDecoration: row.strikedOut ? 'line-through' : 'none', fontWeight: 'bold', fontSize: 11 }}
                                                    >
                                                        ❌
                                                    </button>
                                                    <span style={{ textDecoration: row.strikedOut ? 'line-through' : 'none', color: row.strikedOut ? '#9ca3af' : undefined }}>{idx + 1}</span>
                                                </div>
                                            </td>
                                            <td style={{ position: 'sticky', left: 65, zIndex: 5, background: 'var(--color-bg-card, #fff)' }}>
                                                <input type="date" className="form-control" value={row.date} onChange={e => updateLog(idx, 'date', e.target.value)} disabled={!editMode} style={{ padding: 4, width: '100%', background: 'transparent', textDecoration: row.strikedOut ? 'line-through' : 'none', color: row.strikedOut ? '#9ca3af' : undefined }} />
                                            </td>
                                            <td style={{ position: 'sticky', left: 195, zIndex: 5, background: 'var(--color-bg-card, #fff)', boxShadow: '2px 0 5px -2px rgba(0,0,0,0.3)' }}>
                                                <input type="text" className="form-control" value={row.projectName} onChange={e => updateLog(idx, 'projectName', e.target.value)} disabled={!editMode} placeholder="—" style={{ padding: 4, width: '100%', background: 'transparent', textDecoration: row.strikedOut ? 'line-through' : 'none', color: row.strikedOut ? '#9ca3af' : undefined }} />
                                            </td>
                                            <td><input type="text" className="form-control" value={row.clientName} onChange={e => updateLog(idx, 'clientName', e.target.value)} disabled={!editMode} placeholder="—" style={{ padding: 4, width: '100%', background: 'transparent', textDecoration: row.strikedOut ? 'line-through' : 'none' }} /></td>
                                            <td><input type="text" className="form-control" value={row.errorCategory} onChange={e => updateLog(idx, 'errorCategory', e.target.value)} disabled={!editMode} placeholder="—" style={{ padding: 4, width: '100%', background: 'transparent', textDecoration: row.strikedOut ? 'line-through' : 'none' }} /></td>
                                            <td><input type="text" className="form-control" value={row.errorDescription} onChange={e => updateLog(idx, 'errorDescription', e.target.value)} disabled={!editMode} placeholder="—" style={{ padding: 4, width: '100%', background: 'transparent', textDecoration: row.strikedOut ? 'line-through' : 'none' }} /></td>
                                            <td><input type="text" className="form-control" value={row.impact} onChange={e => updateLog(idx, 'impact', e.target.value)} disabled={!editMode} placeholder="—" style={{ padding: 4, width: '100%', background: 'transparent', textDecoration: row.strikedOut ? 'line-through' : 'none' }} /></td>
                                            <td><input type="text" className="form-control" value={row.pm} onChange={e => updateLog(idx, 'pm', e.target.value)} disabled={!editMode} placeholder="—" style={{ padding: 4, width: '100%', background: 'transparent', textDecoration: row.strikedOut ? 'line-through' : 'none' }} /></td>
                                            <td><input type="text" className="form-control" value={row.modeler} onChange={e => updateLog(idx, 'modeler', e.target.value)} disabled={!editMode} placeholder="—" style={{ padding: 4, width: '100%', background: 'transparent', textDecoration: row.strikedOut ? 'line-through' : 'none' }} /></td>
                                            <td><input type="text" className="form-control" value={row.detailer} onChange={e => updateLog(idx, 'detailer', e.target.value)} disabled={!editMode} placeholder="—" style={{ padding: 4, width: '100%', background: 'transparent', textDecoration: row.strikedOut ? 'line-through' : 'none' }} /></td>
                                            <td><input type="text" className="form-control" value={row.checker} onChange={e => updateLog(idx, 'checker', e.target.value)} disabled={!editMode} placeholder="—" style={{ padding: 4, width: '100%', background: 'transparent', textDecoration: row.strikedOut ? 'line-through' : 'none' }} /></td>
                                            <td><input type="text" className="form-control" value={row.rootCause} onChange={e => updateLog(idx, 'rootCause', e.target.value)} disabled={!editMode} placeholder="—" style={{ padding: 4, width: '100%', background: 'transparent', textDecoration: row.strikedOut ? 'line-through' : 'none' }} /></td>
                                            <td><input type="text" className="form-control" value={row.correctiveAction} onChange={e => updateLog(idx, 'correctiveAction', e.target.value)} disabled={!editMode} placeholder="—" style={{ padding: 4, width: '100%', background: 'transparent', textDecoration: row.strikedOut ? 'line-through' : 'none' }} /></td>
                                            <td>
                                                <select className="form-control" value={row.severity} onChange={e => updateLog(idx, 'severity', e.target.value)} disabled={!editMode}
                                                    style={{ padding: '4px 24px 4px 8px', width: '100%', background: 'transparent', color: row.severity === 'High' ? '#dc2626' : row.severity === 'Medium' ? '#d97706' : row.severity === 'Low' ? '#16a34a' : 'inherit', textDecoration: row.strikedOut ? 'line-through' : 'none' }}>
                                                    <option value="">—</option>
                                                    <option value="High">High</option>
                                                    <option value="Medium">Medium</option>
                                                    <option value="Low">Low</option>
                                                </select>
                                            </td>
                                            <td>
                                                <select className="form-control" value={row.status} onChange={e => updateLog(idx, 'status', e.target.value)} disabled={!editMode} style={{ padding: '4px 24px 4px 8px', width: '100%', background: 'transparent', textDecoration: row.strikedOut ? 'line-through' : 'none' }}>
                                                    <option value="">—</option>
                                                    <option value="Open">Open</option>
                                                    <option value="In Progress">In Progress</option>
                                                    <option value="Closed">Closed</option>
                                                </select>
                                            </td>
                                            <td><input type="text" className="form-control" value={row.remarks} onChange={e => updateLog(idx, 'remarks', e.target.value)} disabled={!editMode} placeholder="—" style={{ padding: 4, width: '100%', background: 'transparent', textDecoration: row.strikedOut ? 'line-through' : 'none' }} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div style={{ marginTop: 16 }}>
                            <button className="btn btn-primary btn-sm" onClick={() => {
                                if (!editMode) setEditMode(true);
                                handleAddRow();
                            }}>+ Add Error Log</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
