/**
 * Scope of Work (SOW) Progress Calculator (Frontend)
 * 
 * Rules:
 * 1. Fixed Phase Weightages:
 *    - Approval = 80% weight (0.80)
 *    - Fabrication = 20% weight (0.20)
 * 2. User-entered fields for each SOW:
 *    - Percentage: Weight of SOW in total project scope (%)
 *    - App (%): Completion of Approval work for this SOW (%)
 *    - Fab (%): Completion of Fabrication work for this SOW (%)
 * 3. Calculations per SOW:
 *    - Approval Contribution = SOW Percentage * (App (%) / 100) * 0.80
 *    - Fabrication Contribution = SOW Percentage * (Fab (%) / 100) * 0.20
 *    - Overall Contribution = Approval Contribution + Fabrication Contribution
 * 4. Status Eligibility:
 *    - 'Pending' / 'Yet to Start' / 'Not Started': Contributions = 0
 *    - 'In Progress' / 'Completed' / 'Done': Calculates based on actual App (%) & Fab (%) values.
 * 5. Empty/missing App (%), Fab (%), or Percentage are strictly treated as 0.
 */

export interface SowItem {
    name?: string;
    percentage?: number;
    approval?: number;
    fabrication?: number;
    status?: string;
}

export interface SowContributionItem {
    name: string;
    sowPercentage: number;
    appPercentage: number;
    fabPercentage: number;
    status: string;
    approvalContribution: number;
    fabricationContribution: number;
    overallContribution: number;
}

export interface SowProgressResult {
    approvalPercentage: number;
    fabricationPercentage: number;
    overallPercentage: number;
    sowContributions: SowContributionItem[];
}

export function calculateSowProgress(scopeOfWork?: SowItem[]): SowProgressResult {
    if (!scopeOfWork || !Array.isArray(scopeOfWork) || scopeOfWork.length === 0) {
        return {
            approvalPercentage: 0,
            fabricationPercentage: 0,
            overallPercentage: 0,
            sowContributions: []
        };
    }

    let totalApprovalContrib = 0;
    let totalFabricationContrib = 0;

    const sowContributions: SowContributionItem[] = scopeOfWork.map(item => {
        const rawStatus = (item.status || 'Yet to Start').trim();
        const isPending = rawStatus === 'Pending' || rawStatus === 'Yet to Start' || rawStatus === 'Not Started';

        const sowPct = Number(item.percentage) || 0;
        const appPct = Number(item.approval) || 0;
        const fabPct = Number(item.fabrication) || 0;

        let approvalContrib = 0;
        let fabricationContrib = 0;

        if (!isPending) {
            approvalContrib = sowPct * (appPct / 100) * 0.80;
            fabricationContrib = sowPct * (fabPct / 100) * 0.20;
        }

        const overallContrib = approvalContrib + fabricationContrib;

        totalApprovalContrib += approvalContrib;
        totalFabricationContrib += fabricationContrib;

        return {
            name: item.name || '',
            sowPercentage: sowPct,
            appPercentage: appPct,
            fabPercentage: fabPct,
            status: rawStatus,
            approvalContribution: Math.round(approvalContrib * 100) / 100,
            fabricationContribution: Math.round(fabricationContrib * 100) / 100,
            overallContribution: Math.round(overallContrib * 100) / 100
        };
    });

    const roundedApproval = Math.round(totalApprovalContrib * 10) / 10;
    const roundedFabrication = Math.round(totalFabricationContrib * 10) / 10;
    const roundedOverall = Math.round((totalApprovalContrib + totalFabricationContrib) * 10) / 10;

    return {
        approvalPercentage: roundedApproval,
        fabricationPercentage: roundedFabrication,
        overallPercentage: roundedOverall,
        sowContributions
    };
}
