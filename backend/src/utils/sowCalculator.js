/**
 * Scope of Work (SOW) Progress Calculator
 */

function calculateSowProgress(scopeOfWork) {
    if (!Array.isArray(scopeOfWork) || scopeOfWork.length === 0) {
        return {
            approvalPercentage: 0,
            fabricationPercentage: 0,
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
    
    let approvalCalc = 0;
    let fabricationCalc = 0;

    if (sowCount > 0) {
        scopeOfWork.forEach(item => {
            const sowWeight = Number(item.percentage) || 0;
            const appPct = Number(item.approval) || 0;
            const fabPct = Number(item.fabrication) || 0;
            
            approvalCalc += (appPct * (sowWeight / 100));
            fabricationCalc += (fabPct * (sowWeight / 100));
        });

        roundedApproval = Math.round(approvalCalc * 10) / 10;
        roundedFabrication = Math.round(fabricationCalc * 10) / 10;
    }

    console.log('SOW COUNT:', sowCount);
    console.log('SOW DATA:', scopeOfWork);
    console.log('APPROVAL RESULT:', approvalCalc);
    console.log('FABRICATION RESULT:', fabricationCalc);

    return {
        approvalPercentage: roundedApproval,
        fabricationPercentage: roundedFabrication,
        sowContributions
    };
}

module.exports = { calculateSowProgress };
