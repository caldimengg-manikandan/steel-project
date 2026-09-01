import { useState, useEffect, useRef } from 'react';
import { 
    browseFiles, 
    uploadFiles, 
    deleteFile, 
    downloadFile,
    uploadFolder,
    type FileEntry 
} from '../services/fileApi';
import { reserveTransmittalNumber, getExcelDownloadUrl } from '../services/extractionApi';
import { listTransmittals } from '../services/transmittalApi';
import { uploadSessionStore, type SessionFile, type UploadSession } from '../services/uploadSessionStore';
import { useMessage } from '../context/MessageContext';
import { 
    IconFolder, 
    IconFile, 
    IconDownload, 
    IconTrash, 
    IconUpload
} from './Icons';

const ExcelIcon = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
);

interface FileBrowserPanelProps {
    projectId?: string;
    projectName?: string;
    canUpload: boolean;
    sequences?: string[];
}

export default function FileBrowserPanel({ projectId, projectName, canUpload, sequences }: FileBrowserPanelProps) {
    const { showMessage } = useMessage();
    
    // Determine the base path based on whether a project was passed
    const basePath = projectName ? `Projects/${projectName.replace(/[^a-zA-Z0-9 _-]/g, '_')}` : '';

    const [currentPath, setCurrentPath] = useState<string>(basePath);
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');
    const [uploading, setUploading] = useState<boolean>(false);

    // Global Upload Session Subscription
    const [session, setSession] = useState<UploadSession | null>(uploadSessionStore.getSession());
    const [activeReportTab, setActiveReportTab] = useState<'drawings' | 'stored' | 'failed'>('drawings');

    useEffect(() => {
        const unsubscribe = uploadSessionStore.subscribe((s) => {
            setSession(s);
        });
        return unsubscribe;
    }, []);

    // Derived states from global session store
    const uploadingFolder = !!session?.active && !!session?.uploading;
    const uploadProgressPercent = session?.progressPercent || 0;
    const uploadProgressSpeed = session?.progressSpeed || '';
    const uploadProgressStats = session?.progressStats || '';
    const folderUploadProgress = session?.progressDetail || '';
    const uploadSessionActive = !!session?.active;
    const sessionFolderName = session?.folderName || '';
    const sessionFiles = session?.files || [];
    const uploadResultModal = !!session?.resultModalOpen;
    const uploadResultDetails = session?.resultDetails || null;
    
    // Drag & Drop state
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);

    // Upload Config Modal States
    const [uploadModalOpen, setUploadModalOpen] = useState(false);
    const [pendingUploadFiles, setPendingUploadFiles] = useState<File[] | null>(null);
    const [pendingUploadMode, setPendingUploadMode] = useState<'files' | 'folder'>('files');
    const [transmittalChoice, setTransmittalChoice] = useState<'new' | 'existing'>('new');
    const [existingTransmittals, setExistingTransmittals] = useState<any[]>([]);
    const [loadingTransmittals, setLoadingTransmittals] = useState(false);
    const [selectedTransmittalNum, setSelectedTransmittalNum] = useState<number | null>(null);
    const [uploadPurpose, setUploadPurpose] = useState<'Fabrication' | 'Approval'>('Fabrication');
    const [selectedUploadSequences, setSelectedUploadSequences] = useState<string[]>([]);
    const [sequenceFilter, setSequenceFilter] = useState<string>('ALL');

    const loadFiles = async (path: string) => {
        setLoading(true);
        setError('');
        try {
            const data = await browseFiles(path);
            setFiles(data.entries || []);
        } catch (err: any) {
            // If the folder simply hasn't been created yet, that's fine. Treat as empty.
            if (err.message.includes('not found') || err.message.includes('404')) {
                setFiles([]);
            } else {
                setError(err.message || 'Failed to load files.');
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadFiles(currentPath);
    }, [currentPath]);



    // Format bytes
    const formatBytes = (bytes: number | null | undefined) => {
        if (bytes === undefined || bytes === null) return '-';
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    // Format Date
    const formatDate = (dateString?: string) => {
        if (!dateString) return '-';
        try {
            return new Date(dateString).toLocaleString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
            });
        } catch {
            return dateString;
        }
    };

    // Navigation
    const handleFolderClick = (folderName: string) => {
        const newPath = currentPath ? `${currentPath}/${folderName}` : folderName;
        setCurrentPath(newPath);
    };

    const handleNavigateUp = () => {
        if (!currentPath || currentPath === basePath) return;
        const parts = currentPath.split('/');
        parts.pop();
        
        const newPath = parts.join('/');
        // Don't let them navigate above the base path if scoped to a project
        if (basePath && !newPath.startsWith(basePath)) {
            setCurrentPath(basePath);
        } else {
            setCurrentPath(newPath);
        }
    };

    // Breadcrumbs
    const renderBreadcrumbs = () => {
        const parts = currentPath ? currentPath.split('/').filter(Boolean) : [];
        let runningPath = '';

        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflowX: 'auto', paddingBottom: 2, flex: 1, minWidth: 0 }}>
                <span 
                    style={{ cursor: basePath ? 'default' : 'pointer', color: (!basePath && !currentPath) ? 'var(--color-text-primary)' : 'var(--color-primary)', whiteSpace: 'nowrap', flexShrink: 0 }}
                    onClick={() => { if (!basePath) setCurrentPath('') }}
                >
                    Storage Root
                </span>
                {parts.map((part, index) => {
                    runningPath = runningPath ? `${runningPath}/${part}` : part;
                    const isLast = index === parts.length - 1;
                    
                    // If we are scoped to a project, prevent clicking breadcrumbs above the project root
                    const isClickable = basePath ? runningPath.startsWith(basePath) : true;
                    const pathClosure = runningPath; // closure for onClick

                    return (
                        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: isLast ? 1 : 0, minWidth: 0 }}>
                            <span style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>/</span>
                            <span 
                                title={part}
                                style={{ 
                                    cursor: (isClickable && !isLast) ? 'pointer' : 'default', 
                                    color: isLast ? 'var(--color-text-primary)' : (isClickable ? 'var(--color-primary)' : 'var(--color-text-muted)'),
                                    textDecoration: (isClickable && !isLast) ? 'underline' : 'none',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    maxWidth: isLast ? 240 : 160,
                                    display: 'inline-block',
                                    verticalAlign: 'bottom'
                                }}
                                onClick={() => { if (isClickable && !isLast) setCurrentPath(pathClosure) }}
                            >
                                {part}
                            </span>
                        </div>
                    );
                })}
            </div>
        );
    };

    // Actions
    const handleDownload = async (fileName: string) => {
        try {
            const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;
            await downloadFile(filePath);
        } catch (err: any) {
            showMessage('Download Failed', err.message, 'error');
        }
    };

    const handleDelete = async (fileName: string) => {
        if (!window.confirm(`Are you sure you want to delete "${fileName}"? This action cannot be undone.`)) return;
        
        try {
            const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;
            await deleteFile(filePath);
            showMessage('Deleted', `File ${fileName} was removed.`, 'success');
            loadFiles(currentPath);
        } catch (err: any) {
            showMessage('Delete Failed', err.message, 'error');
        }
    };

    // ── Upload Configuration Handlers ─────────────────────────────
    const handleInitiateUpload = async (filesToUpload: FileList | null, mode: 'files' | 'folder') => {
        if (!filesToUpload || filesToUpload.length === 0) return;
        if (!canUpload) {
            showMessage('Access Denied', 'You do not have permission to upload files.', 'error');
            return;
        }

        const fileArray = Array.from(filesToUpload);
        setPendingUploadFiles(fileArray);
        setPendingUploadMode(mode);
        setTransmittalChoice('new');
        setUploadPurpose('Fabrication');

        const availableSeqs = sequences && sequences.length > 0 ? sequences : ['Seq 1'];
        setSelectedUploadSequences([availableSeqs[0]]);

        if (projectId) {
            setLoadingTransmittals(true);
            try {
                const data = await listTransmittals(projectId);
                setExistingTransmittals(data.transmittals || []);
                if (data.transmittals && data.transmittals.length > 0) {
                    setSelectedTransmittalNum(data.transmittals[0].transmittalNumber);
                } else {
                    setSelectedTransmittalNum(null);
                }
            } catch (err) {
                console.warn('[FileBrowser] Could not fetch transmittals:', err);
                setExistingTransmittals([]);
            } finally {
                setLoadingTransmittals(false);
            }
        }

        setUploadModalOpen(true);
    };

    const handleConfirmUpload = async () => {
        if (!pendingUploadFiles || pendingUploadFiles.length === 0) return;
        if (selectedUploadSequences.length === 0) {
            showMessage('Required Field', 'Please select at least one Sequence.', 'error');
            return;
        }
        if (transmittalChoice === 'existing' && !selectedTransmittalNum) {
            showMessage('Required Field', 'Please select an existing transmittal to append to.', 'error');
            return;
        }

        setUploadModalOpen(false);

        let finalTransmittalNum: number | null = null;
        if (transmittalChoice === 'existing') {
            finalTransmittalNum = selectedTransmittalNum;
        } else if (projectId) {
            try {
                const res = await reserveTransmittalNumber(projectId);
                finalTransmittalNum = res.transmittalNumber;
            } catch (err) {
                console.warn('[FileBrowser] Could not reserve transmittal number:', err);
            }
        }

        if (pendingUploadMode === 'folder') {
            executeFolderUpload(pendingUploadFiles, finalTransmittalNum, uploadPurpose, selectedUploadSequences);
        } else {
            executeFilesUpload(pendingUploadFiles, currentPath);
        }
    };

    const executeFilesUpload = async (filesToUpload: File[], path: string) => {
        setUploading(true);
        try {
            const res = await uploadFiles(filesToUpload, path);
            showMessage('Upload Success', res.message, 'success');
            loadFiles(path);
        } catch (err: any) {
            showMessage('Upload Failed', err.message, 'error');
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // Folder Upload Handler
    const executeFolderUpload = async (
        fileArray: File[],
        reservedTransmittalNum: number | null,
        purpose: 'Fabrication' | 'Approval',
        chosenSeqs: string[]
    ) => {
        if (!projectId) {
            showMessage('Error', 'Project ID is missing. Cannot upload folder.', 'error');
            return;
        }

        const topFolderName = fileArray[0]?.webkitRelativePath?.split('/')?.[0] || 'Folder';

        // Initialize session files
        const initialSessionFiles = fileArray.map((f): SessionFile => ({
            name: f.name,
            path: (f as any).webkitRelativePath || f.name,
            size: f.size,
            status: 'uploading'
        }));

        // Start global session in store
        uploadSessionStore.startSession(projectId, topFolderName, currentPath || undefined, initialSessionFiles, fileArray);

        const totalFolderSize = fileArray.reduce((acc, f) => acc + f.size, 0);
        let totalUploadedBytes = 0;
        let currentSessionFiles = [...initialSessionFiles];

        const finalResultsList: any[] = [];
        const finalDrawingsList: any[] = [];

        try {
            // Step 2: Upload files one-by-one synchronously (in series) to prevent rate limit & network drop issues
            for (let i = 0; i < fileArray.length; i++) {
                const file = fileArray[i];

                uploadSessionStore.updateFileStatus(i, { status: 'uploading' });
                uploadSessionStore.updateProgress(
                    Math.round((totalUploadedBytes / totalFolderSize) * 100),
                    '0 KB/s',
                    `${(totalUploadedBytes / (1024 * 1024)).toFixed(1)} MB / ${(totalFolderSize / (1024 * 1024)).toFixed(1)} MB`,
                    `Uploading [${i + 1}/${fileArray.length}]: ${file.name}`
                );

                try {
                    const result = await uploadFolder(
                        projectId,
                        [file], // Send ONLY this single file in the request
                        reservedTransmittalNum,
                        chosenSeqs || [],
                        currentPath || undefined,
                        (prog) => {
                            const loadedSoFar = totalUploadedBytes + prog.loaded;
                            const overallPct = Math.round((loadedSoFar / totalFolderSize) * 100);
                            
                            let speedStr = '0 B/s';
                            if (prog.speed > 1024 * 1024) {
                                speedStr = `${(prog.speed / (1024 * 1024)).toFixed(1)} MB/s`;
                            } else if (prog.speed > 1024) {
                                speedStr = `${(prog.speed / 1024).toFixed(1)} KB/s`;
                            } else {
                                speedStr = `${Math.round(prog.speed)} B/s`;
                            }

                            const formatMB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
                            uploadSessionStore.updateProgress(
                                overallPct,
                                speedStr,
                                `${formatMB(loadedSoFar)} / ${formatMB(totalFolderSize)}`,
                                `Uploading [${i + 1}/${fileArray.length}]: ${file.name}`
                            );
                        },
                        purpose
                    );

                    // Add successful upload results
                    if (result.results && result.results.length > 0) {
                        finalResultsList.push(...result.results);
                    }
                    if (result.drawings && result.drawings.length > 0) {
                        finalDrawingsList.push(...result.drawings);
                    }

                    // Update store status
                    const resMatch = result.results?.find(r => r.path === file.name || r.name === file.name || r.path?.endsWith(file.name));
                    if (!resMatch || resMatch.status === 'failed') {
                        currentSessionFiles[i].status = 'failed';
                        currentSessionFiles[i].error = resMatch?.error || 'Upload failed on storage agent';
                        uploadSessionStore.updateFileStatus(i, {
                            status: 'failed',
                            error: resMatch?.error || 'Upload failed on storage agent'
                        });
                    } else {
                        const drawingMatch = result.drawings?.find(d => d.name === file.name);
                        if (drawingMatch) {
                            currentSessionFiles[i].status = 'extracting';
                            currentSessionFiles[i].folder = drawingMatch.folder;
                            currentSessionFiles[i].extractionId = drawingMatch.id;
                            uploadSessionStore.updateFileStatus(i, {
                                status: 'extracting',
                                folder: drawingMatch.folder,
                                extractionId: drawingMatch.id
                            });
                        } else {
                            currentSessionFiles[i].status = 'stored';
                            uploadSessionStore.updateFileStatus(i, { status: 'stored' });
                        }
                    }
                } catch (err: any) {
                    console.error(`[FolderUpload] Upload failed for file ${file.name}:`, err.message);
                    currentSessionFiles[i].status = 'failed';
                    currentSessionFiles[i].error = err.message || 'Upload error';
                    uploadSessionStore.updateFileStatus(i, {
                        status: 'failed',
                        error: err.message || 'Upload error'
                    });
                    finalResultsList.push({ name: file.name, path: (file as any).webkitRelativePath || file.name, status: 'failed', error: err.message });
                }

                totalUploadedBytes += file.size;
            }

            // Populate the detailed modal report summary
            const storedCount = currentSessionFiles.filter(f => f.status === 'stored' || f.status === 'completed' || f.status === 'extracting').length;
            const failedCount = currentSessionFiles.filter(f => f.status === 'failed').length;
            const drawingsQueued = currentSessionFiles.filter(f => f.status === 'completed' || f.status === 'extracting').length;

            const summaryReport = {
                message: `${storedCount} file(s) stored on server. ${drawingsQueued} drawing(s) queued for extraction.`,
                storedCount,
                drawingsQueued,
                failedCount,
                transmittalNumber: reservedTransmittalNum,
                results: finalResultsList,
                drawings: finalDrawingsList
            };

            uploadSessionStore.setUploadingFinished(summaryReport, currentSessionFiles);
            setActiveReportTab(drawingsQueued > 0 ? 'drawings' : 'stored');
            loadFiles(currentPath);
        } catch (err: any) {
            showMessage('Folder Upload Failed', err.message, 'error');
            const failedFiles = currentSessionFiles.map(f => f.status === 'uploading' ? { ...f, status: 'failed' as const, error: err.message } : f);
            uploadSessionStore.setUploadingFinished(null, failedFiles);
        } finally {
            if (folderInputRef.current) folderInputRef.current.value = '';
        }
    };

    // Drag & Drop Handlers
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (canUpload) setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (canUpload && e.dataTransfer.files) {
            handleInitiateUpload(e.dataTransfer.files, 'files');
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Header / Actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'var(--color-bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, minWidth: 0 }}>
                    {renderBreadcrumbs()}
                    {sequences && sequences.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                                Sequence:
                            </span>
                            <select
                                value={sequenceFilter}
                                onChange={(e) => setSequenceFilter(e.target.value)}
                                style={{
                                    padding: '4px 10px',
                                    borderRadius: 6,
                                    border: '1px solid var(--color-border)',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: 'var(--color-text-primary)',
                                    background: 'var(--color-bg-card)',
                                    cursor: 'pointer'
                                }}
                            >
                                <option value="ALL">All Sequences</option>
                                {sequences.map((s: any, idx: number) => {
                                    const seqName = typeof s === 'string' ? s : (s.name || `Seq ${idx + 1}`);
                                    return <option key={idx} value={seqName}>{seqName}</option>;
                                })}
                            </select>
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    {projectId && (
                        <div style={{ display: 'flex', gap: 12 }}>
                            <a
                                href={getExcelDownloadUrl(projectId, 'transmittal')}
                                download
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    padding: '0 14px', height: 36, whiteSpace: 'nowrap',
                                    background: '#f0fdf4', color: '#15803d',
                                    border: '1px solid #bbf7d0', borderRadius: 6,
                                    fontSize: 12.5, fontWeight: 700, textDecoration: 'none',
                                    transition: 'all 0.15s ease',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
                                }}
                            >
                                <IconDownload width={14} height={14} />
                                <span>Download Transmittal</span>
                            </a>
                            <a
                                href={getExcelDownloadUrl(projectId, 'log')}
                                download
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    padding: '0 14px', height: 36, whiteSpace: 'nowrap',
                                    background: '#f0fdf4', color: '#15803d',
                                    border: '1px solid #bbf7d0', borderRadius: 6,
                                    fontSize: 12.5, fontWeight: 700, textDecoration: 'none',
                                    transition: 'all 0.15s ease',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
                                }}
                            >
                                <IconDownload width={14} height={14} />
                                <span>Download Drawing Log</span>
                            </a>
                        </div>
                    )}
                    {/* Live Upload Progress Text & Stats beside upload buttons */}
                    {uploadingFolder && (
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-end',
                            fontSize: 12,
                            color: 'var(--color-text-secondary)',
                            textAlign: 'right',
                            marginRight: 8,
                            maxWidth: 240,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--color-primary)' }}>
                                <svg className="animate-spin" style={{ animation: 'spin 1s linear infinite', width: 12, height: 12, color: 'var(--color-primary)' }} viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" style={{ opacity: 0.25 }} />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" style={{ opacity: 0.75 }} />
                                </svg>
                                <span>⚡ {uploadProgressSpeed}</span>
                                <span style={{ opacity: 0.3 }}>|</span>
                                <span>{uploadProgressPercent}%</span>
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', maxWidth: 200 }}>
                                {uploadProgressStats} — {folderUploadProgress}
                            </div>
                        </div>
                    )}

                    {canUpload && (
                        <div style={{ display: 'flex', gap: 12 }}>
                            {/* Regular file upload */}
                            <input 
                                type="file" 
                                multiple 
                                style={{ display: 'none' }} 
                                ref={fileInputRef} 
                                onChange={(e) => handleInitiateUpload(e.target.files, 'files')} 
                            />
                            <button 
                                className="btn btn-secondary" 
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading || uploadingFolder}
                                title="Upload individual files to current folder"
                            >
                                <IconUpload /> {uploading ? 'Uploading...' : 'Upload Files'}
                            </button>

                            {/* Folder upload — only if we have a projectId context */}
                            {projectId && (
                                <>
                                    <input 
                                        type="file" 
                                        style={{ display: 'none' }} 
                                        ref={folderInputRef}
                                        // @ts-ignore — webkitdirectory is non-standard but widely supported
                                        webkitdirectory=""
                                        multiple
                                        onChange={(e) => handleInitiateUpload(e.target.files, 'folder')}
                                    />
                                    <button 
                                        className="btn btn-primary" 
                                        onClick={() => folderInputRef.current?.click()}
                                        disabled={uploading || uploadingFolder}
                                        title="Upload an entire transmittal folder. Structure is preserved on the server and drawings are auto-detected for extraction."
                                    >
                                        <IconUpload /> {uploadingFolder ? 'Uploading...' : '📁 Upload Folder'}
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Live Upload Session Dashboard */}
            {uploadSessionActive && (
                <div style={{
                    background: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-xl)',
                    padding: 24,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                    boxShadow: 'var(--shadow-sm)',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                                📁 Folder Upload & Processing: <span style={{ color: 'var(--color-primary)' }}>{sessionFolderName}</span>
                            </h4>
                            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
                                Live tracking status of file uploads and AI drawing metadata extractions.
                            </p>
                        </div>
                        <button 
                            className="btn btn-secondary btn-sm"
                            onClick={() => uploadSessionStore.dismissSession()}
                        >
                            Dismiss Dashboard
                        </button>
                    </div>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                        gap: 16,
                    }}>
                        {/* Column 1: Uploading & Stored */}
                        <div style={{
                            background: 'var(--color-bg-page)',
                            border: '1px solid var(--color-border-light)',
                            borderRadius: 'var(--radius-lg)',
                            padding: 16,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12,
                        }}>
                            <h5 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border-light)', paddingBottom: 8 }}>
                                📦 Stored Files ({sessionFiles.filter(f => f.status === 'stored' || f.status === 'uploading').length})
                            </h5>
                            <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
                                {sessionFiles.filter(f => f.status === 'stored' || f.status === 'uploading').length === 0 ? (
                                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: '12px 0' }}>No general files.</span>
                                ) : (
                                    sessionFiles.map((f, i) => {
                                        if (f.status !== 'stored' && f.status !== 'uploading') return null;
                                        return (
                                            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, background: 'var(--color-bg-card)', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--color-border-light)' }}>
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120, flex: 1 }} title={f.path}>{f.name}</span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    {f.status === 'uploading' ? (
                                                        <span style={{ color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                                                            <svg className="animate-spin" style={{ animation: 'spin 1s linear infinite', width: 10, height: 10 }} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" style={{ opacity: 0.25 }} /><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4" style={{ opacity: 0.75 }} /></svg>
                                                            Up...
                                                        </span>
                                                    ) : (
                                                        <>
                                                            <span style={{ color: 'var(--color-success-mid)', fontWeight: 600, fontSize: 11 }}>✅</span>
                                                            <button
                                                                onClick={() => { if (window.confirm(`Delete "${f.name}" from server?`)) uploadSessionStore.deleteSessionFile(i); }}
                                                                className="btn btn-ghost"
                                                                style={{ color: 'var(--color-danger-mid)', padding: '1px 4px', fontSize: 10, height: 'auto', minHeight: 0, background: 'transparent', border: 'none', cursor: 'pointer', opacity: 0.6 }}
                                                                title="Delete from server"
                                                            >🗑️</button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* Column 2: AI Drawing Extractions */}
                        <div style={{
                            background: 'var(--color-bg-page)',
                            border: '1px solid var(--color-border-light)',
                            borderRadius: 'var(--radius-lg)',
                            padding: 16,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12,
                        }}>
                            <h5 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border-light)', paddingBottom: 8 }}>
                                🤖 AI Extractions ({sessionFiles.filter(f => f.status === 'extracting' || f.status === 'completed').length})
                            </h5>
                            <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
                                {sessionFiles.filter(f => f.status === 'extracting' || f.status === 'completed').length === 0 ? (
                                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: '12px 0' }}>No drawings detected.</span>
                                ) : (
                                    sessionFiles.map((f, i) => {
                                        if (f.status !== 'extracting' && f.status !== 'completed') return null;
                                        return (
                                            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, background: 'var(--color-bg-card)', padding: '8px 10px', borderRadius: 4, border: '1px solid var(--color-border-light)' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100, flex: 1 }} title={f.name}>{f.name}</span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        {f.status === 'extracting' ? (
                                                            <span style={{
                                                                fontSize: 9,
                                                                fontWeight: 700,
                                                                color: 'var(--color-primary)',
                                                                background: 'rgba(37,99,235,0.08)',
                                                                padding: '2px 6px',
                                                                borderRadius: 4,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: 4
                                                            }}>
                                                                <svg className="animate-spin" style={{ animation: 'spin 1s linear infinite', width: 8, height: 8 }} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" style={{ opacity: 0.25 }} /><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4" style={{ opacity: 0.75 }} /></svg>
                                                                AI RUNNING
                                                            </span>
                                                        ) : (
                                                            <span style={{
                                                                fontSize: 9,
                                                                fontWeight: 700,
                                                                color: 'var(--color-success-mid)',
                                                                background: 'rgba(22,163,74,0.08)',
                                                                padding: '2px 6px',
                                                                borderRadius: 4
                                                            }}>
                                                                ✅ COMPLETE
                                                            </span>
                                                        )}
                                                        <button
                                                            onClick={() => { if (window.confirm(`Delete extraction for "${f.name}" from server?`)) uploadSessionStore.deleteSessionFile(i); }}
                                                            className="btn btn-ghost"
                                                            style={{ color: 'var(--color-danger-mid)', padding: '1px 4px', fontSize: 10, height: 'auto', minHeight: 0, background: 'transparent', border: 'none', cursor: 'pointer', opacity: 0.6 }}
                                                            title="Delete extraction from server"
                                                        >🗑️</button>
                                                    </div>
                                                </div>
                                                <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Target subfolder: {f.folder}</span>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* Column 3: Failed Files */}
                        <div style={{
                            background: 'var(--color-bg-page)',
                            border: '1px solid var(--color-border-light)',
                            borderRadius: 'var(--radius-lg)',
                            padding: 16,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12,
                        }}>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                borderBottom: '1px solid var(--color-border-light)',
                                paddingBottom: 8,
                                margin: 0
                            }}>
                                <h5 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                                    ❌ Failed ({sessionFiles.filter(f => f.status === 'failed').length})
                                </h5>
                                {sessionFiles.some(f => f.status === 'failed') && (
                                    session?.retryActive ? (
                                        <button
                                            onClick={() => uploadSessionStore.stopRetry()}
                                            className="btn btn-ghost"
                                            style={{
                                                color: 'var(--color-danger-mid)',
                                                padding: '2px 8px',
                                                fontSize: 10,
                                                height: 'auto',
                                                minHeight: 0,
                                                fontWeight: 700,
                                                background: 'var(--color-bg-card)',
                                                border: '1px solid var(--color-danger-mid)',
                                                borderRadius: 4
                                            }}
                                            title="Stop current retry process"
                                        >
                                            🛑 Stop Retry
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => uploadSessionStore.retryAllFailed(uploadFolder, sequences || [])}
                                            className="btn btn-ghost"
                                            style={{
                                                color: 'var(--color-primary)',
                                                padding: '2px 8px',
                                                fontSize: 10,
                                                height: 'auto',
                                                minHeight: 0,
                                                fontWeight: 700,
                                                background: 'var(--color-bg-card)',
                                                border: '1px solid var(--color-border-light)',
                                                borderRadius: 4
                                            }}
                                            title="Retry all failed files sequentially"
                                        >
                                            🔄 Retry All
                                        </button>
                                    )
                                )}
                            </div>
                            <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
                                {sessionFiles.filter(f => f.status === 'failed').length === 0 ? (
                                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: '12px 0' }}>No failures.</span>
                                ) : (
                                    sessionFiles.map((f, i) => {
                                        if (f.status !== 'failed') return null;
                                        return (
                                            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, background: 'rgba(239,68,68,0.02)', padding: '8px 10px', borderRadius: 4, border: '1px solid rgba(239,68,68,0.15)' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100, flex: 1 }} title={f.name}>{f.name}</span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <button
                                                            onClick={() => uploadSessionStore.retryFile(i, uploadFolder, sequences || [])}
                                                            className="btn btn-ghost"
                                                            style={{
                                                                color: 'var(--color-primary)',
                                                                padding: '2px 6px',
                                                                fontSize: 10,
                                                                height: 'auto',
                                                                minHeight: 0,
                                                                fontWeight: 700,
                                                                background: 'var(--color-bg-card)',
                                                                border: '1px solid var(--color-border-light)',
                                                                borderRadius: 4
                                                            }}
                                                            title="Retry uploading this file"
                                                        >
                                                            🔄 Retry
                                                        </button>
                                                        <button
                                                            onClick={() => uploadSessionStore.deleteSessionFile(i)}
                                                            className="btn btn-ghost"
                                                            style={{ color: 'var(--color-danger-mid)', padding: '1px 4px', fontSize: 10, height: 'auto', minHeight: 0, background: 'transparent', border: 'none', cursor: 'pointer', opacity: 0.6 }}
                                                            title="Remove from list"
                                                        >🗑️</button>
                                                    </div>
                                                </div>
                                                <span style={{ fontSize: 10, color: 'var(--color-danger-mid)', fontWeight: 500 }}>{f.error || 'Failed to upload/extract'}</span>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Error State */}
            {error && (
                <div className="info-box danger">
                    <strong>Error: </strong> {error}
                </div>
            )}

            {/* File List Area */}
            <div 
                className={`card ${isDragging ? 'drag-active' : ''}`}
                style={{ 
                    minHeight: 400,
                    border: isDragging ? '2px dashed var(--color-primary)' : '1px solid var(--color-border)',
                    background: isDragging ? 'rgba(37,99,235,0.03)' : 'var(--color-bg-card)',
                    position: 'relative'
                }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {loading && (
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                        <div className="spinner"></div>
                    </div>
                )}

                {/* Up Directory Row */}
                {currentPath !== basePath && (
                    <div 
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--color-border-light)', cursor: 'pointer', background: 'var(--color-bg-page)' }}
                        onClick={handleNavigateUp}
                    >
                        <div style={{ width: 24, display: 'flex', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M9 14l-4-4 4-4M5 10h11a4 4 0 110 8h-1"/></svg>
                        </div>
                        <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>.. (Up one level)</span>
                    </div>
                )}

                {/* Files Table */}
                <div className="table-wrapper" style={{ border: 'none', boxShadow: 'none' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: 'var(--color-bg-page)', borderBottom: '1px solid var(--color-border)' }}>
                                <th style={{ width: 40, padding: '12px 20px' }}></th>
                                <th style={{ padding: '12px 20px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Name</th>
                                <th style={{ padding: '12px 20px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', width: 140 }}>Revised By</th>
                                <th style={{ padding: '12px 20px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', width: 150 }}>Modified</th>
                                <th style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 600, color: 'var(--color-text-secondary)', width: 120 }}>Size</th>
                                <th style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 600, color: 'var(--color-text-secondary)', width: 100 }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {!loading && files.length === 0 && !error && (
                                <tr>
                                    <td colSpan={6} className="table-empty" style={{ padding: 60 }}>
                                        {canUpload ? (
                                            <>
                                                <div style={{ color: 'var(--color-text-muted)', marginBottom: 12 }}>This folder is empty.</div>
                                                <div style={{ fontSize: 13 }}>Drag and drop files here to upload.</div>
                                            </>
                                        ) : (
                                            <div style={{ color: 'var(--color-text-muted)' }}>This folder is empty.</div>
                                        )}
                                    </td>
                                </tr>
                            )}

                            {files
                                .filter((file) => {
                                    if (sequenceFilter === 'ALL') return true;
                                    if (file.type === 'directory') return true;
                                    const searchKey = sequenceFilter.toLowerCase().replace(/[^a-z0-9]/g, '');
                                    const fileKey = file.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                                    return fileKey.includes(searchKey);
                                })
                                .map((file, idx) => (
                                <tr key={idx} style={{ borderBottom: '1px solid var(--color-border-light)' }} className="table-row-hover">
                                    <td style={{ padding: '12px 20px', color: file.type === 'directory' ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                                        {file.type === 'directory' ? <IconFolder /> : <IconFile />}
                                    </td>
                                    <td style={{ padding: '12px 20px' }}>
                                        {file.type === 'directory' ? (
                                            <span 
                                                style={{ fontWeight: 600, color: 'var(--color-primary)', cursor: 'pointer' }}
                                                onClick={() => handleFolderClick(file.name)}
                                            >
                                                {file.name}
                                            </span>
                                        ) : (
                                            <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{file.name}</span>
                                        )}
                                    </td>
                                    <td style={{ padding: '12px 20px', color: 'var(--color-text-secondary)', fontSize: 13 }}>
                                        {file.type === 'directory' ? '-' : ((file as any).uploadedBy || 'admin')}
                                    </td>
                                    <td style={{ padding: '12px 20px', color: 'var(--color-text-muted)', fontSize: 13 }}>
                                        {formatDate(file.modified)}
                                    </td>
                                    <td style={{ padding: '12px 20px', textAlign: 'right', color: 'var(--color-text-muted)', fontSize: 13, fontFamily: 'monospace' }}>
                                        {file.type === 'directory' ? '-' : formatBytes(file.size)}
                                    </td>
                                    <td style={{ padding: '12px 20px', textAlign: 'right' }}>
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                            {file.type !== 'directory' && (
                                                <button 
                                                    className="btn btn-ghost btn-sm btn-icon" 
                                                    onClick={() => handleDownload(file.name)}
                                                    title="Download"
                                                >
                                                    <IconDownload />
                                                </button>
                                            )}
                                            {canUpload && (
                                                <button 
                                                    className="btn btn-ghost btn-sm btn-icon" 
                                                    style={{ color: 'var(--color-danger-mid)' }}
                                                    onClick={() => handleDelete(file.name)}
                                                    title={file.type === 'directory' ? "Delete Folder" : "Delete"}
                                                >
                                                    <IconTrash />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Custom Animation Styles */}
            <style dangerouslySetInnerHTML={{__html: `
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}} />



            {/* Folder Upload Complete / Details Modal */}
            {uploadResultModal && uploadResultDetails && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(15, 23, 42, 0.65)',
                    backdropFilter: 'blur(8px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                    padding: 24,
                }}>
                    <div style={{
                        background: 'var(--color-bg-card)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-xl)',
                        width: '100%',
                        maxWidth: 800,
                        maxHeight: '90vh',
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                        overflow: 'hidden',
                    }}>
                        {/* Modal Header */}
                        <div style={{
                            padding: '20px 24px',
                            borderBottom: '1px solid var(--color-border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: 'linear-gradient(to right, rgba(37,99,235,0.05), rgba(37,99,235,0.01))',
                        }}>
                            <div>
                                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--color-text-primary)' }}>
                                    Folder Upload Report
                                </h3>
                                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>
                                    {uploadResultDetails.storedCount} files stored, {uploadResultDetails.drawingsQueued} drawings queued.
                                    {uploadResultDetails.transmittalNumber && ` Linked to Transmittal #${uploadResultDetails.transmittalNumber}.`}
                                </p>
                            </div>
                            <button 
                                onClick={() => uploadSessionStore.setResultModalOpen(false)}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}
                            >
                                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                        </div>

                        {/* Tabs Selector */}
                        <div style={{
                            display: 'flex',
                            borderBottom: '1px solid var(--color-border-light)',
                            padding: '0 16px',
                            background: 'var(--color-bg-page)',
                        }}>
                            <button
                                onClick={() => setActiveReportTab('drawings')}
                                style={{
                                    padding: '14px 16px',
                                    border: 'none',
                                    background: 'transparent',
                                    fontWeight: 600,
                                    fontSize: 13,
                                    color: activeReportTab === 'drawings' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                    borderBottom: activeReportTab === 'drawings' ? '2px solid var(--color-primary)' : '2px solid transparent',
                                    cursor: 'pointer',
                                }}
                            >
                                🤖 Queued Drawings ({uploadResultDetails.drawingsQueued})
                            </button>
                            <button
                                onClick={() => setActiveReportTab('stored')}
                                style={{
                                    padding: '14px 16px',
                                    border: 'none',
                                    background: 'transparent',
                                    fontWeight: 600,
                                    fontSize: 13,
                                    color: activeReportTab === 'stored' ? 'var(--color-success-mid)' : 'var(--color-text-secondary)',
                                    borderBottom: activeReportTab === 'stored' ? '2px solid var(--color-success-mid)' : '2px solid transparent',
                                    cursor: 'pointer',
                                }}
                            >
                                ✅ Stored Files ({uploadResultDetails.storedCount - uploadResultDetails.failedCount})
                            </button>
                            {uploadResultDetails.failedCount > 0 && (
                                <button
                                    onClick={() => setActiveReportTab('failed')}
                                    style={{
                                        padding: '14px 16px',
                                        border: 'none',
                                        background: 'transparent',
                                        fontWeight: 600,
                                        fontSize: 13,
                                        color: 'var(--color-danger-mid)',
                                        borderBottom: activeReportTab === 'failed' ? '2px solid ' + 'var(--color-danger-mid)' : '2px solid transparent',
                                        cursor: 'pointer',
                                    }}
                                >
                                    ❌ Failed Uploads ({uploadResultDetails.failedCount})
                                </button>
                            )}
                        </div>

                        {/* List Body */}
                        <div style={{
                            flex: 1,
                            overflowY: 'auto',
                            padding: 24,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12,
                        }}>
                            {activeReportTab === 'drawings' && (
                                <>
                                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>
                                        The system detected these files inside your upload as valid PDF drawings and sent them to the AI pipeline for field extraction.
                                    </div>
                                    {(!uploadResultDetails.drawings || uploadResultDetails.drawings.length === 0) ? (
                                        <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '24px 0' }}>
                                            No drawings detected in this upload.
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            {uploadResultDetails.drawings.map((dwg: any, i: number) => (
                                                <div key={i} style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    padding: '12px 16px',
                                                    background: 'var(--color-bg-page)',
                                                    border: '1px solid var(--color-border)',
                                                    borderRadius: 'var(--radius-md)',
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="var(--color-primary)" strokeWidth="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                                        <div>
                                                            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>{dwg.name}</div>
                                                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Target subfolder: {dwg.folder}</div>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <span style={{
                                                            fontSize: 10,
                                                            fontWeight: 700,
                                                            color: 'var(--color-primary)',
                                                            background: 'rgba(37,99,235,0.08)',
                                                            padding: '2px 8px',
                                                            borderRadius: 99,
                                                        }}>QUEUED FOR AI</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}

                            {activeReportTab === 'stored' && (
                                <>
                                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>
                                        All files successfully uploaded to the Windows storage drive.
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {uploadResultDetails.results
                                            ?.filter((r: any) => r.status === 'stored')
                                            .map((r: any, i: number) => (
                                                <div key={i} style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    padding: '10px 14px',
                                                    background: 'var(--color-bg-page)',
                                                    border: '1px solid var(--color-border-light)',
                                                    borderRadius: 'var(--radius-sm)',
                                                    gap: 12,
                                                }}>
                                                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--color-success-mid)" strokeWidth="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                                                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Path: {r.path}</div>
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                </>
                            )}

                            {activeReportTab === 'failed' && (
                                <>
                                    <div style={{ fontSize: 13, color: 'var(--color-danger-mid)', marginBottom: 8, fontWeight: 500 }}>
                                        These files encountered errors and could not be uploaded or stored.
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {uploadResultDetails.results
                                            ?.filter((r: any) => r.status === 'failed')
                                            .map((r: any, i: number) => (
                                                <div key={i} style={{
                                                    display: 'flex',
                                                    alignItems: 'flex-start',
                                                    padding: '12px 16px',
                                                    background: 'rgba(239,68,68,0.02)',
                                                    border: '1px solid rgba(239,68,68,0.15)',
                                                    borderRadius: 'var(--radius-md)',
                                                    gap: 12,
                                                }}>
                                                    <svg viewBox="0 0 24 24" width="18" height="18" stroke="var(--color-danger-mid)" strokeWidth="2" fill="none" style={{ marginTop: 2 }}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>{r.name}</div>
                                                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '2px 0 6px 0' }}>Path: {r.path}</div>
                                                        <div style={{ fontSize: 12, color: 'var(--color-danger-mid)', fontWeight: 500 }}>Error: {r.error || 'Upload error'}</div>
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div style={{
                            padding: '16px 24px',
                            borderTop: '1px solid var(--color-border)',
                            background: 'var(--color-bg-page)',
                            display: 'flex',
                            justifyContent: 'flex-end',
                        }}>
                            <button 
                                onClick={() => uploadSessionStore.setResultModalOpen(false)}
                                className="btn btn-primary"
                                style={{ minWidth: 100 }}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Upload Options & Mandatory Constraints Modal */}
            {uploadModalOpen && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 9999,
                    background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
                }}>
                    <div style={{
                        background: '#ffffff', borderRadius: 16, width: '100%', maxWidth: 520,
                        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', border: '1px solid #e2e8f0',
                        overflow: 'hidden', display: 'flex', flexDirection: 'column'
                    }}>
                        {/* Header */}
                        <div style={{
                            padding: '20px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                        }}>
                            <div>
                                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0f172a' }}>
                                    Configure Upload & Transmittal
                                </h3>
                                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
                                    Set mandatory metadata for this drawing batch
                                </p>
                            </div>
                            <button
                                onClick={() => setUploadModalOpen(false)}
                                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8' }}
                            >
                                ✕
                            </button>
                        </div>

                        {/* Body */}
                        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
                            
                            {/* 1. Transmittal Choice (Mandatory) */}
                            <div>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 8 }}>
                                    Transmittal Assignment <span style={{ color: '#ef4444' }}>*</span>
                                </label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <label style={{
                                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                                        borderRadius: 8, border: transmittalChoice === 'new' ? '2px solid var(--color-primary)' : '1px solid #cbd5e1',
                                        background: transmittalChoice === 'new' ? '#eff6ff' : '#ffffff', cursor: 'pointer'
                                    }}>
                                        <input
                                            type="radio"
                                            name="transmittalChoice"
                                            value="new"
                                            checked={transmittalChoice === 'new'}
                                            onChange={() => setTransmittalChoice('new')}
                                        />
                                        <div>
                                            <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>Create New Transmittal</span>
                                            <span style={{ display: 'block', fontSize: 12, color: '#64748b' }}>Automatically generates the next sequential transmittal number</span>
                                        </div>
                                    </label>

                                    <label style={{
                                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                                        borderRadius: 8, border: transmittalChoice === 'existing' ? '2px solid var(--color-primary)' : '1px solid #cbd5e1',
                                        background: transmittalChoice === 'existing' ? '#eff6ff' : '#ffffff', cursor: 'pointer'
                                    }}>
                                        <input
                                            type="radio"
                                            name="transmittalChoice"
                                            value="existing"
                                            checked={transmittalChoice === 'existing'}
                                            onChange={() => setTransmittalChoice('existing')}
                                        />
                                        <div>
                                            <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>Append to Existing Transmittal</span>
                                            <span style={{ display: 'block', fontSize: 12, color: '#64748b' }}>Add drawings into an existing transmittal batch</span>
                                        </div>
                                    </label>
                                </div>

                                {transmittalChoice === 'existing' && (
                                    <div style={{ marginTop: 12, paddingLeft: 8 }}>
                                        {loadingTransmittals ? (
                                            <span style={{ fontSize: 12, color: '#64748b' }}>Loading project transmittals...</span>
                                        ) : existingTransmittals.length === 0 ? (
                                            <span style={{ fontSize: 12, color: '#ef4444' }}>No existing transmittals found for this project. Select 'Create New'.</span>
                                        ) : (
                                            <select
                                                value={selectedTransmittalNum || ''}
                                                onChange={(e) => setSelectedTransmittalNum(Number(e.target.value))}
                                                style={{
                                                    width: '100%', padding: '8px 12px', borderRadius: 6,
                                                    border: '1px solid #cbd5e1', fontSize: 13, fontWeight: 600, color: '#0f172a'
                                                }}
                                            >
                                                {existingTransmittals.map(t => (
                                                    <option key={t._id} value={t.transmittalNumber}>
                                                        TR-{String(t.transmittalNumber).padStart(3, '0')} ({(t.newCount != null ? t.newCount : (t.drawings ? t.drawings.length : 0))} drawings)
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* 2. Upload Purpose (Mandatory - Radio Buttons) */}
                            <div>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 8 }}>
                                    Upload Purpose <span style={{ color: '#ef4444' }}>*</span>
                                </label>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                    <label style={{
                                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                                        borderRadius: 8, border: uploadPurpose === 'Fabrication' ? '2px solid var(--color-primary)' : '1px solid #cbd5e1',
                                        background: uploadPurpose === 'Fabrication' ? '#eff6ff' : '#ffffff', cursor: 'pointer'
                                    }}>
                                        <input
                                            type="radio"
                                            name="uploadPurpose"
                                            value="Fabrication"
                                            checked={uploadPurpose === 'Fabrication'}
                                            onChange={() => setUploadPurpose('Fabrication')}
                                        />
                                        <div>
                                            <span style={{ fontWeight: 700, fontSize: 13.5, color: '#0f172a' }}>Fabrication</span>
                                            <span style={{ display: 'block', fontSize: 11.5, color: '#64748b' }}>Increments Fab count</span>
                                        </div>
                                    </label>

                                    <label style={{
                                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                                        borderRadius: 8, border: uploadPurpose === 'Approval' ? '2px solid var(--color-primary)' : '1px solid #cbd5e1',
                                        background: uploadPurpose === 'Approval' ? '#eff6ff' : '#ffffff', cursor: 'pointer'
                                    }}>
                                        <input
                                            type="radio"
                                            name="uploadPurpose"
                                            value="Approval"
                                            checked={uploadPurpose === 'Approval'}
                                            onChange={() => setUploadPurpose('Approval')}
                                        />
                                        <div>
                                            <span style={{ fontWeight: 700, fontSize: 13.5, color: '#0f172a' }}>Approval</span>
                                            <span style={{ display: 'block', fontSize: 11.5, color: '#64748b' }}>Increments App count</span>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            {/* 3. Sequence Tagging (Mandatory) */}
                            <div>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 8 }}>
                                    Sequence <span style={{ color: '#ef4444' }}>*</span>
                                </label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {((sequences && sequences.length > 0) ? sequences : ['Seq 1']).map((seq) => {
                                        const isSelected = selectedUploadSequences.includes(seq);
                                        return (
                                            <button
                                                key={seq}
                                                type="button"
                                                onClick={() => {
                                                    if (isSelected) {
                                                        if (selectedUploadSequences.length > 1) {
                                                            setSelectedUploadSequences(selectedUploadSequences.filter(s => s !== seq));
                                                        }
                                                    } else {
                                                        setSelectedUploadSequences([...selectedUploadSequences, seq]);
                                                    }
                                                }}
                                                style={{
                                                    padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                                                    cursor: 'pointer', transition: 'all 0.15s ease',
                                                    border: isSelected ? '2px solid var(--color-primary)' : '1px solid #cbd5e1',
                                                    background: isSelected ? 'var(--color-primary)' : '#ffffff',
                                                    color: isSelected ? '#ffffff' : '#475569'
                                                }}
                                            >
                                                {isSelected ? '✓ ' : ''}{seq}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div style={{
                            padding: '16px 24px', background: '#f8fafc', borderTop: '1px solid #e2e8f0',
                            display: 'flex', justifyContent: 'flex-end', gap: 12
                        }}>
                            <button
                                className="btn btn-secondary"
                                onClick={() => setUploadModalOpen(false)}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleConfirmUpload}
                                disabled={selectedUploadSequences.length === 0 || (transmittalChoice === 'existing' && !selectedTransmittalNum)}
                            >
                                Start Upload
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
