const fetch = require('isomorphic-fetch');

// Simple in-memory cache with stale-while-revalidate to prevent blocking the app
let cache = { data: null, lastFetched: 0, isFetching: false };
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch project details and count from external App A APIs.
 */
async function getExternalProjects() {
    const projectsUrl = process.env.APP_A_PROJECTS_URL;
    const countUrl = process.env.APP_A_API_URL;

    if (!projectsUrl) {
        return { count: 0, projects: [], error: 'External API URL is not configured' };
    }

    // STALE-WHILE-REVALIDATE: If we have ANY data, return it immediately to make UI instant.
    // Trigger background fetch if TTL expired and not already fetching.
    if (cache.data) {
        if (Date.now() - cache.lastFetched > CACHE_TTL && !cache.isFetching) {
            fetchAndCache(projectsUrl, countUrl).catch(console.error);
        }
        return cache.data;
    }

    // If no data exists at all, we must wait for the first fetch (with a timeout)
    return await fetchAndCache(projectsUrl, countUrl);
}

async function fetchAndCache(projectsUrl, countUrl) {
    if (cache.isFetching) return cache.data || { count: 0, projects: [] };
    cache.isFetching = true;

    const headers = {};
    if (process.env.APP_A_API_KEY) {
        headers['x-api-key'] = process.env.APP_A_API_KEY;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000); // 3 seconds timeout

        // Fetch projects list first
        const projectsRes = await fetch(projectsUrl, { headers, signal: controller.signal });
        clearTimeout(timeout);
        if (!projectsRes.ok) {
            throw new Error(`Projects API failed with status ${projectsRes.status}`);
        }
        const projectsData = await projectsRes.json();

        // Extract list of projects safely
        let rawProjects = [];
        let totalItemsFromList = 0;
        if (Array.isArray(projectsData)) {
            rawProjects = projectsData;
            totalItemsFromList = projectsData.length;
        } else if (projectsData) {
            if (Array.isArray(projectsData.data)) {
                rawProjects = projectsData.data;
            } else if (Array.isArray(projectsData.projects)) {
                rawProjects = projectsData.projects;
            }
            totalItemsFromList = projectsData.totalItems ?? projectsData.count ?? projectsData.total ?? rawProjects.length;
        }

        // Fetch total count from countUrl if available (graceful fallback if it fails)
        let totalCount = totalItemsFromList;
        if (countUrl) {
            try {
                const countController = new AbortController();
                const countTimeout = setTimeout(() => countController.abort(), 3000);
                const countRes = await fetch(countUrl, { headers, signal: countController.signal });
                clearTimeout(countTimeout);
                if (countRes.ok) {
                    const countData = await countRes.json();
                    if (typeof countData === 'number') {
                        totalCount = countData;
                    } else if (countData) {
                        totalCount = countData.count ?? countData.total ?? countData.totalCount ?? totalItemsFromList;
                    }
                } else {
                    console.warn(`[ExternalProjectService] Count API returned status ${countRes.status}. Using list total.`);
                }
            } catch (countErr) {
                console.warn('[ExternalProjectService] Count API failed, falling back to list total:', countErr.message);
            }
        }

        // Normalize external projects into a standard schema structure
        const projects = rawProjects.map((p, index) => {
            // Map external status values to local options ('active', 'on_hold', 'completed', 'archived')
            let mappedStatus = 'active';
            const rawStatus = (p.projectStatus || p.status || '').toLowerCase();
            if (rawStatus.includes('complete') || rawStatus.includes('finish')) {
                mappedStatus = 'completed';
            } else if (rawStatus.includes('hold') || rawStatus.includes('pause') || rawStatus.includes('stop')) {
                mappedStatus = 'on_hold';
            } else if (rawStatus.includes('archive')) {
                mappedStatus = 'archived';
            } else {
                mappedStatus = 'active';
            }

            return {
                id: p.id || p._id || `ext-${index}`,
                name: p.name || p.projectName || p.title || 'Unnamed External Project',
                clientName: p.clientName || p.customerName || p.client || p.client_name || 'N/A',
                status: mappedStatus,
                rawStatus: p.projectStatus || p.status || 'active',
                createdAt: p.createdAt || p.projectStartDate || p.created_at || new Date().toISOString(),
                updatedAt: p.updatedAt || p.updated_at || null,
                approximateDrawingsCount: p.approximateDrawingsCount || p.drawingsCount || 0,
                approvalPercentage: p.approvalPercentage ?? p.approval_percentage ?? 0,
                fabricationPercentage: p.fabricationPercentage ?? p.fabrication_percentage ?? 0,
                isExternal: true,
                corStatus: p.corStatus ? {
                    hasCOR: p.corStatus.hasCOR || false,
                    totalCORItems: p.corStatus.totalCORItems || 0,
                    totalAmount: p.coCost || p.corStatus.totalAmount || p.corStatus.approvedCoCost || 0,
                    statusSummary: p.corStatus.statusSummary || {
                        Approved: p.corStatus.statusSummary?.Approved || 0,
                        Completed: p.corStatus.statusSummary?.Completed || 0,
                        Submitted: p.corStatus.statusSummary?.Submitted || 0
                    },
                    statusAmounts: p.corStatus.statusAmounts || {
                        Approved: p.corStatus.statusAmounts?.Approved || p.corStatus.approvedCoCost || 0,
                        Completed: p.corStatus.statusAmounts?.Completed || p.corStatus.completedCoCost || 0,
                        Submitted: p.corStatus.statusAmounts?.Submitted || p.corStatus.submittedCoCost || p.corStatus.pendingCoCost || 0
                    },
                    items: (() => {
                        const corItems = [];
                        if (p.corStatus.corsData && Array.isArray(p.corStatus.corsData)) {
                            p.corStatus.corsData.forEach(cd => {
                                if (cd && Array.isArray(cd.items)) {
                                    cd.items.forEach(item => {
                                        corItems.push({
                                            corNumber: item.corNumber || '',
                                            amount: item.amount || 0,
                                            status: item.status || 'Pending',
                                            date: item.date || null
                                        });
                                    });
                                }
                            });
                        }
                        return corItems;
                    })()
                } : null
            };
        });

        cache.data = {
            count: totalCount,
            projects,
            error: null
        };
        cache.lastFetched = Date.now();
        cache.isFetching = false;
        return cache.data;
    } catch (error) {
        cache.isFetching = false;
        console.error('[ExternalProjectService] Failed to retrieve external projects:', error.message);
        return {
            count: 0,
            projects: [],
            error: `External App A is currently unreachable: ${error.message}`
        };
    }
}

module.exports = {
    getExternalProjects
};
