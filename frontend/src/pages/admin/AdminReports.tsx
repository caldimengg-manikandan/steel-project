import { useState, useEffect, useCallback, useRef } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
    BarChart, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    AreaChart, Area
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

    const { projectProgress, drawingSplit, userPerformance, trendData, projects } = data;

    // Local filtering and stat recalculation
    const filteredProjects = selectedProjectIds.length > 0 
        ? projects.filter((p: any) => selectedProjectIds.includes(String(p.id)))
        : projects;

    const filteredProgress = selectedProjectIds.length > 0 
        ? projectProgress.filter((p: any) => selectedProjectIds.includes(String(p.id)))
        : projectProgress;

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
        { label: 'TOTAL DRAWINGS', value: (currentStats.totalDrawings || 0).toLocaleString(), icon: <IconChart /> },
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
                                                checked={selectedProjectIds.includes(p.id)}
                                                onChange={() => {
                                                    if (selectedProjectIds.includes(p.id)) {
                                                        setSelectedProjectIds(selectedProjectIds.filter(id => id !== p.id));
                                                    } else {
                                                        setSelectedProjectIds([...selectedProjectIds, p.id]);
                                                    }
                                                }}
                                            />
                                            {p.name}
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
            <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 32 }}>
                {OVERVIEW_STATS.map((stat, i) => (
                    <StatCard key={i} {...stat} />
                ))}
            </div>

            {/* Row 1: Project Progress (Full Width) */}
            <div style={{ marginBottom: 32 }}>
                <ChartCard title="Approval & Fabrication Progress %">
                    {projectProgress.length === 0 ? (
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

            {/* Charts Row 2: Monthly Trends & Drawing Status */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 32 }}>
                <ChartCard title="Monthly Performance Trends">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorApp" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.2} />
                                    <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorFab" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border-light)" />
                            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600 }} />
                            <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }} />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 600, paddingBottom: 10 }} />
                            <Area type="monotone" name="Approval" dataKey="approval" stroke="var(--color-primary)" strokeWidth={4} fillOpacity={1} fill="url(#colorApp)" />
                            <Area type="monotone" name="Fabrication" dataKey="fabrication" stroke="#10b981" strokeWidth={4} fillOpacity={1} fill="url(#colorFab)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Drawing Categories Distribution">
                    {drawingSplit.length === 0 ? (
                        <div className="table-empty">No drawing split data found.</div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={drawingSplit} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border-light)" />
                                <XAxis type="number" hide />
                                <YAxis dataKey="category" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 700, fill: 'var(--color-text-primary)' }} />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 600, paddingBottom: 10 }} />
                                <Bar dataKey="approved" name="Approved" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                                <Bar dataKey="pending" name="Pending" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                                <Bar dataKey="rejected" name="Rejected" stackId="a" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={24} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </ChartCard>
            </div>

            {/* Row 3: User Performance Summary */}
            <ChartCard title="Internal Team Performance (Live Sample)">
                <div className="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Tasks Completed</th>
                                <th>Avg. Efficiency</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {userPerformance.length === 0 ? (
                                <tr><td colSpan={4} className="table-empty">No user data available.</td></tr>
                            ) : (
                                userPerformance.map((row: any, i: number) => (
                                    <tr key={i}>
                                        <td><span style={{ fontWeight: 600 }}>{row.user}</span></td>
                                        <td>{row.tasks}</td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <div style={{ flex: 1, height: 6, background: 'var(--color-bg-page)', borderRadius: 3, overflow: 'hidden' }}>
                                                    <div style={{ height: '100%', width: row.efficiency, background: 'var(--color-primary)' }} />
                                                </div>
                                                <span style={{ fontSize: 12, fontWeight: 700 }}>{row.efficiency}</span>
                                            </div>
                                        </td>
                                        <td><span className="badge badge-success">Active</span></td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </ChartCard>
            </div>
        </div>
    );
}
