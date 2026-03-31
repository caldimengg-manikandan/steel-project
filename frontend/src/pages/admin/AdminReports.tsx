import { useState, useEffect, useCallback, useRef } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
    BarChart, Bar, PieChart as RePieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import {
    IconChart, IconDownload,
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

const PieChart = ({ data }: { data: any[] }) => {
    const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];
    return (
        <ResponsiveContainer width="100%" height={300}>
            <RePieChart>
                <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    animationBegin={0}
                    animationDuration={1500}
                >
                    {data.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                </Pie>
                <Tooltip />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: 20, fontSize: 12, fontWeight: 600 }} />
            </RePieChart>
        </ResponsiveContainer>
    );
};

// ─── Main Page ───

export default function AdminReports() {
    const [days, setDays] = useState(30);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [exportLoading, setExportLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedClient, setSelectedClient] = useState<string | null>(null);
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
    const reportRef = useRef<HTMLDivElement>(null);

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

    if (!data) return (
        <div style={{ padding: '60px', textAlign: 'center', opacity: 0.7 }}>
            No data available for the selected period.
        </div>
    );

    const { projectProgress = [], projects = [], overview = {} } = data;

    // Group projects by client for visualization (Normalize to Title Case)
    const clientGroups = projects.reduce((acc: any, p: any) => {
        const rawClient = p.clientName || 'Other';
        const client = rawClient.charAt(0).toUpperCase() + rawClient.slice(1).toLowerCase();
        if (!acc[client]) acc[client] = [];
        const pid = String(p._id || p.id);
        acc[client].push({
            id: pid,
            name: p.name,
            approval: p.approvalPercentage || 0,
            fabrication: p.fabricationPercentage || 0,
            drawings: p.totalDrawings || p.drawingCount || 0,
            rfis: p.openRfiCount || 0,
            status: p.status
        });
        return acc;
    }, {});

    const clientNames = Object.keys(clientGroups).sort();

    // Filter project progress and summary projects based on selection
    const filteredProgress = projectProgress
        .filter((p: any) => !selectedClient || (p.clientName || '').toLowerCase() === selectedClient.toLowerCase())
        .filter((p: any) => !selectedProjectId || String(p._id || p.id) === selectedProjectId);

    const filteredSummaryProjects = projects
        .filter((p: any) => !selectedClient || (p.clientName || '').toLowerCase() === selectedClient.toLowerCase())
        .filter((p: any) => !selectedProjectId || String(p._id || p.id) === selectedProjectId);

    // Stats always show global totals
    const OVERVIEW_STATS = [
        { label: 'TOTAL PROJECTS', value: overview?.totalProjects || 0, icon: <IconFolder /> },
        { label: 'ACTIVE RFIS', value: overview?.activeRfis || 0, icon: <IconChart /> },
        { label: 'DELAYED TASKS', value: overview?.delayedTasks || 0, icon: <IconTrendingUp />, variant: 'danger' },
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

                {/* Top Overview Cards (3-column) */}
                <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 32 }}>
                    {OVERVIEW_STATS.map((stat, i) => (
                        <StatCard key={i} {...stat} />
                    ))}
                </div>

                {/* Filter Bar */}
                <div style={{ 
                    marginBottom: 32, 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 16, 
                    background: 'var(--color-bg-card)', 
                    padding: '12px 24px', 
                    borderRadius: 12,
                    border: '1px solid var(--color-border-light)',
                    overflowX: 'auto'
                }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>FILTER BY CLIENT:</span>
                    <select
                        className="form-control"
                        style={{ width: 'auto', minWidth: 200, fontWeight: 600 }}
                        value={selectedClient || ''}
                        onChange={(e) => {
                            setSelectedClient(e.target.value || null);
                            setSelectedProjectId(null);
                        }}
                    >
                        <option value="">ALL CLIENTS</option>
                        {clientNames.map(name => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>

                    {selectedClient && (
                        <>
                            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-secondary)', marginLeft: 16 }}>SELECT PROJECT:</span>
                            <select
                                className="form-control"
                                style={{ width: 'auto', minWidth: 240, fontWeight: 600 }}
                                value={selectedProjectId || ''}
                                onChange={(e) => setSelectedProjectId(e.target.value || null)}
                            >
                                <option value="">All Associated Projects</option>
                                {clientGroups[selectedClient]?.map((p: any) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </>
                    )}
                </div>

                {/* Line 1: Bar Chart */}
                <div style={{ marginBottom: 32 }}>
                    <ChartCard title="Overall Approval & Fabrication Progress">
                        {filteredProgress.length === 0 ? (
                            <div className="table-empty">No data matches the selected filters.</div>
                        ) : (
                            <ResponsiveContainer width="100%" height={360}>
                                <BarChart data={filteredProgress} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border-light)" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)', fontWeight: 600 }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} domain={[0, 100]} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ paddingBottom: 20, fontSize: 12, fontWeight: 600 }} />
                                    <Bar dataKey="approval" name="Approval" fill="var(--color-primary)" radius={[6, 6, 0, 0]} barSize={40} />
                                    <Bar dataKey="fabrication" name="Fabrication" fill="#10b981" radius={[6, 6, 0, 0]} barSize={40} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </ChartCard>
                </div>

                {/* Line 2: Pie Charts */}
                <div className="grid-2" style={{ gap: 24, marginBottom: 32 }}>
                    <ChartCard title="Project Distribution">
                        <PieChart data={filteredSummaryProjects.reduce((acc: any, p: any) => {
                            const status = p.status || 'active';
                            const existing = acc.find((v: any) => v.name === status);
                            if (existing) existing.value++;
                            else acc.push({ name: status, value: 1 });
                            return acc;
                        }, [])} />
                    </ChartCard>

                    <ChartCard title="Projects per Client">
                        <PieChart data={Object.entries(clientGroups)
                            .filter(([name]) => !selectedClient || name.toLowerCase() === selectedClient.toLowerCase())
                            .map(([name, items]: any) => ({
                                name,
                                value: items.filter((p: any) => !selectedProjectId || p.id === selectedProjectId).length
                            }))
                            .filter(v => v.value > 0)} />
                    </ChartCard>
                </div>

                {/* Line 3: Delayed Tasks */}
                <div style={{ marginBottom: 32 }}>
                    <ChartCard title="Delayed Tasks by Project">
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={projects
                                .filter((p: any) => !selectedClient || (p.clientName || '').toLowerCase() === selectedClient.toLowerCase())
                                .filter((p: any) => !selectedProjectId || String(p._id || p.id) === selectedProjectId)
                                .map((p: any) => ({
                                    name: p.name,
                                    delayed: (p.sequences || []).filter((s: any) => {
                                        const today = new Date().toISOString().split('T')[0];
                                        const target = s.approvalDate || s.deadline;
                                        return s.status !== 'Completed' && target && target < today;
                                    }).length
                                }))
                                .filter((v: any) => v.delayed > 0)} 
                            >
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border-light)" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)', fontWeight: 600 }} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                                <Tooltip content={<CustomTooltip />} />
                                <Legend iconType="circle" />
                                <Bar dataKey="delayed" name="Delayed Tasks" fill="#ef4444" radius={[6, 6, 0, 0]} barSize={40} />
                            </BarChart>
                        </ResponsiveContainer>
                    </ChartCard>
                </div>

                {/* Row 4: Client Wise Analysis (Details) */}
                <div style={{ marginBottom: 32 }}>
                    {selectedClient && clientGroups[selectedClient] ? (
                        <ChartCard title={`Client Wise Analysis: ${selectedClient}`}>
                            <div style={{ marginBottom: 24, display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
                                {clientGroups[selectedClient]
                                    .filter((p: any) => !selectedProjectId || p.id === selectedProjectId)
                                    .map((p: any, idx: number) => (
                                    <div key={idx} style={{ 
                                        padding: '12px 16px', 
                                        background: 'var(--color-bg-page)', 
                                        borderRadius: 12, 
                                        border: '1px solid var(--color-border-light)',
                                        minWidth: '200px',
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
                                    }}>
                                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 6 }}>{p.name}</div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <span>Drawings:</span>
                                                <span style={{ color: 'var(--color-primary)' }}>{p.drawings}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <span>Active RFIs:</span>
                                                <span style={{ color: p.rfis > 0 ? '#ef4444' : 'var(--color-text-muted)' }}>{p.rfis}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--color-border-light)', paddingTop: 4, marginTop: 4 }}>
                                                <span>Status:</span>
                                                <span style={{ color: p.status === 'active' ? '#10b981' : '#94a3b8' }}>{p.status?.toUpperCase()}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={clientGroups[selectedClient].filter((p: any) => !selectedProjectId || p.id === selectedProjectId)}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border-light)" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)', fontWeight: 600 }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} domain={[0, 100]} />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                                    <Bar dataKey="approval" name="Approval %" fill="var(--color-primary)" radius={[4, 4, 0, 0]} barSize={30} />
                                    <Bar dataKey="fabrication" name="Fabrication %" fill="#10b981" radius={[4, 4, 0, 0]} barSize={30} />
                                </BarChart>
                            </ResponsiveContainer>
                        </ChartCard>
                    ) : !selectedClient && (
                        <div className="card" style={{ padding: '48px', textAlign: 'center', background: 'var(--color-bg-page)', border: '1px dashed var(--color-border)' }}>
                            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                                Select a client above to view specific project analytics.
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
