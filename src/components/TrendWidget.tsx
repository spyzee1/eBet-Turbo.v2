import { useState, useEffect, useCallback, useRef } from 'react';
import { triggerTrendScan, getTrendStatus, TrendSignal } from '../api';

const POLL_INTERVAL = 5 * 60 * 1000;
const CHECKED_GREEN_KEY  = 'checked_green_matches';
const BETTING_JOURNAL_KEY = 'betting_journal';
const TREND_RED_KEY      = 'trend_red';

function leagueBadge(l: string) {
  if (l === 'GT Leagues')              return 'bg-green/20 text-green';
  if (l === 'Esoccer Battle')          return 'bg-yellow/20 text-yellow';
  if (l === 'Cyber Live Arena')        return 'bg-purple/20 text-purple';
  if (l === 'Esoccer H2H GG League')  return 'bg-orange-500/20 text-orange-400';
  if (l === 'Esports Volta')           return 'bg-cyan-500/20 text-cyan-400';
  return 'bg-slate-600/30 text-slate-400';
}

function signalKey(s: TrendSignal) {
  return `trend|${[s.playerA, s.playerB].sort().join('-')}|${s.nextMatchTime}`;
}

function buildCheckedMatch(sig: TrendSignal, strategy?: 'A' | 'B' | 'C') {
  const today = new Date().toISOString().split('T')[0];
  const fakeTip = {
    playerA: sig.playerA, teamA: sig.playerA,
    playerB: sig.playerB, teamB: sig.playerB,
    time: sig.nextMatchTime,
    date: today,
    league: sig.league,
    ouLine: sig.ouLine,
    vartGol: sig.avgTotalGoals,
    valueBet: `OVER ${sig.ouLine}`,
    ajanlottTipp: `OVER ${sig.ouLine}`,
    confidence: sig.signalStrength === 'TREND' ? 0.82 : 0.75,
    edge: sig.signalStrength === 'TREND' ? 0.10 : 0.07,
    winEselyA: 0.5, winEselyB: 0.5,
    overEsely: 0.70, underEsely: 0.30,
    stake: 2000,
    category: 'BET',
    oddsSource: 'vegas.hu',
  };
  const [h, m] = sig.nextMatchTime.split(':').map(Number);
  const ts = new Date();
  ts.setHours(h, m, 0, 0);
  return {
    matchId: signalKey(sig),
    tip: fakeTip,
    timestamp: ts.getTime(),
    date: today,
    betType: 'Over' as const,
    betLine: sig.ouLine,
    fromTrend: true,
    trendType: sig.signalStrength,
    strategy,
    odds: sig.oddsOver,
    trendAboveLinePct: sig.aboveLinePct,
    trendAboveLineCount: sig.aboveLineCount,
    trendAvgGoals: sig.avgTotalGoals,
    trendSlope: sig.trendSlope,
    trendTodayH2H: sig.todayH2H,
    trendTotalMatches: sig.todayH2H.length,
  };
}

function addToGreenList(sig: TrendSignal, strategy?: 'A' | 'B' | 'C') {
  try {
    const key = signalKey(sig);
    const entry = buildCheckedMatch(sig, strategy);
    const stored: any[] = JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]');
    if (!stored.some(m => m.matchId === key)) {
      stored.push(entry);
      localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(stored));
    }
    const journal: any[] = JSON.parse(localStorage.getItem(BETTING_JOURNAL_KEY) || '[]');
    if (!journal.some(m => m.matchId === key)) {
      journal.push(entry);
      localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(journal));
    }
    window.dispatchEvent(new Event('checked-matches-updated'));
  } catch {}
}

function removeFromGreenList(sig: TrendSignal) {
  try {
    const key = signalKey(sig);
    const stored: any[] = JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]');
    localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(stored.filter(m => m.matchId !== key)));
    window.dispatchEvent(new Event('checked-matches-updated'));
  } catch {}
}

