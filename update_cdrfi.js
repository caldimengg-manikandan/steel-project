const fs = require('fs');
let content = fs.readFileSync('frontend/src/components/WeeklyProgressPanel.tsx', 'utf8');

// 1. Add useState
content = content.replace(
    'const [transmittalData, setTransmittalData] = useState<any[]>([]);',
    'const [transmittalData, setTransmittalData] = useState<any[]>([]);\n    const [cdrfiData, setCdrfiData] = useState<any[]>([]);'
);

// 2. handleCreateNew
content = content.replace(
    'setTransmittalData([]);',
    'setTransmittalData([]);\n        setCdrfiData([]);'
);

// 3. fetchLiveAutoData (saved case)
const searchStr1 = 'let savedTransmittals = res.report.transmittalData || [];';
const replaceStr1 = `let savedTransmittals = res.report.transmittalData || [];
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
                setCdrfiData(savedCdrfis);`;
content = content.replace(searchStr1, replaceStr1);

// 4. fetchLiveAutoData (new case)
const searchStr2 = 'setTransmittalData(initialTransmittals);';
const replaceStr2 = `setTransmittalData(initialTransmittals);
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
                setCdrfiData(initialCdrfis);`;
content = content.replace(searchStr2, replaceStr2);

// 5. save payload
content = content.replace(
    `transmittalData,
                status: 'Draft'`,
    `transmittalData,
                cdrfiData,
                status: 'Draft'`
);

// 6. render block
const searchStr3 = `{activeTab === 'CDRFI LOG' && (
                            <div className="table-wrapper">
                                {autoFetchData.cdrfis.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-muted)' }}>
                                        No CDRFIs found for this project.
                                    </div>
                                ) : (
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>CDRFI #</th>
                                                <th>Status</th>
                                                <th>Description</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {autoFetchData.cdrfis.map((r: any, idx: number) => (
                                                <tr key={idx}>
                                                    <td>{r.id}</td>
                                                    <td>{r.status}</td>
                                                    <td>{r.description}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        )}`;

const replaceStr3 = `{activeTab === 'CDRFI LOG' && (
                            <div className="table-wrapper">
                                <table>
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
                                {editMode && <div style={{ marginTop: 12 }}><button className="btn btn-secondary btn-sm" onClick={() => setCdrfiData([...cdrfiData, { isCustomRow: true, caldimCdrfiNo: '', clientCdrfiNo: '', status: '', priority: '', sentDate: '', seqArea: '', cdrfiType: '', description: '', receivedDate: '', remarks: '' }])}>+ Add Custom CDRFI</button></div>}
                            </div>
                        )}`;
content = content.replace(searchStr3, replaceStr3);

fs.writeFileSync('frontend/src/components/WeeklyProgressPanel.tsx', content);
