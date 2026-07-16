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
            remarks: ''
        }]);
    };

    const handleDeleteRow = (index: number) => {
        const newLogs = logs.filter((_, i) => i !== index);
        setLogs(newLogs);
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
                    cursor: default;
                    color: var(--color-text-primary);
                }
            `}</style>

            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h1 style={{ margin: 0, fontSize: 22 }}>Global Error Log</h1>
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

            {loading ? (
                <p style={{ color: 'var(--color-text-muted)', padding: 20 }}>Loading Error Logs...</p>
            ) : (
                <>
                    <div className="grid-container">
                        {/* 1. LEFT STATIC SIDE (S.No, Date, Project Name) */}
                        <div className="grid-frozen-side">
                            <table className="grid-table" style={{ width: '375px' }}>
                                <colgroup>
                                    <col style={{ width: '65px' }} />
                                    <col style={{ width: '130px' }} />
                                    <col style={{ width: '180px' }} />
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th>S.No</th>
                                        <th>Date</th>
                                        <th>Project / Job Name</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((row, idx) => (
                                        <tr key={'frozen-' + idx}>
                                            <td style={{ textAlign: 'center', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 12 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
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
                                                    <span>{idx + 1}</span>
                                                </div>
                                            </td>
                                            <td>
                                                <input type="date" className="cell-input" value={row.date} onChange={e => updateLog(idx, 'date', e.target.value)} disabled={!editMode} />
                                            </td>
                                            <td>
                                                <input type="text" className="cell-input" value={row.projectName} onChange={e => updateLog(idx, 'projectName', e.target.value)} disabled={!editMode} placeholder="—" />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* 2. RIGHT SCROLLABLE SIDE */}
                        <div className="grid-scrollable-side">
                            <table className="grid-table" style={{ width: '2300px' }}>
                                <colgroup>
                                    <col style={{ width: '180px' }} />
                                    <col style={{ width: '150px' }} />
                                    <col style={{ width: '250px' }} />
                                    <col style={{ width: '140px' }} />
                                    <col style={{ width: '120px' }} />
                                    <col style={{ width: '120px' }} />
                                    <col style={{ width: '120px' }} />
                                    <col style={{ width: '120px' }} />
                                    <col style={{ width: '200px' }} />
                                    <col style={{ width: '250px' }} />
                                    <col style={{ width: '110px' }} />
                                    <col style={{ width: '110px' }} />
                                    <col style={{ width: '200px' }} />
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th>Client / Fabricator</th>
                                        <th>Error Category</th>
                                        <th>Error Description</th>
                                        <th>Impact (Shop/Fld)</th>
                                        <th>PM</th>
                                        <th>Modeler</th>
                                        <th>Detailer</th>
                                        <th>Checker</th>
                                        <th>Root Cause</th>
                                        <th>Corrective/Preventive Action</th>
                                        <th>Severity</th>
                                        <th>Status</th>
                                        <th>Remarks</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((row, idx) => (
                                        <tr key={'scroll-' + idx}>
                                            <td><input type="text" className="cell-input" value={row.clientName} onChange={e => updateLog(idx, 'clientName', e.target.value)} disabled={!editMode} placeholder="—" /></td>
                                            <td><input type="text" className="cell-input" value={row.errorCategory} onChange={e => updateLog(idx, 'errorCategory', e.target.value)} disabled={!editMode} placeholder="—" /></td>
                                            <td><input type="text" className="cell-input" value={row.errorDescription} onChange={e => updateLog(idx, 'errorDescription', e.target.value)} disabled={!editMode} placeholder="—" /></td>
                                            <td><input type="text" className="cell-input" value={row.impact} onChange={e => updateLog(idx, 'impact', e.target.value)} disabled={!editMode} placeholder="—" /></td>
                                            <td><input type="text" className="cell-input" value={row.pm} onChange={e => updateLog(idx, 'pm', e.target.value)} disabled={!editMode} placeholder="—" /></td>
                                            <td><input type="text" className="cell-input" value={row.modeler} onChange={e => updateLog(idx, 'modeler', e.target.value)} disabled={!editMode} placeholder="—" /></td>
                                            <td><input type="text" className="cell-input" value={row.detailer} onChange={e => updateLog(idx, 'detailer', e.target.value)} disabled={!editMode} placeholder="—" /></td>
                                            <td><input type="text" className="cell-input" value={row.checker} onChange={e => updateLog(idx, 'checker', e.target.value)} disabled={!editMode} placeholder="—" /></td>
                                            <td><input type="text" className="cell-input" value={row.rootCause} onChange={e => updateLog(idx, 'rootCause', e.target.value)} disabled={!editMode} placeholder="—" /></td>
                                            <td><input type="text" className="cell-input" value={row.correctiveAction} onChange={e => updateLog(idx, 'correctiveAction', e.target.value)} disabled={!editMode} placeholder="—" /></td>
                                            <td>
                                                <select className="cell-input" value={row.severity} onChange={e => updateLog(idx, 'severity', e.target.value)} disabled={!editMode}
                                                    style={{ color: row.severity === 'High' ? '#dc2626' : row.severity === 'Medium' ? '#d97706' : row.severity === 'Low' ? '#16a34a' : 'inherit', height: '100%' }}>
                                                    <option value="">—</option>
                                                    <option value="High">High</option>
                                                    <option value="Medium">Medium</option>
                                                    <option value="Low">Low</option>
                                                </select>
                                            </td>
                                            <td>
                                                <select className="cell-input" value={row.status} onChange={e => updateLog(idx, 'status', e.target.value)} disabled={!editMode} style={{ height: '100%' }}>
                                                    <option value="">—</option>
                                                    <option value="Open">Open</option>
                                                    <option value="In Progress">In Progress</option>
                                                    <option value="Closed">Closed</option>
                                                </select>
                                            </td>
                                            <td><input type="text" className="cell-input" value={row.remarks} onChange={e => updateLog(idx, 'remarks', e.target.value)} disabled={!editMode} placeholder="—" /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div style={{ marginTop: 12 }}>
                        <button className="btn btn-primary btn-sm" onClick={() => {
                            if (!editMode) setEditMode(true);
                            handleAddRow();
                        }}>+ Add Error Log</button>
                    </div>
                </>
            )}
        </div>
    );
}
