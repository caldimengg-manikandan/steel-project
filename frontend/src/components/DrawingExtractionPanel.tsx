/**
 * ============================================================
 * DrawingExtractionPanel
 * ============================================================
 * Self-contained panel that handles:
 *  • PDF drag-and-drop / click upload
 *  • Live extraction status with animated indicator
 *  • Extracted data table (all fields)
 *  • Per-field confidence badge
 *  • Validation warnings
 *  • Excel download button
 *  • Reprocess button for failed extractions
 *  • Full admin-scoped isolation (only shows this project's data)
 */
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { DrawingExtraction, ExtractionStatus } from '../types';
import {
    uploadDrawing,
    listExtractions,
    deleteExtraction,
    checkDuplicates,
    reprocessExtraction,
    getExcelDownloadUrl,
    reserveTransmittalNumber,
} from '../services/extractionApi';
import { listTransmittals } from '../services/transmittalApi';
import { IconClose } from './Icons';

// ── Mock data for demo (when backend not running) ─────────
const MOCK_EXTRACTIONS: DrawingExtraction[] = [
    {
        _id: 'ex001',
        projectId: 'p001',
        createdByAdminId: 'a001',
        originalFileName: 'SteelFrame_Tower_A_S101.pdf',
        fileUrl: '',
        fileSize: 204800,
        uploadedBy: 'admin',
        status: 'completed',
        errorMessage: '',
        extractionConfidence: 0.91,
        processingTimeMs: 4320,
        extractedFields: {
            drawingNumber: 'S-101',
            drawingTitle: 'Ground Floor Framing Plan',
            description: 'Structural steel framing — ground floor layout',
            drawingDescription: 'GROUND FLOOR FRAMING PLAN',
            revision: 'Rev 0',
            date: '2026-01-15',
            scale: '1:100',
            clientName: 'Infra Corp Ltd.',
            projectName: 'SteelFrame Tower A',
            remarks: '',
            revisionHistory: [
                { mark: '0', date: '2026-01-15', remarks: 'For Fabrication' },
            ],
        },
        validationResult: {
            drawingNumberValid: true,
            revisionValid: true,
            dateValid: true,
            warnings: [],
        },
        excelPath: '',
        excelUrl: '',
        createdAt: '2026-02-20T08:00:00Z',
        updatedAt: '2026-02-20T08:04:32Z',
    },
    {
        _id: 'ex002',
        projectId: 'p001',
        createdByAdminId: 'a001',
        originalFileName: 'SteelFrame_Tower_A_S102.pdf',
        fileUrl: '',
        fileSize: 189440,
        uploadedBy: 'admin',
        status: 'completed',
        errorMessage: '',
        extractionConfidence: 0.76,
        processingTimeMs: 3890,
        extractedFields: {
            drawingNumber: 'S-102',
            drawingTitle: 'First Floor Framing Plan',
            description: 'Structural steel framing — first floor',
            drawingDescription: 'FIRST FLOOR FRAMING PLAN',
            revision: 'Rev A',
            date: '2026-01-28',
            scale: '1:100',
            clientName: 'Infra Corp Ltd.',
            projectName: 'SteelFrame Tower A',
            remarks: '',
            revisionHistory: [
                { mark: '0', date: '2026-01-10', remarks: 'For Approval' },
                { mark: 'A', date: '2026-01-28', remarks: 'For Fabrication' },
            ],
        },
        validationResult: {
            drawingNumberValid: true,
            revisionValid: true,
            dateValid: true,
            warnings: [],
        },
        excelPath: '',
        excelUrl: '',
        createdAt: '2026-02-20T09:00:00Z',
        updatedAt: '2026-02-20T09:03:50Z',
    },
];

// ── Icons ────────────────────────────────────────────────
const UploadIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" />
        <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
    </svg>
);
const ExcelIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
        <rect x="2" y="2" width="20" height="20" rx="3" fill="#1D6F42" opacity="0.15" />
        <path d="M8 7l4 5-4 5h2.5l2.5-3.2L15.5 17H18l-4-5 4-5h-2.5L13.5 9.8 11 7H8z" fill="#1D6F42" />
    </svg>
);
const SpinnerIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"
        style={{ animation: 'spin 1s linear infinite' }}>
        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
        <path d="M12 2a10 10 0 0110 10" strokeLinecap="round" />
    </svg>
);
const CheckIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13">
        <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);
const ErrorIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
    </svg>
);
const TrashIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
        <polyline points="3 6 5 6 21 6" strokeLinecap="round" />
        <path d="M19 6l-1 14H6L5 6" strokeLinecap="round" />
        <path d="M10 11v6M14 11v6" strokeLinecap="round" />
    </svg>
);
const RefreshIcon = ({ spin }: { spin?: boolean }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"
        style={{ animation: spin ? 'spin 1s linear infinite' : 'none' }}>
        <polyline points="23 4 23 10 17 10" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" strokeLinecap="round" />
    </svg>
);

