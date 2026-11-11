import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getProjectTargetSequences } from '../utils/sequenceUtils';
import { listTransmittals } from '../services/transmittalApi';
import { uploadFolder } from '../services/fileApi';
import { uploadHistoricalTransmittalDoc, updateHistoricalBackfillStatus } from '../services/projectApi';
import { useMessage } from '../context/MessageContext';
import { IconFolder, IconFile, IconUpload, IconClose, IconCheck, IconAlert } from './Icons';

interface HistoricalTransmittalModalProps {
    isOpen: boolean;
    onClose: () => void;
    project: any;
    onComplete?: () => void;
}

export default function HistoricalTransmittalModal({
    isOpen,
    onClose,
    project,
    onComplete
}: HistoricalTransmittalModalProps) {
    const { showMessage } = useMessage();
    const projectId = project?._id || project?.id;

    const rawLast = Number(project?.lastTransmittalNumber || 0);
    const maxHistoricalNum = Math.max(1, rawLast > 1 ? rawLast - 1 : rawLast);

    const historicalNumbers = useMemo(() => {
        const nums: number[] = [];
        for (let i = 1; i <= maxHistoricalNum; i++) {
            nums.push(i);
        }
        return nums;
    }, [maxHistoricalNum]);

    const [selectedNum, setSelectedNum] = useState<number>(1);
    const [existingTransmittals, setExistingTransmittals] = useState<any[]>([]);
    const [loadingExisting, setLoadingExisting] = useState(false);

    // Upload Type: 'folder' (drawings for extraction) or 'doc' (transmittal document)
    const [uploadType, setUploadType] = useState<'folder' | 'doc'>('folder');

    // Sequences selection
    const availableSequences = useMemo(() => {
        const seqs = getProjectTargetSequences(project);
        return seqs.map(s => (typeof s === 'string' ? s : s.name || '')).filter(Boolean);
    }, [project]);
    const [selectedSequences, setSelectedSequences] = useState<string[]>([]);

    // Folder upload state
    const folderInputRef = useRef<HTMLInputElement>(null);
    const [selectedFolderFiles, setSelectedFolderFiles] = useState<File[]>([]);
    const [uploadingFolder, setUploadingFolder] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{ percent: number; text: string }>({ percent: 0, text: '' });

    // Document upload state
    const docInputRef = useRef<HTMLInputElement>(null);
    const [selectedDocFile, setSelectedDocFile] = useState<File | null>(null);
    const [uploadingDoc, setUploadingDoc] = useState(false);

    // Load existing transmittals to know which have already been uploaded
    const fetchTransmittals = async () => {
        if (!projectId) return;
        setLoadingExisting(true);
        try {
            const res = await listTransmittals(projectId);
            setExistingTransmittals(res.transmittals || []);
        } catch (err: any) {
            console.warn('[HistoricalTransmittalModal] Failed to list transmittals:', err.message);
        } finally {
            setLoadingExisting(false);
        }
    };

    useEffect(() => {
        if (isOpen && projectId) {
            fetchTransmittals();
            setSelectedSequences([]);
            setSelectedFolderFiles([]);
            setSelectedDocFile(null);
        }
    }, [isOpen, projectId]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const handleSelectNum = (num: number) => {
        setSelectedNum(num);
        setSelectedFolderFiles([]);
        setSelectedDocFile(null);
        setSelectedSequences([]);
        if (folderInputRef.current) folderInputRef.current.value = '';
        if (docInputRef.current) docInputRef.current.value = '';
    };

    const transmittalMap = useMemo(() => {
        const map = new Map<number, any>();
        for (const t of existingTransmittals) {
            const num = Number(t.transmittalNumber);
            if (!isNaN(num)) {
                map.set(num, t);
            }
        }
        return map;
    }, [existingTransmittals]);

    if (!isOpen || !project) return null;

    // Toggle sequence
    const toggleSequence = (seq: string) => {
        setSelectedSequences(prev =>
            prev.includes(seq) ? prev.filter(s => s !== seq) : [...prev, seq]
        );
    };

    // Handle Folder selection
    const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const fileList = Array.from(e.target.files);
            setSelectedFolderFiles(fileList);
        }
    };

    // Handle Document selection
    const handleDocChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedDocFile(e.target.files[0]);
        }
    };

    // Upload folder for extraction
    const handleUploadFolderForExtraction = async () => {
        if (selectedFolderFiles.length === 0) {
            showMessage('No Files Selected', 'Please select a folder containing drawings for extraction.', 'warning');
            return;
        }

        if (availableSequences.length > 0 && selectedSequences.length === 0) {
            showMessage('Sequence Required', 'Please select at least one Sequence or Scope of Work for this transmittal.', 'warning');
            return;
        }

        setUploadingFolder(true);
        setUploadProgress({ percent: 0, text: `Starting upload for Transmittal #${selectedNum}...` });

        const totalFiles = selectedFolderFiles.length;
        let successCount = 0;

        try {
            // Upload files in batches or series
            for (let i = 0; i < totalFiles; i++) {
                const file = selectedFolderFiles[i];
                const pct = Math.round(((i + 1) / totalFiles) * 100);
                setUploadProgress({
                    percent: pct,
                    text: `Uploading [${i + 1}/${totalFiles}]: ${file.name}`
                });

                await uploadFolder(
                    projectId,
                    [file],
                    selectedNum,
                    selectedSequences,
                    undefined,
                    undefined,
                    'Fabrication'
                );
                successCount++;
            }

            showMessage(
                'Upload Complete',
                `Successfully uploaded ${successCount} file(s) for Transmittal #${selectedNum}. Drawings queued for extraction.`,
                'success'
            );

            setSelectedFolderFiles([]);
            setSelectedSequences([]);
            if (folderInputRef.current) folderInputRef.current.value = '';
            await fetchTransmittals();

            // Auto-advance to next pending transmittal if available
            const nextPending = historicalNumbers.find(n => n > selectedNum && !transmittalMap.has(n));
            if (nextPending) {
                handleSelectNum(nextPending);
            }
        } catch (err: any) {
            console.error('[HistoricalModal] Folder upload failed:', err);
            showMessage('Upload Failed', err.message || 'Failed to upload folder for transmittal.', 'error');
        } finally {
            setUploadingFolder(false);
            setUploadProgress({ percent: 0, text: '' });
        }
    };

    // Upload Transmittal Excel Sheet
    const handleUploadDoc = async () => {
        if (!selectedDocFile) {
            showMessage('No File Selected', 'Please select a transmittal Excel file (.xlsx, .xls) to upload.', 'warning');
            return;
        }

        if (availableSequences.length > 0 && selectedSequences.length === 0) {
            showMessage('Sequence Required', 'Please select at least one Sequence or Scope of Work for this transmittal.', 'warning');
            return;
        }

        setUploadingDoc(true);
        try {
            const res = await uploadHistoricalTransmittalDoc(
                projectId,
                selectedDocFile,
                selectedNum,
                selectedSequences,
                `Historical Transmittal #${selectedNum} Excel`
            );

            showMessage(
                'Transmittal Saved & Logged',
                res.message || `Transmittal #${selectedNum} Excel (${selectedDocFile.name}) was successfully processed and added to Drawing Log.`,
                'success'
            );

            setSelectedDocFile(null);
            setSelectedSequences([]);
            if (docInputRef.current) docInputRef.current.value = '';
            await fetchTransmittals();

            // Auto-advance to next pending
            const nextPending = historicalNumbers.find(n => n > selectedNum && !transmittalMap.has(n));
            if (nextPending) {
                handleSelectNum(nextPending);
            }
        } catch (err: any) {
            console.error('[HistoricalModal] Document upload failed:', err);
            showMessage('Upload Failed', err.message || 'Failed to upload transmittal Excel sheet.', 'error');
        } finally {
            setUploadingDoc(false);
        }
    };

    // Mark all historical backfill complete
    const handleMarkComplete = async () => {
        try {
            await updateHistoricalBackfillStatus(projectId, true);
            showMessage('Backfill Complete', 'Historical transmittals marked as complete. Extraction reminders are now resolved.', 'success');
            if (onComplete) onComplete();
            onClose();
        } catch (err: any) {
            showMessage('Error', err.message || 'Failed to update backfill status', 'error');
        }
    };

    const isCurrentNumUploaded = transmittalMap.has(selectedNum);
    const currentNumData = transmittalMap.get(selectedNum);

    return (
        <div
            className="modal-overlay"
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 1050,
                background: 'rgba(15, 23, 42, 0.75)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 20
            }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                style={{
                    maxWidth: 960,
                    width: '100%',
                    maxHeight: '90vh',
                    display: 'flex',
                    flexDirection: 'column',
                    background: '#ffffff',
                    borderRadius: 14,
                    overflow: 'hidden',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.1)'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ── Modal Header ── */}
                <div
                    style={{
                        padding: '16px 24px',
                        background: '#0f172a',
                        borderBottom: '1px solid #1e293b',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexShrink: 0
                    }}
                >
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 20 }}>📁</span>
                            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#f8fafc' }}>
                                Historical Transmittals & Drawings Backfill
                            </h3>
                        </div>
                        <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#94a3b8' }}>
                            Project: <strong style={{ color: '#e2e8f0' }}>{project.name}</strong> • Range: Transmittal #01 to #{String(maxHistoricalNum).padStart(2, '0')}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        title="Close (Esc)"
                        style={{
                            background: 'rgba(255, 255, 255, 0.1)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            color: '#ffffff',
                            cursor: 'pointer',
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.15s ease',
                            flexShrink: 0
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#ef4444';
                            e.currentTarget.style.color = '#ffffff';
                            e.currentTarget.style.borderColor = '#ef4444';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                            e.currentTarget.style.color = '#ffffff';
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                        }}
                    >
                        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                            <path d="M3 3l10 10M13 3L3 13" />
                        </svg>
                    </button>
                </div>

                {/* ── Modal Body (2 Columns) ── */}
                <div style={{ display: 'flex', flex: 1, minHeight: 480, maxHeight: 'calc(90vh - 130px)', background: '#ffffff', overflow: 'hidden' }}>
                    
                    {/* Left Column: Transmittal List line-by-line */}
                    <div
                        style={{
                            width: 270,
                            minWidth: 270,
                            borderRight: '1px solid #e2e8f0',
                            background: '#f8fafc',
                            display: 'flex',
                            flexDirection: 'column'
                        }}
                    >
                        <div style={{
                            padding: '14px 18px',
                            borderBottom: '1px solid #e2e8f0',
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#64748b',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            background: '#f1f5f9'
                        }}>
                            Select Transmittal Number
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
                            {historicalNumbers.map(num => {
                                const isUploaded = transmittalMap.has(num);
                                const isSelected = selectedNum === num;
                                const trData = transmittalMap.get(num);
                                const drawingCount = trData?.drawings?.length || 0;

                                return (
                                    <div
                                        key={num}
                                        onClick={() => handleSelectNum(num)}
                                        style={{
                                            padding: '10px 12px',
                                            marginBottom: 6,
                                            borderRadius: 8,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                                            background: isSelected ? '#eff6ff' : '#ffffff',
                                            boxShadow: isSelected ? '0 1px 3px rgba(37,99,235,0.1)' : 'none',
                                            transition: 'all 0.15s ease'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <span style={{ fontWeight: 700, fontSize: 13, color: isSelected ? '#1d4ed8' : '#334155' }}>
                                                Transmittal #{String(num).padStart(2, '0')}
                                            </span>
                                        </div>
                                        <div>
                                            {isUploaded ? (
                                                <span
                                                    style={{
                                                        fontSize: 11,
                                                        background: '#dcfce7',
                                                        color: '#166534',
                                                        padding: '2px 8px',
                                                        borderRadius: 12,
                                                        fontWeight: 600,
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 4
                                                    }}
                                                >
                                                    <IconCheck /> {drawingCount > 0 ? `${drawingCount} dwgs` : 'Uploaded'}
                                                </span>
                                            ) : (
                                                <span
                                                    style={{
                                                        fontSize: 11,
                                                        background: '#fef3c7',
                                                        color: '#92400e',
                                                        padding: '2px 8px',
                                                        borderRadius: 12,
                                                        fontWeight: 600
                                                    }}
                                                >
                                                    Pending
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Right Column: Upload Configuration for Selected Transmittal */}
                    <div style={{
                        flex: 1,
                        padding: '24px 28px',
                        background: '#ffffff',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 20
                    }}>
                        
                        {/* Selected Transmittal Banner */}
                        <div
                            style={{
                                padding: '14px 18px',
                                borderRadius: 10,
                                background: isCurrentNumUploaded ? '#f0fdf4' : '#fffbeb',
                                border: isCurrentNumUploaded ? '1px solid #bbf7d0' : '1px solid #fed7aa',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                flexShrink: 0
                            }}
                        >
                            <div>
                                <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: isCurrentNumUploaded ? '#166534' : '#92400e' }}>
                                    Configuring: Transmittal #{String(selectedNum).padStart(2, '0')}
                                </h4>
                                <p style={{ margin: '4px 0 0 0', fontSize: 12, color: isCurrentNumUploaded ? '#15803d' : '#a16207' }}>
                                    {isCurrentNumUploaded
                                        ? `Already uploaded with ${currentNumData?.drawings?.length || 0} drawing(s) or document. You can append more files if needed.`
                                        : 'Not uploaded yet. Select the upload type below to backfill this transmittal.'}
                                </p>
                            </div>
                            <span
                                style={{
                                    fontSize: 12,
                                    fontWeight: 700,
                                    padding: '4px 12px',
                                    borderRadius: 20,
                                    background: isCurrentNumUploaded ? '#16a34a' : '#d97706',
                                    color: '#ffffff'
                                }}
                            >
                                {isCurrentNumUploaded ? 'Uploaded' : 'Action Required'}
                            </span>
                        </div>

                        {/* Step 1: Upload Type Selector */}
                        <div>
                            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#1e293b' }}>
                                1. Choose What to Upload:
                            </label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div
                                    onClick={() => setUploadType('folder')}
                                    style={{
                                        border: uploadType === 'folder' ? '2px solid #2563eb' : '1px solid #cbd5e1',
                                        background: uploadType === 'folder' ? '#eff6ff' : '#ffffff',
                                        borderRadius: 10,
                                        padding: '14px 16px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                        boxShadow: uploadType === 'folder' ? '0 2px 4px rgba(37,99,235,0.1)' : 'none'
                                    }}
                                >
                                    <div style={{ fontSize: 24, flexShrink: 0 }}>📁</div>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>Folder for Extraction</div>
                                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Upload drawings folder to extract & generate Drawing Log</div>
                                    </div>
                                </div>

                                <div
                                    onClick={() => setUploadType('doc')}
                                    style={{
                                        border: uploadType === 'doc' ? '2px solid #2563eb' : '1px solid #cbd5e1',
                                        background: uploadType === 'doc' ? '#eff6ff' : '#ffffff',
                                        borderRadius: 10,
                                        padding: '14px 16px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                        boxShadow: uploadType === 'doc' ? '0 2px 4px rgba(37,99,235,0.1)' : 'none'
                                    }}
                                >
                                    <div style={{ fontSize: 24, flexShrink: 0 }}>📊</div>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>Transmittal Excel Sheet</div>
                                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Upload past Transmittal Excel (.xlsx) to parse & generate Drawing Log</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Step 2: File / Folder Picker Area (Appears FIRST before sequences) */}
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#1e293b' }}>
                                2. Select {uploadType === 'folder' ? 'Drawing Folder' : 'Transmittal Excel Sheet'}:
                            </label>

                            {uploadType === 'folder' ? (
                                <div
                                    style={{
                                        border: selectedFolderFiles.length > 0 ? '2px solid #22c55e' : '2px dashed #94a3b8',
                                        borderRadius: 12,
                                        padding: '24px 20px',
                                        textAlign: 'center',
                                        background: selectedFolderFiles.length > 0 ? '#f0fdf4' : '#fafafa',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <input
                                        type="file"
                                        style={{ display: 'none' }}
                                        ref={folderInputRef}
                                        // @ts-ignore
                                        webkitdirectory=""
                                        multiple
                                        onChange={handleFolderChange}
                                    />
                                    <div style={{ fontSize: 36, marginBottom: 8 }}>📁</div>
                                    {selectedFolderFiles.length > 0 ? (
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: 14, color: '#166534', marginBottom: 4 }}>
                                                ✅ {selectedFolderFiles.length} file(s) selected from folder "{selectedFolderFiles[0]?.webkitRelativePath?.split('/')?.[0] || 'Selected Folder'}"
                                            </div>
                                            <p style={{ fontSize: 12, color: '#15803d', margin: '4px 0 12px' }}>
                                                Drawings will be queued for extraction and logged under Transmittal #{selectedNum}.
                                            </p>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => folderInputRef.current?.click()}
                                                disabled={uploadingFolder}
                                            >
                                                Change Folder
                                            </button>
                                        </div>
                                    ) : (
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b', marginBottom: 4 }}>
                                                Select Drawing Folder for Transmittal #{selectedNum}
                                            </div>
                                            <p style={{ fontSize: 12, color: '#64748b', maxWidth: 440, margin: '0 auto 16px', lineHeight: 1.5 }}>
                                                Preserves folder structure on the server and automatically extracts drawings into the Drawing Log.
                                            </p>
                                            <button
                                                type="button"
                                                className="btn btn-secondary"
                                                onClick={() => folderInputRef.current?.click()}
                                                disabled={uploadingFolder}
                                                style={{ padding: '8px 18px', fontWeight: 600 }}
                                            >
                                                <IconFolder /> Choose Drawing Folder
                                            </button>
                                        </div>
                                    )}

                                    {uploadingFolder && (
                                        <div style={{ marginTop: 16, width: '100%', maxWidth: 460, margin: '16px auto 0' }}>
                                            <div style={{ fontSize: 12, color: '#2563eb', fontWeight: 600, marginBottom: 6 }}>
                                                {uploadProgress.text}
                                            </div>
                                            <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                                                <div
                                                    style={{
                                                        height: '100%',
                                                        width: `${uploadProgress.percent}%`,
                                                        background: '#2563eb',
                                                        transition: 'width 0.2s ease'
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div
                                    style={{
                                        border: selectedDocFile ? '2px solid #22c55e' : '2px dashed #94a3b8',
                                        borderRadius: 12,
                                        padding: '24px 20px',
                                        textAlign: 'center',
                                        background: selectedDocFile ? '#f0fdf4' : '#fafafa',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <input
                                        type="file"
                                        style={{ display: 'none' }}
                                        ref={docInputRef}
                                        accept=".xlsx,.xls"
                                        onChange={handleDocChange}
                                    />
                                    <div style={{ fontSize: 36, marginBottom: 8 }}>📊</div>
                                    {selectedDocFile ? (
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: 14, color: '#166534', marginBottom: 4 }}>
                                                ✅ Selected Excel: {selectedDocFile.name} ({(selectedDocFile.size / 1024).toFixed(1)} KB)
                                            </div>
                                            <p style={{ fontSize: 12, color: '#15803d', margin: '4px 0 12px' }}>
                                                Drawing sheet numbers, revisions, and titles will be parsed directly into the Drawing Log.
                                            </p>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => docInputRef.current?.click()}
                                                disabled={uploadingDoc}
                                            >
                                                Change Excel File
                                            </button>
                                        </div>
                                    ) : (
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b', marginBottom: 4 }}>
                                                Select Transmittal Excel Sheet (.xlsx, .xls)
                                            </div>
                                            <p style={{ fontSize: 12, color: '#64748b', maxWidth: 440, margin: '0 auto 16px', lineHeight: 1.5 }}>
                                                Upload past Transmittal Excel workbook. Drawings inside will be automatically parsed into the project's Drawing Log.
                                            </p>
                                            <button
                                                type="button"
                                                className="btn btn-secondary"
                                                onClick={() => docInputRef.current?.click()}
                                                disabled={uploadingDoc}
                                                style={{ padding: '8px 18px', fontWeight: 600 }}
                                            >
                                                <IconFile /> Choose Transmittal Excel Sheet
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Step 3: Target Sequences Selection (ONLY unlocked/active AFTER files or folder are chosen!) */}
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#1e293b' }}>
                                3. Target Sequences / Scope of Work:
                            </label>

                            {!(uploadType === 'folder' ? selectedFolderFiles.length > 0 : !!selectedDocFile) ? (
                                <div style={{
                                    padding: '16px 20px',
                                    background: '#f8fafc',
                                    borderRadius: 10,
                                    border: '1px dashed #cbd5e1',
                                    color: '#64748b',
                                    fontSize: 13,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10
                                }}>
                                    <span style={{ fontSize: 18 }}>⏳</span>
                                    <span>Please select your {uploadType === 'folder' ? 'drawing folder' : 'transmittal Excel sheet'} above first to select sequences and proceed.</span>
                                </div>
                            ) : (
                                <div style={{ padding: '16px 18px', background: '#f8fafc', borderRadius: 10, border: '1px solid #bfdbfe' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase' }}>
                                            Assign Sequence(s) for Transmittal #{selectedNum}:
                                        </span>
                                        {availableSequences.length > 0 && (
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedSequences(availableSequences)}
                                                    style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                                                >
                                                    Select All
                                                </button>
                                                <span style={{ color: '#cbd5e1' }}>•</span>
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedSequences([])}
                                                    style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                                                >
                                                    Clear All
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {availableSequences.length > 0 ? (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                            {availableSequences.map(seq => {
                                                const checked = selectedSequences.includes(seq);
                                                return (
                                                    <label
                                                        key={seq}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 6,
                                                            padding: '6px 12px',
                                                            borderRadius: 6,
                                                            background: checked ? '#dbeafe' : '#ffffff',
                                                            border: checked ? '1px solid #3b82f6' : '1px solid #cbd5e1',
                                                            cursor: 'pointer',
                                                            fontSize: 12,
                                                            fontWeight: checked ? 700 : 500,
                                                            color: checked ? '#1d4ed8' : '#475569'
                                                        }}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => toggleSequence(seq)}
                                                            style={{ cursor: 'pointer' }}
                                                        />
                                                        {seq}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <span style={{ fontSize: 12, color: '#64748b' }}>No specific sequences configured for this project. Entire project scope will be used.</span>
                                    )}

                                    {/* Action button */}
                                    <div style={{ marginTop: 18, borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
                                        {uploadType === 'folder' ? (
                                            <button
                                                type="button"
                                                className="btn btn-primary"
                                                onClick={handleUploadFolderForExtraction}
                                                disabled={uploadingFolder || (availableSequences.length > 0 && selectedSequences.length === 0)}
                                                style={{ width: '100%', padding: '12px 20px', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                                            >
                                                <IconUpload /> {uploadingFolder ? 'Uploading & Queuing Extraction...' : `Upload & Generate Drawing Log for Transmittal #${selectedNum}`}
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                className="btn btn-primary"
                                                onClick={handleUploadDoc}
                                                disabled={uploadingDoc || (availableSequences.length > 0 && selectedSequences.length === 0)}
                                                style={{ width: '100%', padding: '12px 20px', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                                            >
                                                <IconUpload /> {uploadingDoc ? 'Processing Excel & Generating Log...' : `Process Excel Sheet & Generate Drawing Log for Transmittal #${selectedNum}`}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Modal Footer ── */}
                <div
                    style={{
                        padding: '14px 24px',
                        background: '#ffffff',
                        borderTop: '1px solid #e2e8f0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexShrink: 0
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
                        <IconAlert /> You can upload remaining transmittals at any time, or mark complete to dismiss reminders.
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={onClose}
                        >
                            Do It Later / Close
                        </button>
                        <button
                            type="button"
                            className="btn btn-success"
                            onClick={handleMarkComplete}
                            style={{ background: '#16a34a', color: '#fff', border: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                            <IconCheck /> Mark Historical Backfill Complete
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

