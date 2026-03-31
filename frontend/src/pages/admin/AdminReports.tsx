import { useState, useEffect, useCallback, useRef } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
    BarChart, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import {
    IconChart, IconFilter, IconDownload,
    IconFolder, IconTrendingUp
} from '../../components/Icons';
import { adminGetReportsData } from '../../services/adminUserApi';

// ─── Sub-components ───

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div style={{ 
                background: 'rgba(255, 255, 255, 0.95)', 
                backdropFilter: 'blur(8px)',
                border: '1px solid var(--color-border)', 
                padding: '12px 16px', 
                borderRadius: '12px', 
                boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
                fontSize: '13px'
            }}>
                <p style={{ margin: '0 0 8px 0', fontWeight: 700, color: 'var(--color-text-primary)' }}>{label}</p>
                {payload.map((entry: any, index: number) => (
                    <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, color: entry.color }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: entry.color }} />
                        <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>{entry.name}:</span>
                        <span style={{ fontWeight: 700 }}>{entry.value}{entry.unit || ''}</span>
                    </div>
                ))}
            </div>
        );
    }
    return null;
};

const StatCard = ({ label, value, icon, variant }: any) => (
    <div className="card" style={{ 
        padding: '24px', 
        border: '1px solid var(--color-border-light)',
        background: 'linear-gradient(145deg, var(--color-bg-card) 0%, var(--color-bg-subtle, #ffffff) 100%)',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-sm)'
    }}>
        <div style={{ 
            position: 'absolute', 
            top: -10, 
            right: -10, 
            width: 80, 
            height: 80, 
            background: variant === 'danger' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(var(--color-primary-rgb, 30, 79, 216), 0.05)', 
            borderRadius: '50%', 
            zIndex: 0
        }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ 
                    width: 40, height: 40, 
                    borderRadius: '10px', 
                    background: variant === 'danger' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(var(--color-primary-rgb, 30, 79, 216), 0.15)',
                    color: variant === 'danger' ? '#ef4444' : 'var(--color-primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                    {icon}
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--color-text-secondary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</div>
            </div>
            <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--color-text-primary)', marginBottom: 0 }}>{value}</div>
        </div>
    </div>
);

const ChartCard = ({ title, children, action }: { title: string, children: React.ReactNode, action?: React.ReactNode }) => (
    <div className="card" style={{ 
        height: '100%', 
        display: 'flex', 
        flexDirection: 'column',
        boxShadow: '0 4px 20px rgba(0,0,0,0.02)',
        border: '1px solid var(--color-border-light)'
    }}>
        <div className="card-header" style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border-light)' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>{title}</span>
            {action}
        </div>
        <div className="card-body" style={{ flex: 1, minHeight: 320, padding: '24px' }}>
            {children}
        </div>
    </div>
);

// ─── Main Page ───

