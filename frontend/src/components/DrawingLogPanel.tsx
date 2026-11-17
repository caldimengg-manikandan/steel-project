import { useState, useEffect } from 'react';
import { fetchDrawingLog } from '../services/drawingLogApi';

interface DrawingLogPanelProps {
    projectId: string;
}

function cleanRemarks(text?: any) {
    if (!text) return '';
    let s = String(text).trim();
    s = s.replace(/^(?:[xX*\-.\s]+|[vV]\s+)(?=[A-Z0-9])/, '').trim();
    let changed = true;
    while (changed) {
        const orig = s;
        // 1. Field labels like 'DETAILED BY :', 'CHECKED BY :', 'BY :'
        s = s.replace(/^(?:[A-Za-z\s'’]{1,20}\bBY\s*[:\-])\s*/i, '').trim();
        // 2. Standard column headers
        s = s.replace(/^(?:DATE|CHKD|DWN|REV(?:ISION)?(?:\s*#|\s*\d+)?|MARK|NO|SHEET|TITLE)\s*[:\-]\s*(?:[A-Za-z0-9]{1,4}\b(?!\s*[-/.]|\s*[A-Z]{3,})\s*)?/i, '').trim();
        // 3. Standalone initials or mark with colon or dash: 'RBS :', '0 :', 'E :'
        s = s.replace(/^[A-Za-z0-9]{1,4}\s*[:\-]\s*/, '').trim();
        // 4. Initials followed immediately by a date: 'RBS 05-11' -> '05-11'
        s = s.replace(/^[A-Za-z0-9]{1,4}\s+(?=\d{1,2}\s*[-/.]\d{1,2})/, '').trim();
        // 5. Date at start (MM-DD, MM/DD/YYYY, etc.)
        s = s.replace(/^\d{1,2}\s*[-/.]\s*\d{1,2}(?:\s*[-/.]\s*(?:20\d{2}|19\d{2}|\d{2}))?\s*/, '').trim();
        // 6. Initials or mark followed by standard remark keywords: 'RBS ISSUED' -> 'ISSUED'
        s = s.replace(/^[A-Za-z0-9]{1,4}\s+(?=(?:ISSUED|REVISED|FOR|APPROVED?|PRELIMINARY|SUBMITTED|BID|CONSTRUCTION|RELEASED|CHECKED|RECORD|AS[\s\-]BUILT)\b)/i, '').trim();
        // 7. Initials that follow a date or colon (e.g. 'Y : ' or 'E : ')
        s = s.replace(/^[A-Za-z0-9]{1,4}\s*[:\-]\s*/, '').trim();
        // 8. Leading punctuation
        s = s.replace(/^[:.\-/\s]+/, '').trim();
        changed = (s !== orig);
    }
    s = s.replace(/\s+\b(?:(?:DRAWN|CHECKED|DETAILED|APP'?D?|CHKD|DWN)\s+BY|DRAWN|CHKD|DWN|DATE|REV\s*#)\b\s*[:\-]?(?:\s+[A-Za-z0-9]{1,4})?\s*$/i, '').trim();
    s = s.replace(/[:.\-/\s]+$/, '').trim();
    s = s.replace(/\s+/, ' ').trim();
    return s;
}

export default function DrawingLogPanel({ projectId }: DrawingLogPanelProps) {
    const [logData, setLogData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        loadData();
    }, [projectId]);

    const loadData = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetchDrawingLog(projectId);
            setLogData(res.drawingLog);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch drawing log');
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading drawing log...</div>;

    if (error) {
        return (
            <div style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ color: 'var(--color-danger)', marginBottom: 16 }}>{error}</div>
                <button className="btn btn-secondary" onClick={loadData}>Retry</button>
            </div>
        );
    }

    if (!logData || !logData.drawings || logData.drawings.length === 0) {
        return (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                No drawings found in the log for this project.
            </div>
        );
    }

    const normalizeRev = (r: string) => {
        let s = (r || '').replace(/^rev[\s\-_]*/i, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().trim();
        if (!s || s.length > 3) return '';
        return s;
    };

    // Determine all revision marks across all drawings for dynamic columns
    const allRevsSet = new Set<string>();
    logData.drawings.forEach((d: any) => {
        (d.revisionHistory || []).forEach((rh: any) => {
            if (rh.revision) {
                const norm = normalizeRev(rh.revision);
                if (norm) allRevsSet.add(norm);
            }
        });
        if (d.currentRevision) {
            const norm = normalizeRev(d.currentRevision);
            if (norm) allRevsSet.add(norm);
        }
    });
    
    const allRevsArr = Array.from(allRevsSet);
    const alphaRevs = allRevsArr.filter(r => /^[A-Za-z]/.test(r));
    const numRevs = allRevsArr.filter(r => !/^[A-Za-z]/.test(r));
    
    alphaRevs.sort();
    
    numRevs.sort((a, b) => {
        const numA = parseInt(a, 10);
        const numB = parseInt(b, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.localeCompare(b);
    });

    const revHeaders = [...alphaRevs, ...numRevs];

    return (
        <div className="drawing-log-panel">
            <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%' }}>
                    <thead>
                        <tr>
                            <th style={{ width: 60 }}>Sl No</th>
                            <th>Sheet No.</th>
                            <th>Drawing Title</th>
                            {revHeaders.map(r => (
                                <th key={`rev-${r}`} style={{ textAlign: 'center', width: 80 }}>Rev {r}</th>
                            ))}
                            <th>Remarks</th>
                        </tr>
                    </thead>
                    <tbody>
                        {logData.drawings.map((d: any, index: number) => {
                            // Find the dates/transmittals for each revision
                            const revMap: Record<string, string> = {};
                            if (d.revisionHistory) {
                                d.revisionHistory.forEach((rh: any) => {
                                    if (rh.revision) {
                                        const norm = normalizeRev(rh.revision);
                                        const val = rh.date || (rh.transmittalNo ? `TR-${String(rh.transmittalNo).padStart(3, '0')}` : '✓');
                                        revMap[norm] = val;
                                    }
                                });
                            }
                            if (d.currentRevision) {
                                const norm = normalizeRev(d.currentRevision);
                                if (!revMap[norm]) {
                                    revMap[norm] = d.lastUpdated ? new Date(d.lastUpdated).toLocaleDateString() : '✓';
                                }
                            }

                            // Determine if drawing was sent for fabrication but not for approval
                            let hasApproval = false;
                            let hasFabrication = false;
                            if (d.revisionHistory) {
                                d.revisionHistory.forEach((rh: any) => {
                                    if (rh.revision) {
                                        const norm = normalizeRev(rh.revision);
                                        if (/^[A-Za-z]/.test(norm)) hasApproval = true;
                                        else hasFabrication = true;
                                    }
                                });
                            }
                            if (d.currentRevision) {
                                const norm = normalizeRev(d.currentRevision);
                                if (/^[A-Za-z]/.test(norm)) hasApproval = true;
                                else hasFabrication = true;
                            }

                            const isOnlyFabrication = hasFabrication && !hasApproval;

                            return (
                                <tr key={d._id || index}>
                                    <td>{index + 1}</td>
                                    <td><strong>{d.drawingNumber}</strong></td>
                                    <td>{d.drawingTitle || d.description}</td>
                                    {revHeaders.map(r => {
                                        const isApprovalCol = /^[A-Za-z]/.test(r);
                                        const bg = (isOnlyFabrication && isApprovalCol) ? '#f1f5f9' : 'transparent';
                                        return (
                                            <td key={`cell-${r}`} style={{ textAlign: 'center', backgroundColor: bg }}>
                                                {revMap[r] || '-'}
                                            </td>
                                        );
                                    })}
                                    <td>
                                        {d.revisionHistory && d.revisionHistory.length > 0 
                                            ? cleanRemarks(d.revisionHistory[d.revisionHistory.length - 1].remarks) 
                                            : ''}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
