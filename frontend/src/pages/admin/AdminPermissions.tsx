import { useState, useEffect, useCallback } from 'react';
import { adminListProjects, adminRemoveUserAssignment } from '../../services/projectApi';
import type { Project } from '../../types';

type Permission = 'viewer' | 'editor' | 'admin';

interface Assignment {
    id: string;
    projectId: string;
    projectName: string;
    userId: string;
    username: string;
    permission: Permission;
    assignedAt: string;
}

const PERM_LABEL: Record<Permission, string> = {
    viewer: 'Viewer', editor: 'Editor', admin: 'Admin',
};

const PERM_DESC: Record<Permission, string> = {
    viewer: 'Read-only access to all drawings and revision history.',
    editor: 'Can upload new drawings and edit drawing metadata.',
    admin: 'Full control: upload, edit, delete drawings, manage project settings.',
};

export default function AdminPermissions() {
    const [error, setError] = useState('');
    const [assignments, setAssignments] = useState<Assignment[]>([]);

    const fetchData = useCallback(async () => {
        try {
            const projData = await adminListProjects();

            const mappedProj = projData.projects.map((p: any) => ({
                ...p,
                id: String(p._id || p.id),
            }));

            // Reconstruct assignments list from ALL projects
            const allAssignments: Assignment[] = mappedProj.flatMap((p: Project) =>
                p.assignments.map((a: any) => ({
                    id: `${p.id}_${a.userId}`,
                    projectId: p.id,
                    projectName: p.name,
                    userId: a.userId,
                    username: a.username,
                    permission: a.permission as Permission,
                    assignedAt: p.updatedAt,
                }))
            );
            setAssignments(allAssignments);

        } catch (err: any) {
            setError(err.message || 'Failed to load data');
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    async function handleRemove(projectId: string, userId: string) {
        try {
            setError('');
            await adminRemoveUserAssignment(projectId, userId);
            await fetchData();
        } catch (err: any) {
            setError(`Removal failed: ${err.message}`);
        }
    }

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h2 className="page-title">Permission Assignment</h2>
                    <p className="page-subtitle">Control which users access which projects and at what permission level</p>
                </div>
            </div>

            {error && (
                <div className="info-box danger mb-md">
                    <strong>Error:</strong> {error}
                </div>
            )}

            <div style={{ maxWidth: '850px', margin: '0 auto', paddingBottom: 'var(--space-xl)' }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 'var(--space-xl)',
                    paddingBottom: 'var(--space-md)',
                    borderBottom: '2px solid var(--color-border-light)'
                }}>
                    <div>
                        <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--color-text-primary)' }}>
                            Active Permission Modules
                        </h3>
                        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>
                            Review current user access levels and assigned roles across all projects
                        </p>
                    </div>
                    <span style={{ 
                        fontSize: 13, 
                        fontWeight: 600, 
                        color: 'var(--color-primary)', 
                        backgroundColor: 'var(--color-primary-light)', 
                        padding: '6px 14px', 
                        borderRadius: '20px' 
                    }}>
                        {assignments.length} Active Assignment{assignments.length !== 1 ? 's' : ''}
                    </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
                    {(['viewer', 'editor', 'admin'] as Permission[]).map((perm) => {
                        const moduleAssignments = assignments.filter((a) => a.permission === perm);
                        return (
                            <div key={perm} className="card" style={{ margin: 0, borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.03)', border: '1px solid var(--color-border)' }}>
                                <div className="card-header" style={{ paddingTop: 16, paddingBottom: 16, backgroundColor: 'var(--color-bg-subtle, #f8fafc)', borderBottom: '1px solid var(--color-border-light)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <span className={`role-chip ${perm}`} style={{ fontSize: 13, padding: '4px 10px' }}>{PERM_LABEL[perm]}</span>
                                        <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                                            {PERM_DESC[perm]}
                                        </span>
                                    </div>
                                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)' }}>
                                        {moduleAssignments.length} assigned
                                    </span>
                                </div>
                                <div style={{ padding: '8px var(--space-lg) 12px' }}>
                                    {moduleAssignments.length === 0 ? (
                                        <p style={{
                                            fontSize: 13,
                                            color: 'var(--color-text-muted)',
                                            fontStyle: 'italic',
                                            margin: '12px 0',
                                            padding: '8px 0',
                                            textAlign: 'center'
                                        }}>
                                            No users currently have this permission role.
                                        </p>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                                            {moduleAssignments.map((a) => (
                                                <div key={a.id} style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    padding: '12px 16px',
                                                    borderRadius: '8px',
                                                    background: 'var(--color-bg-subtle, #f8faff)',
                                                    border: '1px solid var(--color-border-light)',
                                                    transition: 'all 0.2s ease',
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                        <div style={{
                                                            width: 32, height: 32,
                                                            borderRadius: '50%',
                                                            background: 'var(--color-primary-light)',
                                                            color: 'var(--color-primary)',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            fontSize: 12, fontWeight: 700,
                                                            border: '1px solid #93c5fd',
                                                            flexShrink: 0,
                                                        }}>
                                                            {a.username.slice(0, 2).toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text-primary)' }}>
                                                                {a.username}
                                                            </div>
                                                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                                                Project: <span style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>{a.projectName}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <button
                                                        className="btn btn-danger btn-sm"
                                                        style={{ padding: '6px 12px', fontSize: 13, fontWeight: 500 }}
                                                        onClick={() => handleRemove(a.projectId, a.userId)}
                                                    >
                                                        Revoke Access
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