export default function TrendWidget({ strategy }: { strategy?: 'A' | 'B' | 'C' }) {
  const [signals, setSignals]   = useState<TrendSignal[]>([]);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const [greenSet, setGreenSet] = useState<Set<string>>(() => {
    try {
      const stored: any[] = JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]');
      return new Set(stored.filter(m => m.fromTrend).map((m: any) => m.matchId));
    } catch { return new Set(); }
  });
  const [redSet, setRedSet] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(TREND_RED_KEY) || '[]')); }
    catch { return new Set(); }
  });

  useEffect(() => {
    localStorage.setItem(TREND_RED_KEY, JSON.stringify([...redSet]));
  }, [redSet]);

  // Sync greenSet if another tab updates localStorage
  useEffect(() => {
    const sync = () => {
      try {
        const stored: any[] = JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]');
        setGreenSet(new Set(stored.filter(m => m.fromTrend).map((m: any) => m.matchId)));
      } catch {}
    };
    window.addEventListener('checked-matches-updated', sync);
    return () => window.removeEventListener('checked-matches-updated', sync);
  }, []);

  const toggleGreen = (key: string, sig: TrendSignal) => {
    if (greenSet.has(key)) {
      removeFromGreenList(sig);
      setGreenSet(prev => { const n = new Set(prev); n.delete(key); return n; });
    } else {
      addToGreenList(sig, strategy);
      setGreenSet(prev => new Set([...prev, key]));
      setRedSet(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  };
  const toggleRed = (key: string) => {
    setRedSet(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        // Ha zöldben volt, vegyük ki a Mérkőzés Listából
        if (greenSet.has(key)) {
          try {
            const stored: any[] = JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]');
            localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(stored.filter(m => m.matchId !== key)));
            window.dispatchEvent(new Event('checked-matches-updated'));
          } catch {}
          setGreenSet(g => { const n = new Set(g); n.delete(key); return n; });
        }
      }
      return next;
    });
  };

  const prevKeySet = useRef<Set<string>>(new Set());

  function playTrendSound() {
    try {
      const ctx = new AudioContext();
      [660, 880, 1100].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.13);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.13 + 0.18);
        osc.start(ctx.currentTime + i * 0.13);
        osc.stop(ctx.currentTime + i * 0.13 + 0.18);
      });
    } catch {}
  }

  const runScan = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await triggerTrendScan();
      // Hangjelzés ha új jelzés jelent meg
      const newKeys = new Set(res.signals.map(s => signalKey(s)));
      const hasNew = [...newKeys].some(k => !prevKeySet.current.has(k));
      if (hasNew && res.signals.length > 0 && prevKeySet.current.size > 0) {
        playTrendSound();
      }
      prevKeySet.current = newKeys;
      setSignals(res.signals);
      setLastScan(new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }));
    } catch {
      setError('Trend scan sikertelen');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getTrendStatus()
      .then(s => { if (s.lastRunISO) setLastScan(new Date(s.lastRunISO).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })); })
      .catch(() => {});
    runScan(true);
    const iv = setInterval(() => runScan(true), POLL_INTERVAL);
    return () => clearInterval(iv);
  }, [runScan]);

  const strongCount = signals.filter(s => s.signalStrength === 'TREND').length;

  return (
    <div className="bg-dark-card rounded-xl border border-dark-border overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-green-400">▲</span>
          <span className="text-sm font-semibold text-white">Intraday Trend Jelzések</span>
          {signals.length > 0 && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              strongCount > 0
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40'
                : 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
            }`}>
              {signals.length} aktív
            </span>
          )}
          {strongCount > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse">
              {strongCount} ERŐS
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lastScan && <span className="text-xs text-slate-500">Utolsó scan: {lastScan}</span>}
          <button
            onClick={e => { e.stopPropagation(); runScan(); }}
            disabled={loading}
            className="text-xs px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition disabled:opacity-40 cursor-pointer"
          >
            {loading ? '⟳ Scanning...' : '↺ Scan'}
          </button>
          <svg className={`w-4 h-4 text-slate-500 transition-transform ${collapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="border-t border-dark-border">
          {error && <div className="px-4 py-3 text-xs text-red-400 bg-red-500/10">{error}</div>}
          {loading && signals.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-slate-500">Trend scan fut...</div>
          )}
          {!loading && signals.length === 0 && !error && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-slate-500">Nincs aktív trend jelzés</p>
              <p className="text-xs text-slate-600 mt-1">A scanner 5 percenként automatikusan fut</p>
            </div>
          )}
          {signals.length > 0 && (
            <div className="divide-y divide-dark-border">
              {signals.map((sig, i) => {
                const key = signalKey(sig);
                return (
                  <TrendCard
                    key={i}
                    signal={sig}
                    isGreen={greenSet.has(key)}
                    isRed={redSet.has(key)}
                    onGreen={() => toggleGreen(key, sig)}
                    onRed={() => toggleRed(key)}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface TrendCardProps {
  signal: TrendSignal;
  isGreen: boolean;
  isRed: boolean;
  onGreen: () => void;
  onRed: () => void;
}

function TrendCard({ signal, isGreen, isRed, onGreen, onRed }: TrendCardProps) {
  const isValue = signal.signalStrength === 'VALUE';

  return (
    <div className={`px-4 pt-3 pb-4 hover:bg-white/3 transition ${isValue ? 'border-l-4 border-yellow-400' : 'border-l-4 border-orange-500'}`}>

      {/* Sor 1: típus badge + liga + időpont */}
      <div className="flex items-center gap-2 mb-3">
        <span
          style={isValue ? { backgroundColor: '#facc15', color: '#111827' } : {}}
          className={`text-[10px] font-bold px-2 py-0.5 rounded ${!isValue ? 'bg-orange-500 text-white' : ''}`}
        >
          {isValue ? '💰 VALUE' : '🚀 TREND'}
        </span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${leagueBadge(signal.league)}`}>
          {signal.league}
        </span>
        <span className="text-xs text-white font-mono font-bold">{signal.nextMatchTime}</span>
        <span className="text-xs text-slate-500">({signal.minutesUntil} perc múlva)</span>
      </div>

      {/* Sor 2: Játékos nevek — NAGY — KÖZÉPRE */}
      <div className="flex items-center justify-center gap-3 mb-3">
        <span className="text-xl font-black text-white uppercase tracking-wide select-text cursor-text">{signal.playerA}</span>
        <span className="text-slate-500 text-base font-normal select-none">vs</span>
        <span className="text-xl font-black text-white uppercase tracking-wide select-text cursor-text">{signal.playerB}</span>
      </div>

      {/* Sor 3: H2H gólsorozat — KÖZÉPRE, nevek alá szimmetrikusan */}
      <div className="flex justify-center items-center gap-1 flex-wrap mb-3">
        {signal.todayH2H.map((m, i) => {
          const aboveLine = m.total > signal.ouLine;
          const rising    = i > 0 && m.total > signal.todayH2H[i - 1].total;
          const falling   = i > 0 && m.total < signal.todayH2H[i - 1].total;
          return (
            <div key={i} className="flex items-center gap-0.5">
              {i > 0 && (
                <span className={`text-sm font-bold ${rising ? 'text-green-400' : falling ? 'text-red-400' : 'text-slate-600'}`}>
                  {rising ? '↑' : falling ? '↓' : '→'}
                </span>
              )}
              <span className={`text-sm font-mono font-black px-2 py-1 rounded ${
                aboveLine ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
              }`}>
                {m.goalsA}–{m.goalsB} <span className="text-xs opacity-80">({m.total})</span>
              </span>
            </div>
          );
        })}
      </div>

      {/* Sor 4: Statisztikák — szellős, vízszintesen — KÖZÉPRE */}
      <div className="flex justify-center items-center gap-6 mb-4">
        <div className="text-center">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Vonal</div>
          <div className="text-lg font-bold text-white">{signal.ouLine}</div>
        </div>
        <div className="w-px h-8 bg-dark-border" />
        <div className="text-center">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">
            {isValue ? 'Vonal felett' : 'Trend'}
          </div>
          <div className={`text-lg font-bold ${isValue ? 'text-yellow-300' : 'text-orange-400'}`}>
            {isValue
              ? `${signal.aboveLineCount}/${signal.todayH2H.length} (${Math.round(signal.aboveLinePct * 100)}%)`
              : `+${signal.trendSlope.toFixed(1)}/meccs`}
          </div>
        </div>
        <div className="w-px h-8 bg-dark-border" />
        <div className="text-center">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Átlag</div>
          <div className="text-lg font-bold text-white">{signal.avgTotalGoals.toFixed(1)} gól</div>
        </div>
      </div>

      {/* Sor 5: OVER badge (bal) + pipák (jobb) — egy sorban */}
      <div className="flex items-center justify-between">
        <div
          style={isValue ? {backgroundColor:'#facc15',color:'#111827'} : {}}
          className={`px-4 py-2 rounded-lg font-black text-sm flex items-center gap-2 ${!isValue ? 'bg-orange-500 text-white' : ''}`}
        >
          <span>OVER {signal.ouLine}</span>
          <span className="opacity-85">
            {isValue ? `${Math.round(signal.aboveLinePct * 100)}%` : `+${signal.trendSlope.toFixed(1)}/m`}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={onGreen} title="Megtéve"
            className={`w-6 h-6 rounded border-2 flex items-center justify-center cursor-pointer transition-all text-xs font-bold ${isGreen ? 'bg-green/30 border-green text-green' : 'border-slate-600 hover:border-green'}`}>
            {isGreen && '✓'}
          </button>
          <button onClick={onRed} title="Kihagyom"
            className={`w-6 h-6 rounded border-2 flex items-center justify-center cursor-pointer transition-all text-xs font-bold ${isRed ? 'bg-red/30 border-red text-red' : 'border-slate-600 hover:border-red'}`}>
            {isRed && '✕'}
          </button>
        </div>
      </div>

    </div>
  );
}
