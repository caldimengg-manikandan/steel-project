import { useState, useEffect, useCallback } from 'react';
import {
    listTransmittals,
    generateTransmittal,
    previewTransmittal,
    getTransmittalExcelUrl,
    getDrawingLogExcelUrl
} from '../services/transmittalApi';

export default function TransmittalPanel({ projectId, canEdit, sequences }: { projectId: string; canEdit: boolean; sequences?: any[] }) {
    const [transmittals, setTransmittals] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState('');
    const [selectedFilters, setSelectedFilters] = useState<string[]>([]);

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



    return (
        <div className="card" style={{ padding: 'var(--space-lg)' }}>
            <div className="panel-status-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                    <h3 style={{ fontWeight: 800, fontSize: 17, margin: 0, color: 'var(--color-text-primary)' }}>Transmittal Generator</h3>
                    <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '3px 0 0' }}>Generate transmittals from completed extractions.</p>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                    {sequences && sequences.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginRight: 8, flexWrap: 'wrap', background: 'var(--color-background)', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--color-border-light)' }}>
                            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Filter:</span>
                            
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                                <input
                                    type="checkbox"
                                    checked={selectedFilters.length === 0}
                                    onChange={() => setSelectedFilters([])}
                                    style={{ cursor: 'pointer' }}
                                />
                                All Sequences
                            </label>

                            {sequences.map((s: any, idx: number) => (
                                <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                                    <input
                                        type="checkbox"
                                        checked={selectedFilters.includes(s.name)}
                                        onChange={(e) => {
                                            if (e.target.checked) setSelectedFilters(prev => [...prev, s.name]);
                                            else setSelectedFilters(prev => prev.filter(name => name !== s.name));
                                        }}
                                        style={{ cursor: 'pointer' }}
                                    />
                                    {s.name}
                                </label>
                            ))}
                        </div>
                    )}
                    <a href={getDrawingLogExcelUrl(projectId)} download className="btn btn-secondary btn-sm" style={{ padding: '7px 14px', background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac', flexShrink: 0 }}>
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
                                <th>Sequences</th>
                                <th>Date</th>
                                <th>New Drawings</th>
                                <th>Revised Drawings</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(selectedFilters.length > 0 ? transmittals.filter(t => t.sequences?.some((seq: string) => selectedFilters.includes(seq))) : transmittals).map(t => {
                                if (t.isPending) {
                                    return (
                                        <tr key={t._id} style={{ fontStyle: 'normal' }}>
                                            <td style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                                TR-{String(t.transmittalNumber).padStart(3, '0')}
                                                <span style={{ marginLeft: 8, fontSize: 10, background: '#fef3c7', color: '#d97706', padding: '2px 5px', borderRadius: 4, fontWeight: 700 }}>DRAFT</span>
                                            </td>
                                            <td>
                                                {t.sequences && t.sequences.length > 0 ? (
                                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                        {t.sequences.map((seq: string, idx: number) => (
                                                            <span key={idx} style={{ padding: '2px 6px', background: '#f1f5f9', borderRadius: 4, fontSize: 11, fontWeight: 600, color: '#475569', border: '1px solid #e2e8f0' }}>
                                                                {seq}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span style={{ fontSize: 12, color: '#94a3b8' }}>None</span>
                                                )}
                                            </td>
                                            <td className="text-muted">{new Date(t.createdAt).toLocaleDateString()}</td>
                                            <td><span className="badge badge-success">{t.newCount}</span></td>
                                            <td><span className="badge badge-warning">{t.revisedCount}</span></td>
                                            <td>
                                                {canEdit ? (
                                                    <button className="btn btn-primary btn-sm" onClick={handleGenerate} disabled={generating}>
                                                        {generating ? 'Processing...' : '⚡ Generate Excel'}
                                                    </button>
                                                ) : (
                                                    <span style={{ fontSize: 11, color: '#64748b' }}>Awaiting Generation</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                }
                                return (
                                <tr key={t._id}>
                                    <td style={{ fontWeight: 600 }}>
                                        <a href={getTransmittalExcelUrl(projectId, t._id)} download style={{ color: '#2563eb', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} title="Click to download Excel">
                                            TR-{String(t.transmittalNumber).padStart(3, '0')}
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                        </a>
                                    </td>
                                    <td>
                                        {t.sequences && t.sequences.length > 0 ? (
                                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                {t.sequences.map((seq: string, idx: number) => (
                                                    <span key={idx} style={{ padding: '2px 6px', background: '#f1f5f9', borderRadius: 4, fontSize: 11, fontWeight: 600, color: '#475569', border: '1px solid #e2e8f0' }}>
                                                        {seq}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : (
                                            <span style={{ fontSize: 12, color: '#94a3b8' }}>None</span>
                                        )}
                                    </td>
                                    <td className="text-muted">{new Date(t.createdAt).toLocaleDateString()}</td>
                                    <td><span className="badge badge-success">{t.newCount}</span></td>
                                    <td><span className="badge badge-warning">{t.revisedCount}</span></td>
                                    <td>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <a href={getTransmittalExcelUrl(projectId, t._id)} download className="btn btn-ghost btn-sm">
                                                📥 Download
                                            </a>
                                        </div>
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
