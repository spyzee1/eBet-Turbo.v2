import { useState, useEffect, useCallback } from 'react';
import { fetchTopTips, TopTip, TopTipsResponse } from '../api';
import { MatchInput } from '../model/types';
import H2HModal from './H2HModal';
import { useFilterPresets, TipFilterPreset } from '../hooks/useFilterPresets';
import { useNewTipDetector, useNotificationSettings } from '../hooks/useNotifications';

interface Props {
  onAddMatch: (m: MatchInput) => void;
}

function pct(v: number) { return `${(v * 100).toFixed(1)}%`; }

function genId() { return Math.random().toString(36).slice(2, 10); }

function confColor(c: number) {
  if (c >= 0.75) return 'text-green';
  if (c >= 0.6) return 'text-yellow';
  return 'text-red';
}

function leagueBadge(l: string) {
  if (l === 'GT Leagues') return 'bg-green/20 text-green';
  if (l === 'Esoccer Battle') return 'bg-yellow/20 text-yellow';
  if (l === 'Cyber Live Arena') return 'bg-purple/20 text-purple';
  if (l === 'Esoccer H2H GG League') return 'bg-orange-500/20 text-orange-400';
  return 'bg-slate-600/30 text-slate-400';
}

function categoryBadge(cat: string | undefined) {
  if (cat === 'STRONG_BET') return { bg: 'bg-green text-white', label: 'STRONG BET' };
  if (cat === 'BET') return { bg: 'bg-yellow text-dark-bg', label: 'BET' };
  return { bg: 'bg-slate-600 text-slate-200', label: 'NO BET' };
}

function medalIcon(idx: number) {
  if (idx === 0) return '🥇';
  if (idx === 1) return '🥈';
  if (idx === 2) return '🥉';
  return `#${idx + 1}`;
}

type Filter = 'all' | 'strong' | 'h2h' | 'liveOdds';
type SortMode = 'time' | 'probability';

const CHECKED_GREEN_KEY = 'checked_green_matches';
const CHECKED_RED_KEY = 'checked_red_matches';
const BETTING_JOURNAL_KEY = 'betting_journal';

interface CheckedMatch {
  matchId: string;
  tip: TopTip;
  timestamp: number;
  date: string;
  betType?: 'Over' | 'Under';
  betLine?: number;
  result?: 'Win' | 'Loss';
  stake?: number;
  odds?: number;
}

