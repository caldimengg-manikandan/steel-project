import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const data = [
  { month: 'Oct', active: 12, completed: 8 },
  { month: 'Nov', active: 15, completed: 10 },
  { month: 'Dec', active: 18, completed: 14 },
  { month: 'Jan', active: 14, completed: 20 },
  { month: 'Feb', active: 20, completed: 18 },
  { month: 'Mar', active: 24, completed: 22 },
];

export default function ProjectTrendsChart() {
  return (
    <div className="w-full bg-white p-6 rounded-xl shadow-sm border border-slate-200">
      <div className="mb-6">
        <h3 className="text-lg font-bold text-[#0f172a] mb-1">Project Trends</h3>
        <p className="text-sm text-slate-500">
          Active vs Completed projects over the last 6 months
        </p>
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{
              top: 5,
              right: 20,
              left: 0,
              bottom: 5,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis 
              dataKey="month" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: '#64748b', fontSize: 12 }}
              dy={10}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: '#64748b', fontSize: 12 }}
              dx={-10}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0f172a',
                borderRadius: '8px',
                border: 'none',
                color: '#f8fafc',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
              }}
              itemStyle={{ color: '#f8fafc', fontSize: '13px' }}
              labelStyle={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px' }}
              cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }}
            />
            <Legend 
              iconType="circle"
              wrapperStyle={{ fontSize: '13px', paddingTop: '16px' }}
            />
            <Line
              name="Active Projects"
              type="monotone"
              dataKey="active"
              stroke="#0f172a"
              strokeWidth={3}
              dot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: '#0f172a' }}
              activeDot={{ r: 6, strokeWidth: 0, fill: '#0f172a' }}
            />
            <Line
              name="Completed Projects"
              type="monotone"
              dataKey="completed"
              stroke="#10b981"
              strokeWidth={3}
              dot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: '#10b981' }}
              activeDot={{ r: 6, strokeWidth: 0, fill: '#10b981' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
