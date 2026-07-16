import { useState, useEffect } from 'react';
import { useMessage } from '../context/MessageContext';
import { fetchWeeklyProgresss, saveWeeklyProgressDraft, getWeeklyProgressDownloadUrl, fetchWeeklyProgressDraft } from '../services/weeklyProgressApi';

const DEFAULT_SOW = [
    { sNo: '', description: 'BASE BID', change: '', receivedDate: '', remarks: '' },
    { sNo: '', description: 'STRUCTURAL STEEL:', change: '', receivedDate: '', remarks: '' },
    ...Array(10).fill(null).map(() => ({ sNo: '', description: '', change: '', receivedDate: '', remarks: '' })),
    { sNo: '', description: 'MISC. STEEL:', change: '', receivedDate: '', remarks: '' },
    ...Array(5).fill(null).map(() => ({ sNo: '', description: '', change: '', receivedDate: '', remarks: '' }))
];

export default function WeeklyProgressPanel({ projectId, projectName, initialMode = 'view', onModeChange }: { projectId: string, projectName?: string, initialMode?: 'view' | 'edit', onClose?: () => void, onModeChange?: (mode: 'view' | 'edit') => void }) {
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
        date: '',
        projectName: projectName || '',
        projectNo: '',
        clientName: '',
        clientProjectNo: '',
        clientAddress: '',
        clientProjectManager: '',
        caldimProjectManager: '',
        reportCirculatedTo1: '',
        reportCirculatedTo2: '',
        projectType: '',
        projectDescription: '',
        projectStatusLastWeek: '',
        overallApprovalStatus: '',
        overallFabricationStatus: ''
    });
    const [sowData, setSowData] = useState<any[]>([]);
    const [scheduleData, setScheduleData] = useState<any[]>([]);
    const [transmittalData, setTransmittalData] = useState<any[]>([]);
    const [cdrfiData, setCdrfiData] = useState<any[]>([]);
    const [rfiData, setRfiData] = useState<any[]>([]);
    
    // Auto fetch state
    const [autoFetchData, setAutoFetchData] = useState<any>({ transmittals: [], rfis: [], cdrfis: [] });

    useEffect(() => {
        loadAndInitialize();
    }, [projectId]);

    const loadAndInitialize = async () => {
        try {
            setLoading(true);
            const res = await fetchWeeklyProgresss(projectId);
            
            // If there's an existing report/draft, load it. Otherwise always show a new empty form.
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
                // No saved reports — always show the form with auto-fetched data (never close/redirect)
                handleCreateNew();
            }
        } catch (err) {
            console.error(err);
            // Even on error, show an empty form instead of a blank page
            handleCreateNew();
        } finally {
            setLoading(false);
        }
    };

    const handleCreateNew = () => {
        setCurrentReportId(null);
        setWeekStartDate(new Date().toISOString().split('T')[0]);
        setSummaryData({
            date: new Date().toLocaleDateString(),
            projectName: projectName || '',
            projectNo: '',
            clientName: '',
            clientProjectNo: '',
            clientAddress: '',
            clientProjectManager: '',
            caldimProjectManager: '',
            reportCirculatedTo1: '',
            reportCirculatedTo2: '',
            projectType: '',
            projectDescription: '',
            projectStatusLastWeek: '',
            overallApprovalStatus: '',
            overallFabricationStatus: ''
        });
        setSowData(DEFAULT_SOW);
        setScheduleData([{ sNo: '1', seqArea: '', status: '', plannedIfaDate: '', actualIfaDate: '', bfaReceivedDate: '', plannedFabDate: '', actualFabDate: '', remarks: '' }]);
        setTransmittalData([]);
        setCdrfiData([]);
        setRfiData([]);
        setActiveTab('SUMMARY');
        fetchLiveAutoData('new');
    };

    const fetchLiveAutoData = async (reportId: string) => {
        try {
            const res = await fetchWeeklyProgressDraft(projectId, reportId === 'new' ? 'dummy' : reportId);
            if (res.autoFetch) setAutoFetchData(res.autoFetch);
            
            if (reportId !== 'new' && res.report) {
                setWeekStartDate(res.report.weekStartDate);
                setSummaryData(res.report.summaryData || {});
                
                let savedSow = res.report.sowData || [];
                if (savedSow.length === 0 || (savedSow.length === 1 && !savedSow[0].description)) {
                    savedSow = DEFAULT_SOW;
                }
                setSowData(savedSow);
                
                setScheduleData(res.report.scheduleData || []);
                let savedTransmittals = res.report.transmittalData || [];
                let savedRfis = res.report.rfiData || [];
                if (savedRfis.length === 0 && res.autoFetch && res.autoFetch.rfis && res.autoFetch.rfis.length > 0) {
                    savedRfis = res.autoFetch.rfis.map((r: any) => ({
                        isCustomRow: false,
                        rfiNumber: r.rfiNumber,
                        clientRfiNumber: r.clientRfiNumber || '',
                        status: r.status,
                        priority: r.priority || '',
                        description: r.description || '',
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
                if (savedTransmittals.length === 0 && res.autoFetch && res.autoFetch.transmittals && res.autoFetch.transmittals.length > 0) {
                    savedTransmittals = res.autoFetch.transmittals.map((t: any) => ({
                        isCustomRow: false,
                        transmittalNo: t.transmittalNumber ? `TR-${String(t.transmittalNumber).padStart(3, '0')}` : (t.trackingNo || t.id || ''),
                        date: t.createdAt ? new Date(t.createdAt).toISOString().split('T')[0] : '',
                        appFab: '',
                        numberOfSheets: t.drawings ? t.drawings.length : '',
                        seqArea: t.sequences && t.sequences.length > 0 ? t.sequences.join(', ') : '',
                        remarks: ''
                    }));
                }
                setTransmittalData(savedTransmittals);
                setCurrentReportId(res.report._id);
            } else if (reportId === 'new' && res.autoFetch) {
                const initialTransmittals = res.autoFetch.transmittals.map((t: any) => ({
                    isCustomRow: false,
                    transmittalNo: t.transmittalNumber ? `TR-${String(t.transmittalNumber).padStart(3, '0')}` : (t.trackingNo || t.id || ''),
                    date: t.createdAt ? new Date(t.createdAt).toISOString().split('T')[0] : '',
                    appFab: t.appFab || '',
                    numberOfSheets: t.drawings ? t.drawings.length : '',
                    seqArea: t.sequences && t.sequences.length > 0 ? t.sequences.join(', ') : '',
                    remarks: ''
                }));
                setTransmittalData(initialTransmittals);
                const initialRfis = res.autoFetch.rfis.map((r: any) => ({
                    isCustomRow: false,
                    rfiNumber: r.rfiNumber,
                    clientRfiNumber: r.clientRfiNumber || '',
                    status: r.status,
                    priority: r.priority || '',
                    description: r.description || '',
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
                
                const pDetails = res.autoFetch.projectDetails || {};
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
            const data = {
                reportId: currentReportId,
                weekStartDate,
                summaryData,
                sowData,
                scheduleData,
                transmittalData,
                cdrfiData,
                rfiData,
                status: 'Draft'
            };
            const res = await saveWeeklyProgressDraft(projectId, data);
            showMessage('Success', 'Draft saved.', 'success');
            setCurrentReportId(res.report._id);
        } catch (err) {
            showMessage('Error', 'Failed to save draft', 'error');
        }
    };

    const handleSubmitReport = async () => {
        try {
            const data = {
                reportId: currentReportId,
                weekStartDate,
                summaryData,
                sowData,
                scheduleData,
                transmittalData,
                cdrfiData,
                rfiData,
                status: 'Submitted'
            };
            const res = await saveWeeklyProgressDraft(projectId, data);
            showMessage('Success', 'Report submitted. You can now download the Excel.', 'success');
            setCurrentReportId(res.report._id);
            setEditMode(false);
        } catch (err) {
            showMessage('Error', 'Failed to submit report', 'error');
        }
    };

    // Helper for rendering summary fields in a clean grid
    const renderSummaryInput = (key: string, label: string, isTextarea = false) => {
        const isDateType = key === 'date';
        return (
            <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">{label}</label>
                {isTextarea ? (
                    <textarea 
                        className="form-control" 
                        value={summaryData[key] || ''} 
                        onChange={e => setSummaryData({...summaryData, [key]: e.target.value})} 
                        disabled={!editMode} 
                        rows={4} 
                    />
                ) : (
                    <input 
                        type={isDateType ? "date" : "text"} 
                        className="form-control" 
                        value={summaryData[key] || ''} 
                        onChange={e => setSummaryData({...summaryData, [key]: e.target.value})} 
                        disabled={!editMode} 
                    />
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
            
            {/* Removed the list view to jump straight to the auto-fetched report form */}

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
                        {['SUMMARY', 'SOW', 'SCHEDULE', 'TRANSMITTAL LOG', 'RFI LOG', 'CDRFI LOG', 'REF'].map(tab => (
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
                                        {sowData.map((row, idx) => {
                                            const isHeading = ['BASE BID', 'STRUCTURAL STEEL:', 'MISC. STEEL:'].includes(row.description);
                                            const isBold = ['STRUCTURAL STEEL:', 'MISC. STEEL:'].includes(row.description);
                                            
                                            if (isHeading) {
                                                return (
                                                    <tr key={idx} style={{ backgroundColor: 'var(--color-table-row-alt)' }}>
                                                        <td></td>
                                                        <td colSpan={4} style={{ fontWeight: isBold ? 'bold' : 'normal', textDecoration: isBold ? 'underline' : 'none' }}>
                                                            {row.description}
                                                        </td>
                                                    </tr>
                                                );
                                            }
                                            
                                            return (
                                                <tr key={idx}>
                                                    <td><input type="text" className="form-control" style={{ padding: 4 }} value={row.sNo} onChange={e => { const nd = [...sowData]; nd[idx].sNo = e.target.value; setSowData(nd); }} disabled={!editMode} /></td>
                                                    <td><input type="text" className="form-control" style={{ padding: 4 }} value={row.description} onChange={e => { const nd = [...sowData]; nd[idx].description = e.target.value; setSowData(nd); }} disabled={!editMode} /></td>
                                                    <td><input type="text" className="form-control" style={{ padding: 4 }} value={row.change} onChange={e => { const nd = [...sowData]; nd[idx].change = e.target.value; setSowData(nd); }} disabled={!editMode} /></td>
                                                    <td><input type="date" className="form-control" style={{ padding: 4 }} value={row.receivedDate} onChange={e => { const nd = [...sowData]; nd[idx].receivedDate = e.target.value; setSowData(nd); }} disabled={!editMode} /></td>
                                                    <td><input type="text" className="form-control" style={{ padding: 4 }} value={row.remarks} onChange={e => { const nd = [...sowData]; nd[idx].remarks = e.target.value; setSowData(nd); }} disabled={!editMode} /></td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                {editMode && <div style={{ margin: 16 }}><button className="btn btn-primary btn-sm" onClick={() => setSowData([...sowData, { sNo: (sowData.length + 1).toString(), description: '', change: '', receivedDate: '', remarks: '' }])}>+ Add SOW Row</button></div>}
                            </div>
                        )}
                        
                        {activeTab === 'SCHEDULE' && (
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
                                {editMode && <div style={{ margin: 16 }}><button className="btn btn-primary btn-sm" onClick={() => setScheduleData([...scheduleData, { sNo: (scheduleData.length + 1).toString(), seqArea: '', status: '', plannedIfaDate: '', actualIfaDate: '', bfaReceivedDate: '', plannedFabDate: '', actualFabDate: '', remarks: '' }])}>+ Add Schedule Row</button></div>}
                            </div>
                        )}

                        {activeTab === 'TRANSMITTAL LOG' && (
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
                                                <td colSpan={7} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-text-muted)' }}>No transmittals found. Add a custom row below.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {activeTab === 'RFI LOG' && (
                            <div className="table-wrapper">
                                <table className="excel-table">
                                    <thead>
                                        <tr>
                                            <th>S.NO</th>
                                            <th>CALDIM RFI #</th>
                                            <th>CLIENT RFI #</th>
                                            <th>STATUS</th>
                                            <th>PRIORITY</th>
                                            <th>SENT DATE</th>
                                            <th>SEQ/AREA</th>
                                            <th>RFI TYPE</th>
                                            <th>DESCRIPTION</th>
                                            <th>RECVD DATE</th>
                                            <th>REMARKS</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rfiData.map((row, idx) => (
                                            <tr key={idx}>
                                                <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={idx + 1} disabled /></td>
                                                <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.rfiNumber} onChange={e => { const nd = [...rfiData]; nd[idx].rfiNumber = e.target.value; setRfiData(nd); }} disabled={!editMode} /></td>
                                                <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.clientRfiNumber} onChange={e => { const nd = [...rfiData]; nd[idx].clientRfiNumber = e.target.value; setRfiData(nd); }} disabled={!editMode} /></td>
                                                <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.status} onChange={e => { const nd = [...rfiData]; nd[idx].status = e.target.value; setRfiData(nd); }} disabled={!editMode} /></td>
                                                <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.priority} onChange={e => { const nd = [...rfiData]; nd[idx].priority = e.target.value; setRfiData(nd); }} disabled={!editMode} /></td>
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
                                {editMode && <div style={{ margin: 16 }}><button className="btn btn-primary btn-sm" onClick={() => setRfiData([...rfiData, { isCustomRow: true, rfiNumber: '', clientRfiNumber: '', status: '', priority: '', sentDate: '', seqArea: '', rfiType: '', description: '', receivedDate: '', remarks: '' }])}>+ Add Custom RFI</button></div>}
                            </div>
                        )}

                        {activeTab === 'CDRFI LOG' && (
                            <div className="table-wrapper">
                                <table className="excel-table">
                                    <thead>
                                        <tr>
                                            <th>S.NO</th>
                                            <th>CALDIM CDRFI #</th>
                                            <th>CLIENT CDRFI #</th>
                                            <th>STATUS</th>
                                            <th>PRIORITY</th>
                                            <th>SENT DATE</th>
                                            <th>SEQ/AREA</th>
                                            <th>CDRFI TYPE</th>
                                            <th>DESCRIPTION</th>
                                            <th>RECVD DATE</th>
                                            <th>REMARKS</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {cdrfiData.map((row, idx) => (
                                            <tr key={idx}>
                                                <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={idx + 1} disabled /></td>
                                                <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.caldimCdrfiNo} onChange={e => { const nd = [...cdrfiData]; nd[idx].caldimCdrfiNo = e.target.value; setCdrfiData(nd); }} disabled={!editMode} /></td>
                                                <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.clientCdrfiNo} onChange={e => { const nd = [...cdrfiData]; nd[idx].clientCdrfiNo = e.target.value; setCdrfiData(nd); }} disabled={!editMode} /></td>
                                                <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.status} onChange={e => { const nd = [...cdrfiData]; nd[idx].status = e.target.value; setCdrfiData(nd); }} disabled={!editMode} /></td>
                                                <td><input type="text" className="form-control" style={{ padding: 4, width: '100%' }} value={row.priority} onChange={e => { const nd = [...cdrfiData]; nd[idx].priority = e.target.value; setCdrfiData(nd); }} disabled={!editMode} /></td>
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
                                {editMode && <div style={{ margin: 16 }}><button className="btn btn-primary btn-sm" onClick={() => setCdrfiData([...cdrfiData, { isCustomRow: true, caldimCdrfiNo: '', clientCdrfiNo: '', status: '', priority: '', sentDate: '', seqArea: '', cdrfiType: '', description: '', receivedDate: '', remarks: '' }])}>+ Add Custom CDRFI</button></div>}
                            </div>
                        )}

                        {activeTab === 'REF' && (
                            <div className="card" style={{ padding: 24, maxWidth: 400 }}>
                                <h3 style={{ fontSize: 16, marginBottom: 16, color: 'var(--color-primary)' }}>Reference Data Overview</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--color-border)' }}>
                                        <span style={{ color: 'var(--color-text-muted)' }}>Open RFIs</span>
                                        <strong>{autoFetchData.rfis.filter((r: any) => r.status !== 'CLOSED').length}</strong>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--color-border)' }}>
                                        <span style={{ color: 'var(--color-text-muted)' }}>Closed RFIs</span>
                                        <strong>{autoFetchData.rfis.filter((r: any) => r.status === 'CLOSED').length}</strong>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--color-border)' }}>
                                        <span style={{ color: 'var(--color-text-muted)' }}>Total Transmittals (Auto)</span>
                                        <strong>{autoFetchData.transmittals.length}</strong>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
        </div>
    );
}
