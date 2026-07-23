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
