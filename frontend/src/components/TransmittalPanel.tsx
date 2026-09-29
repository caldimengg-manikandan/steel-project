import { useState, useEffect, useCallback } from 'react';
import {
    listTransmittals,
    generateTransmittal,
    previewTransmittal,
    getTransmittalExcelUrl,
    getDrawingLogExcelUrl,
    voidTransmittal
} from '../services/transmittalApi';
import { useMessage } from '../context/MessageContext';
import { formatDate } from '../utils/dateUtils';
import { IconDownload } from './Icons';

export default function TransmittalPanel({ projectId, canEdit, sequences }: { projectId: string; canEdit: boolean; sequences?: any[] }) {
    const { showMessage, showConfirm } = useMessage();
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

    useEffect(() => {
        const pendingT = transmittals.find(t => t.isPending);
        if (pendingT && canEdit && !generating) {
            handleGenerate(pendingT.transmittalNumber);
        }
    }, [transmittals, canEdit, generating]);

    const handleGenerate = async (targetTransmittalNumber?: number) => {
        try {
            setGenerating(true);
            setError('');
            
            // If specific target transmittal number is clicked, proceed directly to generation
            if (targetTransmittalNumber != null) {
                const data = await generateTransmittal(projectId, undefined, targetTransmittalNumber);
                if (data.transmittal) {
                    showMessage('Success', data.message || 'Transmittal generated successfully.', 'success');
                    await fetchTransmittals();
                } else {
                    showMessage('Notice', data.message || 'No drawings found to transmit.', 'info');
                }
                return;
            }

            const preview = await previewTransmittal(projectId, undefined, targetTransmittalNumber);

            if (preview.newCount === 0 && preview.revisedCount === 0) {
                showMessage('No Drawings to Transmit', 'No new or revised completed extractions ready for a transmittal.', 'info');
                return;
            }

            showConfirm('Generate Transmittal', `This will generate a new transmittal with ${preview.newCount} new and ${preview.revisedCount} revised drawings. Continue?`, async () => {
                try {
                    setGenerating(true);
                    const data = await generateTransmittal(projectId, undefined, targetTransmittalNumber);
                    if (data.transmittal) {
                        showMessage('Success', data.message || 'Transmittal generated successfully.', 'success');
                        await fetchTransmittals();
                    } else {
                        showMessage('Notice', data.message || 'No new drawings to transmit.', 'info');
                    }
                } catch (err: any) {
                    setError(err.message || 'Failed to generate transmittal');
                } finally {
                    setGenerating(false);
                }
            });
            return;
        } catch (err: any) {
            setError(err.message || 'Failed to generate transmittal');
        } finally {
            setGenerating(false);
        }
    };



    const handleVoid = async (transmittalId: string, transmittalNumber: number) => {
        showConfirm('Void Transmittal', `Are you sure you want to void TR-${String(transmittalNumber).padStart(3, '0')}? This will remove its drawings from the drawing log.`, async () => {
            try {
                setGenerating(true);
                await voidTransmittal(projectId, transmittalId);
                showMessage('Success', 'Transmittal voided successfully.', 'success');
                fetchTransmittals();
            } catch (err: any) {
                setError(err.message || 'Failed to void transmittal');
            } finally {
                setGenerating(false);
            }
        });
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
                                <th>Log Updated</th>
                                <th>Drawings</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(selectedFilters.length > 0 ? transmittals.filter(t => t.sequences?.some((seq: string) => selectedFilters.includes(seq))) : transmittals)
                                .filter(t => !t.isVoided)
                                .map(t => {
                                const drawingCount = t.drawings ? t.drawings.length : ((t.newCount || 0) + (t.revisedCount || 0) + (t.unchangedCount || 0));
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
                                            <td className="text-muted">{formatDate(t.createdAt)}</td>
                                            <td className="text-muted">{formatDate(t.updatedAt || t.createdAt)}</td>
                                            <td>
                                                <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                    • {drawingCount}
                                                </span>
                                            </td>
                                            <td>
                                                {canEdit ? (
                                                    <span style={{ fontSize: 12, color: '#2563eb', fontWeight: 600 }}>Auto-Generating...</span>
                                                ) : (
                                                    <span style={{ fontSize: 11, color: '#64748b' }}>Awaiting Generation</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                }
                                return (
                                    <tr key={t._id} style={{ opacity: t.isVoided ? 0.5 : 1, textDecoration: t.isVoided ? 'line-through' : 'none', background: t.isVoided ? '#f8fafc' : 'transparent' }}>
                                        <td style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                            TR-{String(t.transmittalNumber).padStart(3, '0')}
                                            {t.isVoided && <span style={{ marginLeft: 8, fontSize: 10, background: '#fee2e2', color: '#b91c1c', padding: '2px 5px', borderRadius: 4, fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>VOIDED</span>}
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
                                        <td className={t.isVoided ? "" : "text-muted"}>{formatDate(t.createdAt)}</td>
                                        <td className={t.isVoided ? "" : "text-muted"}>{formatDate(t.updatedAt || t.createdAt)}</td>
                                        <td>
                                            <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, filter: t.isVoided ? 'grayscale(100%)' : 'none' }}>
                                                • {drawingCount}
                                            </span>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', textDecoration: 'none' }}>
                                                {!t.isVoided && (
                                                    <>
                                                        <a href={getTransmittalExcelUrl(projectId, t._id)} download className="btn btn-primary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                                                            <IconDownload width={14} height={14} /> Transmittal
                                                        </a>
                                                        <a href={getDrawingLogExcelUrl(projectId, t.transmittalNumber)} download className="btn btn-primary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                                                            <IconDownload width={14} height={14} /> Log
                                                        </a>
                                                        {canEdit && (
                                                            <button 
                                                                className="btn btn-sm" 
                                                                style={{ backgroundColor: '#ef4444', color: '#ffffff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, padding: '6px 12px', borderRadius: '6px', cursor: 'pointer' }}
                                                                onClick={() => handleVoid(t._id, t.transmittalNumber)}
                                                                disabled={generating}
                                                            >
                                                                Void
                                                            </button>
                                                        )}
                                                    </>
                                                )}
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
