/**
 * ============================================================
 * sequenceUtils.ts
 * ============================================================
 * Helper utility to derive target sequences for drawings, extractions,
 * transmittals, and reports across all project types.
 *
 * RULE:
 * If sequences are defined (either sub-sequences in SOW or top-level
 * project sequences), return them.
 * If NO sequences are present (neither sub-sequences nor project sequences),
 * return ALL Scope of Work (SOW) items from scopeOfWork and additionalScopeOfWork.
 */

export interface DerivedSequenceItem {
    name: string;
    approvalDate?: string | Date | null;
    fabricationDate?: string | Date | null;
    source?: string;
    sowIndex?: number;
    seqIndex?: number;
    sowStatus?: string;
    parentStatus?: string;
    status?: string;
    deadline?: string | Date;
    [key: string]: any;
}

export function getProjectTargetSequences(project: any): DerivedSequenceItem[] {
    if (!project) return [];

    const defaultAppDate = project.creationDate || 
        (project.createdAt ? new Date(project.createdAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);

    // 1. Collect all SOW items from both scopeOfWork and additionalScopeOfWork
    const allSow: any[] = [
        ...(Array.isArray(project.scopeOfWork) ? project.scopeOfWork : []),
        ...(Array.isArray(project.additionalScopeOfWork) ? project.additionalScopeOfWork : [])
    ].filter(sow => sow && (sow.name || typeof sow === 'string'));

    // 2. Check for sub-sequences inside SOW items
    const sowSubSeqs: DerivedSequenceItem[] = [];
    allSow.forEach((sow, sowIdx) => {
        const sowName = String(sow.name || sow || '').trim();
        if (Array.isArray(sow.sequences) && sow.sequences.length > 0) {
            sow.sequences.forEach((seq: any, seqIdx: number) => {
                const sName = String(typeof seq === 'string' ? seq : (seq?.name || '')).trim();
                if (sName) {
                    const effectiveApprovalDate = seq.approvalDate || sow.approvalDate || defaultAppDate;
                    sowSubSeqs.push({
                        ...seq,
                        approvalDate: effectiveApprovalDate,
                        source: 'sow',
                        sowIndex: sowIdx,
                        seqIndex: seqIdx,
                        sowStatus: sow.status,
                        parentStatus: sow.status,
                        name: `${sName} (${sowName})`
                    });
                }
            });
        }
    });

    // 3. Check for top-level project sequences
    const topLevelSeqs: DerivedSequenceItem[] = [];
    if (Array.isArray(project.sequences) && project.sequences.length > 0) {
        project.sequences.forEach((seq: any, idx: number) => {
            const sName = String(typeof seq === 'string' ? seq : (seq?.name || '')).trim();
            if (sName) {
                const effectiveApprovalDate = seq.approvalDate || defaultAppDate;
                topLevelSeqs.push({
                    ...seq,
                    approvalDate: effectiveApprovalDate,
                    source: 'project',
                    seqIndex: idx,
                    name: sName
                });
            }
        });
    }

    // 4. If SOW sub-sequences exist, return them (+ any standalone SOWs without sub-sequences)
    if (sowSubSeqs.length > 0) {
        const result = [...sowSubSeqs];
        allSow.forEach((sow, sowIdx) => {
            const sowName = String(sow.name || sow || '').trim();
            if (!Array.isArray(sow.sequences) || sow.sequences.length === 0) {
                if (sowName) {
                    const effectiveApprovalDate = sow.approvalDate || defaultAppDate;
                    result.push({
                        ...sow,
                        approvalDate: effectiveApprovalDate,
                        source: 'sow-fallback',
                        sowIndex: sowIdx,
                        sowStatus: sow.status,
                        parentStatus: sow.status,
                        name: sowName
                    });
                }
            }
        });
        return result;
    }

    // 5. If top-level project sequences exist, return them
    if (topLevelSeqs.length > 0) {
        return topLevelSeqs;
    }

    // 6. IF NO SEQUENCES ARE PRESENT:
    // ALWAYS return ALL Scope of Work (SOW) names!
    if (allSow.length > 0) {
        return allSow
            .map((sow, sowIdx) => {
                const sowName = String(sow.name || sow || '').trim();
                if (!sowName) return null;
                const effectiveApprovalDate = sow.approvalDate || defaultAppDate;
                return {
                    ...sow,
                    approvalDate: effectiveApprovalDate,
                    source: 'sow-fallback',
                    sowIndex: sowIdx,
                    sowStatus: sow.status,
                    parentStatus: sow.status,
                    name: sowName
                };
            })
            .filter((item): item is DerivedSequenceItem => item !== null);
    }

    return [];
}

