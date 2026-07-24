const fetch = require('isomorphic-fetch');

/**
 * Fetch project details and count from external App A APIs.
 */
async function getExternalProjects() {
    const projectsUrl = process.env.APP_A_PROJECTS_URL;
    const countUrl = process.env.APP_A_API_URL;

    if (!projectsUrl) {
        return {
            count: 0,
            projects: [],
            error: 'External API URL is not configured in environment variables'
        };
    }

    const headers = {};
    if (process.env.APP_A_API_KEY) {
        headers['x-api-key'] = process.env.APP_A_API_KEY;
    }

    try {
        // Fetch projects list first
        const projectsRes = await fetch(projectsUrl, { headers });
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
                const countRes = await fetch(countUrl, { headers });
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
                approximateDrawingsCount: p.approximateDrawingsCount || p.drawingsCount || 0,
                approvalPercentage: p.approvalPercentage ?? p.approval_percentage ?? 0,
                fabricationPercentage: p.fabricationPercentage ?? p.fabrication_percentage ?? 0,
                isExternal: true,
                corStatus: p.corStatus ? {
                    ...p.corStatus,
                    totalAmount: p.coCost || 0
                } : null
            };
        });

        return {
            count: totalCount,
            projects,
            error: null
        };
    } catch (error) {
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