export default function AdminReports() {
    const [days, setDays] = useState(30);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [exportLoading, setExportLoading] = useState(false);
    const [error, setError] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
    const [selectedClient, setSelectedClient] = useState('all');
    const reportRef = useRef<HTMLDivElement>(null);
    const filterRef = useRef<HTMLDivElement>(null);

    const fetchData = useCallback(async (d: number) => {
        try {
            setLoading(true);
            const res = await adminGetReportsData(d);
            setData(res);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch reports');
        } finally {
            setLoading(false);
        }
    }, []);

    const handleExportPDF = async () => {
        if (!reportRef.current) return;
        try {
            setExportLoading(true);
            const canvas = await html2canvas(reportRef.current, {
                scale: 1.5,
                useCORS: true,
                logging: false,
                backgroundColor: null,
                allowTaint: true
            });
            const imgData = canvas.toDataURL('image/png', 1.0);
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');
            pdf.save(`Steel-Project-Report-${new Date().toLocaleDateString().replace(/\//g, '-')}.pdf`);
        } catch (err) {
            console.error('PDF Export failed:', err);
            alert('Failed to generate PDF. Please try again.');
        } finally {
            setExportLoading(false);
        }
    };

    useEffect(() => {
        fetchData(days);
    }, [days, fetchData]);

    // Close filters when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
                setShowFilters(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    if (loading && !data) return (
        <div style={{ padding: '100px 0', textAlign: 'center' }}>
            <div className="spinner mb-sm"></div>
            <p>Gathering live metrics...</p>
        </div>
    );

    if (error) return (
        <div className="info-box danger">
            <strong>Error:</strong> {error}
            <button onClick={() => fetchData(days)} className="btn btn-ghost btn-sm" style={{ marginLeft: 12 }}>Retry</button>
        </div>
    );

    if (!data) return null;

    const { projectProgress, projects } = data;

    // Local filtering and stat recalculation
    const filteredProjects = projects.filter((p: any) => {
        const matchesClient = selectedClient === 'all' || p.clientName === selectedClient;
        const matchesProject = selectedProjectIds.length === 0 || selectedProjectIds.includes(String(p.id));
        return matchesClient && matchesProject;
    });

    const filteredProgress = projectProgress.filter((p: any) => {
        const matchesClient = selectedClient === 'all' || projects.find((proj: any) => proj.id === p.id)?.clientName === selectedClient;
        const matchesProject = selectedProjectIds.length === 0 || selectedProjectIds.includes(String(p.id));
        return matchesClient && matchesProject;
    });

    // Group projects by client for visualization
    const clientGroups = filteredProjects.reduce((acc: any, p: any) => {
        const client = p.clientName || 'Unknown';
        if (!acc[client]) acc[client] = [];
        acc[client].push({
            name: p.name,
            approval: p.approvalPercentage || 0,
            fabrication: p.fabricationPercentage || 0,
            drawings: p.totalDrawings || p.drawingCount || 0,
            rfis: p.openRfiCount || 0,
            status: p.status
        });
        return acc;
    }, {});

    // Recalculate overview based on filtered selection
    const currentStats = {
        totalProjects: filteredProjects.length,
        activeRfis: filteredProjects.reduce((acc: number, p: any) => acc + (p.openRfiCount || 0), 0),
        totalDrawings: filteredProjects.reduce((acc: number, p: any) => acc + (p.drawingCount || 0), 0),
        delayedTasks: filteredProjects.reduce((acc: number, p: any) => {
            const delayed = (p.sequences || []).filter((s: any) => 
                s.status !== 'Completed' && s.deadline && new Date(s.deadline) < new Date()
            ).length;
            return acc + delayed;
        }, 0)
    };

    const OVERVIEW_STATS = [
        { label: 'TOTAL PROJECTS', value: currentStats.totalProjects, icon: <IconFolder /> },
        { label: 'ACTIVE RFIS', value: currentStats.activeRfis, icon: <IconChart /> },
        { label: 'DELAYED TASKS', value: currentStats.delayedTasks, icon: <IconTrendingUp />, variant: 'danger' },
    ];

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h2 className="page-title">Reports & Analytics</h2>
                    <p className="page-subtitle">Real-time insights from live project data</p>
                </div>
                <div className="page-header-right" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div className="btn-group">
                        <button className={`btn ${days === 7 ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setDays(7)}>Last 7 Days</button>
                        <button className={`btn ${days === 30 ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setDays(30)}>Last 30 Days</button>
                        <button className={`btn ${days === 90 ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setDays(90)}>Last 90 Days</button>
                    </div>

                    <select 
                        className="form-control btn-sm" 
                        value={selectedClient}
                        onChange={(e) => {
                            setSelectedClient(e.target.value);
                            setSelectedProjectIds([]); // Reset project filter when client changes
                        }}
                        style={{ width: 'auto', minWidth: 160, display: 'inline-block' }}
                    >
                        <option value="all">All Clients</option>
                        {Array.from(new Set(projects.map((p: any) => p.clientName))).filter(Boolean).sort().map((c: any) => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                    
                    <div style={{ position: 'relative' }} ref={filterRef}>
                        <button 
                            className={`btn ${selectedProjectIds.length > 0 ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                            onClick={() => setShowFilters(!showFilters)}
                        >
                            <IconFilter /> Filters {selectedProjectIds.length > 0 && `(${selectedProjectIds.length})`}
                        </button>

                        {showFilters && (
                            <div style={{ 
                                position: 'absolute', top: '100%', right: 0, marginTop: 8,
                                background: '#fff', border: '1px solid var(--color-border)',
                                borderRadius: 12, boxShadow: 'var(--shadow-lg)', zIndex: 100,
                                minWidth: 240, padding: 12
                            }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                                    <span>FILTER BY PROJECT</span>
                                    <span style={{ cursor: 'pointer', color: 'var(--color-primary)' }} onClick={() => setSelectedProjectIds([])}>Clear</span>
                                </div>
                                <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {projects.map((p: any) => (
                                        <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }} className="hover-bg">
                                            <input 
                                                type="checkbox" 
                                                checked={selectedProjectIds.includes(String(p.id))}
                                                onChange={() => {
                                                    const pid = String(p.id);
                                                    if (selectedProjectIds.includes(pid)) {
                                                        setSelectedProjectIds(selectedProjectIds.filter(id => id !== pid));
                                                    } else {
                                                        setSelectedProjectIds([...selectedProjectIds, pid]);
                                                    }
                                                }}
                                            />
                                            <span style={{ fontWeight: 600 }}>{p.clientName}</span> - {p.name}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <button 
                        className="btn btn-primary btn-sm" 
                        onClick={handleExportPDF} 
                        disabled={exportLoading}
                        style={{ minWidth: 120 }}
                    >
                        {exportLoading ? (
                            <><div className="spinner-xs" style={{ marginRight: 8 }} /> Generating...</>
                        ) : (
                            <><IconDownload /> Export PDF</>
                        )}
                    </button>
                </div>
            </div>

            {loading && <div className="progress-bar-indefinite" style={{ marginBottom: 24 }}></div>}

            <div ref={reportRef} style={{ background: 'var(--color-bg-page)', padding: '16px', borderRadius: '12px' }}>

            {/* Top Overview Cards */}
            <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 32 }}>
                {OVERVIEW_STATS.map((stat, i) => (
                    <StatCard key={i} {...stat} />
                ))}
            </div>

            {/* Row 1: Project Progress (Full Width) */}
            <div style={{ marginBottom: 32 }}>
                <ChartCard title={selectedClient === 'all' ? "Approval & Fabrication Progress %" : `Approval & Fabrication Progress % - ${selectedClient}`}>
                    {filteredProgress.length === 0 ? (
                        <div className="table-empty">No project data available for charts.</div>
                    ) : (
                        <ResponsiveContainer width="100%" height={360}>
                            <BarChart data={filteredProgress} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="barGradientPrimary" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={1} />
                                        <stop offset="100%" stopColor="var(--color-primary-light)" stopOpacity={1} />
                                    </linearGradient>
                                    <linearGradient id="barGradientSuccess" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                                        <stop offset="100%" stopColor="#34d399" stopOpacity={1} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border-light)" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)', fontWeight: 600 }} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} domain={[0, 100]} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-primary-glow)', opacity: 0.1 }} />
                                <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ paddingBottom: 20, fontSize: 12, fontWeight: 600 }} />
                                <Bar dataKey="approval" name="Approval" fill="url(#barGradientPrimary)" radius={[6, 6, 0, 0]} barSize={40} />
                                <Bar dataKey="fabrication" name="Fabrication" fill="url(#barGradientSuccess)" radius={[6, 6, 0, 0]} barSize={40} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </ChartCard>
            </div>



            {/* Row 3: Client Wise Project Analysis */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '24px' }}>
                {Object.keys(clientGroups).length === 0 ? (
                    <div className="card" style={{ padding: '40px', textAlign: 'center', gridColumn: '1 / -1' }}>
                        <div className="table-empty">No projects found.</div>
                    </div>
                ) : (
                    Object.entries(clientGroups).map(([clientName, clientProjects]: [string, any]) => (
                        <ChartCard key={clientName} title={`Client: ${clientName}`}>
                            <div style={{ marginBottom: 16, display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
                                {clientProjects.map((p: any, idx: number) => (
                                    <div key={idx} style={{ 
                                        padding: '10px 14px', 
                                        background: 'var(--color-bg-page)', 
                                        borderRadius: 8, 
                                        border: '1px solid var(--color-border-light)',
                                        minWidth: 'fit-content'
                                    }}>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4 }}>{p.name}</div>
                                        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600 }}>
                                            <span>DWGS: {p.drawings}</span>
                                            <span>RFIs: {p.rfis}</span>
                                            <span style={{ color: p.status === 'active' ? '#10b981' : '#94a3b8' }}>{p.status?.toUpperCase()}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <ResponsiveContainer width="100%" height={260}>
                                <BarChart data={clientProjects}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border-light)" />
                                    <XAxis 
                                        dataKey="name" 
                                        axisLine={false} 
                                        tickLine={false} 
                                        tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontWeight: 600 }} 
                                    />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} domain={[0, 100]} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                                    <Bar dataKey="approval" name="Approval %" fill="var(--color-primary)" radius={[4, 4, 0, 0]} barSize={25} />
                                    <Bar dataKey="fabrication" name="Fabrication %" fill="#10b981" radius={[4, 4, 0, 0]} barSize={25} />
                                </BarChart>
                            </ResponsiveContainer>
                        </ChartCard>
                    ))
                )}
            </div>

            </div>
        </div>
    );
}
