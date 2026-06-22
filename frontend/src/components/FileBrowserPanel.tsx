import { useState, useEffect, useRef } from 'react';
import { 
    browseFiles, 
    uploadFiles, 
    deleteFile, 
    downloadFile,
    type FileEntry 
} from '../services/fileApi';
import { useMessage } from '../context/MessageContext';
import { 
    IconFolder, 
    IconFile, 
    IconDownload, 
    IconTrash, 
    IconUpload, 
    IconSearch 
} from './Icons';

interface FileBrowserPanelProps {
    projectId?: string;
    projectName?: string;
    canUpload: boolean;
}

export default function FileBrowserPanel({ projectId, projectName, canUpload }: FileBrowserPanelProps) {
    const { showMessage } = useMessage();
    
    // Determine the base path based on whether a project was passed
    const basePath = projectName ? `Projects/${projectName.replace(/[^a-zA-Z0-9 _-]/g, '_')}` : '';

    const [currentPath, setCurrentPath] = useState<string>(basePath);
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');
    const [uploading, setUploading] = useState<boolean>(false);
    
    // Drag & Drop state
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
    const formatBytes = (bytes: number | undefined) => {
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
        // Only show parts relative to basePath if scoped? 
        // Actually, let's just show the full path to make it clear where they are on the drive.
        const parts = currentPath ? currentPath.split('/') : [];
        let runningPath = '';

        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)', overflowX: 'auto', paddingBottom: 4 }}>
                <span 
                    style={{ cursor: basePath ? 'default' : 'pointer', color: (!basePath && !currentPath) ? 'var(--color-text-primary)' : 'var(--color-primary)' }}
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
                        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ color: 'var(--color-text-muted)' }}>/</span>
                            <span 
                                style={{ 
                                    cursor: (isClickable && !isLast) ? 'pointer' : 'default', 
                                    color: isLast ? 'var(--color-text-primary)' : (isClickable ? 'var(--color-primary)' : 'var(--color-text-muted)'),
                                    textDecoration: (isClickable && !isLast) ? 'underline' : 'none'
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

    const handleFileUpload = async (filesToUpload: FileList | null) => {
        if (!filesToUpload || filesToUpload.length === 0) return;
        if (!canUpload) {
            showMessage('Access Denied', 'You do not have permission to upload files.', 'error');
            return;
        }

        const fileArray = Array.from(filesToUpload);
        setUploading(true);
        try {
            const res = await uploadFiles(fileArray, currentPath);
            showMessage('Upload Success', res.message, 'success');
            loadFiles(currentPath);
        } catch (err: any) {
            showMessage('Upload Failed', err.message, 'error');
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
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
            handleFileUpload(e.dataTransfer.files);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Header / Actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'var(--color-bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                {renderBreadcrumbs()}

                <div style={{ display: 'flex', gap: 12 }}>
                    {canUpload && (
                        <>
                            <input 
                                type="file" 
                                multiple 
                                style={{ display: 'none' }} 
                                ref={fileInputRef} 
                                onChange={(e) => handleFileUpload(e.target.files)} 
                            />
                            <button 
                                className="btn btn-primary" 
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                            >
                                <IconUpload /> {uploading ? 'Uploading...' : 'Upload Files'}
                            </button>
                        </>
                    )}
                </div>
            </div>

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
                                <th style={{ padding: '12px 20px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', width: 150 }}>Modified</th>
                                <th style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 600, color: 'var(--color-text-secondary)', width: 120 }}>Size</th>
                                <th style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 600, color: 'var(--color-text-secondary)', width: 100 }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {!loading && files.length === 0 && !error && (
                                <tr>
                                    <td colSpan={5} className="table-empty" style={{ padding: 60 }}>
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

                            {files.map((file, idx) => (
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
                                            {canUpload && file.type !== 'directory' && (
                                                <button 
                                                    className="btn btn-ghost btn-sm btn-icon" 
                                                    style={{ color: 'var(--color-danger-mid)' }}
                                                    onClick={() => handleDelete(file.name)}
                                                    title="Delete"
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
        </div>
    );
}
