import { useState } from 'react';
import { MatchResult } from '../model/types';
import { HistoryEntry } from '../model/store';
import BetCard from './BetCard';
import ProfitChart from './ProfitChart';

interface Props {
  results: MatchResult[];
  history: HistoryEntry[];
  bankroll: number;
  onRemoveMatch: (id: string) => void;
  onSaveToHistory: (result: MatchResult) => void;
}

type FilterLiga = 'all' | 'GT Leagues' | 'eAdriaticLeague' | 'Other';
type FilterSort = 'default' | 'confidence' | 'edge';

export default function Dashboard({ results, history, bankroll, onRemoveMatch, onSaveToHistory }: Props) {
  const [filterLiga, setFilterLiga] = useState<FilterLiga>('all');
  const [filterMinConf, setFilterMinConf] = useState(0);
  const [filterSort, setFilterSort] = useState<FilterSort>('default');
  const [hidePass, setHidePass] = useState(false);

  // Apply filters
  let filtered = results;
  if (filterLiga !== 'all') filtered = filtered.filter(r => r.input.liga === filterLiga);
  if (hidePass) filtered = filtered.filter(r => r.valueBet !== 'PASS');
  if (filterMinConf > 0) filtered = filtered.filter(r => r.confidence >= filterMinConf / 100);

  // Sort
  if (filterSort === 'confidence') filtered = [...filtered].sort((a, b) => b.confidence - a.confidence);
  else if (filterSort === 'edge') filtered = [...filtered].sort((a, b) => b.kivalasztottEdge - a.kivalasztottEdge);

  const activeValueBets = results.filter(r => r.valueBet !== 'PASS');
  const totalStake = activeValueBets.reduce((s, r) => s + r.stakeFt, 0);
  const avgConfidence = activeValueBets.length > 0
    ? activeValueBets.reduce((s, r) => s + r.confidence, 0) / activeValueBets.length : 0;
  const avgEdge = activeValueBets.length > 0
    ? activeValueBets.reduce((s, r) => s + r.kivalasztottEdge, 0) / activeValueBets.length : 0;

  const historyWins = history.filter(h => h.outcome === 'win').length;
  const historyLosses = history.filter(h => h.outcome === 'loss').length;
  const historyResolved = historyWins + historyLosses;
  const hitRate = historyResolved > 0 ? historyWins / historyResolved : 0;

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <StatCard label="Aktív tippek" value={String(activeValueBets.length)} sub={`${results.length} meccs elemezve`} color="text-accent-light" />
        <StatCard label="Összes tét" value={`${totalStake} Ft`} sub={`Bankroll: ${bankroll} Ft`} color="text-green" />
        <StatCard label="Átl. confidence" value={`${Math.round(avgConfidence * 100)}%`} sub={`Átl. edge: ${(avgEdge * 100).toFixed(1)}%`} color="text-yellow" />
        <StatCard label="Találati arány" value={historyResolved > 0 ? `${Math.round(hitRate * 100)}%` : '-'} sub={`${historyWins}W / ${historyLosses}L (${history.length} össz.)`} color="text-purple" />
      </div>

      {/* Profit chart */}
      <ProfitChart history={history} />

      {results.length > 0 ? (
        <>
          {/* Filters */}
          <div className="bg-dark-card rounded-xl border border-dark-border p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-slate-500 font-medium">Szűrők:</span>
              <select
                value={filterLiga}
                onChange={e => setFilterLiga(e.target.value as FilterLiga)}
                className="bg-dark-bg border border-dark-border rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
              >
                <option value="all">Összes liga</option>
                <option value="GT Leagues">GT Leagues</option>
                <option value="eAdriaticLeague">eAdriaticLeague</option>
                <option value="Other">Egyéb</option>
              </select>
              <select
                value={filterSort}
                onChange={e => setFilterSort(e.target.value as FilterSort)}
                className="bg-dark-bg border border-dark-border rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
              >
                <option value="default">Sorrend: alapértelmezett</option>
                <option value="confidence">Sorrend: confidence</option>
                <option value="edge">Sorrend: edge</option>
              </select>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500">Min conf:</label>
                <input
                  type="range" min="0" max="90" step="5" value={filterMinConf}
                  onChange={e => setFilterMinConf(+e.target.value)}
                  className="w-20 accent-accent"
                />
                <span className="text-xs text-white w-8">{filterMinConf}%</span>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer ml-auto">
                <input type="checkbox" checked={hidePass} onChange={e => setHidePass(e.target.checked)} className="accent-accent" />
                PASS elrejtése
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Aktuális elemzések</h2>
            <span className="text-xs text-slate-500">{filtered.length} / {results.length} meccs</span>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {filtered.map(r => (
              <BetCard key={r.input.id} result={r} onRemove={() => onRemoveMatch(r.input.id)} onSaveToHistory={() => onSaveToHistory(r)} />
            ))}
          </div>
        </>
      ) : (
        <div className="bg-dark-card rounded-xl border border-dark-border p-8 lg:p-12 text-center">
          <svg className="w-12 h-12 lg:w-16 lg:h-16 mx-auto text-slate-700 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
          <h3 className="text-base lg:text-lg font-medium text-slate-400 mb-2">Nincs még elemzett meccs</h3>
          <p className="text-sm text-slate-600">Adj hozzá a „Közelgő meccsek" vagy az „Új meccs" menüpontból.</p>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="bg-dark-card rounded-xl border border-dark-border p-4 lg:p-5">
      <p className="text-[11px] lg:text-xs text-slate-500 font-medium mb-1">{label}</p>
      <p className={`text-xl lg:text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-[11px] lg:text-xs text-slate-600 mt-1">{sub}</p>
    </div>
  );
}
