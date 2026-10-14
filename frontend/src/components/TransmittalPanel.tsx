import { useState, useEffect, useCallback, Fragment } from 'react';
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
import { IconDownload, IconEye } from './Icons';

function normalizeFolderHeader(fName?: string) {
    if (!fName) return 'DETAIL SHEET';
    const s = String(fName).trim().replace(/_/g, ' ').toUpperCase();
    if (s.includes('DETAIL') || s.startsWith('D SHEET') || s.startsWith('D-SHEET')) return 'DETAIL SHEET';
    if (s.includes('ERECTION') || s.startsWith('E SHEET') || s.startsWith('E-SHEET')) return 'ERECTION SHEET';
    if (s.includes('ANCHOR')) return 'ANCHOR BOLT';
    return s;
}

export default function TransmittalPanel({ projectId, canEdit, sequences }: { projectId: string; canEdit: boolean; sequences?: any[] }) {
    const { showMessage, showConfirm } = useMessage();
    const [transmittals, setTransmittals] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState('');
    const [selectedFilters, setSelectedFilters] = useState<string[]>([]);
    const [expandedTransmittalId, setExpandedTransmittalId] = useState<string | null>(null);

    const fetchTransmittals = useCallback(async (background = false) => {
        try {
            if (!background) setLoading(true);
            const data = await listTransmittals(projectId);
            setTransmittals(data.transmittals || []);
        } catch (err: any) {
            setError(err.message || 'Failed to load transmittals');
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        fetchTransmittals(false);
    }, [fetchTransmittals]);

    useEffect(() => {
        // Auto-fetch every 10 seconds to update extraction progress
        const interval = setInterval(() => {
            if (!generating) fetchTransmittals(true);
        }, 10000);
        return () => clearInterval(interval);
    }, [fetchTransmittals, generating]);

    useEffect(() => {
        // Auto-generate ONLY when all extractions are completed
        const pendingT = transmittals.find(t => t.isPending && t.isReadyToGenerate);
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
                                                {canEdit && t.isReadyToGenerate ? (
                                                    <span style={{ fontSize: 12, color: '#2563eb', fontWeight: 600 }}>Auto-Generating...</span>
                                                ) : (
                                                    <span style={{ fontSize: 11, color: '#64748b' }}>
                                                        {t.totalCount ? `Extracting (${t.newCount}/${t.totalCount})...` : 'Awaiting Generation'}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                }
                                return (
                                    <Fragment key={t._id}>
                                        <tr style={{ opacity: t.isVoided ? 0.5 : 1, textDecoration: t.isVoided ? 'line-through' : 'none', background: t.isVoided ? '#f8fafc' : 'transparent' }}>
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
                                                            <button
                                                                type="button"
                                                                onClick={() => setExpandedTransmittalId(prev => prev === t._id ? null : t._id)}
                                                                className={`btn btn-sm ${expandedTransmittalId === t._id ? 'btn-primary' : 'btn-secondary'}`}
                                                                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                                                                title={expandedTransmittalId === t._id ? "Close Preview" : "Preview Transmittal"}
                                                            >
                                                                <IconEye width={14} height={14} /> {expandedTransmittalId === t._id ? 'Close' : 'Preview'}
                                                            </button>
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

                                        {/* Inline Excel-style Preview Row */}
                                        {expandedTransmittalId === t._id && !t.isVoided && (() => {
                                            const groupedDrawings: { [category: string]: any[] } = {};
                                            (t.drawings || []).forEach((d: any) => {
                                                const cat = normalizeFolderHeader(d.folderName);
                                                if (!groupedDrawings[cat]) groupedDrawings[cat] = [];
                                                groupedDrawings[cat].push(d);
                                            });
                                            const categories = Object.keys(groupedDrawings).sort((a, b) => a.localeCompare(b));
                                            let currentSlNo = 1;

                                            return (
                                                <tr key={`${t._id}-preview`} style={{ background: '#f8fafc' }}>
                                                    <td colSpan={6} style={{ padding: '12px 16px 20px', borderBottom: '2px solid #cbd5e1' }}>
                                                        <div style={{
                                                            background: '#ffffff',
                                                            border: '1px solid #cbd5e1',
                                                            borderRadius: '8px',
                                                            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.06)',
                                                            overflow: 'hidden'
                                                        }}>
                                                            {/* Excel Transmittal Header Banner */}
                                                            <div style={{
                                                                display: 'flex',
                                                                justifyContent: 'space-between',
                                                                alignItems: 'center',
                                                                padding: '10px 16px',
                                                                background: '#f1f5f9',
                                                                borderBottom: '1px solid #e2e8f0',
                                                                flexWrap: 'wrap',
                                                                gap: 8
                                                            }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                                                                    <span style={{ fontWeight: 800, fontSize: 13, color: '#16a34a', letterSpacing: '0.3px' }}>
                                                                        TRANSMITTAL NO: TR-{String(t.transmittalNumber).padStart(3, '0')}
                                                                    </span>
                                                                    <span style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>
                                                                        DATE: {formatDate(t.createdAt)}
                                                                    </span>
                                                                    {t.sequences && t.sequences.length > 0 && (
                                                                        <span style={{ fontSize: 11, color: '#64748b' }}>
                                                                            Sequences: {t.sequences.join(', ')}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                                    <span style={{
                                                                        fontSize: 11,
                                                                        fontWeight: 700,
                                                                        padding: '3px 8px',
                                                                        background: '#e0f2fe',
                                                                        color: '#0369a1',
                                                                        borderRadius: 4,
                                                                        border: '1px solid #bae6fd'
                                                                    }}>
                                                                        Excel Sheet Preview • {drawingCount} Drawing{drawingCount === 1 ? '' : 's'}
                                                                    </span>
                                                                </div>
                                                            </div>

                                                            {/* Excel Table */}
                                                            <div style={{ overflowX: 'auto' }}>
                                                                <table style={{
                                                                    width: '100%',
                                                                    borderCollapse: 'collapse',
                                                                    fontSize: 12,
                                                                    fontFamily: "'Segoe UI', Aptos, Calibri, sans-serif"
                                                                }}>
                                                                    <thead>
                                                                        <tr style={{ background: '#d9e1f2', color: '#1f3864' }}>
                                                                            <th style={{ width: 65, textAlign: 'center', padding: '9px 8px', fontWeight: 700, border: '1px solid #b4c6e7' }}>Sl. No.</th>
                                                                            <th style={{ width: 140, textAlign: 'left', padding: '9px 12px', fontWeight: 700, border: '1px solid #b4c6e7' }}>Sheet No.</th>
                                                                            <th style={{ textAlign: 'left', padding: '9px 12px', fontWeight: 700, border: '1px solid #b4c6e7' }}>Drawing Title</th>
                                                                            <th style={{ width: 80, textAlign: 'center', padding: '9px 8px', fontWeight: 700, border: '1px solid #b4c6e7' }}>REV#</th>
                                                                            <th style={{ width: 110, textAlign: 'center', padding: '9px 8px', fontWeight: 700, border: '1px solid #b4c6e7' }}>DATE</th>
                                                                            <th style={{ width: 220, textAlign: 'left', padding: '9px 12px', fontWeight: 700, border: '1px solid #b4c6e7' }}>Revision History</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {categories.length === 0 || (t.drawings || []).length === 0 ? (
                                                                            <tr>
                                                                                <td colSpan={6} style={{ textAlign: 'center', padding: '20px', color: '#64748b', fontStyle: 'italic', border: '1px solid #e2e8f0' }}>
                                                                                    No drawings recorded in this transmittal.
                                                                                </td>
                                                                            </tr>
                                                                        ) : (
                                                                            categories.map((catKey) => {
                                                                                const sortedDrawings = [...groupedDrawings[catKey]].sort((a: any, b: any) =>
                                                                                    (a.drawingNumber || '').localeCompare(b.drawingNumber || '', undefined, { numeric: true, sensitivity: 'base' })
                                                                                );
                                                                                return (
                                                                                    <Fragment key={catKey}>
                                                                                        {/* Yellow Main Category Header Row */}
                                                                                        <tr style={{ background: '#ffff00', color: '#000000', fontWeight: 800 }}>
                                                                                            <td
                                                                                                colSpan={6}
                                                                                                style={{
                                                                                                    textAlign: 'center',
                                                                                                    padding: '7px 12px',
                                                                                                    border: '1px solid #b4c6e7',
                                                                                                    letterSpacing: '0.5px',
                                                                                                    fontSize: 12
                                                                                                }}
                                                                                            >
                                                                                                {catKey}
                                                                                            </td>
                                                                                        </tr>

                                                                                        {/* Drawing rows */}
                                                                                        {sortedDrawings.map((d: any, dIdx: number) => {
                                                                                            const rowSlNo = currentSlNo++;
                                                                                            const revHistoryText = d.remarks || (d.changeType === 'new' ? 'ISSUED FOR APPROVAL' : d.changeType === 'revised' ? 'ISSUED FOR RE-APPROVAL' : 'RE-ISSUED');
                                                                                            return (
                                                                                                <tr
                                                                                                    key={`${catKey}-${dIdx}`}
                                                                                                    style={{
                                                                                                        background: dIdx % 2 === 0 ? '#ffffff' : '#f8fafc',
                                                                                                        transition: 'background-color 0.15s ease'
                                                                                                    }}
                                                                                                >
                                                                                                    <td style={{ textAlign: 'center', padding: '7px 8px', border: '1px solid #d9d9d9', fontWeight: 600, color: '#64748b' }}>
                                                                                                        {rowSlNo}
                                                                                                    </td>
                                                                                                    <td style={{ textAlign: 'left', padding: '7px 12px', border: '1px solid #d9d9d9', fontWeight: 700, color: '#0f172a' }}>
                                                                                                        {d.drawingNumber || '-'}
                                                                                                    </td>
                                                                                                    <td style={{ textAlign: 'left', padding: '7px 12px', border: '1px solid #d9d9d9', color: '#334155' }}>
                                                                                                        {d.drawingTitle || '-'}
                                                                                                    </td>
                                                                                                    <td style={{ textAlign: 'center', padding: '7px 8px', border: '1px solid #d9d9d9', fontWeight: 700, color: '#1d4ed8' }}>
                                                                                                        {d.revision || '0'}
                                                                                                    </td>
                                                                                                    <td style={{ textAlign: 'center', padding: '7px 8px', border: '1px solid #d9d9d9', color: '#475569', fontSize: 11.5 }}>
                                                                                                        {d.date || formatDate(t.createdAt)}
                                                                                                    </td>
                                                                                                    <td style={{ textAlign: 'left', padding: '7px 12px', border: '1px solid #d9d9d9', color: '#475569', fontSize: 11.5 }}>
                                                                                                        {revHistoryText}
                                                                                                    </td>
                                                                                                </tr>
                                                                                            );
                                                                                        })}
                                                                                    </Fragment>
                                                                                );
                                                                            })
                                                                        )}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })()}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
