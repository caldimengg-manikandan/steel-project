import { useState, useEffect } from 'react';
import { adminListProjects } from '../../services/projectApi';
import { fetchWeeklyProgresss, getWeeklyProgressDownloadUrl } from '../../services/weeklyProgressApi';
import WeeklyProgressPanel from '../../components/WeeklyProgressPanel';
import { IconSearch, IconFolder, IconBack } from '../../components/Icons';

export default function AdminWeeklyProgress() {
    const [projects, setProjects] = useState<any[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<string>('');
    const [currentMode, setCurrentMode] = useState<'view' | 'edit'>('view');
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    const handleDownloadLatest = async (projectId: string) => {
        try {
            const res = await fetchWeeklyProgresss(projectId);
            if (res.reports && res.reports.length > 0) {
                // Find latest submitted report, or just use latest if none
                const latest = res.reports.find((r: any) => r.status === 'Submitted') || res.reports[0];
                window.location.href = getWeeklyProgressDownloadUrl(projectId, latest._id || latest.id);
            } else {
                // No reports found, download an empty template
                window.location.href = getWeeklyProgressDownloadUrl(projectId, 'empty');
            }
        } catch (err) {
            console.error('Failed to fetch reports', err);
            alert('Failed to download report.');
        }
    };

    useEffect(() => {
        const fetchProjects = async () => {
            try {
                const res = await adminListProjects();
                setProjects(res.projects || []);
            } catch (err) {
                console.error('Failed to load projects', err);
            } finally {
                setLoading(false);
            }
        };
        fetchProjects();
    }, []);

    const selectedProject = projects.find(p => (p._id || p.id) === selectedProjectId);

    const filteredProjects = projects.filter(p => 
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        (p.clientName && p.clientName.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
        <div className="admin-clients">
            {selectedProjectId && selectedProject ? (
                <>
                    <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setSelectedProjectId('')} title="Back">
                            <IconBack />
                        </button>
                        <div>
                            <h2 className="page-title">{selectedProject.name} - Weekly Progress</h2>
                            <p className="page-subtitle">Manage and generate progress reports for this project</p>
                        </div>
                    </div>
                    <div className="card" style={{ padding: 'var(--space-lg)', marginTop: 24 }}>
                        <WeeklyProgressPanel 
                            projectId={selectedProjectId} 
                            projectName={selectedProject.name} 
                            initialMode={currentMode}
                            onClose={() => setSelectedProjectId('')}
                        />
                    </div>
                </>
            ) : (
                <>
                    <div className="page-header">
                        <div className="page-header-left">
                            <h2 className="page-title">Weekly Progress</h2>
                            <p className="page-subtitle">Select a project to manage and generate its weekly progress reports</p>
                        </div>
                    </div>

                    <div className="toolbar">
                        <div className="toolbar-left">
                            <div className="search-container">
                                <span className="search-icon"><IconSearch /></span>
                                <input 
                                    type="text" 
                                    className="search-input" 
                                    placeholder="Search projects..." 
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                            Showing <strong>{filteredProjects.length}</strong> projects
                        </div>
                    </div>

                    <div className="client-grid">
                        {loading ? (
                            Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="client-card skeleton" style={{ height: 200, opacity: 0.5 }}></div>
                            ))
                        ) : filteredProjects.map(project => (
                            <div key={project._id || project.id} className="client-card">
                                <div className="client-card-header">
                                    <div className="client-title-wrapper">
                                        <div className="client-icon-box">
                                            <IconFolder />
                                        </div>
                                        <div>
                                            <div className="client-name" title={project.name}>{project.name}</div>
                                            <span className={`client-status-badge status-${project.status || 'active'}`}>
                                                {project.status || 'active'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="client-card-body">
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                                        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                                            <strong>Client:</strong> {project.clientName || 'N/A'}
                                        </div>
                                        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                                            <strong>Updated:</strong> {new Date(project.updatedAt).toLocaleDateString()}
                                        </div>
                                    </div>
                                </div>

                                <div className="client-card-footer" style={{ display: 'flex', gap: 8 }}>
                                    <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedProjectId(project._id || project.id); setCurrentMode('view'); }} style={{ flex: 1, justifyContent: 'center' }}>
                                        View
                                    </button>
                                    <button className="btn btn-primary btn-sm" onClick={() => { setSelectedProjectId(project._id || project.id); setCurrentMode('edit'); }} style={{ flex: 1, justifyContent: 'center' }}>
                                        Edit
                                    </button>
                                    <button onClick={() => handleDownloadLatest(project._id || project.id)} className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }}>
                                        Download
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {filteredProjects.length === 0 && !loading && (
                        <div style={{ textAlign: 'center', padding: 100, background: 'var(--color-bg-card)', borderRadius: 12, border: '1px dashed var(--color-border)' }}>
                            <div style={{ opacity: 0.2, margin: '0 auto 16px', width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <IconFolder />
                            </div>
                            <h3 style={{ color: 'var(--color-text-primary)' }}>No projects found</h3>
                            <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Try adjusting your search criteria</p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