export default function TopTips({ onAddMatch }: Props) {
  const [data, setData] = useState<TopTipsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedLeagues, setSelectedLeagues] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(10);
  const [filter, setFilter] = useState<Filter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('time');
  const [h2hModal, setH2hModal] = useState<{ a: string; b: string; lg: string } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [showPresetForm, setShowPresetForm] = useState(false);
  const [strategy, setStrategy] = useState<'A' | 'B'>('B'); // ← ÚJ: Strategy választó (default: B)

  const [checkedMatches, setCheckedMatches] = useState<CheckedMatch[]>(() => {
    try {
      const stored = localStorage.getItem(CHECKED_GREEN_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      const valid = parsed.filter((item: any) =>
        item && typeof item === 'object' && item.matchId && item.tip && typeof item.tip === 'object'
      );
      // Clear stale data from previous days on load
      const today = new Date().toISOString().split('T')[0];
      const hasStale = valid.some((item: any) => item.date && item.date < today);
      if (hasStale) {
        localStorage.removeItem(CHECKED_GREEN_KEY);
        return [];
      }
      return valid;
    } catch (e) {
      console.error('Hiba a zöld pipák betöltésekor:', e);
      return [];
    }
  });

  const [checkedRed, setCheckedRed] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(CHECKED_RED_KEY);
      if (!stored) return new Set();
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? new Set(parsed) : new Set();
    } catch (e) {
      console.error('Hiba a piros pipák betöltésekor:', e);
      return new Set();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(checkedMatches));
    } catch (e) {
      console.error('Hiba a zöld pipák mentésekor:', e);
    }
  }, [checkedMatches]);

  useEffect(() => {
    try {
      localStorage.setItem(CHECKED_RED_KEY, JSON.stringify([...checkedRed]));
    } catch (e) {
      console.error('Hiba a piros pipák mentésekor:', e);
    }
  }, [checkedRed]);

  useEffect(() => {
    const checkMidnight = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      
      if (hours === 23 && minutes === 59) {
        console.log('🕐 23:59 - Napi lista törlése (Napló megmarad!)');
        setCheckedMatches([]);
        setCheckedRed(new Set());
        try {
          localStorage.removeItem(CHECKED_GREEN_KEY);
          localStorage.removeItem(CHECKED_RED_KEY);
          console.log('✅ Napi lista törölve! Napló megmaradt.');
        } catch (e) {
          console.error('Hiba a localStorage törlésekor:', e);
        }
      }
    };

    const interval = setInterval(checkMidnight, 60_000);
    checkMidnight();
    
    return () => clearInterval(interval);
  }, []);

  const { presets, addPreset, removePreset } = useFilterPresets();
  const { soundEnabled, toggleSound, browserNotifEnabled, enableBrowserNotif, disableBrowserNotif } = useNotificationSettings();

  useNewTipDetector(data?.tips, true);

  // Sync from Napló: when Napló updates a result, reload checkedMatches from localStorage
  useEffect(() => {
    const handleExternalUpdate = () => {
      try {
        const stored = localStorage.getItem(CHECKED_GREEN_KEY);
        if (!stored) return;
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setCheckedMatches(parsed.filter((item: any) => item?.matchId && item?.tip));
        }
      } catch {}
    };
    window.addEventListener('checked-matches-updated', handleExternalUpdate);
    return () => window.removeEventListener('checked-matches-updated', handleExternalUpdate);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const leagueFilter = selectedLeagues.size === 1 
        ? Array.from(selectedLeagues)[0] 
        : undefined;
      
      const result = await fetchTopTips(leagueFilter, limit, strategy); // ← STRATEGY PARAMÉTER!
      setData(result);
    } catch {
      setError('Nem sikerült betölteni. Ellenőrizd a szervert (port 3005).');
    } finally {
      setLoading(false);
    }
  }, [selectedLeagues, limit, strategy]); // ← strategy dependency!

  const toggleLeague = (league: string) => {
    setSelectedLeagues(prev => {
      const next = new Set(prev);
      if (next.has(league)) {
        next.delete(league);
      } else {
        next.add(league);
      }
      return next;
    });
  };

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  const applyPreset = (p: TipFilterPreset) => {
    const leagues = p.league ? new Set([p.league]) : new Set<string>();
    setSelectedLeagues(leagues);
    setFilter(p.filter);
    setLimit(p.limit);
  };

  const saveCurrentAsPreset = () => {
    if (!presetName.trim()) return;
    const leagueStr = selectedLeagues.size === 1 ? Array.from(selectedLeagues)[0] : '';
    addPreset({ name: presetName.trim(), league: leagueStr, filter, limit });
    setPresetName('');
    setShowPresetForm(false);
  };

  const addTip = (tip: TopTip) => {
    const liga = tip.league === 'GT Leagues' ? 'GT Leagues' as const
      : tip.league === 'Cyber Live Arena' ? 'eAdriaticLeague' as const
      : 'Other' as const;
    const percek = tip.league === 'GT Leagues' ? 12 : tip.league === 'Cyber Live Arena' ? 10 : tip.league === 'Esoccer Battle' ? 8 : 6;

    const match: MatchInput = {
      id: genId(), liga, percek, matchTime: tip.time, matchDate: tip.date,
      piacTipus: liga === 'GT Leagues' ? 'Over/Under' : 'Win',
      playerA: tip.playerA, playerB: tip.playerB,
      oddsA: tip.oddsA ?? 1.85,
      oddsB: tip.oddsB ?? 1.95,
      gfA: 0, gaA: 0, gfB: 0, gaB: 0,
      winRateA: tip.winEselyA, winRateB: tip.winEselyB,
      formaA: 0.5, formaB: 0.5, h2hA: 0.5, h2hB: 0.5,
      ouLine: tip.ouLine,
      oddsOver: tip.oddsOver ?? 1.85,
      oddsUnder: tip.oddsUnder ?? 1.95,
    };
    onAddMatch(match);
  };

  const toggleGreenCheck = (matchId: string, tip: TopTip) => {
    setCheckedMatches(prev => {
      const exists = prev.find(m => m.matchId === matchId);
      if (exists) {
        return prev.filter(m => m.matchId !== matchId);
      } else {
        setCheckedRed(prevRed => {
          const nextRed = new Set(prevRed);
          nextRed.delete(matchId);
          return nextRed;
        });
        
        const today = new Date().toISOString().split('T')[0];
        let matchDate = tip.date || today;
        
        if (matchDate && matchDate.includes('/')) {
          const [month, day] = matchDate.split('/');
          const year = new Date().getFullYear();
          matchDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        
        const matchTime = tip.time || '00:00';
        const matchDateTime = new Date(`${matchDate}T${matchTime}`);
        const timestamp = matchDateTime.getTime();
        
        console.log(`✅ Timestamp számítás: ${tip.playerA} vs ${tip.playerB}`);
        console.log(`  tip.date: "${tip.date}" → matchDate: "${matchDate}"`);
        console.log(`  matchTime: "${matchTime}"`);
        console.log(`  timestamp: ${timestamp} (${new Date(timestamp).toLocaleString('hu-HU')})`);
        
        // Auto-populate bet fields from tip data
        const autoBetType: 'Over' | 'Under' | undefined =
          tip.valueBet?.toUpperCase().startsWith('OVER') ? 'Over'
          : tip.valueBet?.toUpperCase().startsWith('UNDER') ? 'Under'
          : tip.vartGol > (tip.ouLine || 0) ? 'Over' : 'Under';
        const autoOdds = autoBetType === 'Over'
          ? (tip.oddsOver && tip.oddsOver > 1 ? tip.oddsOver : undefined)
          : (tip.oddsUnder && tip.oddsUnder > 1 ? tip.oddsUnder : undefined);

        const newMatch = {
          matchId,
          tip,
          timestamp,
          date: matchDate,
          betType: autoBetType,
          betLine: tip.ouLine > 0 ? tip.ouLine : undefined,
          odds: autoOdds,
          stake: 2000,
        };
        
        try {
          const journal = JSON.parse(localStorage.getItem(BETTING_JOURNAL_KEY) || '[]');
          const alreadyInJournal = journal.some((m: any) => m.matchId === matchId);
          if (!alreadyInJournal) {
            journal.push(newMatch);
            localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(journal));
          }
        } catch (e) {
          console.error('Napló mentési hiba:', e);
        }
        
        return [...prev, newMatch];
      }
    });
  };

  const toggleRedCheck = (matchId: string) => {
    setCheckedRed(prev => {
      const next = new Set(prev);
      if (next.has(matchId)) {
        next.delete(matchId);
      } else {
        next.add(matchId);
        setCheckedMatches(prevGreen => prevGreen.filter(m => m.matchId !== matchId));
      }
      return next;
    });
  };

  const removeFromGreenList = (matchId: string) => {
    setCheckedMatches(prev => prev.filter(m => m.matchId !== matchId));
  };

  const updateJournalEntry = (matchId: string, field: 'betType' | 'betLine' | 'result' | 'stake' | 'odds', value: any) => {
    setCheckedMatches(prev => {
      const updated = prev.map(match => 
        match.matchId === matchId 
          ? { ...match, [field]: value }
          : match
      );
      
      try {
        localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(updated));
        
        const journal = JSON.parse(localStorage.getItem(BETTING_JOURNAL_KEY) || '[]');
        const journalIndex = journal.findIndex((m: any) => m.matchId === matchId);
        if (journalIndex !== -1) {
          journal[journalIndex] = { ...journal[journalIndex], [field]: value };
        } else {
          // Entry nincs a naplóban – hozzáadjuk most
          const matchData = updated.find(m => m.matchId === matchId);
          if (matchData) journal.push(matchData);
        }
        localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(journal));
        window.dispatchEvent(new Event('journal-updated'));
      } catch (e) {
        console.error('Journal update hiba:', e);
      }
      
      return updated;
    });
  };

  const getMatchId = (tip: TopTip) => `${tip.playerA}-${tip.playerB}-${tip.time}`;
  const hasHighWinChance = (tip: TopTip) => tip.winEselyA >= 0.7 || tip.winEselyB >= 0.7;
  const isGreenChecked = (matchId: string) => checkedMatches.some(m => m.matchId === matchId);

  return (
    <div className="flex gap-10">
      <div className="flex-1 space-y-6">
        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Liga gombok */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Ligák:</span>
            <button
              onClick={() => toggleLeague('GT Leagues')}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                selectedLeagues.has('GT Leagues')
                  ? 'bg-green/20 text-green border-2 border-green'
                  : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'
              }`}
            >
              GT Leagues (12p)
            </button>
            <button
              onClick={() => toggleLeague('Esoccer Battle')}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                selectedLeagues.has('Esoccer Battle')
                  ? 'bg-yellow/20 text-yellow border-2 border-yellow'
                  : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'
              }`}
            >
              Esoccer Battle (8p)
            </button>
            <button
              onClick={() => toggleLeague('Cyber Live Arena')}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                selectedLeagues.has('Cyber Live Arena')
                  ? 'bg-purple/20 text-purple border-2 border-purple'
                  : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'
              }`}
            >
              Cyber Live Arena (10p)
            </button>
            <button
              onClick={() => toggleLeague('Esoccer H2H GG League')}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                selectedLeagues.has('Esoccer H2H GG League')
                  ? 'bg-orange-500/20 text-orange-400 border-2 border-orange-400'
                  : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'
              }`}
            >
              H2H GG League (8p)
            </button>
          </div>

          {/* ========== ÚJ: STRATEGY VÁLASZTÓ ========== */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Stratégia:</span>
            <select
              value={strategy}
              onChange={e => setStrategy(e.target.value as 'A' | 'B')}
              className="bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-accent"
            >
              <option value="A">Strategy A (Original)</option>
              <option value="B">Strategy B (Enhanced 🏆)</option>
            </select>
          </div>
          {/* ========== END STRATEGY ========== */}

          <select
            value={limit}
            onChange={e => setLimit(+e.target.value)}
            className="bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-accent"
          >
            <option value={5}>Top 5</option>
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="bg-accent/20 text-accent-light hover:bg-accent/30 text-xs font-semibold px-4 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
          >
            {loading ? 'Keresés...' : 'Frissítés'}
          </button>

          <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="accent-accent" />
            Auto (60s)
          </label>

          <button
            onClick={toggleSound}
            className="text-xs text-slate-400 hover:text-white cursor-pointer"
            title={soundEnabled ? 'Hang ki' : 'Hang be'}
          >
            {soundEnabled ? '🔔' : '🔕'}
          </button>

          {browserNotifEnabled ? (
            <button
              onClick={disableBrowserNotif}
              className="text-xs text-green hover:text-white cursor-pointer"
              title="Böngésző értesítés ki"
            >
              🖥️✅
            </button>
          ) : (
            <button
              onClick={enableBrowserNotif}
              className="text-xs text-slate-400 hover:text-white cursor-pointer"
              title="Böngésző értesítés be"
            >
              🖥️
            </button>
          )}
        </div>

        {/* Filters + Rendezés */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-slate-400">Presets:</span>
          <button
            onClick={() => setFilter('all')}
            className={`text-xs px-3 py-1 rounded-lg font-semibold cursor-pointer ${filter === 'all' ? 'bg-accent text-white' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover'}`}
          >
            Összes
          </button>
          <button
            onClick={() => setFilter('strong')}
            className={`text-xs px-3 py-1 rounded-lg font-semibold cursor-pointer ${filter === 'strong' ? 'bg-green text-white' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover'}`}
          >
            Csak STRONG
          </button>
          <button
            onClick={() => setFilter('h2h')}
            className={`text-xs px-3 py-1 rounded-lg font-semibold cursor-pointer ${filter === 'h2h' ? 'bg-accent text-white' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover'}`}
          >
            H2H ONLY
          </button>
          <button
            onClick={() => setFilter('liveOdds')}
            className={`text-xs px-3 py-1 rounded-lg font-semibold cursor-pointer ${filter === 'liveOdds' ? 'bg-purple text-white' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover'}`}
          >
            LIVE ODDS
          </button>

          <div className="ml-4 flex items-center gap-2">
            <span className="text-xs text-slate-400">Rendezés:</span>
            <button
              onClick={() => setSortMode('time')}
              className={`text-xs px-3 py-1 rounded-lg font-semibold cursor-pointer ${sortMode === 'time' ? 'bg-accent text-white' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover'}`}
            >
              🕐 Idő szerint
            </button>
            <button
              onClick={() => setSortMode('probability')}
              className={`text-xs px-3 py-1 rounded-lg font-semibold cursor-pointer ${sortMode === 'probability' ? 'bg-accent text-white' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover'}`}
            >
              📊 Esély szerint
            </button>
          </div>

          <button
            onClick={() => setShowPresetForm(!showPresetForm)}
            className="text-xs px-3 py-1 rounded-lg font-semibold bg-dark-card text-accent-light hover:bg-dark-card-hover cursor-pointer"
          >
            + Mentés
          </button>
        </div>

        {showPresetForm && (
          <div className="flex items-center gap-2 bg-dark-card border border-dark-border rounded-lg p-3">
            <input
              type="text"
              value={presetName}
              onChange={e => setPresetName(e.target.value)}
              placeholder="Preset neve..."
              className="flex-1 bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
            />
            <button
              onClick={saveCurrentAsPreset}
              className="bg-accent/20 text-accent-light hover:bg-accent/30 text-xs font-semibold px-3 py-1 rounded cursor-pointer"
            >
              Mentés
            </button>
            <button
              onClick={() => setShowPresetForm(false)}
              className="text-xs text-slate-400 hover:text-white cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {presets.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500">Mentett:</span>
            {presets.map(p => (
              <div key={p.name} className="flex items-center gap-1 bg-dark-card border border-dark-border rounded-lg px-2 py-1">
                <button
                  onClick={() => applyPreset(p)}
                  className="text-xs text-accent-light hover:text-white cursor-pointer"
                >
                  {p.name}
                </button>
                <button
                  onClick={() => removePreset(p.name)}
                  className="text-xs text-red hover:text-white cursor-pointer"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-red text-sm">{error}</p>}

        {/* Tips list */}
        {(() => {
          if (!data) return null;
          
          let tips = (() => {
            if (filter === 'strong') return data.tips.filter(t => t.category === 'STRONG_BET');
            if (filter === 'h2h') return data.tips.filter(t => t.h2hMode);
            if (filter === 'liveOdds') return data.tips.filter(t => t.oddsSource === 'bet365' || t.oddsSource === 'vegas.hu');
            return data.tips;
          })();

          if (selectedLeagues.size > 0) {
            tips = tips.filter(tip => selectedLeagues.has(tip.league));
          }

          tips = tips.filter(tip => !checkedRed.has(getMatchId(tip)));

          if (sortMode === 'time') {
            tips = [...tips].sort((a, b) => a.time.localeCompare(b.time));
          } else {
            tips = [...tips].sort((a, b) => {
              const maxA = Math.max(a.winEselyA, a.winEselyB);
              const maxB = Math.max(b.winEselyA, b.winEselyB);
              return maxB - maxA;
            });
          }

          if (tips.length === 0) return <p className="text-slate-400 text-sm">Nincs találat.</p>;

          return (
            <div className="grid gap-4">
              {tips.map((tip, idx) => {
                const matchId = getMatchId(tip);
                const isGreen = isGreenChecked(matchId);
                const isRed = checkedRed.has(matchId);
                const isChecked = isGreen || isRed;
                const isHighWin = hasHighWinChance(tip);

                const cardOpacity = isChecked ? 'opacity-50' : 'opacity-100';
                const hasGolValue = tip.ouLine > 0
                  && Math.abs(tip.vartGol - tip.ouLine) >= 0.6
                  && tip.oddsSource === 'vegas.hu';
                const cardBorder = hasGolValue && !isChecked ? 'border-green'
                  : isHighWin && !isChecked ? 'border-yellow-500'
                  : 'border-dark-border';
                const cardGlow = hasGolValue && !isChecked ? 'shadow-[0_0_12px_rgba(34,197,94,0.4)]'
                  : isHighWin && !isChecked ? 'shadow-yellow-glow'
                  : '';
                // O/U tip is primary; win tip only when no O/U line
                const ouDir = tip.vartGol > tip.ouLine ? 'OVER' : 'UNDER';
                const displayTip = tip.ouLine > 0
                  ? `${ouDir} ${tip.ouLine}`
                  : tip.valueBet;

                return (
                  <div
                    key={idx}
                    className={`bg-dark-card border-2 ${cardBorder} rounded-xl overflow-hidden transition-all ${cardOpacity} ${cardGlow} min-w-[900px] w-full flex flex-col`}
                  >
                    <div className="flex items-center gap-4 px-5 py-3 bg-dark-bg/40 border-b border-dark-border">
                      <span className="text-xs font-bold text-slate-500 w-6 shrink-0">#{idx + 1}</span>
                      <div className={`px-2 py-1 rounded text-[10px] font-bold ${leagueBadge(tip.league)}`}>
                        {tip.league === 'GT Leagues' ? 'GT' : tip.league === 'Esoccer Battle' ? 'EB' : tip.league === 'Cyber Live Arena' ? 'CLA' : tip.league === 'Esoccer H2H GG League' ? 'H2H' : 'EV'}
                      </div>

                      <span className="text-sm text-white font-mono font-bold whitespace-nowrap">{tip.time}</span>
                      <span className={`text-sm font-semibold whitespace-nowrap ${tip.oddsSource === 'vegas.hu' ? 'text-green-400' : tip.oddsSource === 'bet365' ? 'text-blue-400' : 'text-accent-light'}`}>
                        O/U {tip.ouLine}
                        {tip.oddsSource === 'vegas.hu' && (
                          <>
                            <span className="ml-1 text-[10px] text-green-500">vegas</span>
                            {tip.oddsOver && tip.oddsOver > 1 && (
                              <span className="ml-2 text-[11px] font-mono text-green-400">
                                ↑{tip.oddsOver.toFixed(2)} ↓{(tip.oddsUnder ?? 0).toFixed(2)}
                              </span>
                            )}
                          </>
                        )}
                        {tip.oddsSource === 'bet365' && <span className="ml-1 text-[10px] text-blue-500">b365</span>}
                      </span>
                      <span className={`text-sm whitespace-nowrap ${hasGolValue ? 'border border-green rounded px-2 py-0.5' : ''}`}>
                        <span className="text-slate-400">GÓL </span>
                        <span className={`font-semibold ${hasGolValue ? 'text-green' : 'text-white'}`}>{tip.vartGol.toFixed(1)}</span>
                      </span>
                      
                      <div className="flex-1 flex items-center justify-center gap-3">
                        <span className={`text-sm font-bold ${isHighWin && tip.winEselyA >= 0.7 && !isChecked ? 'text-yellow-400' : 'text-accent-light'}`}>
                          {pct(tip.winEselyA)}
                        </span>
                        <span className="text-slate-500 text-sm">vs.</span>
                        <span className={`text-sm font-bold ${isHighWin && tip.winEselyB >= 0.7 && !isChecked ? 'text-yellow-400' : 'text-purple'}`}>
                          {pct(tip.winEselyB)}
                        </span>
                        
                        <span className={`text-sm font-semibold uppercase ml-4 ${isHighWin && tip.winEselyA >= 0.7 && !isChecked ? 'text-yellow-400' : 'text-white'}`}>
                          {tip.playerA}
                        </span>
                        <span className="text-slate-500 text-sm">vs.</span>
                        <span className={`text-sm font-semibold uppercase ${isHighWin && tip.winEselyB >= 0.7 && !isChecked ? 'text-yellow-400' : 'text-white'}`}>
                          {tip.playerB}
                        </span>
                      </div>

                      <span className={`text-lg font-bold whitespace-nowrap ${confColor(tip.confidence)}`}>
                        {Math.round(tip.confidence * 100)}%
                      </span>
                    </div>

                    <div className="px-5 py-3 flex-1 flex flex-col">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div>
                            <p className="text-[10px] text-slate-400">Ajánlott tipp</p>
                            <p className={`text-sm font-bold ${hasGolValue ? 'text-green' : tip.ouLine > 0 ? 'text-accent-light' : 'text-white'}`}>{displayTip}</p>
                          </div>
                          <span className="text-xs text-accent-light font-semibold bg-accent/10 px-2 py-0.5 rounded">
                            💰 2 000 Ft
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleGreenCheck(matchId, tip)}
                            className={`w-6 h-6 rounded border-2 flex items-center justify-center cursor-pointer transition-all ${
                              isGreen
                                ? 'bg-green/30 border-green text-green'
                                : 'border-slate-600 hover:border-green'
                            }`}
                            title="Jó feltételek, megtéve"
                          >
                            {isGreen && '✓'}
                          </button>
                          <button
                            onClick={() => toggleRedCheck(matchId)}
                            className={`w-6 h-6 rounded border-2 flex items-center justify-center cursor-pointer transition-all ${
                              isRed
                                ? 'bg-red/30 border-red text-red'
                                : 'border-slate-600 hover:border-red'
                            }`}
                            title="Rossz feltételek / nem találom"
                          >
                            {isRed && '✓'}
                          </button>
                        </div>
                      </div>

                      {/* Egyéni forma badge-sorok (a H2H chart helyén) */}
                      {((tip.lastMatchesA?.length ?? 0) > 0 || (tip.lastMatchesB?.length ?? 0) > 0) && (() => {
                        const now = new Date();
                        const dd = String(now.getDate()).padStart(2, '0');
                        const mm = String(now.getMonth() + 1).padStart(2, '0');
                        // Raw date formátum: "MM/DD HH:MM" → today prefix: "MM/DD"
                        const todayPrefix = `${mm}/${dd}`;
                        const renderBadges = (matches: typeof tip.lastMatchesA, name: string, gf?: number) => {
                          if (!matches?.length) return null;
                          const todayCount = matches.filter(m => m.date.startsWith(todayPrefix)).length;
                          return (
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-bold text-white uppercase truncate">{name}</span>
                                <span className="text-[10px] text-slate-500 shrink-0 ml-1">
                                  {todayCount > 0 && <span className="text-accent-light font-semibold">Ma:{todayCount} · </span>}
                                  {gf !== undefined && `Ø${gf.toFixed(1)}`}
                                </span>
                              </div>
                              <div className="flex gap-1 flex-wrap">
                                {matches.map((m, i) => {
                                  const goals = m.scoreHome + m.scoreAway;
                                  const isToday = m.date.startsWith(todayPrefix);
                                  const color = m.result === 'win' ? 'bg-green/20 text-green border-green/40'
                                    : m.result === 'loss' ? 'bg-red/20 text-red border-red/40'
                                    : 'bg-yellow/20 text-yellow border-yellow/40';
                                  return (
                                    <span key={i} className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded border ${color} ${isToday ? 'ring-1 ring-white/40' : 'opacity-75'}`}>
                                      <span>{m.result === 'win' ? 'W' : m.result === 'loss' ? 'L' : 'D'}</span>
                                      <span className="text-[13px] font-mono leading-none">{goals}</span>
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        };
                        return (
                          <div className="flex gap-3 mb-2">
                            {renderBadges(tip.lastMatchesA, tip.playerA, tip.gfPerMatchA)}
                            <div className="w-px bg-dark-border shrink-0" />
                            {renderBadges(tip.lastMatchesB, tip.playerB, tip.gfPerMatchB)}
                          </div>
                        );
                      })()}

                      {/* H2H meccs-előzmény – egymás elleni meccsek */}
                      {(tip.h2hMatchHistory?.length ?? 0) > 0 && (() => {
                        const now = new Date();
                        const dd = String(now.getDate()).padStart(2, '0');
                        const mm = String(now.getMonth() + 1).padStart(2, '0');
                        // Raw date: "MM/DD HH:MM" → today prefix: "MM/DD"
                        const todayPrefix = `${mm}/${dd}`;
                        const todayCount = tip.h2hMatchHistory.filter(m => m.date.startsWith(todayPrefix)).length;

                        return (
                          <div className="bg-dark-bg/40 border border-dark-border rounded-lg overflow-hidden mb-2">
                            {/* Fejléc */}
                            <div className="flex items-center justify-between px-2 py-1 border-b border-dark-border bg-dark-bg/60">
                              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wide">
                                Egymás elleni ({tip.h2hMatchHistory.length} meccs)
                              </span>
                              {todayCount > 0 && (
                                <span className="text-[10px] font-semibold text-accent-light">Ma: {todayCount} meccs</span>
                              )}
                            </div>
                            {/* Sorok */}
                            <div className="p-1">
                              {(() => {
                                // Mai meccseket elválasztjuk a régebbiektől
                                const todayMatches = tip.h2hMatchHistory.filter(m => m.date.startsWith(todayPrefix));
                                const olderMatches = tip.h2hMatchHistory.filter(m => !m.date.startsWith(todayPrefix));

                                const renderRow = (m: typeof tip.h2hMatchHistory[0], i: number, isToday: boolean) => {
                                  const totalGoals = m.goalsA + m.goalsB;
                                  // Raw: "MM/DD HH:MM" → "MM.DD HH:MM"
                                  const dateFmt = m.date.length >= 5
                                    ? `${m.date.slice(0,2)}.${m.date.slice(3,5)}${m.date.length > 5 ? ' ' + m.date.slice(6,11) : ''}`
                                    : m.date;
                                  const aWon = m.winner === 'A';
                                  const bWon = m.winner === 'B';
                                  return (
                                    <div key={i} className={`flex items-center gap-1 mb-px rounded-sm ${isToday ? 'bg-accent/5' : ''}`}>
                                      <div className={`flex-1 min-w-0 flex items-center justify-end px-1.5 py-1 rounded-l ${aWon ? 'bg-green/25' : bWon ? 'bg-red/15' : 'bg-yellow/15'}`}>
                                        <span className={`text-[10px] font-bold truncate ${aWon ? 'text-green' : bWon ? 'text-slate-400' : 'text-yellow'}`}>
                                          {tip.playerA}
                                        </span>
                                      </div>
                                      <div className="shrink-0 text-center w-20 flex items-center justify-center gap-1">
                                        <span className="text-[11px] font-mono font-bold text-slate-300">{m.goalsA}–{m.goalsB}</span>
                                        <span className={`text-[15px] font-mono font-bold ${totalGoals >= 7 ? 'text-red' : totalGoals >= 5 ? 'text-yellow' : 'text-green'}`}>({totalGoals})</span>
                                      </div>
                                      <div className={`flex-1 min-w-0 flex items-center px-1.5 py-1 rounded-r ${bWon ? 'bg-green/25' : aWon ? 'bg-red/15' : 'bg-yellow/15'}`}>
                                        <span className={`text-[10px] font-bold truncate ${bWon ? 'text-green' : aWon ? 'text-slate-400' : 'text-yellow'}`}>
                                          {tip.playerB}
                                        </span>
                                      </div>
                                      <div className="shrink-0 w-20 flex items-center justify-end gap-1">
                                        {isToday && <span className="text-[8px] bg-accent/30 text-accent-light px-1 py-0.5 rounded font-bold">MA</span>}
                                        <span className="text-[9px] text-slate-500 font-mono">{dateFmt}</span>
                                      </div>
                                    </div>
                                  );
                                };

                                return (
                                  <>
                                    {/* Mai meccsek kiemelten */}
                                    {todayMatches.length > 0 && (
                                      <div className="mb-1">
                                        {todayMatches.map((m, i) => renderRow(m, i, true))}
                                      </div>
                                    )}
                                    {/* Elválasztó ha van mai meccs */}
                                    {todayMatches.length > 0 && olderMatches.length > 0 && (
                                      <div className="flex items-center gap-2 my-1.5">
                                        <div className="flex-1 h-px bg-dark-border" />
                                        <span className="text-[9px] text-slate-600">korábbi</span>
                                        <div className="flex-1 h-px bg-dark-border" />
                                      </div>
                                    )}
                                    {/* Régebbi meccsek */}
                                    {olderMatches.map((m, i) => renderRow(m, i, false))}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })()}

                      {tip.warning && (
                        <div className="flex items-center gap-2 bg-yellow/10 border border-yellow/30 rounded-lg p-2">
                          <svg className="w-4 h-4 text-yellow shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                          </svg>
                          <p className="text-[11px] text-yellow">{tip.warning}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {data && (
          <p className="text-[10px] text-slate-600 text-center">
            Generálva: {new Date(data.generated).toLocaleString('hu-HU')} | 
            {data.strategy && ` Stratégia: ${data.strategy.name} |`} Modell: H2H-first + Poisson + ELO
          </p>
        )}
      </div>

      {/* NAPLÓ */}
      <div className="w-[420px] shrink-0">
        <div className="bg-dark-card border border-dark-border rounded-xl p-4 sticky top-4">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            ✅ Megtett meccsek ({checkedMatches.length})
          </h3>
          
          {checkedMatches.length === 0 ? (
            <p className="text-xs text-slate-500 italic">Még nincs megtett meccs</p>
          ) : (
            <div className="space-y-3 max-h-[800px] overflow-y-auto pr-2">
              {checkedMatches
                .filter(match => match && match.tip)
                .sort((a, b) => b.timestamp - a.timestamp)
                .map((match, idx) => (
                  <div
                    key={idx}
                    className="bg-dark-bg/40 border border-dark-border rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-xs flex-1">
                        <span className="text-slate-500 font-bold w-7 shrink-0">#{idx + 1}</span>
                        <span className="text-slate-400 font-mono">{match.tip.time || '—'}</span>
                        <span className="text-slate-600">|</span>
                        <span className="text-white font-semibold">
                          {match.tip.playerA || '?'} vs {match.tip.playerB || '?'}
                        </span>
                        <span className="text-slate-600">|</span>
                        <span className="text-slate-400">
                          GÓL <span className={`font-semibold ${match.tip.ouLine > 0 && Math.abs((match.tip.vartGol || 0) - match.tip.ouLine) >= 0.6 ? 'text-green border border-green rounded px-1' : 'text-accent-light'}`}>{match.tip.vartGol?.toFixed(1) || '—'}</span>
                        </span>
                      </div>
                      <button
                        onClick={() => removeFromGreenList(match.matchId)}
                        className="text-red hover:text-white text-xs ml-2"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <select
                        value={match.betType || ''}
                        onChange={e => updateJournalEntry(match.matchId, 'betType', e.target.value as 'Over' | 'Under')}
                        className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
                      >
                        <option value="">O/U</option>
                        <option value="Over">Over</option>
                        <option value="Under">Under</option>
                      </select>

                      <select
                        value={match.betLine || ''}
                        onChange={e => updateJournalEntry(match.matchId, 'betLine', parseFloat(e.target.value))}
                        className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
                      >
                        <option value="">Vonal</option>
                        <option value="1.5">1.5</option>
                        <option value="2.5">2.5</option>
                        <option value="3.5">3.5</option>
                        <option value="4.5">4.5</option>
                        <option value="5.5">5.5</option>
                        <option value="6.5">6.5</option>
                        <option value="7.5">7.5</option>
                        <option value="8.5">8.5</option>
                        <option value="9.5">9.5</option>
                        <option value="10.5">10.5</option>
                        <option value="11.5">11.5</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="1.01"
                        max="50"
                        placeholder="Odds"
                        value={match.odds || ''}
                        onChange={e => updateJournalEntry(match.matchId, 'odds', e.target.value ? parseFloat(e.target.value) : undefined)}
                        className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent placeholder-slate-600"
                      />

                      <input
                        type="number"
                        step="100"
                        min="100"
                        placeholder="2000"
                        value={match.stake ?? 2000}
                        onChange={e => updateJournalEntry(match.matchId, 'stake', e.target.value ? parseFloat(e.target.value) : 2000)}
                        className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent placeholder-slate-600"
                      />

                      <select
                        value={match.result || ''}
                        onChange={e => updateJournalEntry(match.matchId, 'result', e.target.value as 'Win' | 'Loss')}
                        className="bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
                      >
                        <option value="">Eredmény</option>
                        <option value="Win">Win</option>
                        <option value="Loss">Loss</option>
                      </select>
                    </div>

                    {(match.betType || match.betLine || match.result) && (
                      <div className="mt-2 pt-2 border-t border-dark-border">
                        <p className="text-xs text-slate-400">
                          {match.betType && match.betLine && (
                            <span className="text-accent-light font-semibold">
                              {match.betType} {match.betLine}
                            </span>
                          )}
                          {match.result && (
                            <span className={`ml-2 font-semibold ${match.result === 'Win' ? 'text-green' : 'text-red'}`}>
                              {match.result === 'Win' ? '✅' : '❌'} {match.result}
                            </span>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {h2hModal && (
        <H2HModal
          playerA={h2hModal.a}
          playerB={h2hModal.b}
          league={h2hModal.lg}
          onClose={() => setH2hModal(null)}
        />
      )}
    </div>
  );
}