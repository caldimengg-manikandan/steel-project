import { useState, useEffect, useCallback } from 'react';
import {
    listTransmittals,
    generateTransmittal,
    previewTransmittal,
    getTransmittalExcelUrl,
    getDrawingLogExcelUrl
} from '../services/transmittalApi';

export default function TransmittalPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
    const [transmittals, setTransmittals] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState('');

    const fetchTransmittals = useCallback(async () => {
        try {
            setLoading(true);
            const data = await listTransmittals(projectId);
            setTransmittals(data.transmittals || []);
        } catch (err: any) {
            setError(err.message || 'Failed to load transmittals');
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        fetchTransmittals();
    }, [fetchTransmittals]);

    const handleGenerate = async () => {
        try {
            setGenerating(true);
            setError('');
            const preview = await previewTransmittal(projectId);

            if (preview.newCount === 0 && preview.revisedCount === 0) {
                alert('No new or revised completed extractions ready for a transmittal.');
                return;
            }

            if (!confirm(`This will generate a new transmittal with ${preview.newCount} new and ${preview.revisedCount} revised drawings. Continue?`)) {
                return;
            }

            const data = await generateTransmittal(projectId);
            if (data.transmittal) {
                alert(data.message);
                fetchTransmittals();
            } else {
                alert(data.message || 'No new drawings to transmit.');
            }
        } catch (err: any) {
            setError(err.message || 'Failed to generate transmittal');
        } finally {
            setGenerating(false);
        }
    };

    const handleDeleteTransmittal = async (transmittalId: string, transmittalNo: number) => {
        if (!confirm(`Are you sure you want to delete Transmittal TR-${String(transmittalNo).padStart(3, '0')}? This action cannot be undone.`)) {
            return;
        }

        try {
            const { deleteTransmittal } = await import('../services/transmittalApi');
            const res = await deleteTransmittal(projectId, transmittalId);
            alert(res.message);
            fetchTransmittals();
        } catch (err: any) {
            alert(`Failed to delete: ${err.message}`);
        }
    };

    return (
        <div className="card" style={{ padding: 'var(--space-lg)' }}>
            <div className="panel-status-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                    <h3 style={{ fontWeight: 800, fontSize: 17, margin: 0, color: 'var(--color-text-primary)' }}>Transmittal Generator</h3>
                    <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '3px 0 0' }}>Generate transmittals from completed extractions.</p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <a href={getDrawingLogExcelUrl(projectId)} download className="btn btn-secondary btn-sm" style={{ padding: '7px 14px', background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac' }}>
                        📥 Master Drawing Log
                    </a>
                    {canEdit && (
                        <button className="btn btn-primary btn-sm" onClick={handleGenerate} disabled={generating}>
                            {generating ? 'Generating...' : '➕ Generate New Transmittal'}
                        </button>
                    )}
                </div>
            </div>

            {error && <div className="info-box danger mb-md">{error}</div>}

            {loading ? (
                <div className="text-center py-md"><div className="spinner"></div></div>
            ) : transmittals.length === 0 ? (
                <div className="table-empty">No transmittals have been generated yet. Upload and extract PDFs, then click Generate.</div>
            ) : (
                <div className="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Transmittal No</th>
                                <th>Date</th>
                                <th>New Drawings</th>
                                <th>Revised Drawings</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {transmittals.map(t => (
                                <tr key={t._id}>
                                    <td style={{ fontWeight: 600 }}>TR-{String(t.transmittalNumber).padStart(3, '0')}</td>
                                    <td className="text-muted">{new Date(t.createdAt).toLocaleDateString()}</td>
                                    <td><span className="badge badge-success">{t.newCount}</span></td>
                                    <td><span className="badge badge-warning">{t.revisedCount}</span></td>
                                    <td>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <a href={getTransmittalExcelUrl(projectId, t._id)} download className="btn btn-ghost btn-sm">
                                                📥 Download
                                            </a>
                                            {canEdit && (
                                                <button 
                                                    className="btn btn-ghost btn-sm" 
                                                    style={{ color: '#dc2626' }}
                                                    onClick={() => handleDeleteTransmittal(t._id, t.transmittalNumber)}
                                                >
                                                    🗑️
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
