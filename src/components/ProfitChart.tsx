import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { HistoryEntry } from '../model/store';

interface Props {
  history: HistoryEntry[];
}

export default function ProfitChart({ history }: Props) {
  // Build cumulative profit data from oldest to newest
  const resolved = [...history]
    .filter(h => h.outcome === 'win' || h.outcome === 'loss')
    .reverse();

  if (resolved.length < 2) {
    return (
      <div className="bg-dark-card rounded-xl border border-dark-border p-6 text-center">
        <p className="text-sm text-slate-500">Legalább 2 lezárt tipp kell a grafikonhoz.</p>
      </div>
    );
  }

  let cumulative = 0;
  const data = resolved.map((h, i) => {
    const profit = h.outcome === 'win'
      ? h.result.stakeFt * (h.result.kivalasztottOdds - 1)
      : -h.result.stakeFt;
    cumulative += profit;
    return {
      idx: i + 1,
      label: new Date(h.timestamp).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' }),
      profit: Math.round(cumulative),
      bet: `${h.result.input.playerA} vs ${h.result.input.playerB}`,
    };
  });

  const isPositive = cumulative >= 0;

  return (
    <div className="bg-dark-card rounded-xl border border-dark-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">Profit görbe</h3>
        <span className={`text-sm font-bold ${isPositive ? 'text-green' : 'text-red'}`}>
          {isPositive ? '+' : ''}{Math.round(cumulative)} Ft
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
              <stop offset="95%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2e45" />
          <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={{ stroke: '#2a2e45' }} />
          <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={{ stroke: '#2a2e45' }} />
          <Tooltip
            contentStyle={{ background: '#1a1d2e', border: '1px solid #2a2e45', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#94a3b8' }}
            formatter={(value) => [`${value} Ft`, 'Profit']}
          />
          <Area
            type="monotone"
            dataKey="profit"
            stroke={isPositive ? '#10b981' : '#ef4444'}
            strokeWidth={2}
            fill="url(#profitGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
