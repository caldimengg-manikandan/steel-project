import { listExtractions, deleteExtraction } from './extractionApi';

export interface SessionFile {
    name: string;
    path: string;
    size: number;
    status: 'uploading' | 'stored' | 'extracting' | 'completed' | 'failed';
    error?: string;
    folder?: string;
    extractionId?: string;
}

export interface UploadSession {
    projectId: string;
    folderName: string;
    files: SessionFile[];
    rawFiles: File[];
    active: boolean;
    uploading: boolean;
    progressPercent: number;
    progressSpeed: string;
    progressStats: string;
    progressDetail: string;
    resultDetails?: any;
    resultModalOpen: boolean;
}

let currentSession: UploadSession | null = null;
let listeners: Array<(session: UploadSession | null) => void> = [];
let pollingInterval: any = null;

function notify() {
    listeners.forEach(l => l(currentSession ? { ...currentSession } : null));
}

export const uploadSessionStore = {
    getSession(): UploadSession | null {
        return currentSession;
    },
    
    startSession(projectId: string, folderName: string, files: SessionFile[], rawFiles: File[]) {
        this.clearPolling();
        currentSession = {
            projectId,
            folderName,
            files,
            rawFiles,
            active: true,
            uploading: true,
            progressPercent: 0,
            progressSpeed: '0 KB/s',
            progressStats: '0 B / 0 B',
            progressDetail: 'Scanning...',
            resultModalOpen: false,
        };
        notify();
    },

    async retryFile(index: number, uploadFolderFn: any, sequences: string[]) {
        if (!currentSession) return;
        const file = currentSession.files[index];
        const rawFile = currentSession.rawFiles[index];
        if (!rawFile) return;

        // Set status to uploading and clear errors
        currentSession.files[index] = {
            ...file,
            status: 'uploading',
            error: undefined
        };
        notify();

        try {
            const result = await uploadFolderFn(
                currentSession.projectId,
                [rawFile],
                currentSession.resultDetails?.transmittalNumber || null,
                sequences,
                (prog: any) => {
                    let speedStr = '0 B/s';
                    if (prog.speed > 1024 * 1024) {
                        speedStr = `${(prog.speed / (1024 * 1024)).toFixed(1)} MB/s`;
                    } else if (prog.speed > 1024) {
                        speedStr = `${(prog.speed / 1024).toFixed(1)} KB/s`;
                    } else {
                        speedStr = `${Math.round(prog.speed)} B/s`;
                    }
                    this.updateProgress(
                        currentSession?.progressPercent || 0,
                        speedStr,
                        currentSession?.progressStats || '',
                        `Retrying: ${rawFile.name}`
                    );
                }
            );

            // Update this file status based on the single file result
            const resMatch = result.results?.find((r: any) => r.path === rawFile.name || r.name === rawFile.name || r.path?.endsWith(rawFile.name));
            if (!resMatch || resMatch.status === 'failed') {
                currentSession.files[index] = {
                    ...file,
                    status: 'failed',
                    error: resMatch?.error || 'Upload failed on storage agent'
                };
            } else {
                const drawingMatch = result.drawings?.find((d: any) => d.name === rawFile.name);
                if (drawingMatch) {
                    currentSession.files[index] = {
                        ...file,
                        status: 'extracting',
                        folder: drawingMatch.folder,
                        extractionId: drawingMatch.id
                    };
                } else {
                    currentSession.files[index] = {
                        ...file,
                        status: 'stored'
                    };
                }
            }
            notify();

            // If it is now extracting, trigger polling
            if (currentSession.files[index].status === 'extracting') {
                this.startExtractionPolling();
            }
        } catch (err: any) {
            console.error(`[UploadSessionStore] Retry failed for ${rawFile.name}:`, err.message);
            currentSession.files[index] = {
                ...file,
                status: 'failed',
                error: err.message || 'Upload error'
            };
            notify();
        }
    },

    async retryAllFailed(uploadFolderFn: any, sequences: string[]) {
        if (!currentSession) return;
        const failedIndices: number[] = [];
        currentSession.files.forEach((f, idx) => {
            if (f.status === 'failed') failedIndices.push(idx);
        });

        for (const index of failedIndices) {
            await this.retryFile(index, uploadFolderFn, sequences);
        }
    },

    updateProgress(percent: number, speed: string, stats: string, detail: string) {
        if (currentSession) {
            currentSession.progressPercent = percent;
            currentSession.progressSpeed = speed;
            currentSession.progressStats = stats;
            currentSession.progressDetail = detail;
            notify();
        }
    },

    updateFileStatus(index: number, updates: Partial<SessionFile>) {
        if (currentSession && currentSession.files[index]) {
            currentSession.files[index] = { ...currentSession.files[index], ...updates };
            notify();
        }
    },

    setUploadingFinished(resultDetails: any, updatedFiles: SessionFile[]) {
        if (currentSession) {
            currentSession.uploading = false;
            currentSession.files = updatedFiles;
            currentSession.resultDetails = resultDetails;
            currentSession.resultModalOpen = true;
            notify();

            // Start global background polling for AI extractions
            this.startExtractionPolling();
        }
    },

    setResultModalOpen(open: boolean) {
        if (currentSession) {
            currentSession.resultModalOpen = open;
            notify();
        }
    },

    dismissSession() {
        this.clearPolling();
        currentSession = null;
        notify();
    },

    async deleteSessionFile(index: number) {
        if (!currentSession) return;
        const file = currentSession.files[index];
        if (!file) return;

        // If this file has an extraction record, delete it from the server
        if (file.extractionId && currentSession.projectId) {
            try {
                await deleteExtraction(currentSession.projectId, file.extractionId);
                console.log(`[UploadSessionStore] Deleted extraction ${file.extractionId} from server`);
            } catch (err: any) {
                console.error(`[UploadSessionStore] Failed to delete extraction from server:`, err.message);
            }
        }

        // Remove the file from the session
        currentSession.files = currentSession.files.filter((_, i) => i !== index);
        currentSession.rawFiles = currentSession.rawFiles.filter((_, i) => i !== index);

        // If no files left, dismiss the whole session
        if (currentSession.files.length === 0) {
            this.dismissSession();
            return;
        }

        notify();
    },

    startExtractionPolling() {
        this.clearPolling();
        if (!currentSession) return;

        const projectId = currentSession.projectId;
        const checkStatus = async () => {
            if (!currentSession) {
                this.clearPolling();
                return;
            }

            try {
                const { extractions } = await listExtractions(projectId);
                if (!currentSession) return;

                let changes = false;
                const nextFiles = currentSession.files.map((sf): SessionFile => {
                    if (sf.status !== 'extracting' || !sf.extractionId) return sf;

                    const matched = extractions.find(ex => 
                        ex._id === sf.extractionId || 
                        ex.id === sf.extractionId ||
                        (ex.originalFileName && ex.originalFileName.toLowerCase() === sf.name.toLowerCase())
                    );
                    if (matched) {
                        if (matched.status === 'completed') {
                            changes = true;
                            return { ...sf, status: 'completed' };
                        } else if (matched.status === 'failed') {
                            changes = true;
                            return { ...sf, status: 'failed', error: matched.errorMessage || 'AI extraction failed' };
                        }
                    }
                    return sf;
                });

                if (changes && currentSession) {
                    currentSession.files = nextFiles;
                    notify();

                    const stillExtracting = nextFiles.some(f => f.status === 'extracting');
                    if (!stillExtracting) {
                        this.clearPolling();
                    }
                }
            } catch (err) {
                console.error('[UploadSessionStore] Polling failed:', err);
            }
        };

        // Poll immediately and then every 3 seconds
        checkStatus();
        pollingInterval = setInterval(checkStatus, 3000);
    },

    clearPolling() {
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
    },

    subscribe(listener: (session: UploadSession | null) => void) {
        listeners.push(listener);
        // Call listener immediately with current state
        listener(currentSession ? { ...currentSession } : null);
        return () => {
            listeners = listeners.filter(l => l !== listener);
        };
    }
};
