/**
 * Formats a given date (string or Date object) into MM-DD-YYYY format.
 */
let globalDateFormat = 'MM-DD-YYYY';

export const setGlobalDateFormat = (format: string) => {
    if (format) globalDateFormat = format;
};

export const formatDate = (dateInput: string | Date | undefined | null): string => {
    if (!dateInput) return 'N/A';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return 'N/A';

    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();

    const fmt = globalDateFormat.toUpperCase();
    if (fmt === 'DD/MM/YYYY') return `${dd}/${mm}/${yyyy}`;
    if (fmt === 'YYYY-MM-DD') return `${yyyy}-${mm}-${dd}`;
    if (fmt === 'MM/DD/YYYY') return `${mm}/${dd}/${yyyy}`;
    
    // fallback to original hardcoded request if somehow missing
    return `${mm}-${dd}-${yyyy}`;
};

/**
 * Resolves the genuine application creation date of a project,
 * recovering from MongoDB _id if createdAt was corrupted with project start date.
 */
export const getProjectAppCreationDate = (project: any): string | null => {
    if (!project) return null;

    const startDateStr = project.projectStartDate ? new Date(project.projectStartDate).toISOString().split('T')[0] : '';
    const createdAtStr = project.createdAt ? new Date(project.createdAt).toISOString().split('T')[0] : '';
    const creationDateStr = project.creationDate ? String(project.creationDate).split('T')[0] : '';

    // If createdAt exists and doesn't match startDate, it's valid
    if (project.createdAt && (!startDateStr || createdAtStr !== startDateStr)) {
        return project.createdAt;
    }

    // If creationDate exists and doesn't match startDate, it's valid
    if (project.creationDate && (!startDateStr || creationDateStr !== startDateStr)) {
        return project.creationDate;
    }

    // Recover from MongoDB 24-hex ObjectId
    const rawId = String(project._id || project.id || '');
    if (/^[0-9a-fA-F]{24}$/.test(rawId)) {
        try {
            const timestamp = parseInt(rawId.substring(0, 8), 16) * 1000;
            const idDate = new Date(timestamp);
            if (!isNaN(idDate.getTime()) && idDate.getFullYear() >= 2020) {
                return idDate.toISOString();
            }
        } catch (e) {}
    }

    return project.createdAt || project.creationDate || null;
};
