/**
 * Scope of Work (SOW) Progress Calculator
 */

function calculateSowProgress(scopeOfWork) {
    if (!Array.isArray(scopeOfWork) || scopeOfWork.length === 0) {
        return {
            approvalPercentage: 0,
            fabricationPercentage: 0,
            overallPercentage: 0,
            sowContributions: []
        };
    }

    let totalApprovalRaw = 0;
    let totalFabricationRaw = 0;
    const sowCount = scopeOfWork.length;

    const sowContributions = scopeOfWork.map(item => {
        // Use the actual Approval and Fabrication % value of each SOW.
        // No null/missing-value handling is required per requirements.
        const appPct = Number(item.approval);
        const fabPct = Number(item.fabrication);

        totalApprovalRaw += appPct;
        totalFabricationRaw += fabPct;
        
        console.log('SOW:', item.name);
        console.log('APPROVAL:', item.approval);
        console.log('FABRICATION:', item.fabrication);

        return {
            name: item.name || '',
            sowPercentage: item.percentage || 0,
            appPercentage: appPct,
            fabPercentage: fabPct,
            status: item.status || 'Yet to Start',
            approvalContribution: 0,
            fabricationContribution: 0,
            overallContribution: 0
        };
    });

    let roundedApproval = 0;
    let roundedFabrication = 0;
    let roundedOverall = 0;
    
    let approvalCalc = 0;
    let fabricationCalc = 0;

    if (sowCount > 0) {
        const maxPossible = sowCount * 100;
        
        // Approval % = (Sum of all SOW Approval % / (SOW Count * 100)) * 100
        approvalCalc = (totalApprovalRaw / maxPossible) * 100;
        
        // Fabrication % = (Sum of all SOW Fabrication % / (SOW Count * 100)) * 100
        fabricationCalc = (totalFabricationRaw / maxPossible) * 100;

        roundedApproval = Math.round(approvalCalc * 10) / 10;
        roundedFabrication = Math.round(fabricationCalc * 10) / 10;
        
        // Overall % calculation without any 80/20 or allocation weighting.
        const overallCalc = ((totalApprovalRaw + totalFabricationRaw) / (maxPossible * 2)) * 100;
        roundedOverall = Math.round(overallCalc * 10) / 10;
    }

    console.log('SOW COUNT:', sowCount);
    console.log('SOW DATA:', scopeOfWork);
    console.log('TOTAL APPROVAL:', totalApprovalRaw);
    console.log('TOTAL FABRICATION:', totalFabricationRaw);
    console.log('APPROVAL RESULT:', approvalCalc);
    console.log('FABRICATION RESULT:', fabricationCalc);

    return {
        approvalPercentage: roundedApproval,
        fabricationPercentage: roundedFabrication,
        overallPercentage: roundedOverall,
        sowContributions
    };
}

module.exports = { calculateSowProgress };
