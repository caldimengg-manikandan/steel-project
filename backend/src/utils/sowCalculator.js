/**
 * Scope of Work (SOW) Progress Calculator
 */

/**
 * Re-balances % of Total Work among SOW items.
 * If any SOW is on Hold, its percentage is set to 0 and the 100% total
 * is divided equally among the remaining active (non-hold) SOWs.
 */
function rebalanceSowPercentages(sows) {
    if (!Array.isArray(sows) || sows.length === 0) return sows;

    const isHold = (status) => {
        const s = String(status || '').toLowerCase().trim();
        return s === 'hold' || s === 'on hold' || s === 'on_hold';
    };

    const hasHold = sows.some(sow => isHold(sow.status));
    if (!hasHold) {
        const currentSum = sows.reduce((acc, curr) => acc + (Number(curr.percentage) || 0), 0);
        const hasZero = sows.some(s => Number(s.percentage) === 0);
        if (Math.round(currentSum * 10) / 10 === 100 && !hasZero) {
            return sows;
        }
    }

    const activeIndices = [];
    sows.forEach((sow, idx) => {
        if (!isHold(sow.status)) {
            activeIndices.push(idx);
        }
    });

    if (activeIndices.length === 0) {
        return sows.map(sow => ({ ...sow, percentage: 0 }));
    }

    const totalAmount = 100;
    const activeCount = activeIndices.length;
    const defaultPct = Math.round((totalAmount / activeCount) * 100) / 100;

    let sumOthers = 0;
    return sows.map((sow, idx) => {
        if (isHold(sow.status)) {
            return { ...sow, percentage: 0 };
        }
        if (idx === activeIndices[activeCount - 1]) {
            const remainder = Math.round((totalAmount - sumOthers) * 100) / 100;
            return { ...sow, percentage: remainder };
        } else {
            sumOthers += defaultPct;
            return { ...sow, percentage: defaultPct };
        }
    });
}

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

    const isHold = (status) => {
        const s = String(status || '').toLowerCase().trim();
        return s === 'hold' || s === 'on hold' || s === 'on_hold';
    };

    // Ensure scopeOfWork used for progress calculation has rebalanced weights
    const effectiveSows = rebalanceSowPercentages(scopeOfWork);

    let totalApprovalRaw = 0;
    let totalFabricationRaw = 0;
    const sowCount = effectiveSows.length;

    const sowContributions = effectiveSows.map(item => {
        if (isHold(item.status)) {
            return {
                name: item.name || '',
                sowPercentage: 0,
                appPercentage: 0,
                fabPercentage: 0,
                status: item.status || 'Hold',
                approvalContribution: 0,
                fabricationContribution: 0,
                overallContribution: 0
            };
        }

        const appPct = Number(item.approval) || 0;
        const fabPct = Number(item.fabrication) || 0;

        totalApprovalRaw += appPct;
        totalFabricationRaw += fabPct;

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
        effectiveSows.forEach(item => {
            if (isHold(item.status)) return; // Hold SOWs are not considered
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
    console.log('SOW DATA:', effectiveSows);
    console.log('APPROVAL RESULT:', approvalCalc);
    console.log('FABRICATION RESULT:', fabricationCalc);

    return {
        approvalPercentage: roundedApproval,
        fabricationPercentage: roundedFabrication,
        sowContributions
    };
}

module.exports = { calculateSowProgress, rebalanceSowPercentages };
