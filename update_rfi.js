const fs = require('fs');
let content = fs.readFileSync('frontend/src/components/WeeklyProgressPanel.tsx', 'utf8');

// 1. Add useState
content = content.replace(
    'const [cdrfiData, setCdrfiData] = useState<any[]>([]);',
    'const [cdrfiData, setCdrfiData] = useState<any[]>([]);\n    const [rfiData, setRfiData] = useState<any[]>([]);'
);

// 2. handleCreateNew
content = content.replace(
    'setCdrfiData([]);',
    'setCdrfiData([]);\n        setRfiData([]);'
);

// 3. fetchLiveAutoData (saved case)
const searchStr1 = 'let savedCdrfis = res.report.cdrfiData || [];';
const replaceStr1 = `let savedCdrfis = res.report.cdrfiData || [];
                let savedRfis = res.report.rfiData || [];
                if (savedRfis.length === 0 && res.autoFetch && res.autoFetch.rfis && res.autoFetch.rfis.length > 0) {
                    savedRfis = res.autoFetch.rfis.map((r: any) => ({
                        isCustomRow: false,
                        rfiNumber: r.rfiNumber,
                        clientRfiNumber: r.clientRfiNumber || '',
                        status: r.status,
                        priority: r.priority || '',
                        sentDate: r.sentDate ? new Date(r.sentDate).toLocaleDateString() : '',
                        seqArea: r.seqArea || '',
                        rfiType: r.rfiType || '',
                        description: r.description,
                        receivedDate: r.receivedDate || '',
                        remarks: r.remarks || ''
                    }));
                }
                setRfiData(savedRfis);`;
content = content.replace(searchStr1, replaceStr1);

// 4. fetchLiveAutoData (new case)
const searchStr2 = 'const initialCdrfis = res.autoFetch.cdrfis.map((c: any) => ({';
const replaceStr2 = `const initialRfis = res.autoFetch.rfis.map((r: any) => ({
                    isCustomRow: false,
                    rfiNumber: r.rfiNumber,
                    clientRfiNumber: r.clientRfiNumber || '',
                    status: r.status,
                    priority: r.priority || '',
                    sentDate: r.sentDate ? new Date(r.sentDate).toLocaleDateString() : '',
                    seqArea: r.seqArea || '',
                    rfiType: r.rfiType || '',
                    description: r.description,
                    receivedDate: r.receivedDate || '',
                    remarks: r.remarks || ''
                }));
                setRfiData(initialRfis);
                
                const initialCdrfis = res.autoFetch.cdrfis.map((c: any) => ({`;
content = content.replace(searchStr2, replaceStr2);

// 5. save payload
content = content.replace(
    `cdrfiData,
                status: 'Draft'`,
    `cdrfiData,
                rfiData,
                status: 'Draft'`
);

// 6. render block
const searchStr3 = `{activeTab === 'RFI LOG' && (
                            <div className="table-wrapper">
                                {autoFetchData.rfis.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-muted)' }}>
                                        No RFIs found for this project.
                                    </div>
                                ) : (
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>RFI #</th>
                                                <th>CLIENT #</th>
                                                <th>STATUS</th>
                                                <th>PRIORITY</th>
                                                <th>DESCRIPTION</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {autoFetchData.rfis.map((r: any, idx: number) => (
                                                <tr key={idx}>
                                                    <td>{r.rfiNumber}</td>
                                                    <td>{r.clientRfiNumber}</td>
                                                    <td>{r.status}</td>
                                                    <td>{r.priority}</td>
                                                    <td>{r.description}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        )}`;

const replaceStr3 = `{activeTab === 'RFI LOG' && (
                            <div className="table-wrapper">
                                <table>
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
                                {editMode && <div style={{ marginTop: 12 }}><button className="btn btn-secondary btn-sm" onClick={() => setRfiData([...rfiData, { isCustomRow: true, rfiNumber: '', clientRfiNumber: '', status: '', priority: '', sentDate: '', seqArea: '', rfiType: '', description: '', receivedDate: '', remarks: '' }])}>+ Add Custom RFI</button></div>}
                            </div>
                        )}`;
content = content.replace(searchStr3, replaceStr3);

fs.writeFileSync('frontend/src/components/WeeklyProgressPanel.tsx', content);
