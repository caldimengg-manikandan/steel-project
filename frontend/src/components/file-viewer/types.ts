// ============================================================
// File Viewer Types & Interfaces
// ============================================================

export type FileType =
    | 'pdf'
    | 'docx'
    | 'xlsx'
    | 'csv'
    | 'txt'
    | 'pptx'
    | 'image'
    | 'video'
    | 'audio'
    | 'unsupported';

export interface FileViewerFile {
    id?: string;
    filename: string;
    url: string;
    contentType?: string;
    sizeBytes?: number;
}

export interface FileViewerProps {
    file: FileViewerFile | null;
    files?: FileViewerFile[];
    onClose: () => void;
    onFileChange?: (file: FileViewerFile) => void;
}

export interface SubViewerProps {
    file: FileViewerFile;
    fileBuffer?: ArrayBuffer | null;
    fileBlobUrl?: string | null;
    zoom: number;
    onZoomChange: (newZoom: number) => void;
    fitMode: 'custom' | 'width' | 'screen';
    onFitModeChange: (mode: 'custom' | 'width' | 'screen') => void;
    isFullscreen: boolean;
    onToggleFullscreen: () => void;
    // PDF specifics
    pageNumber?: number;
    numPages?: number;
    onPageChange?: (page: number) => void;
    onNumPagesLoaded?: (total: number) => void;
    requestedPage?: { page: number; timestamp: number } | null;
    isTwoPageView?: boolean;
    onToggleTwoPageView?: () => void;
    isPanMode?: boolean;
    onTogglePanMode?: () => void;
    // PPT specifics
    slideNumber?: number;
    numSlides?: number;
    onSlideChange?: (slide: number) => void;
    onNumSlidesLoaded?: (total: number) => void;
    // Spreadsheet specifics
    sheets?: string[];
    activeSheet?: string;
    onSheetChange?: (sheet: string) => void;
    onSheetsLoaded?: (sheets: string[], defaultSheet: string) => void;
    // CSV specifics
    searchQuery?: string;
    onSearchQueryChange?: (q: string) => void;
    // Image specifics
    rotation?: number;
    onRotate?: () => void;
    onFitZoomComputed?: (fitZoom: number) => void;
}
