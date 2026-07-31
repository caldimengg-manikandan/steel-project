import { useState, useEffect } from 'react';
import { useMessage } from '../context/MessageContext';
import { fetchWeeklyProgresss, saveWeeklyProgressDraft, getWeeklyProgressDownloadUrl, fetchWeeklyProgressDraft } from '../services/weeklyProgressApi';

const DEFAULT_SOW = [
    { sNo: '', description: 'BASE BID', change: '', receivedDate: '', remarks: '' },
    { sNo: '', description: 'STRUCTURAL STEEL:', change: '', receivedDate: '', remarks: '' },
    { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
    { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
    { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
    { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
    { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
    { sNo: '', description: 'MISC. STEEL:', change: '', receivedDate: '', remarks: '' },
    { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
    { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
    { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
    { sNo: '', description: '', change: '', receivedDate: '', remarks: '' },
    { sNo: '', description: '', change: '', receivedDate: '', remarks: '' }
];

const DEFAULT_SCHEDULE: any[] = Array.from({ length: 10 }, (_, i) => ({
    sNo: String(i + 1), seqArea: '', status: '', plannedIfaDate: '', actualIfaDate: '',
    bfaReceivedDate: '', plannedFabDate: '', actualFabDate: '', remarks: ''
}));

export default function WeeklyProgressPanel({ projectId, projectName, initialMode = 'view', onModeChange, onClose }: {
    projectId: string, projectName?: string, initialMode?: 'view' | 'edit', onClose?: () => void, onModeChange?: (mode: 'view' | 'edit') => void
}) {
    const { showMessage } = useMessage();
    const [loading, setLoading] = useState(false);
    const [currentReportId, setCurrentReportId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState('SUMMARY');
    const [editMode, setEditMode] = useState(initialMode === 'edit');

    useEffect(() => {
        setEditMode(initialMode === 'edit');
    }, [initialMode]);

    // Form state
    const [weekStartDate, setWeekStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [summaryData, setSummaryData] = useState<any>({
        date: '', projectName: projectName || '', projectNo: '', clientName: '',
        clientProjectNo: '', clientAddress: '', clientProjectManager: '',
        caldimProjectManager: '', reportCirculatedTo1: '', reportCirculatedTo2: '',
        projectType: '', projectDescription: '', projectStatusLastWeek: '',
        overallApprovalStatus: '', overallFabricationStatus: ''
    });
    const [sowData, setSowData] = useState<any[]>(DEFAULT_SOW);
    const [scheduleData, setScheduleData] = useState<any[]>(DEFAULT_SCHEDULE);
    const [transmittalData, setTransmittalData] = useState<any[]>([]);
    const [corStats, setCorStats] = useState({ total: 0, approved: 0, completed: 0, pending: 0 });
    const [corData, setCorData] = useState<any[]>([]);

    useEffect(() => {
        loadAndInitialize();
    }, [projectId]);

    const loadAndInitialize = async () => {
        try {
            setLoading(true);
            const res = await fetchWeeklyProgresss(projectId);
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
        setWeekStartDate(new Date().toISOString().split('T')[0]);
        setSummaryData({
            date: new Date().toISOString().split('T')[0], projectName: projectName || '', projectNo: '',
            clientName: '', clientProjectNo: '', clientAddress: '', clientProjectManager: '',
            caldimProjectManager: '', reportCirculatedTo1: '', reportCirculatedTo2: '',
            projectType: '', projectDescription: '', projectStatusLastWeek: '',
            overallApprovalStatus: '', overallFabricationStatus: ''
        });
        setSowData(DEFAULT_SOW);
        setScheduleData(DEFAULT_SCHEDULE);
        setTransmittalData([]);
        setCorData([]);
        setActiveTab('SUMMARY');
        fetchLiveAutoData('new');
    };

    const fetchLiveAutoData = async (reportId: string) => {
        try {
            const res = await fetchWeeklyProgressDraft(projectId, reportId === 'new' ? 'dummy' : reportId);

            if (reportId !== 'new' && res.report) {
                setWeekStartDate(res.report.weekStartDate);
                setSummaryData(res.report.summaryData || {});
                if (res.report.corStats && (res.report.corStats.total > 0 || res.report.corStats.approved > 0 || res.report.corStats.completed > 0 || res.report.corStats.pending > 0)) {
                    setCorStats(res.report.corStats);
                } else if (res.autoFetch?.corStats) {
                    setCorStats(res.autoFetch.corStats);
                }

                let savedSow = res.report.sowData || [];
                if (savedSow.length === 0 || (savedSow.length === 1 && !savedSow[0].description)) {
                    savedSow = DEFAULT_SOW;
                }
                setSowData(savedSow);

                const savedSchedule = res.report.scheduleData || [];
                setScheduleData(savedSchedule.length > 0 ? savedSchedule : DEFAULT_SCHEDULE);

                let savedCorData = res.report.corData || [];
                if (savedCorData.length === 0 && res.autoFetch?.cdrfis?.length > 0) {
                    savedCorData = res.autoFetch.cdrfis.map((co: any) => ({
                        cor: co.id || '',
                        date: co.createdAt ? new Date(co.createdAt).toISOString().split('T')[0] : '',
                        changeReference: '',
                        corAmount: co.amount || '',
                        status: co.status || '',
                        description: co.description || ''
                    }));
                }
                setCorData(savedCorData);

                let savedTransmittals = res.report.transmittalData || [];
                if (savedTransmittals.length === 0 && res.autoFetch?.transmittals?.length > 0) {
                    savedTransmittals = res.autoFetch.transmittals.map((t: any) => ({
                        isCustomRow: false,
                        transmittalNo: t.transmittalNumber ? `TR-${String(t.transmittalNumber).padStart(3, '0')}` : (t.trackingNo || t.id || ''),
                        date: t.createdAt ? new Date(t.createdAt).toISOString().split('T')[0] : '',
                        appFab: '', numberOfSheets: t.drawings ? t.drawings.length : '',
                        seqArea: t.sequences?.length > 0 ? t.sequences.join(', ') : '', remarks: ''
                    }));
                }
                setTransmittalData(savedTransmittals);
                setCurrentReportId(res.report._id);

            } else if (reportId === 'new' && res.autoFetch) {
                const initialTransmittals = res.autoFetch.transmittals.map((t: any) => ({
                    isCustomRow: false,
                    transmittalNo: t.transmittalNumber ? `TR-${String(t.transmittalNumber).padStart(3, '0')}` : (t.trackingNo || t.id || ''),
                    date: t.createdAt ? new Date(t.createdAt).toISOString().split('T')[0] : '',
                    appFab: t.appFab || '', numberOfSheets: t.drawings ? t.drawings.length : '',
                    seqArea: t.sequences?.length > 0 ? t.sequences.join(', ') : '', remarks: ''
                }));
                setTransmittalData(initialTransmittals);

                const pDetails = res.autoFetch.projectDetails || {};
                if (res.autoFetch.corStats) setCorStats(res.autoFetch.corStats);
                
                let initialCorData = [];
                if (res.autoFetch.cdrfis && res.autoFetch.cdrfis.length > 0) {
                    initialCorData = res.autoFetch.cdrfis.map((co: any) => ({
                        cor: co.id || '',
                        date: co.createdAt ? new Date(co.createdAt).toISOString().split('T')[0] : '',
                        changeReference: '',
                        corAmount: co.amount || '',
                        status: co.status || '',
                        description: co.description || ''
                    }));
                }
                setCorData(initialCorData);

                setSummaryData((prev: any) => ({
                    ...prev,
                    projectName: prev.projectName || pDetails.projectName || '',
                    clientName: prev.clientName || pDetails.clientName || '',
                    clientAddress: prev.clientAddress || pDetails.clientAddress || '',
                    clientProjectManager: prev.clientProjectManager || pDetails.clientProjectManager || '',
                    overallFabricationStatus: res.autoFetch.fabricationStats || '',
                    overallApprovalStatus: res.autoFetch.approvalStats || ''
                }));
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleSaveDraft = async () => {
        try {
            const data = { reportId: currentReportId, weekStartDate, summaryData, sowData, scheduleData, transmittalData, corData, corStats, status: 'Draft' };
            const res = await saveWeeklyProgressDraft(projectId, data);
            showMessage('Success', 'Draft saved.', 'success');
            setCurrentReportId(res.report._id);
        } catch (err) {
            showMessage('Error', 'Failed to save draft', 'error');
        }
    };

    const handleSubmitReport = async () => {
        try {
            const data = { reportId: currentReportId, weekStartDate, summaryData, sowData, scheduleData, transmittalData, corData, corStats, status: 'Submitted' };
            const res = await saveWeeklyProgressDraft(projectId, data);
            showMessage('Success', 'Report submitted. You can now download the Excel.', 'success');
            setCurrentReportId(res.report._id);
            setEditMode(false);
        } catch (err) {
            showMessage('Error', 'Failed to submit report', 'error');
        }
    };

    const renderSummaryInput = (key: string, label: string, isTextarea = false) => {
        const isDateType = key === 'date';
        return (
            <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">{label}</label>
                {isTextarea ? (
                    <textarea className="form-control" value={summaryData[key] || ''} onChange={e => setSummaryData({ ...summaryData, [key]: e.target.value })} disabled={!editMode} rows={4} />
                ) : (
                    <input type={isDateType ? 'date' : 'text'} className="form-control" value={summaryData[key] || ''} onChange={e => setSummaryData({ ...summaryData, [key]: e.target.value })} disabled={!editMode} />
                )}
            </div>
        );
    };

    return (
        <div style={{ padding: '0 10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
                <h2>Weekly Progress</h2>
            </div>

            {loading && <p>Loading...</p>}

            <div className="card" style={{ padding: 24, marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24, alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--color-text-muted)' }}>Week Start Date</label>
                            <input type="date" value={weekStartDate} onChange={e => setWeekStartDate(e.target.value)} disabled={!editMode} className="form-control" style={{ width: 160 }} />
                        </div>
                        <div style={{ paddingTop: 20 }}>
                            {!editMode && <button className="btn btn-secondary" onClick={() => { setEditMode(true); if (onModeChange) onModeChange('edit'); }}>Edit Draft</button>}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 12, paddingTop: 20 }}>
                        {editMode ? (
                            <>
                                <button className="btn btn-secondary" onClick={handleSaveDraft}>Save Draft</button>
                                <button className="btn btn-primary" onClick={handleSubmitReport}>Submit Report</button>
                                <button className="btn btn-ghost" onClick={() => { setEditMode(false); if (onModeChange) onModeChange('view'); }}>Cancel</button>
                            </>
                        ) : null}
                        {currentReportId && !editMode && <a href={getWeeklyProgressDownloadUrl(projectId, currentReportId)} download className="btn btn-primary">Download Excel</a>}
                    </div>
                </div>

                <div className="tab-bar" style={{ marginBottom: 24 }}>
                    {['SUMMARY', 'SOW', 'SCHEDULE', 'COR', 'TRANSMITTAL LOG'].map(tab => (
                        <button key={tab} className={`tab-item ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>
                    ))}
                </div>

                <div style={{ minHeight: 500 }}>
                    {activeTab === 'SUMMARY' && (
                        <div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
                                <div>
                                    <h3 style={{ fontSize: 14, marginBottom: 16, color: 'var(--color-primary)' }}>Header Information</h3>
                                    {renderSummaryInput('date', 'Date')}
                                    {renderSummaryInput('projectName', 'Project Name')}
                                    {renderSummaryInput('projectNo', 'Project Number')}
                                    {renderSummaryInput('clientName', 'Client Name')}
                                    {renderSummaryInput('clientProjectNo', 'Client Project Number')}
                                    {renderSummaryInput('clientAddress', 'Client Address')}
                                </div>
                                <div>
                                    <h3 style={{ fontSize: 14, marginBottom: 16, color: 'var(--color-primary)' }}>Personnel & Routing</h3>
                                    {renderSummaryInput('clientProjectManager', 'Client Project Manager')}
                                    {renderSummaryInput('caldimProjectManager', 'Caldim Project Manager')}
                                    {renderSummaryInput('reportCirculatedTo1', 'Report Circulated To (1)')}
                                    {renderSummaryInput('reportCirculatedTo2', 'Report Circulated To (2)')}
                                    {renderSummaryInput('projectType', 'Project Type (e.g. Commercial, Industrial)')}
                                </div>
                            </div>
                            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 24 }}>
                                <h3 style={{ fontSize: 14, marginBottom: 16, color: 'var(--color-primary)' }}>Status & Descriptions</h3>
                                {renderSummaryInput('projectDescription', 'Project Description', true)}
                                {renderSummaryInput('projectStatusLastWeek', 'Project Status Last Week', true)}
                                {renderSummaryInput('overallApprovalStatus', 'Overall Approval Status', true)}
                                {renderSummaryInput('overallFabricationStatus', 'Overall Fabrication Status', true)}
                            </div>
                        </div>
                    )}

                    {activeTab === 'SOW' && (
                        <>
                            <div className="table-wrapper">
                            <table className="excel-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: 80 }}>S.No</th>
                                        <th>DESCRIPTION</th>
                                        <th style={{ width: 120 }}>CHANGE</th>
                                        <th style={{ width: 150 }}>RECEIVED DATE</th>
                                        <th style={{ width: 250 }}>REMARKS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(() => {
                                        let currentSNo = 1;
                                        return sowData.flatMap((row, idx) => {
                                            const isHeading = ['BASE BID', 'STRUCTURAL STEEL:', 'MISC. STEEL:'].includes(row.description);
                                            const isBold = ['STRUCTURAL STEEL:', 'MISC. STEEL:'].includes(row.description);
                                            
                                            const renderedElements = [];
                                            
                                            // Add Row button row BEFORE MISC. STEEL:
                                            if (editMode && row.description === 'MISC. STEEL:') {
                                                renderedElements.push(
                                                    <tr key={`add-btn-misc-${idx}`} style={{ background: 'transparent' }}>
                                                        <td colSpan={editMode ? 6 : 5} style={{ border: 'none', textAlign: 'left', padding: '8px 16px' }}>
                                                            <button 
                                                                className="btn btn-primary btn-sm"
                                                                onClick={() => {
                                                                    const nd = [...sowData];
                                                                    nd.splice(idx, 0, { sNo: '', description: '', change: '', receivedDate: '', remarks: '' });
                                                                    setSowData(nd);
                                                                }}
                                                            >
                                                                + Add Row
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            }

                                            if (isHeading) {
                                                renderedElements.push(
                                                    <tr key={`heading-${idx}`} style={{ backgroundColor: 'var(--color-table-row-alt)' }}>
                                                        <td></td>
                                                        <td colSpan={editMode ? 5 : 4} style={{ fontWeight: isBold ? 'bold' : 'normal', textDecoration: isBold ? 'underline' : 'none' }}>
                                                            {row.description}
                                                        </td>
                                                    </tr>
                                                );
                                                return renderedElements;
                                            }

                                            const displaySNo = currentSNo++;
                                            renderedElements.push(
                                                <tr key={`data-${idx}`}>
                                                    <td style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>{displaySNo}</td>
                                                    <td><input type="text" className="form-control" style={{ padding: 4 }} value={row.description} onChange={e => { const nd = [...sowData]; nd[idx].description = e.target.value; setSowData(nd); }} disabled={!editMode} /></td>
                                                    <td><input type="text" className="form-control" style={{ padding: 4 }} value={row.change} onChange={e => { const nd = [...sowData]; nd[idx].change = e.target.value; setSowData(nd); }} disabled={!editMode} /></td>
                                                    <td><input type="date" className="form-control" style={{ padding: 4 }} value={row.receivedDate} onChange={e => { const nd = [...sowData]; nd[idx].receivedDate = e.target.value; setSowData(nd); }} disabled={!editMode} /></td>
                                                    <td><input type="text" className="form-control" style={{ padding: 4 }} value={row.remarks} onChange={e => { const nd = [...sowData]; nd[idx].remarks = e.target.value; setSowData(nd); }} disabled={!editMode} /></td>
                                                    {editMode && (
                                                        <td style={{ width: 30, padding: 0, textAlign: 'center', border: 'none' }}>
                                                            <button 
                                                                onClick={() => { const nd = [...sowData]; nd.splice(idx, 1); setSowData(nd); }}
                                                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#dc2626' }}
                                                                title="Delete Row"
                                                            >
                                                                ✕
                                                            </button>
                                                        </td>
                                                    )}
                                                </tr>
                                            );
                                            return renderedElements;
                                        });
                                    })()}
                                </tbody>
                            </table>
                        </div>
                        {editMode && (
                            <div style={{ marginTop: 16 }}>
                                <button 
                                    className="btn btn-primary btn-sm"
                                    onClick={() => setSowData([...sowData, { sNo: '', description: '', change: '', receivedDate: '', remarks: '' }])}
                                >
                                    + Add Row
                                </button>
                            </div>
                        )}
                        </>
                    )}

                    {activeTab === 'SCHEDULE' && (
                        <>
                            <div className="table-wrapper">
                            <table className="excel-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: 60 }}>S.No</th>
                                        <th>Seq/Area</th>
                                        <th>Status</th>
                                        <th>Planned IFA</th>
                                        <th>Actual IFA</th>
                                        <th>Planned Fab</th>
                                        <th>Actual Fab</th>
                                        <th>Remarks</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {scheduleData.map((row, idx) => (
                                        <tr key={idx}>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.sNo} onChange={e => { const nd = [...scheduleData]; nd[idx].sNo = e.target.value; setScheduleData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.seqArea} onChange={e => { const nd = [...scheduleData]; nd[idx].seqArea = e.target.value; setScheduleData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.status} onChange={e => { const nd = [...scheduleData]; nd[idx].status = e.target.value; setScheduleData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="date" className="form-control" style={{ padding: 4, width: '100%' }} value={row.plannedIfaDate} onChange={e => { const nd = [...scheduleData]; nd[idx].plannedIfaDate = e.target.value; setScheduleData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="date" className="form-control" style={{ padding: 4, width: '100%' }} value={row.actualIfaDate} onChange={e => { const nd = [...scheduleData]; nd[idx].actualIfaDate = e.target.value; setScheduleData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="date" className="form-control" style={{ padding: 4, width: '100%' }} value={row.plannedFabDate} onChange={e => { const nd = [...scheduleData]; nd[idx].plannedFabDate = e.target.value; setScheduleData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="date" className="form-control" style={{ padding: 4, width: '100%' }} value={row.actualFabDate} onChange={e => { const nd = [...scheduleData]; nd[idx].actualFabDate = e.target.value; setScheduleData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.remarks} onChange={e => { const nd = [...scheduleData]; nd[idx].remarks = e.target.value; setScheduleData(nd); }} disabled={!editMode} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {editMode && <div style={{ marginTop: 16 }}><button className="btn btn-primary btn-sm" onClick={() => setScheduleData([...scheduleData, { sNo: String(scheduleData.length + 1), seqArea: '', status: '', plannedIfaDate: '', actualIfaDate: '', bfaReceivedDate: '', plannedFabDate: '', actualFabDate: '', remarks: '' }])}>+ Add Schedule Row</button></div>}
                        </>
                    )}

                    {activeTab === 'COR' && (
                        <div style={{ padding: 20 }}>
                            <h3 style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 24, textTransform: 'uppercase', letterSpacing: 0.5 }}>CHANGE ORDERS (CO)</h3>
                            <div className="table-wrapper">
                                <table className="excel-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 80 }}>COR</th>
                                            <th style={{ width: 120 }}>DATE</th>
                                            <th>CHANGE REFERENCE</th>
                                            <th style={{ width: 150 }}>COR AMOUNT</th>
                                            <th style={{ width: 120 }}>STATUS</th>
                                            <th>DESCRIPTION</th>
                                            {editMode && <th style={{ width: 30, border: 'none' }}></th>}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {corData.map((row, idx) => (
                                            <tr key={idx}>
                                                <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.cor} onChange={e => { const nd = [...corData]; nd[idx].cor = e.target.value; setCorData(nd); }} disabled={!editMode} /></td>
                                                <td><input type="date" className="form-control" style={{ padding: 4, width: '100%' }} value={row.date} onChange={e => { const nd = [...corData]; nd[idx].date = e.target.value; setCorData(nd); }} disabled={!editMode} /></td>
                                                <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.changeReference} onChange={e => { const nd = [...corData]; nd[idx].changeReference = e.target.value; setCorData(nd); }} disabled={!editMode} /></td>
                                                <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.corAmount} onChange={e => { const nd = [...corData]; nd[idx].corAmount = e.target.value; setCorData(nd); }} disabled={!editMode} /></td>
                                                <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.status} onChange={e => { const nd = [...corData]; nd[idx].status = e.target.value; setCorData(nd); }} disabled={!editMode} /></td>
                                                <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.description} onChange={e => { const nd = [...corData]; nd[idx].description = e.target.value; setCorData(nd); }} disabled={!editMode} /></td>
                                                {editMode && (
                                                    <td style={{ width: 30, padding: 0, textAlign: 'center', border: 'none' }}>
                                                        <button 
                                                            onClick={() => { const nd = [...corData]; nd.splice(idx, 1); setCorData(nd); }}
                                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#dc2626' }}
                                                            title="Delete Row"
                                                        >
                                                            ✕
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {editMode && <div style={{ marginTop: 16 }}><button className="btn btn-primary btn-sm" onClick={() => setCorData([...corData, { cor: '', date: '', changeReference: '', corAmount: '', status: '', description: '' }])}>+ Add COR Row</button></div>}
                        </div>
                    )}

                    {activeTab === 'TRANSMITTAL LOG' && (
                        <>
                            <div className="table-wrapper">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Fields auto-fetched from Transmittal Log. Overwrite manually as needed.</p>
                            </div>
                            <table className="excel-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: 60 }}>S.No</th>
                                        <th>Transmittal No</th>
                                        <th>Date</th>
                                        <th>App/Fab</th>
                                        <th style={{ width: 80 }}>Sheets</th>
                                        <th>Seq/Area</th>
                                        <th>Remarks</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {transmittalData.map((row, idx) => (
                                        <tr key={idx}>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={idx + 1} disabled /></td>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.transmittalNo} onChange={e => { const nd = [...transmittalData]; nd[idx].transmittalNo = e.target.value; setTransmittalData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="date" className="form-control" style={{ padding: 4, width: '100%' }} value={row.date} onChange={e => { const nd = [...transmittalData]; nd[idx].date = e.target.value; setTransmittalData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.appFab} onChange={e => { const nd = [...transmittalData]; nd[idx].appFab = e.target.value; setTransmittalData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.numberOfSheets} onChange={e => { const nd = [...transmittalData]; nd[idx].numberOfSheets = e.target.value; setTransmittalData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.seqArea} onChange={e => { const nd = [...transmittalData]; nd[idx].seqArea = e.target.value; setTransmittalData(nd); }} disabled={!editMode} /></td>
                                            <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.remarks} onChange={e => { const nd = [...transmittalData]; nd[idx].remarks = e.target.value; setTransmittalData(nd); }} disabled={!editMode} /></td>
                                        </tr>
                                    ))}
                                    {transmittalData.length === 0 && (
                                        <tr>
                                            <td colSpan={7} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-text-muted)' }}>No transmittals found.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {editMode && <div style={{ marginTop: 16 }}><button className="btn btn-primary btn-sm" onClick={() => setTransmittalData([...transmittalData, { isCustomRow: true, transmittalNo: '', date: '', appFab: '', numberOfSheets: '', seqArea: '', remarks: '' }])}>+ Add Transmittal Row</button></div>}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