// ── Status badge ─────────────────────────────────────────
function StatusBadge({ status }: { status: ExtractionStatus }) {
    const cfg: Record<ExtractionStatus, { label: string; color: string; bg: string; icon: ReactNode }> = {
        queued: { label: 'Queued', color: '#64748b', bg: '#f1f5f9', icon: <SpinnerIcon /> },
        processing: { label: 'Processing', color: '#2563eb', bg: '#eff6ff', icon: <SpinnerIcon /> },
        completed: { label: 'Completed', color: '#16a34a', bg: '#f0fdf4', icon: <CheckIcon /> },
        failed: { label: 'Failed', color: '#dc2626', bg: '#fef2f2', icon: <ErrorIcon /> },
    };
    const { label, color, bg, icon } = cfg[status];
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 11, fontWeight: 700, padding: '3px 8px',
            borderRadius: 20, background: bg, color,
            border: `1px solid ${color}30`,
        }}>
            {icon} {label}
        </span>
    );
}

// ── Confidence meter: Displays the bar and percentage text ──
/* 
function ConfidenceMeter({ value }: { value: number }) {
    // Convert decimal (0.9) to percentage (90)
    const pct = Math.round(value * 100);
    // Dynamic color based on confidence level
    const color = pct >= 80 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626';
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
                width: 60, height: 6, borderRadius: 3,
                background: '#e2e8f0', overflow: 'hidden', flexShrink: 0,
            }}>
                <div style={{
                    width: `${pct}%`, height: '100%',
                    background: color, borderRadius: 3,
                    transition: 'width 0.4s ease',
                }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 30 }}>{pct}%</span>
        </div>
    );
}
*/

// ── Validation dot ────────────────────────────────────────
function ValidDot({ valid }: { valid: boolean | null }) {
    if (valid === null) return <span style={{ color: '#94a3b8', fontSize: 11 }}>—</span>;
    return (
        <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: valid ? '#16a34a' : '#dc2626',
        }} title={valid ? 'Valid' : 'Warning'} />
    );
}

// ── Main component ────────────────────────────────────────
interface DrawingExtractionPanelProps {
    projectId: string;
    canUpload: boolean;
}

