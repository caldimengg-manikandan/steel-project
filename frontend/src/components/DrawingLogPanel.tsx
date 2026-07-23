import { useState, useEffect } from 'react';
import { fetchDrawingLog } from '../services/drawingLogApi';

interface DrawingLogPanelProps {
    projectId: string;
    projectName: string;
}

export default function DrawingLogPanel({ projectId, projectName }: DrawingLogPanelProps) {
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

    // Determine all revision marks across all drawings for dynamic columns
    const allRevsSet = new Set<string>();
    logData.drawings.forEach((d: any) => {
        (d.revisionHistory || []).forEach((rh: any) => {
            if (rh.revision) allRevsSet.add(String(rh.revision).toUpperCase().trim());
        });
        if (d.currentRevision) allRevsSet.add(String(d.currentRevision).toUpperCase().trim());
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
                                        revMap[rh.revision.toUpperCase()] = rh.date || rh.transmittalNo || '✓';
                                    }
                                });
                            }
                            if (d.currentRevision && !revMap[d.currentRevision.toUpperCase()]) {
                                revMap[d.currentRevision.toUpperCase()] = d.lastUpdated ? new Date(d.lastUpdated).toLocaleDateString() : '✓';
                            }

                            return (
                                <tr key={d._id || index}>
                                    <td>{index + 1}</td>
                                    <td><strong>{d.drawingNumber}</strong></td>
                                    <td>{d.drawingTitle || d.description}</td>
                                    {revHeaders.map(r => (
                                        <td key={`cell-${r}`} style={{ textAlign: 'center' }}>
                                            {revMap[r] || '-'}
                                        </td>
                                    ))}
                                    <td>
                                        {d.revisionHistory && d.revisionHistory.length > 0 
                                            ? d.revisionHistory[d.revisionHistory.length - 1].remarks 
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
