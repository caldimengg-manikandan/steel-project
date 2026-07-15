import React, { useState, useEffect } from 'react';
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
            const res = await saveErrorLogs(logs);
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

    const handleDownload = () => {
        window.open(getErrorLogDownloadUrl(), '_blank');
    };

    const updateLog = (index: number, field: keyof ErrorLogItem, value: string) => {
        const newLogs = [...logs];
        newLogs[index] = { ...newLogs[index], [field]: value };
        setLogs(newLogs);
    };

    return (
        <div className="container" style={{ padding: 24, maxWidth: '100%', overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <h1 style={{ margin: 0, fontSize: 24 }}>Global Error Log</h1>
                <div style={{ display: 'flex', gap: 12 }}>
                    {editMode ? (
                        <>
                            <button className="btn btn-secondary" onClick={() => { setEditMode(false); loadLogs(); }} disabled={saving}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                        </>
                    ) : (
                        <button className="btn btn-primary" onClick={() => setEditMode(true)}>Edit Mode</button>
                    )}
                    <button className="btn btn-secondary" onClick={handleDownload} title="Download Error Log Excel">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        Download Excel
                    </button>
                </div>
            </div>

            {loading ? (
                <p>Loading Error Logs...</p>
            ) : (
                <div className="card" style={{ overflowX: 'auto', padding: '16px' }}>
                    <div className="table-wrapper">
                        <table className="excel-table">
                            <thead>
                                <tr>
                                    <th style={{ minWidth: 60 }}>S.No</th>
                                    <th style={{ minWidth: 120 }}>Date</th>
                                    <th style={{ minWidth: 180 }}>Project / Job Name</th>
                                    <th style={{ minWidth: 180 }}>Client / Fabricator</th>
                                    <th style={{ minWidth: 150 }}>Error Category</th>
                                    <th style={{ minWidth: 250 }}>Error Description</th>
                                    <th style={{ minWidth: 120 }}>Impact (Shop/Fld)</th>
                                    <th style={{ minWidth: 120 }}>PM</th>
                                    <th style={{ minWidth: 120 }}>Modeler</th>
                                    <th style={{ minWidth: 120 }}>Detailer</th>
                                    <th style={{ minWidth: 120 }}>Checker</th>
                                    <th style={{ minWidth: 200 }}>Root Cause</th>
                                    <th style={{ minWidth: 250 }}>Corrective/Preventive Action</th>
                                    <th style={{ minWidth: 120 }}>Severity</th>
                                    <th style={{ minWidth: 120 }}>Status</th>
                                    <th style={{ minWidth: 200 }}>Remarks</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((row, idx) => (
                                    <tr key={idx}>
                                        <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={idx + 1} disabled /></td>
                                        <td><input type="date" className="form-control" style={{ padding: 4, width: '100%' }} value={row.date} onChange={e => updateLog(idx, 'date', e.target.value)} disabled={!editMode} /></td>
                                        <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.projectName} onChange={e => updateLog(idx, 'projectName', e.target.value)} disabled={!editMode} /></td>
                                        <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.clientName} onChange={e => updateLog(idx, 'clientName', e.target.value)} disabled={!editMode} /></td>
                                        <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.errorCategory} onChange={e => updateLog(idx, 'errorCategory', e.target.value)} disabled={!editMode} /></td>
                                        <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.errorDescription} onChange={e => updateLog(idx, 'errorDescription', e.target.value)} disabled={!editMode} /></td>
                                        <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.impact} onChange={e => updateLog(idx, 'impact', e.target.value)} disabled={!editMode} /></td>
                                        <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.pm} onChange={e => updateLog(idx, 'pm', e.target.value)} disabled={!editMode} /></td>
                                        <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.modeler} onChange={e => updateLog(idx, 'modeler', e.target.value)} disabled={!editMode} /></td>
                                        <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.detailer} onChange={e => updateLog(idx, 'detailer', e.target.value)} disabled={!editMode} /></td>
                                        <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.checker} onChange={e => updateLog(idx, 'checker', e.target.value)} disabled={!editMode} /></td>
                                        <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.rootCause} onChange={e => updateLog(idx, 'rootCause', e.target.value)} disabled={!editMode} /></td>
                                        <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.correctiveAction} onChange={e => updateLog(idx, 'correctiveAction', e.target.value)} disabled={!editMode} /></td>
                                        <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.severity} onChange={e => updateLog(idx, 'severity', e.target.value)} disabled={!editMode} /></td>
                                        <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.status} onChange={e => updateLog(idx, 'status', e.target.value)} disabled={!editMode} /></td>
                                        <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.remarks} onChange={e => updateLog(idx, 'remarks', e.target.value)} disabled={!editMode} /></td>
                                    </tr>
                                ))}
                                {logs.length === 0 && !editMode && (
                                    <tr>
                                        <td colSpan={16} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-text-muted)' }}>No error logs found. Switch to Edit Mode to add some.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                        {editMode && (
                            <div style={{ margin: 16 }}>
                                <button className="btn btn-primary btn-sm" onClick={handleAddRow}>+ Add Error Log</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