export default function DrawingExtractionPanel({
    projectId,
    canUpload,
}: DrawingExtractionPanelProps) {

    const [extractions, setExtractions] = useState<DrawingExtraction[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [expanded, setExpanded] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null); // New error state
    // Duplicate detection state
    const [dupCheckLoading, setDupCheckLoading] = useState(false);
    const [dupModal, setDupModal] = useState(false);
    const [dupList, setDupList] = useState<Array<{ filename: string; sheetNumber: string; revision: string }>>([]);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);

    // Feature 6 state
    const [localSavePath, setLocalSavePath] = useState('');

    // ── Transmittal selection modal state ──────────────────
    const [transmittalModal, setTransmittalModal] = useState(false);
    const [existingTransmittals, setExistingTransmittals] = useState<any[]>([]);
    const [loadingTransmittals, setLoadingTransmittals] = useState(false);
    // null = Create New (auto-assign); number = append to that existing transmittal
    const [selectedTransmittalNumber, setSelectedTransmittalNumber] = useState<number | null>(null);
    // Files waiting for the user to pick a transmittal
    const [pendingTransmittalFiles, setPendingTransmittalFiles] = useState<File[]>([]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const pollRef = useRef<any>(null);

    // ── Fetching logic ──────────────────────────────────────
    const fetchExtractions = useCallback(async (isBackground: boolean | React.MouseEvent = false) => {
        if (!projectId) return;

        const background = typeof isBackground === 'boolean' ? isBackground : false;
        if (!background) setLoading(true);

        try {
            const data = await listExtractions(projectId);

            setError(null);
            setExtractions((prev) => {
                // 1. Create a map of server items by their ID
                const serverMap = new Map();
                data.extractions.forEach((e: DrawingExtraction) => serverMap.set(e._id, e));

                // 2. Identify which optimistic entries are still truly unknown to the server
                const pendingOptimistic = prev.filter(e => {
                    if (!e._id.startsWith('opt_')) return false;

                    // Match by filename within this project.
                    const matchedServerRecord = data.extractions.find((s: DrawingExtraction) =>
                        s.originalFileName === e.originalFileName
                    );

                    // Failsafe: older than 30 seconds
                    const ageMs = Date.now() - new Date(e.createdAt).getTime();
                    const isStale = ageMs > 30 * 1000;

                    return !matchedServerRecord && !isStale;
                });

                // 3. Combine server items (unique IDs) + actually pending optimistic ones
                return [...data.extractions, ...pendingOptimistic];
            });

        } catch (err: any) {
            console.error('[ExtractionPanel] Fetch failed:', err);
            setError(err.message || 'Failed to sync with server');

            if (err.message?.includes('404')) {
                setExtractions([]);
            }

            setExtractions(prev => {
                if (prev.length === 0 && !uploading) {
                    return MOCK_EXTRACTIONS.filter(e => e.projectId === projectId);
                }
                return prev;
            });
        } finally {
            if (!background) setLoading(false);
        }
    }, [projectId, uploading]);

    // ── Initial load ──────────────────────────────────────
    useEffect(() => {
        fetchExtractions();
    }, [fetchExtractions]);

    // Poll for status updates every 2 seconds while any item is still processing OR uploading
    useEffect(() => {
        const hasActive = extractions.some(
            (e) => e.status === 'queued' || e.status === 'processing'
        ) || uploading;

        if (hasActive) {
            if (!pollRef.current) {
                pollRef.current = setInterval(() => fetchExtractions(true), 1500); // More aggressive
            }
        } else {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        }
        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, [extractions, fetchExtractions, uploading]);

    // ── Transmittal selection interceptor ─────────────────
    // Called by ALL upload entry points before handleUploads.
    // Opens the transmittal selection modal; when user confirms,
    // processUploads() runs with the chosen transmittal number.
    async function requestTransmittalThenUpload(files: FileList | File[]) {
        const fileArray = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
        if (fileArray.length === 0) {
            setUploadError('No valid PDF files found.');
            return;
        }

        // Fetch transmittals in the background while the modal opens
        setLoadingTransmittals(true);
        try {
            const data = await listTransmittals(projectId);
            setExistingTransmittals(data.transmittals || []);
        } catch {
            setExistingTransmittals([]);
        } finally {
            setLoadingTransmittals(false);
        }

        // Default: Create New
        setSelectedTransmittalNumber(null);
        setPendingTransmittalFiles(fileArray);
        setTransmittalModal(true);
    }

    // ── Upload handler ────────────────────────────────────
    // NOTE: files come from pendingTransmittalFiles state (set by transmittal modal).
    // The optional parameter is kept for the dup-modal "Continue" path.
    async function handleUploads(filesArg?: FileList | File[]) {
        const source = filesArg ? Array.from(filesArg) : pendingTransmittalFiles;
        const fileArray = source.filter(f => f.name.toLowerCase().endsWith('.pdf'));

        if (fileArray.length === 0) {
            setUploadError('No valid PDF files found.');
            return;
        }

        const oversized = fileArray.filter(f => f.size > 50 * 1024 * 1024);
        if (oversized.length > 0) {
            setUploadError(`Some files exceed 50 MB limit: ${oversized.map(f => f.name).join(', ')}`);
            return;
        }

        setUploadError('');

        // ── Pre-flight duplicate check ──
        setDupCheckLoading(true);
        try {
            const result = await checkDuplicates(projectId, fileArray.map(f => f.name));
            if (result.hasDuplicates) {
                setDupList(result.duplicates);
                setPendingFiles(fileArray);
                setDupModal(true);
                return; // halt and wait for user explicitly Continue
            }
        } catch (err) {
            console.error('Duplicate check failed, proceeding to upload', err);
        } finally {
            setDupCheckLoading(false);
        }

        await processUploads(fileArray);
    }

    async function processUploads(fileArray: File[]) {
        setDupModal(false);
        setDupList([]);
        setPendingFiles([]);
        setUploading(true);

        // Optimistic UI — add queued entries immediately
        const optimisticEntries: DrawingExtraction[] = fileArray.map(file => ({
            _id: `opt_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`,
            projectId,
            createdByAdminId: '',
            originalFileName: file.name,
            fileUrl: '',
            fileSize: file.size,
            uploadedBy: 'You',
            status: 'queued',
            errorMessage: '',
            extractionConfidence: 0,
            processingTimeMs: 0,
            extractedFields: {
                drawingNumber: '', drawingTitle: '', description: '',
                drawingDescription: '', revision: '', date: '',
                scale: '', clientName: '', projectName: '',
                remarks: '',
                revisionHistory: [],
            },
            validationResult: {
                drawingNumberValid: null, revisionValid: null,
                dateValid: null, warnings: [],
            },
            excelPath: '', excelUrl: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }));

        setExtractions((prev) => [...optimisticEntries, ...prev]);

        let transmittalNumberToUse = selectedTransmittalNumber;
        
        // If we are creating a new transmittal, reserve the number ONCE for this entire session
        if (transmittalNumberToUse === null) {
            try {
                const res = await reserveTransmittalNumber(projectId);
                transmittalNumberToUse = res.transmittalNumber;
                console.log(`[Upload] Reserved Transmittal #${transmittalNumberToUse} for this session.`);
            } catch (err) {
                console.error('[Upload] Failed to reserve transmittal number:', err);
                // Fallback: the server will still auto-assign, but might fragment. 
                // We proceed anyway to ensure the files move.
            }
        }

        try {
            // Upload in parallel batches of 10
            const CHUNK_SIZE = 10;
            const CONCURRENCY = 3; // Upload 3 chunks at a time

            const chunks: File[][] = [];
            for (let i = 0; i < fileArray.length; i += CHUNK_SIZE) {
                chunks.push(fileArray.slice(i, i + CHUNK_SIZE));
            }

            // Process chunks with limited concurrency
            const processChunks = async () => {
                const results = [];
                const executing = new Set<Promise<any>>();

                for (const chunk of chunks) {
                    const p = uploadDrawing(projectId, chunk, localSavePath, transmittalNumberToUse).then(() => fetchExtractions(true));
                    results.push(p);
                    executing.add(p);
                    p.finally(() => executing.delete(p));

                    if (executing.size >= CONCURRENCY) {
                        await Promise.race(executing);
                    }
                }
                return Promise.all(results);
            };

            await processChunks();

        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setUploadError(`Upload failed: ${msg}`);
            setExtractions((prev) => prev.filter(e => !optimisticEntries.find(o => o._id === e._id)));
        } finally {
            setUploading(false);
            fetchExtractions(true);
        }
    }

    async function handleReprocess(e: DrawingExtraction) {
        try {
            await reprocessExtraction(projectId, e._id);
            setExtractions((prev) =>
                prev.map((x) => x._id === e._id ? { ...x, status: 'queued' } : x)
            );
        } catch (err: unknown) {
            alert(`Reprocess failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    async function handleDelete(e: DrawingExtraction) {
        if (!confirm(`Delete extraction for "${e.originalFileName}"?`)) return;
        try {
            await deleteExtraction(projectId, e._id);
            setExtractions((prev) => prev.filter((x) => x._id !== e._id));
        } catch (err: unknown) {
            alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    const completedCount = extractions.filter((e) => e.status === 'completed').length;
    const processingCount = extractions.filter(
        (e) => e.status === 'queued' || e.status === 'processing'
    ).length;

    return (
        <div>
            {/* ── Status Header ── */}
            {error && (
                <div className="info-box danger mb-md">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>
                            <strong>Sync Error:</strong> {error}
                        </span>
                        <button className="btn btn-ghost btn-sm" onClick={() => fetchExtractions()}>Retry</button>
                    </div>
                </div>
            )}

            <div className="panel-status-header" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 16,
            }}>
                <div>
                    <h3 style={{ fontWeight: 800, fontSize: 17, margin: 0, color: 'var(--color-text-primary)' }}>
                        Drawing Extraction
                    </h3>
                    <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '3px 0 0' }}>
                        AI-powered extraction from uploaded PDF drawings
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {/* ── Refresh Button ── */}
                    <button
                        onClick={fetchExtractions}
                        disabled={loading}
                        style={{
                            background: 'white', border: '1px solid #e2e8f0',
                            borderRadius: 6, padding: '7px 10px', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 6,
                            fontSize: 13, color: '#64748b', transition: 'all 0.2s',
                        }}
                    >
                        <RefreshIcon spin={loading} /> Refresh
                    </button>

                    {processingCount > 0 && (
                        <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            fontSize: 12, color: '#2563eb', fontWeight: 600,
                            padding: '4px 10px', background: '#eff6ff',
                            borderRadius: 20, border: '1px solid #bfdbfe',
                        }}>
                            <SpinnerIcon /> {processingCount} items moving in queue…
                        </span>
                    )}

                    {completedCount > 0 && (
                        <>
                            <a
                                href={getExcelDownloadUrl(projectId, 'transmittal')}
                                download
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    padding: '7px 14px',
                                    background: '#f0fdf4', color: '#16a34a',
                                    border: '1px solid #86efac', borderRadius: 6,
                                    fontSize: 13, fontWeight: 600, textDecoration: 'none',
                                    transition: 'background 0.2s',
                                }}
                            >
                                <ExcelIcon /> Download Transmittal
                            </a>
                            <a
                                href={getExcelDownloadUrl(projectId, 'log')}
                                download
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    padding: '7px 14px',
                                    background: '#f0fdf4', color: '#16a34a',
                                    border: '1px solid #86efac', borderRadius: 6,
                                    fontSize: 13, fontWeight: 600, textDecoration: 'none',
                                    transition: 'background 0.2s',
                                }}
                            >
                                <ExcelIcon /> Download Drawing Log
                            </a>
                        </>
                    )}
                </div>
            </div>

            {/* ── Missing API Key Warning Hidden ── */}
            {/* {useMock && (
                <div style={{
                    background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: 10,
                    padding: '12px 16px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start'
                }}>
                    <div style={{ color: '#d97706', fontSize: 20 }}>⚠️</div>
                    <div>
                        <h4 style={{ margin: '0 0 4px', fontSize: 13.5, color: '#92400e', fontWeight: 700 }}>
                            AI Extraction in Demo Mode
                        </h4>
                        <p style={{ margin: 0, fontSize: 12, color: '#b45309', lineHeight: 1.5 }}>
                            The <strong>VISION_AGENT_API_KEY</strong> is missing from the server configuration.
                            Currently, we are generating <strong>Mock Data</strong> for your Excel report.
                            Please add your Landing AI API key to the backend <code>.env</code> file to enable real extraction.
                        </p>
                    </div>
                </div>
            )} */}

            {/* ── Upload Zone ── */}
            {canUpload && (
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={async (e) => {
                        e.preventDefault();
                        setDragOver(false);
                        const items = e.dataTransfer.items;
                        if (items && items.length > 0) {
                            const files: File[] = [];
                            const promises: Promise<void>[] = [];

                            function traverseFileTree(item: any, path: string): Promise<void> {
                                return new Promise((resolve) => {
                                    if (item.isFile) {
                                        item.file((file: File) => {
                                            (file as any).customRelativePath = path + file.name;
                                            files.push(file);
                                            resolve();
                                        });
                                    } else if (item.isDirectory) {
                                        const dirReader = item.createReader();
                                        dirReader.readEntries((entries: any[]) => {
                                            const entryPromises = [];
                                            for (let i = 0; i < entries.length; i++) {
                                                entryPromises.push(traverseFileTree(entries[i], path + item.name + '/'));
                                            }
                                            Promise.all(entryPromises).then(() => resolve());
                                        });
                                    } else {
                                        resolve();
                                    }
                                });
                            }

                            for (let i = 0; i < items.length; i++) {
                                const item = items[i];
                                if (item.kind === 'file') {
                                    const entry = item.webkitGetAsEntry();
                                    if (entry) {
                                        promises.push(traverseFileTree(entry, ''));
                                    }
                                }
                            }
                            await Promise.all(promises);
                            if (files.length > 0) requestTransmittalThenUpload(files);
                        } else {
                            const files = e.dataTransfer.files;
                            if (files && files.length > 0) requestTransmittalThenUpload(Array.from(files));
                        }
                    }}
                    style={{
                        position: 'relative',
                        border: `2px dashed ${dragOver ? 'var(--color-primary)' : '#cbd5e1'}`,
                        borderRadius: 10,
                        padding: '28px 20px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        background: dragOver ? 'var(--color-primary-light)' : '#f8fafc',
                        transition: 'all 0.2s',
                        marginBottom: 16,
                    }}
                >
                    {dupCheckLoading && (
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, borderRadius: 10 }}>
                            <div style={{ color: '#2563eb', fontWeight: 600, fontSize: 14 }}><SpinnerIcon /> &nbsp;Checking duplicates…</div>
                        </div>
                    )}
                    <div onClick={() => fileInputRef.current?.click()}>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf"
                            multiple
                            style={{ display: 'none' }}
                            onChange={(e) => {
                                const files = e.target.files;
                                if (files && files.length > 0) requestTransmittalThenUpload(files);
                                e.target.value = '';
                            }}
                        />
                        <div style={{
                            width: 44, height: 44, borderRadius: '50%',
                            background: dragOver ? 'var(--color-primary)' : '#e2e8f0',
                            color: dragOver ? 'white' : '#64748b',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            margin: '0 auto 10px',
                            transition: 'all 0.2s',
                        }}>
                            <UploadIcon />
                        </div>
                        {uploading ? (
                            <div style={{ color: '#2563eb', fontWeight: 600, fontSize: 14 }}>
                                <SpinnerIcon /> &nbsp;Uploading files…
                            </div>
                        ) : (
                            <>
                                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)', marginBottom: 4 }}>
                                    {dragOver ? 'Drop PDF files here' : 'Click or drag PDFs to upload'}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                    Accepted: <strong>.pdf</strong> — supports multiple files
                                </div>
                            </>
                        )}
                    </div>

                    {!uploading && (
                        <div style={{ marginTop: 15, paddingTop: 15, borderTop: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 400 }}>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Optional: Local folder path for Excel (e.g. C:\Drawings)"
                                    value={localSavePath}
                                    onChange={(e) => setLocalSavePath(e.target.value)}
                                    style={{ flex: 1, fontSize: 12, padding: '6px 10px' }}
                                    title="If provided, the downloaded Excel log will also be saved to this folder on your computer."
                                />
                            </div>
                            <button
                                className="btn btn-secondary btn-sm"
                                disabled={loadingTransmittals}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const input = document.createElement('input');
                                    input.type = 'file';
                                    input.setAttribute('webkitdirectory', '');
                                    input.setAttribute('directory', '');
                                    input.onchange = (ev) => {
                                        const files = (ev.target as HTMLInputElement).files;
                                        if (files && files.length > 0) requestTransmittalThenUpload(files);
                                    };
                                    input.click();
                                }}
                                style={{ fontSize: 12 }}
                            >
                                {loadingTransmittals ? '⏳ Loading…' : '📁 Upload Folder'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── Duplicate Detection Modal ── */}
            {dupModal && (
                <div className="modal-overlay" onClick={() => setDupModal(false)}>
                    <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span className="modal-title">⚠️ Duplicate Drawings Detected</span>
                            <button className="modal-close" onClick={() => setDupModal(false)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <p style={{ marginBottom: 12, color: 'var(--color-text-secondary)', fontSize: 13 }}>
                                <strong>{dupList.length}</strong> drawing{dupList.length !== 1 ? 's' : ''} with the same revision already
                                exist in this project. Do you want to continue uploading?
                            </p>
                            {dupList.length > 0 && (
                                <div className="table-wrapper" style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 16 }}>
                                    <table style={{ fontSize: 12 }}>
                                        <thead>
                                            <tr>
                                                <th>Filename</th>
                                                <th>Sheet No.</th>
                                                <th>Revision</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {dupList.map((d, i) => (
                                                <tr key={i}>
                                                    <td className="text-muted font-mono" style={{ fontSize: 11 }}>{d.filename}</td>
                                                    <td>{d.sheetNumber || '—'}</td>
                                                    <td>{d.revision || '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
                                Selecting <strong>Continue</strong> will skip the duplicate drawing(s) and only upload new or updated revisions.
                            </p>
                            <div className="form-actions">
                                <button
                                    className="btn btn-secondary"
                                    disabled={uploading}
                                    onClick={() => { setDupModal(false); setDupList([]); setPendingFiles([]); }}
                                >
                                    Cancel Upload
                                </button>
                                <button
                                    className="btn btn-primary"
                                    disabled={uploading}
                                    onClick={() => processUploads(pendingFiles)}
                                >
                                    {uploading ? 'Uploading...' : 'Continue'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {uploadError && (
                <div style={{
                    padding: '8px 12px', marginBottom: 12, borderRadius: 6,
                    background: '#fef2f2', border: '1px solid #fecaca',
                    color: '#dc2626', fontSize: 13,
                }}>
                    {uploadError}
                </div>
            )}

            {/* ── Stats Row ── */}
            {extractions.length > 0 && (
                <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 8, marginBottom: 16,
                }}>
                    {[
                        { label: 'Total Uploaded', value: extractions.length, color: '#1d4ed8', bg: '#eff6ff' },
                        { label: 'Completed', value: completedCount, color: '#16a34a', bg: '#f0fdf4' },
                        /* {
                            label: 'Avg Confidence',
                            value: completedCount > 0
                                // Calculate total average across all completed extractions
                                ? `${Math.round(extractions.filter(e => e.status === 'completed')
                                    .reduce((s, e) => s + e.extractionConfidence, 0) / completedCount * 100)}%`
                                : '—',
                            color: '#d97706', bg: '#fffbeb'
                        }, */
                    ].map(({ label, value, color, bg }) => (
                        <div key={label} style={{
                            padding: '10px 14px', borderRadius: 8,
                            background: bg, border: `1px solid ${color}30`,
                        }}>
                            <div style={{ fontSize: 11, color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                            <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Extraction Results Table ── */}
            {loading && extractions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-muted)' }}>
                    <SpinnerIcon /> &nbsp;Loading extractions…
                </div>
            ) : extractions.length === 0 ? (
                <div style={{
                    textAlign: 'center', padding: '36px 20px',
                    background: '#f8fafc', borderRadius: 10,
                    border: '1px dashed #cbd5e1',
                }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                    <div style={{ fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                        No drawings uploaded yet
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
                        {canUpload
                            ? 'Upload a PDF drawing above — AI will auto-extract all fields'
                            : 'No drawings have been uploaded to this project yet'}
                    </div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {extractions.map((ex) => (
                        <ExtractionCard
                            key={ex._id}
                            extraction={ex}
                            isExpanded={expanded === ex._id}
                            onToggle={() => setExpanded(expanded === ex._id ? null : ex._id)}
                            onReprocess={() => handleReprocess(ex)}
                            onDelete={() => handleDelete(ex)}
                            canUpload={canUpload}
                        />
                    ))}
                </div>
            )}

            {/* ── Transmittal Selection Modal ── */}
            {transmittalModal && (
                <div className="modal-overlay" onClick={() => setTransmittalModal(false)}>
                    <div className="modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header" style={{
                            background: 'linear-gradient(135deg,#1e3a5f,#2563eb)',
                            borderRadius: '8px 8px 0 0',
                        }}>
                            <span className="modal-title" style={{ color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                    <line x1="12" y1="18" x2="12" y2="12" />
                                    <line x1="9" y1="15" x2="15" y2="15" />
                                </svg>
                                Select Transmittal
                            </span>
                            <button className="modal-close" style={{ color: 'white' }} onClick={() => setTransmittalModal(false)}><IconClose /></button>
                        </div>
                        <div className="modal-body">
                            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 18, lineHeight: 1.6 }}>
                                Choose which transmittal <strong>{pendingTransmittalFiles.length} file{pendingTransmittalFiles.length !== 1 ? 's' : ''}</strong> should be added to.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                                {/* Existing transmittals */}
                                {existingTransmittals.map(t => (
                                    <label
                                        key={t._id}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 12,
                                            padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                                            border: `2px solid ${selectedTransmittalNumber === t.transmittalNumber ? '#2563eb' : 'var(--color-border-light)'}`,
                                            background: selectedTransmittalNumber === t.transmittalNumber ? 'rgba(37,99,235,0.06)' : 'var(--color-surface)',
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            name="transmittalChoiceDEP"
                                            checked={selectedTransmittalNumber === t.transmittalNumber}
                                            onChange={() => setSelectedTransmittalNumber(t.transmittalNumber)}
                                            style={{ accentColor: '#2563eb', width: 16, height: 16, cursor: 'pointer' }}
                                        />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)' }}>
                                                Transmittal #{t.transmittalNumber}
                                                <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 12, color: 'var(--color-text-muted)' }}>
                                                    — {t.newCount + t.revisedCount} drawing{(t.newCount + t.revisedCount) !== 1 ? 's' : ''}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                                Created: {new Date(t.createdAt).toLocaleDateString()}
                                            </div>
                                        </div>
                                        {selectedTransmittalNumber === t.transmittalNumber && (
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                        )}
                                    </label>
                                ))}

                                {/* Create New Transmittal option */}
                                <label
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 12,
                                        padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                                        border: `2px solid ${selectedTransmittalNumber === null ? '#059669' : 'var(--color-border-light)'}`,
                                        background: selectedTransmittalNumber === null ? 'rgba(5,150,105,0.06)' : 'var(--color-surface)',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    <input
                                        type="radio"
                                        name="transmittalChoiceDEP"
                                        checked={selectedTransmittalNumber === null}
                                        onChange={() => setSelectedTransmittalNumber(null)}
                                        style={{ accentColor: '#059669', width: 16, height: 16, cursor: 'pointer' }}
                                    />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 700, fontSize: 14, color: '#059669', display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                                            Create New Transmittal
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                            Auto-assigns the next transmittal number
                                        </div>
                                    </div>
                                    {selectedTransmittalNumber === null && (
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                    )}
                                </label>
                            </div>

                            <div className="form-actions">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => {
                                        setTransmittalModal(false);
                                        setPendingTransmittalFiles([]);
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={() => {
                                        setTransmittalModal(false);
                                        handleUploads(pendingTransmittalFiles);
                                    }}
                                >
                                    Continue Upload →
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Spinner keyframe */}
            <style>{`
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
}

// ── Extraction Card ───────────────────────────────────────
interface CardProps {
    extraction: DrawingExtraction;
    isExpanded: boolean;
    onToggle: () => void;
    onReprocess: () => void;
    onDelete: () => void;
    canUpload: boolean;
}

function ExtractionCard({ extraction: ex, isExpanded, onToggle, onReprocess, onDelete, canUpload }: CardProps) {
    const f = ex.extractedFields;
    const v = ex.validationResult;
    const ok = ex.status === 'completed';

    // Highlight in grey if "Only Fabrication" (no approval revisions)
    const history = (f && Array.isArray(f.revisionHistory)) ? f.revisionHistory : [];
    
    // Logic updated per user request:
    // Highlight in grey if "Only Fabrication"
    // 1. It skipped approval (numeric revisions exist, but no alphabetic ones)
    // 2. Or it used an approval revision (like 'A') for fabrication specifically
    
    const revMark = (f && f.revision) ? f.revision.replace(/Rev\s*/i, '').trim().toUpperCase() : '';
    const hasFabRemark = history.some((r: any) => /fabrication/i.test(r.remarks || '')) || 
                         (f && /fabrication/i.test(f.remarks || ''));
                         
    const hasAlphaRev = history.some((r: any) => /^[a-zA-Z]/.test(r.mark || '')) || (revMark && /^[a-zA-Z]/.test(revMark));
    const hasNumRev = history.some((r: any) => /^[0-9]/.test(r.mark || '')) || (revMark && /^[0-9]/.test(revMark));

    const isOnlyFab = (revMark === 'A' && hasFabRemark) || (hasNumRev && !hasAlphaRev);

    return (
        <div style={{
            border: '1px solid',
            borderColor: ok ? (isOnlyFab ? '#cbd5e1' : '#e2e8f0') : ex.status === 'failed' ? '#fecaca' : '#bfdbfe',
            borderRadius: 10,
            overflow: 'hidden',
            background: isOnlyFab ? '#f1f5f9' : 'white',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            transition: 'box-shadow 0.2s',
        }}>
            {/* Card header */}
            <div
                onClick={ok ? onToggle : undefined}
                style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '11px 14px',
                    cursor: ok ? 'pointer' : 'default',
                    background: ok ? (isOnlyFab ? '#f8fafc' : 'white') : ex.status === 'failed' ? '#fef2f2' : '#eff6ff',
                    borderBottom: isExpanded ? '1px solid #f1f5f9' : 'none',
                }}
            >
                {/* PDF icon */}
                <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: '#fef2f2', color: '#dc2626',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 900, flexShrink: 0,
                    border: '1px solid #fecaca',
                }}>PDF</div>

                {/* File name + meta */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {ex.originalFileName}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        {ok && f.drawingNumber && (
                            <span style={{ fontFamily: 'monospace', background: '#f1f5f9', padding: '1px 5px', borderRadius: 3, marginRight: 6 }}>
                                {f.drawingNumber}
                            </span>
                        )}
                        {ok && f.drawingTitle && (
                            <span style={{ marginRight: 6 }}>{f.drawingTitle}</span>
                        )}
                        {!ok && ex.errorMessage && (
                            <span style={{ color: '#dc2626' }}>{ex.errorMessage.slice(0, 80)}</span>
                        )}
                        {ex.status === 'processing' && (
                            <span style={{ color: '#2563eb' }}>⚡ Extracting data locally...</span>
                        )}
                        {ex.status === 'queued' && (
                            <span style={{ color: '#64748b' }}>⏳ Waiting in queue...</span>
                        )}
                    </div>
                </div>

                {/* Right side: status + confidence + actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    {/* {ok && <ConfidenceMeter value={ex.extractionConfidence} />} */}
                    <StatusBadge status={ex.status} />
                    {ex.status === 'failed' && canUpload && (
                        <button
                            className="btn btn-ghost btn-sm"
                            onClick={(e) => { e.stopPropagation(); onReprocess(); }}
                            style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px' }}
                        >
                            <RefreshIcon /> Reprocess
                        </button>
                    )}
                    {canUpload && (
                        <button
                            className="btn btn-ghost btn-sm btn-icon"
                            onClick={(e) => { e.stopPropagation(); onDelete(); }}
                            style={{ color: '#dc2626', padding: '5px' }}
                            title="Delete extraction"
                        >
                            <TrashIcon />
                        </button>
                    )}
                    {ok && (
                        <svg
                            viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2" width="14" height="14"
                            style={{
                                color: '#94a3b8', flexShrink: 0,
                                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)',
                                transition: 'transform 0.2s',
                            }}
                        >
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    )}
                </div>
            </div>

            {/* Expanded details */}
            {isExpanded && ok && (
                <div style={{ padding: '14px 16px' }}>
                    {/* Validation warnings */}
                    {v.warnings && v.warnings.length > 0 && (
                        <div style={{
                            marginBottom: 12, padding: '8px 12px',
                            background: '#fffbeb', border: '1px solid #fcd34d',
                            borderRadius: 6, fontSize: 12, color: '#92400e',
                        }}>
                            <strong>⚠ Validation Warnings:</strong>
                            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                                {v.warnings.map((w, i) => <li key={i}>{w}</li>)}
                            </ul>
                        </div>
                    )}

                    {/* Extracted fields grid */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                        gap: 10, marginBottom: 14,
                    }}>
                        {[
                            { label: 'Drawing No.', value: f.drawingNumber, valid: v.drawingNumberValid },
                            { label: 'Drawing Title', value: f.drawingTitle, valid: null },
                            { label: 'Description', value: f.description, valid: null },
                            { label: 'DWG Desc.', value: f.drawingDescription, valid: null },
                            { label: 'Revision', value: f.revision, valid: v.revisionValid },
                            { label: 'Date', value: f.date, valid: v.dateValid },
                            { label: 'Scale', value: f.scale, valid: null },
                            { label: 'Project Name', value: f.projectName, valid: null },
                            { label: 'Client Name', value: f.clientName, valid: null },
                        ].map(({ label, value, valid }) => (
                            <div key={label} style={{
                                background: '#f8fafc', borderRadius: 6,
                                padding: '8px 10px',
                                border: '1px solid #f1f5f9',
                            }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center',
                                    justifyContent: 'space-between', marginBottom: 3,
                                }}>
                                    <span style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        {label}
                                    </span>
                                    <ValidDot valid={valid} />
                                </div>
                                <div style={{
                                    fontSize: 13, fontWeight: 600,
                                    color: value ? 'var(--color-text-primary)' : '#cbd5e1',
                                    fontFamily: label === 'Drawing No.' ? 'monospace' : undefined,
                                }}>
                                    {value || '—'}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Revision history table */}
                    {f.revisionHistory && f.revisionHistory.length > 0 && (
                        <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Revision History
                            </div>
                            <div className="table-wrapper" style={{ marginBottom: 0 }}>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Mark</th>
                                            <th>Date</th>
                                            <th>Remarks</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(f.revisionHistory || [])
                                            .filter((r: any) => {
                                                const mark = (r.mark || '').trim().toUpperCase();
                                                const remarks = (r.remarks || '').toLowerCase();
                                                // Only show Revision 0 if it has fabrication remarks
                                                if (mark === '0' && !remarks.includes('fabrication')) return false;
                                                return true;
                                            })
                                            .map((r: any, i: number) => (
                                                <tr key={i}>
                                                    <td><span className="role-chip viewer" style={{ fontFamily: 'monospace' }}>{r.mark}</span></td>
                                                    <td className="text-muted">{r.date}</td>
                                                    <td>{r.remarks}</td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Footer meta */}
                    <div style={{
                        display: 'flex', gap: 16, marginTop: 12,
                        fontSize: 11, color: '#94a3b8', flexWrap: 'wrap',
                    }}>
                        <span>Uploaded by <strong>{ex.uploadedBy}</strong></span>
                        <span>Processed in <strong>{(ex.processingTimeMs / 1000).toFixed(1)}s</strong></span>
                        <span>Uploaded <strong>{new Date(ex.createdAt).toLocaleDateString()}</strong></span>
                        <span>File size <strong>{(ex.fileSize / 1024).toFixed(0)} KB</strong></span>
                    </div>
                </div>
            )}
        </div>
    );
}
