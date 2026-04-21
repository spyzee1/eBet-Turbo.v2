import { HistoryEntry } from '../model/store';

interface Props {
  history: HistoryEntry[];
  onUpdateOutcome: (idx: number, outcome: 'win' | 'loss' | 'pending') => void;
  onClear: () => void;
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

export default function History({ history, onUpdateOutcome, onClear }: Props) {
  const wins = history.filter(h => h.outcome === 'win');
  const losses = history.filter(h => h.outcome === 'loss');
  const pending = history.filter(h => h.outcome === 'pending');
  const resolved = wins.length + losses.length;

  const totalProfit = history.reduce((sum, h) => {
    if (h.outcome === 'win') return sum + h.result.stakeFt * (h.result.kivalasztottOdds - 1);
    if (h.outcome === 'loss') return sum - h.result.stakeFt;
    return sum;
  }, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-dark-card rounded-xl border border-dark-border p-5">
          <p className="text-xs text-slate-500 font-medium mb-1">Összes tipp</p>
          <p className="text-2xl font-bold text-white">{history.length}</p>
          <p className="text-xs text-slate-600 mt-1">{pending.length} függőben</p>
        </div>
        <div className="bg-dark-card rounded-xl border border-dark-border p-5">
          <p className="text-xs text-slate-500 font-medium mb-1">Találati arány</p>
          <p className="text-2xl font-bold text-green">{resolved > 0 ? `${Math.round(wins.length / resolved * 100)}%` : '-'}</p>
          <p className="text-xs text-slate-600 mt-1">{wins.length}W / {losses.length}L</p>
        </div>
        <div className="bg-dark-card rounded-xl border border-dark-border p-5">
          <p className="text-xs text-slate-500 font-medium mb-1">Profit / Veszteség</p>
          <p className={`text-2xl font-bold ${totalProfit >= 0 ? 'text-green' : 'text-red'}`}>{totalProfit >= 0 ? '+' : ''}{Math.round(totalProfit)} Ft</p>
          <p className="text-xs text-slate-600 mt-1">Lezárt tippek alapján</p>
        </div>
        <div className="bg-dark-card rounded-xl border border-dark-border p-5">
          <p className="text-xs text-slate-500 font-medium mb-1">Atl. Edge</p>
          <p className="text-2xl font-bold text-yellow">{history.length > 0 ? pct(history.reduce((s, h) => s + h.result.kivalasztottEdge, 0) / history.length) : '-'}</p>
          <p className="text-xs text-slate-600 mt-1">Atl. conf: {history.length > 0 ? `${Math.round(history.reduce((s, h) => s + h.result.confidence, 0) / history.length * 100)}%` : '-'}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Tipp előzmény</h2>
        {history.length > 0 && (
          <button onClick={onClear} className="text-xs text-red/60 hover:text-red cursor-pointer">Összes törlés</button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="bg-dark-card rounded-xl border border-dark-border p-12 text-center">
          <h3 className="text-lg font-medium text-slate-400 mb-2">Nincs előzmény</h3>
          <p className="text-sm text-slate-600">A dashboardról mented ide a lezárt tippeket.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {history.map((entry, idx) => (
            <div key={idx} className="bg-dark-card rounded-lg border border-dark-border px-5 py-3 flex items-center gap-4">
              <div className={`w-2 h-2 rounded-full shrink-0 ${
                entry.outcome === 'win' ? 'bg-green' : entry.outcome === 'loss' ? 'bg-red' : 'bg-yellow animate-pulse'
              }`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    entry.result.input.liga === 'GT Leagues' ? 'bg-green/20 text-green' : 'bg-purple/20 text-purple'
                  }`}>
                    {entry.result.input.liga === 'GT Leagues' ? 'GT' : entry.result.input.liga === 'eAdriaticLeague' ? 'eAL' : 'Oth'}
                  </span>
                  <span className="text-sm text-white font-medium truncate">
                    {entry.result.input.playerA || 'A'} vs {entry.result.input.playerB || 'B'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {entry.result.valueBet} | {pct(entry.result.kivalasztottEdge)} edge | {entry.result.stakeFt} Ft
                </p>
              </div>
              <span className="text-[10px] text-slate-600 shrink-0">
                {new Date(entry.timestamp).toLocaleDateString('hu-HU')}
              </span>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => onUpdateOutcome(idx, 'win')} className={`px-2 py-1 text-xs rounded cursor-pointer transition ${entry.outcome === 'win' ? 'bg-green/20 text-green' : 'bg-dark-bg text-slate-500 hover:text-green'}`}>W</button>
                <button onClick={() => onUpdateOutcome(idx, 'loss')} className={`px-2 py-1 text-xs rounded cursor-pointer transition ${entry.outcome === 'loss' ? 'bg-red/20 text-red' : 'bg-dark-bg text-slate-500 hover:text-red'}`}>L</button>
                <button onClick={() => onUpdateOutcome(idx, 'pending')} className={`px-2 py-1 text-xs rounded cursor-pointer transition ${entry.outcome === 'pending' ? 'bg-yellow/20 text-yellow' : 'bg-dark-bg text-slate-500 hover:text-yellow'}`}>?</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
