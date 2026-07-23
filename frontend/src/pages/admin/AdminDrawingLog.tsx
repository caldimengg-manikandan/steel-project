import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import DrawingExtractionPanel from '../../components/DrawingExtractionPanel';
import { IconSearch, IconFolder, IconBack, IconChart } from '../../components/Icons';
import { fetchDrawingLogProjects, getDrawingLogDownloadUrl } from '../../services/drawingLogApi';

export default function AdminDrawingLog() {
    const { projectId: urlProjectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();

    const [projects, setProjects] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchProjects = async () => {
            try {
                const res = await fetchDrawingLogProjects();
                setProjects(res.projects || []);
            } catch (err: any) {
                console.error('Failed to load drawing log projects', err);
                setError(err.message || 'Failed to load projects');
            } finally {
                setLoading(false);
            }
        };
        fetchProjects();
    }, []);

    const selectedProject = projects.find(p => (p._id || p.id) === urlProjectId);

    const filteredProjects = projects.filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.clientName && p.clientName.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const handleSelectProject = (projectId: string) => {
        navigate(`/admin/drawing-log/${projectId}/view`);
    };

    const handleBack = () => {
        navigate('/admin/drawing-log');
    };

    return (
        <div className="admin-clients">
            {urlProjectId ? (
                loading ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading project...</div>
                ) : selectedProject ? (
                    <>
                        <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <button className="btn btn-ghost btn-sm btn-icon" onClick={handleBack} title="Back">
                                <IconBack />
                            </button>
                            <div>
                                <h2 className="page-title">{selectedProject.name} - Drawing Log</h2>
                                <p className="page-subtitle">Viewing Drawing Log</p>
                            </div>
                        </div>
                        <div className="card" style={{ padding: 'var(--space-lg)', marginTop: 24 }}>
                            <DrawingExtractionPanel
                                projectId={urlProjectId}
                                canUpload={true}
                            />
                        </div>
                    </>
                ) : (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        Project not found. <button className="btn btn-secondary btn-sm" onClick={handleBack}>Go Back</button>
                    </div>
                )
            ) : (
                <>
                    <div className="page-header">
                        <div className="page-header-left">
                            <h2 className="page-title">Drawing Log Module</h2>
                            <p className="page-subtitle">Select a project to view and download its drawing log</p>
                        </div>
                    </div>

                    {error && (
                        <div style={{ background: 'var(--color-danger)', color: 'white', padding: '12px 16px', borderRadius: 8, marginBottom: 24 }}>
                            {error}
                        </div>
                    )}

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
                                    </div>
                                </div>

                                <div className="client-card-footer" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => handleSelectProject(project._id || project.id)}
                                        style={{ flex: 1, justifyContent: 'center' }}
                                    >
                                        View Log
                                    </button>
                                    <button
                                        className="btn btn-primary btn-sm"
                                        onClick={() => window.open(getDrawingLogDownloadUrl(project._id || project.id), '_blank')}
                                        style={{ flex: 1, justifyContent: 'center' }}
                                        title="Download Drawing Log Excel"
                                    >
                                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" style={{ marginRight: 6 }}>
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                            <polyline points="7 10 12 15 17 10"></polyline>
                                            <line x1="12" y1="15" x2="12" y2="3"></line>
                                        </svg>
                                        Download
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {filteredProjects.length === 0 && !loading && (
                        <div style={{ textAlign: 'center', padding: 100, background: 'var(--color-bg-card)', borderRadius: 12, border: '1px dashed var(--color-border)' }}>
                            <div style={{ opacity: 0.2, margin: '0 auto 16px', width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <IconChart />
                            </div>
                            <h3 style={{ color: 'var(--color-text-primary)' }}>No projects found</h3>
                            <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Only projects with drawing extractions will appear here.</p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
