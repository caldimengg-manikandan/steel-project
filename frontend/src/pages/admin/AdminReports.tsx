import { useState, useEffect, useCallback } from 'react';
import {
    BarChart, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import {
    IconChart,
    IconFolder, IconTrendingUp
} from '../../components/Icons';
import { adminGetReportsData } from '../../services/adminUserApi';
import { adminListClients } from '../../services/adminClientApi';
import type { Client } from '../../types';

// ─── Simple Sub-components ───

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div style={{ background: '#fff', border: '1px solid #ddd', padding: '10px', borderRadius: '8px', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
                <p style={{ margin: '0 0 5px 0', fontWeight: 700 }}>{label}</p>
                {payload.map((entry: any, index: number) => (
                    <div key={index} style={{ fontSize: '13px', color: entry.color }}>
                        {entry.name}: <strong>{entry.value}%</strong>
                    </div>
                ))}
            </div>
        );
    }
    return null;
};

const StatCard = ({ label, value, icon, variant }: any) => (
    <div className="card" style={{ padding: '16px 20px', border: '1px solid #eee', background: '#fff', borderRadius: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: variant === 'danger' ? '#ef4444' : '#64748b' }}>
            <span style={{ transform: 'scale(0.8)' }}>{icon}</span>
            <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em' }}>{label}</span>
        </div>
        <div style={{ fontSize: '28px', fontWeight: 800, marginTop: '8px', color: '#1e293b' }}>{value}</div>
    </div>
);

const ChartCard = ({ title, children }: { title: string, children: React.ReactNode }) => (
    <div className="card" style={{ padding: '20px', border: '1px solid #eee', background: '#fff', borderRadius: '16px', marginBottom: '20px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px', color: '#1e293b' }}>{title}</h3>
        <div style={{ minHeight: '300px' }}>{children}</div>
    </div>
);

// ─── Main Page ───

export default function AdminReports() {
    const [days, setDays] = useState(30);
    const [data, setData] = useState<any>(null);
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedClient, setSelectedClient] = useState<string | null>(null);

    const fetchData = useCallback(async (d: number) => {
        try {
            setLoading(true);
            const [res, clientsData] = await Promise.all([
                adminGetReportsData(d),
                adminListClients()
            ]);
            setData(res);
            setClients(clientsData.clients || []);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch reports');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData(days);
    }, [days, fetchData]);

    if (loading && !data) return <div style={{ padding: '50px', textAlign: 'center' }}>Loading reports...</div>;
    if (error) return <div className="info-box danger">Error: {error}</div>;
    if (!data) return null;

    const { projectProgress, projects } = data;

    const filteredProjects = !selectedClient ? projects : projects.filter((p: any) => p.clientName === selectedClient);
    const filteredProgress = !selectedClient ? projectProgress : projectProgress.filter((p: any) => p.clientName === selectedClient);

    const OVERVIEW_STATS = [
        { label: 'Total Projects', value: filteredProjects.length, icon: <IconFolder /> },
        { label: 'Active RFIs', value: filteredProjects.reduce((acc: number, p: any) => acc + (p.openRfiCount || 0), 0), icon: <IconChart /> },
        { label: 'Delayed Tasks', value: filteredProjects.reduce((acc: number, p: any) => {
            const delayed = (p.sequences || []).filter((s: any) => {
                const targetDate = s.approvalDate || s.deadline;
                return s.status !== 'Completed' && targetDate && new Date(targetDate) < new Date();
            }).length;
            return acc + delayed;
        }, 0), icon: <IconTrendingUp />, variant: 'danger' },
    ];

    const uniqueClients = clients.map(c => c.name).sort();

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', transition: 'opacity 0.2s ease', opacity: loading ? 0.6 : 1, pointerEvents: loading ? 'none' : 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '24px', fontWeight: 750 }}>Analytics</h2>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <div className="btn-group">
                        {[7, 30, 90].map(d => (
                            <button key={d} className={`btn ${days === d ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setDays(d)}>Last {d} Days</button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Compact Client Chips */}
            <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '11px', fontWeight: 800, color: '#94a3b8', marginBottom: '10px', textTransform: 'uppercase' }}>Select Client</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button 
                        onClick={() => setSelectedClient(null)}
                        className={`btn ${!selectedClient ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                        style={{ borderRadius: '20px', padding: '6px 16px' }}
                    >
                        All Clients
                    </button>
                    {uniqueClients.map(client => (
                        <button 
                            key={client as string}
                            onClick={() => setSelectedClient(client as string)}
                            className={`btn ${selectedClient === client ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                            style={{ borderRadius: '20px', padding: '6px 16px' }}
                        >
                            {client as string}
                        </button>
                    ))}
                </div>
            </div>

            <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
                {OVERVIEW_STATS.map((stat, i) => <StatCard key={i} {...stat} />)}
            </div>

            <ChartCard title={selectedClient ? `${selectedClient} - Progress` : "Project Progress"}>
                <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={filteredProgress}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 100]} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: 12, paddingBottom: 15 }} />
                        <Bar dataKey="approval" name="Approval" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={32} />
                        <Bar dataKey="fabrication" name="Fabrication" fill="#10b981" radius={[4, 4, 0, 0]} barSize={32} />
                    </BarChart>
                </ResponsiveContainer>
            </ChartCard>

            <div className="card" style={{ padding: '0', border: '1px solid #eee', background: '#fff', borderRadius: '16px', overflow: 'hidden' }}>
                <div className="table-wrapper">
                    <table style={{ fontSize: '13px' }}>
                        <thead style={{ background: '#f8fafc' }}>
                            <tr>
                                <th>Client</th>
                                <th>Project</th>
                                <th style={{ textAlign: 'center' }}>RFIs</th>
                                <th style={{ width: '150px' }}>Approval</th>
                                <th style={{ width: '150px' }}>Fabrication</th>
                                <th>Date Created</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredProjects.map((p: any, i: number) => (
                                <tr key={i}>
                                    <td style={{ fontWeight: 700, color: '#3b82f6', cursor: 'pointer' }} onClick={() => setSelectedClient(p.clientName)}>{p.clientName}</td>
                                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                                    <td style={{ textAlign: 'center', color: '#ef4444', fontWeight: 700 }}>{p.openRfiCount || 0}</td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <div style={{ flex: 1, height: '4px', background: '#f1f5f9', borderRadius: '2px', overflow: 'hidden' }}>
                                                <div style={{ height: '100%', width: `${p.approvalPercentage || 0}%`, background: '#3b82f6' }} />
                                            </div>
                                            <span style={{ fontSize: '11px', fontWeight: 700 }}>{p.approvalPercentage || 0}%</span>
                                        </div>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <div style={{ flex: 1, height: '4px', background: '#f1f5f9', borderRadius: '2px', overflow: 'hidden' }}>
                                                <div style={{ height: '100%', width: `${p.fabricationPercentage || 0}%`, background: '#10b981' }} />
                                            </div>
                                            <span style={{ fontSize: '11px', fontWeight: 700 }}>{p.fabricationPercentage || 0}%</span>
                                        </div>
                                    </td>
                                    <td style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>
                                        {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : 'N/A'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
