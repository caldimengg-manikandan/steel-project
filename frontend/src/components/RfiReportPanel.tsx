import { useState, useEffect } from 'react';
import { useMessage } from '../context/MessageContext';
import { fetchRfiReports, fetchRfiReportDraft, saveRfiReportDraft, submitRfiReport, getRfiReportDownloadUrl } from '../services/rfiReportApi';

interface RfiReportPanelProps {
    projectId: string;
    projectName?: string;
    initialMode?: 'view' | 'edit';
    onModeChange?: (mode: 'view' | 'edit') => void;
}

export default function RfiReportPanel({ projectId, projectName, initialMode = 'view', onModeChange }: RfiReportPanelProps) {
    const { showMessage } = useMessage();
    const [loading, setLoading] = useState(false);
    
    const [currentReportId, setCurrentReportId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState('RFI LOG');
    const [editMode, setEditMode] = useState(initialMode === 'edit');
    const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
    
    const [cdrfiData, setCdrfiData] = useState<any[]>([]);
    const [rfiData, setRfiData] = useState<any[]>([]);
    
    // Auto fetch state
    // removed autoFetchData to fix TS error

    useEffect(() => {
        setEditMode(initialMode === 'edit');
    }, [initialMode]);

    useEffect(() => {
        loadAndInitialize();
    }, [projectId]);

    const loadAndInitialize = async () => {
        try {
            setLoading(true);
            const res = await fetchRfiReports(projectId);
            
            if (res.reports && res.reports.length > 0) {
                const draft = res.reports.find((r: any) => r.status === 'Draft');
                if (draft) {
                    setCurrentReportId(draft._id || draft.id);
                    fetchLiveAutoData(draft._id || draft.id);
                } else {
                    const latest = res.reports[0];
                    setCurrentReportId(latest._id || latest.id);
                    fetchLiveAutoData(latest._id || latest.id);
                }
            } else {
                handleCreateNew();
            }
        } catch (err) {
            console.error(err);
            handleCreateNew();
        } finally {
            setLoading(false);
        }
    };

    const handleCreateNew = () => {
        setCurrentReportId(null);
        setReportDate(new Date().toISOString().split('T')[0]);
        setCdrfiData([]);
        setRfiData([]);
        setActiveTab('RFI LOG');
        fetchLiveAutoData('new');
    };

    const fetchLiveAutoData = async (reportId: string) => {
        try {
            const res = await fetchRfiReportDraft(projectId, reportId === 'new' ? 'dummy' : reportId);
            // if (res.autoFetch) setAutoFetchData(res.autoFetch);
            
            if (reportId !== 'new' && res.report) {
                setReportDate(res.report.reportDate);
                
                let savedRfis = res.report.rfiData || [];
                if (savedRfis.length === 0 && res.autoFetch && res.autoFetch.rfis && res.autoFetch.rfis.length > 0) {
                    savedRfis = res.autoFetch.rfis.map((r: any) => ({
                        isCustomRow: false,
                        rfiNumber: r.skNumber || '',
                        questionNumber: r.rfiNumber || '',
                        clientRfiNumber: r.clientRfiNumber || '',
                        status: r.status,
                        priority: r.priority || '',
                        description: r.question || r.description || '',
                        sentDate: r.sentDate ? new Date(r.sentDate).toLocaleDateString() : '',
                        seqArea: r.seqArea || '',
                        rfiType: r.rfiType || '',
                        receivedDate: r.receivedDate || '',
                        remarks: r.remarks || ''
                    }));
                }
                setRfiData(savedRfis);

                let savedCdrfis = res.report.cdrfiData || [];
                if (savedCdrfis.length === 0 && res.autoFetch && res.autoFetch.cdrfis && res.autoFetch.cdrfis.length > 0) {
                    savedCdrfis = res.autoFetch.cdrfis.map((c: any) => ({
                        isCustomRow: false,
                        caldimCdrfiNo: c.id,
                        clientCdrfiNo: '',
                        status: c.status,
                        priority: '',
                        sentDate: '',
                        seqArea: '',
                        cdrfiType: '',
                        description: c.description,
                        receivedDate: '',
                        remarks: ''
                    }));
                }
                setCdrfiData(savedCdrfis);
                setCurrentReportId(res.report._id);
            } else if (reportId === 'new' && res.autoFetch) {
                const initialRfis = res.autoFetch.rfis.map((r: any) => ({
                    isCustomRow: false,
                    rfiNumber: r.skNumber || '',
                    questionNumber: r.rfiNumber || '',
                    clientRfiNumber: r.clientRfiNumber || '',
                    status: r.status,
                    priority: r.priority || '',
                    description: r.question || r.description || '',
                    sentDate: r.sentDate ? new Date(r.sentDate).toLocaleDateString() : '',
                    seqArea: r.seqArea || '',
                    rfiType: r.rfiType || '',
                    receivedDate: r.receivedDate || '',
                    remarks: r.remarks || ''
                }));
                setRfiData(initialRfis);

                const initialCdrfis = res.autoFetch.cdrfis.map((c: any) => ({
                    isCustomRow: false,
                    caldimCdrfiNo: c.id,
                    clientCdrfiNo: '',
                    status: c.status,
                    priority: '',
                    sentDate: '',
                    seqArea: '',
                    cdrfiType: '',
                    description: c.description,
                    receivedDate: '',
                    remarks: ''
                }));
                setCdrfiData(initialCdrfis);
            }
        } catch (e) {
            console.error('Failed to fetch auto data', e);
        }
    };

    const handleSaveDraft = async () => {
        try {
            const data = {
                reportId: currentReportId,
                reportDate,
                rfiData,
                cdrfiData,
                status: 'Draft'
            };
            const res = await saveRfiReportDraft(projectId, data);
            setCurrentReportId(res.report._id);
            showMessage('Draft saved successfully', 'success');
            setEditMode(false);
            if (onModeChange) onModeChange('view');
        } catch (error: any) {
            showMessage(error.message || 'Failed to save draft', 'error');
        }
    };

    const handleSubmitReport = async () => {
        try {
            if (!currentReportId) {
                const data = {
                    reportId: currentReportId,
                    reportDate,
                    rfiData,
                    cdrfiData,
                    status: 'Draft'
                };
                const res = await saveRfiReportDraft(projectId, data);
                await submitRfiReport(projectId, res.report._id, { reportDate, rfiData, cdrfiData });
            } else {
                await submitRfiReport(projectId, currentReportId, { reportDate, rfiData, cdrfiData });
            }
            showMessage('Report submitted successfully', 'success');
            setEditMode(false);
            if (onModeChange) onModeChange('view');
            loadAndInitialize();
        } catch (error: any) {
            showMessage(error.message || 'Failed to submit report', 'error');
        }
    };

    if (loading) {
        return <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading RFI data...</div>;
    }

    return (
        <div className="weekly-progress-panel" style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
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
            `}</style>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h3 style={{ fontSize: 18, color: 'var(--color-text-primary)' }}>RFI Module - {projectName}</h3>
                <div style={{ display: 'flex', gap: 12 }}>
                    {!editMode && <button className="btn btn-secondary" onClick={handleCreateNew}>Create New Report</button>}
                    {editMode ? (
                        <>
                            {currentReportId && currentReportId !== 'new' && (
                                <button className="btn btn-secondary" onClick={() => window.open(getRfiReportDownloadUrl(projectId, currentReportId), '_blank')}>
                                    <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" strokeWidth="2" fill="none" style={{ marginRight: 6, verticalAlign: 'text-bottom' }}>
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                        <polyline points="7 10 12 15 17 10"></polyline>
                                        <line x1="12" y1="15" x2="12" y2="3"></line>
                                    </svg>
                                    Download Excel
                                </button>
                            )}
                            <button className="btn btn-secondary" onClick={handleSaveDraft}>Save Draft</button>
                            <button className="btn btn-primary" onClick={handleSubmitReport}>Submit Report</button>
                            <button className="btn btn-ghost" onClick={() => { setEditMode(false); if (onModeChange) onModeChange('view'); }}>Cancel</button>
                        </>
                    ) : (
                        <>
                            {currentReportId && currentReportId !== 'new' && (
                                <button className="btn btn-secondary" onClick={() => window.open(getRfiReportDownloadUrl(projectId, currentReportId), '_blank')}>
                                    <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" strokeWidth="2" fill="none" style={{ marginRight: 6, verticalAlign: 'text-bottom' }}>
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                        <polyline points="7 10 12 15 17 10"></polyline>
                                        <line x1="12" y1="15" x2="12" y2="3"></line>
                                    </svg>
                                    Download Excel
                                </button>
                            )}
                            <button className="btn btn-secondary" onClick={() => { setEditMode(true); if (onModeChange) onModeChange('edit'); }}>Edit Draft</button>
                        </>
                    )}
                </div>
            </div>

            <div className="card" style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                <div className="tabs">
                    {['RFI LOG', 'CDRFI LOG'].map(tab => (
                        <button key={tab} className={`tab-item ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>
                    ))}
                </div>
                
                <div className="tab-content" style={{ padding: 20, width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                    {activeTab === 'RFI LOG' && (
                        <>
                            <div className="table-wrapper" style={{ overflowX: 'auto', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                                <table className="excel-table" style={{ width: '100%', minWidth: 'max-content', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        <th style={{ width: 50, minWidth: 50, position: 'sticky', left: 0, zIndex: 10, background: 'var(--color-bg-card, #1e2533)' }}>S.NO</th>
                                        <th style={{ width: 120, minWidth: 120, position: 'sticky', left: 50, zIndex: 10, background: 'var(--color-bg-card, #1e2533)' }}>RFI #</th>
                                        <th style={{ width: 120, minWidth: 120, position: 'sticky', left: 170, zIndex: 10, background: 'var(--color-bg-card, #1e2533)' }}>QUESTION NUMBER</th>
                                        <th style={{ width: 120, minWidth: 120, position: 'sticky', left: 290, zIndex: 10, background: 'var(--color-bg-card, #1e2533)', boxShadow: '2px 0 5px -2px rgba(0,0,0,0.3)' }}>CLIENT RFI #</th>
                                        <th style={{ minWidth: 110 }}>STATUS</th>
                                        <th style={{ minWidth: 110 }}>PRIORITY</th>
                                        <th style={{ minWidth: 130 }}>SENT DATE</th>
                                        <th style={{ minWidth: 100 }}>SEQ/AREA</th>
                                        <th style={{ minWidth: 100 }}>RFI TYPE</th>
                                        <th style={{ minWidth: 250 }}>DESCRIPTION</th>
                                        <th style={{ minWidth: 130 }}>RECVD DATE</th>
                                        <th style={{ minWidth: 150 }}>REMARKS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rfiData.map((row, idx) => (
                                        <tr key={idx}>
                                            <td style={{ position: 'sticky', left: 0, zIndex: 5, background: 'var(--color-bg-card, #fff)' }}><input type="text" className="form-control" style={{ padding: 4, width: '100%', background: 'transparent' }} value={idx + 1} disabled /></td>
                                            <td style={{ position: 'sticky', left: 50, zIndex: 5, background: 'var(--color-bg-card, #fff)' }}><input type="text" className="form-control" style={{ padding: 4, width: '100%', background: 'transparent' }} value={row.rfiNumber} onChange={e => { const nd = [...rfiData]; nd[idx].rfiNumber = e.target.value; setRfiData(nd); }} disabled={!editMode} /></td>
                                            <td style={{ position: 'sticky', left: 170, zIndex: 5, background: 'var(--color-bg-card, #fff)' }}><input type="text" className="form-control" style={{ padding: 4, width: '100%', background: 'transparent' }} value={row.questionNumber} onChange={e => { const nd = [...rfiData]; nd[idx].questionNumber = e.target.value; setRfiData(nd); }} disabled={!editMode} /></td>
                                            <td style={{ position: 'sticky', left: 290, zIndex: 5, background: 'var(--color-bg-card, #fff)', boxShadow: '2px 0 5px -2px rgba(0,0,0,0.3)' }}><input type="text" className="form-control" style={{ padding: 4, width: '100%', background: 'transparent' }} value={row.clientRfiNumber} onChange={e => { const nd = [...rfiData]; nd[idx].clientRfiNumber = e.target.value; setRfiData(nd); }} disabled={!editMode} /></td>
                                            <td>
                                                <select className="form-control" style={{ padding: '4px 24px 4px 8px', width: '100%', minWidth: 100 }} value={row.status} onChange={e => { const nd = [...rfiData]; nd[idx].status = e.target.value; setRfiData(nd); }} disabled={!editMode}>
                                                    <option value="OPEN">OPEN</option>
                                                    <option value="CLOSED">CLOSED</option>
                                                </select>
                                            </td>
                                            <td>
                                                <select className="form-control" style={{ padding: '4px 24px 4px 8px', width: '100%', minWidth: 100 }} value={row.priority} onChange={e => { const nd = [...rfiData]; nd[idx].priority = e.target.value; setRfiData(nd); }} disabled={!editMode}>
                                                    <option value="">—</option>
                                                    <option value="High">High</option>
                                                    <option value="Medium">Medium</option>
                                                    <option value="Low">Low</option>
                                                </select>
                                            </td>
                                            <td><input type="date" className="form-control" style={{ padding: 4, width: '100%' }} value={row.sentDate} onChange={e => { const nd = [...rfiData]; nd[idx].sentDate = e.target.value; setRfiData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.seqArea} onChange={e => { const nd = [...rfiData]; nd[idx].seqArea = e.target.value; setRfiData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.rfiType} onChange={e => { const nd = [...rfiData]; nd[idx].rfiType = e.target.value; setRfiData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.description} onChange={e => { const nd = [...rfiData]; nd[idx].description = e.target.value; setRfiData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="date" className="form-control" style={{ padding: 4, width: '100%' }} value={row.receivedDate} onChange={e => { const nd = [...rfiData]; nd[idx].receivedDate = e.target.value; setRfiData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.remarks} onChange={e => { const nd = [...rfiData]; nd[idx].remarks = e.target.value; setRfiData(nd); }} disabled={!editMode} /></td>
                                        </tr>
                                    ))}
                                    {rfiData.length === 0 && (
                                        <tr>
                                            <td colSpan={11} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-text-muted)' }}>No RFIs found. Add a custom row below.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ margin: 16, marginTop: 16 }}><button className="btn btn-primary btn-sm" onClick={() => { setRfiData([...rfiData, { isCustomRow: true, rfiNumber: '', questionNumber: '', clientRfiNumber: '', status: '', priority: '', sentDate: '', seqArea: '', rfiType: '', description: '', receivedDate: '', remarks: '' }]); if (!editMode) { setEditMode(true); if (onModeChange) onModeChange('edit'); } }}>+ Add Custom RFI</button></div>
                        </>
                    )}

                    {activeTab === 'CDRFI LOG' && (
                        <>
                            <div className="table-wrapper" style={{ overflowX: 'auto', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                                <table className="excel-table" style={{ width: '100%', minWidth: 'max-content', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        <th style={{ width: 50, minWidth: 50, position: 'sticky', left: 0, zIndex: 10, background: 'var(--color-bg-card, #1e2533)' }}>S.NO</th>
                                        <th style={{ width: 140, minWidth: 140, position: 'sticky', left: 50, zIndex: 10, background: 'var(--color-bg-card, #1e2533)' }}>CALDIM CDRFI #</th>
                                        <th style={{ width: 140, minWidth: 140, position: 'sticky', left: 190, zIndex: 10, background: 'var(--color-bg-card, #1e2533)', boxShadow: '2px 0 5px -2px rgba(0,0,0,0.3)' }}>CLIENT CDRFI #</th>
                                        <th style={{ minWidth: 110 }}>STATUS</th>
                                        <th style={{ minWidth: 110 }}>PRIORITY</th>
                                        <th style={{ minWidth: 130 }}>SENT DATE</th>
                                        <th style={{ minWidth: 100 }}>SEQ/AREA</th>
                                        <th style={{ minWidth: 100 }}>CDRFI TYPE</th>
                                        <th style={{ minWidth: 250 }}>DESCRIPTION</th>
                                        <th style={{ minWidth: 130 }}>RECVD DATE</th>
                                        <th style={{ minWidth: 150 }}>REMARKS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cdrfiData.map((row, idx) => (
                                        <tr key={idx}>
                                            <td style={{ position: 'sticky', left: 0, zIndex: 5, background: 'var(--color-bg-card, #fff)' }}><input type="text" className="form-control" style={{ padding: 4, width: '100%', background: 'transparent' }} value={idx + 1} disabled /></td>
                                            <td style={{ position: 'sticky', left: 50, zIndex: 5, background: 'var(--color-bg-card, #fff)' }}><input type="text" className="form-control" style={{ padding: 4, width: '100%', background: 'transparent' }} value={row.caldimCdrfiNo} onChange={e => { const nd = [...cdrfiData]; nd[idx].caldimCdrfiNo = e.target.value; setCdrfiData(nd); }} disabled={!editMode} /></td>
                                            <td style={{ position: 'sticky', left: 190, zIndex: 5, background: 'var(--color-bg-card, #fff)', boxShadow: '2px 0 5px -2px rgba(0,0,0,0.3)' }}><input type="text" className="form-control" style={{ padding: 4, width: '100%', background: 'transparent' }} value={row.clientCdrfiNo} onChange={e => { const nd = [...cdrfiData]; nd[idx].clientCdrfiNo = e.target.value; setCdrfiData(nd); }} disabled={!editMode} /></td>
                                            <td>
                                                <select className="form-control" style={{ padding: '4px 24px 4px 8px', width: '100%', minWidth: 100 }} value={row.status} onChange={e => { const nd = [...cdrfiData]; nd[idx].status = e.target.value; setCdrfiData(nd); }} disabled={!editMode}>
                                                    <option value="OPEN">OPEN</option>
                                                    <option value="CLOSED">CLOSED</option>
                                                </select>
                                            </td>
                                            <td>
                                                <select className="form-control" style={{ padding: '4px 24px 4px 8px', width: '100%', minWidth: 100 }} value={row.priority} onChange={e => { const nd = [...cdrfiData]; nd[idx].priority = e.target.value; setCdrfiData(nd); }} disabled={!editMode}>
                                                    <option value="">—</option>
                                                    <option value="High">High</option>
                                                    <option value="Medium">Medium</option>
                                                    <option value="Low">Low</option>
                                                </select>
                                            </td>
                                            <td><input type="date" className="form-control" style={{ padding: 4, width: '100%' }} value={row.sentDate} onChange={e => { const nd = [...cdrfiData]; nd[idx].sentDate = e.target.value; setCdrfiData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.seqArea} onChange={e => { const nd = [...cdrfiData]; nd[idx].seqArea = e.target.value; setCdrfiData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.cdrfiType} onChange={e => { const nd = [...cdrfiData]; nd[idx].cdrfiType = e.target.value; setCdrfiData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.description} onChange={e => { const nd = [...cdrfiData]; nd[idx].description = e.target.value; setCdrfiData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="date" className="form-control" style={{ padding: 4, width: '100%' }} value={row.receivedDate} onChange={e => { const nd = [...cdrfiData]; nd[idx].receivedDate = e.target.value; setCdrfiData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.remarks} onChange={e => { const nd = [...cdrfiData]; nd[idx].remarks = e.target.value; setCdrfiData(nd); }} disabled={!editMode} /></td>
                                        </tr>
                                    ))}
                                    {cdrfiData.length === 0 && (
                                        <tr>
                                            <td colSpan={11} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-text-muted)' }}>No CDRFIs found. Add a custom row below.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ margin: 16, marginTop: 16 }}><button className="btn btn-primary btn-sm" onClick={() => { setCdrfiData([...cdrfiData, { isCustomRow: true, caldimCdrfiNo: '', clientCdrfiNo: '', status: '', priority: '', sentDate: '', seqArea: '', cdrfiType: '', description: '', receivedDate: '', remarks: '' }]); if (!editMode) { setEditMode(true); if (onModeChange) onModeChange('edit'); } }}>+ Add Custom CDRFI</button></div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
