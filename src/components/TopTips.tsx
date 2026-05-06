import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchTopTips, TopTip, TopTipsResponse, fetchLiveScores, LiveScore, clearServerCache, resolveResults, saveJournal } from '../api';
import { MatchInput } from '../model/types';
import H2HModal from './H2HModal';
import TrendWidget from './TrendWidget';
import { useNewTipDetector, useNotificationSettings } from '../hooks/useNotifications';

interface Props {
  onAddMatch: (m: MatchInput) => void;
}

function pct(v: number) { return `${(v * 100).toFixed(1)}%`; }

function confColor(c: number) {
  if (c >= 0.75) return 'text-green';
  if (c >= 0.6) return 'text-yellow';
  return 'text-red';
}

function leagueBadge(l: string) {
  if (l === 'GT Leagues') return 'bg-green/20 text-green';
  if (l === 'Esoccer Battle') return 'bg-yellow/20 text-yellow';
  if (l === 'eAdriatic League') return 'bg-sky-500/20 text-sky-400';
  if (l === 'Esoccer H2H GG League') return 'bg-orange-500/20 text-orange-400';
  if (l === 'Esports Volta') return 'bg-cyan-500/20 text-cyan-400';
  return 'bg-slate-600/30 text-slate-400';
}

function leagueAbbr(l: string) {
  if (l === 'GT Leagues') return 'GT';
  if (l === 'Esoccer Battle') return 'EB';
  if (l === 'eAdriatic League') return 'ADR';
  if (l === 'Esoccer H2H GG League') return 'H2H';
  if (l === 'Esports Volta') return 'VOLTA';
  return 'EV';
}

type SortMode = 'time' | 'probability';

const CHECKED_GREEN_KEY = 'checked_green_matches';
const CHECKED_RED_KEY = 'checked_red_matches';
const BETTING_JOURNAL_KEY = 'betting_journal';
const LIVE_SCORES_CACHE_KEY = 'live_scores_cache';
const LAST_KNOWN_LIVE_KEY = 'last_known_live_map';

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
  finalScore?: string;
  fromTrend?: boolean;
  trendType?: 'VALUE' | 'TREND';
}

export default function TopTips({ onAddMatch: _onAddMatch }: Props) {
  const [data, setData] = useState<TopTipsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedLeagues, setSelectedLeagues] = useState<Set<string>>(new Set(['GT Leagues', 'eAdriatic League']));
  const [limit, setLimit] = useState(20);
  const [sortMode, setSortMode] = useState<SortMode>('time');
  const [h2hModal, setH2hModal] = useState<{ a: string; b: string; lg: string } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [strategy, setStrategy] = useState<'A' | 'B' | 'C'>('A');
  const [globalStake, setGlobalStake] = useState(() => parseInt(localStorage.getItem('global_stake') || '2000'));

  useEffect(() => { localStorage.setItem('global_stake', String(globalStake)); }, [globalStake]);

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
      let result: TopTipsResponse;

      if (selectedLeagues.size === 0) {
        // Szűrő nélkül: minden liga
        result = await fetchTopTips(undefined, limit, strategy);
      } else if (selectedLeagues.size === 1) {
        // Egyetlen liga: közvetlen szűrés
        result = await fetchTopTips(Array.from(selectedLeagues)[0], limit, strategy);
      } else {
        // Több liga: párhuzamos lekérés, eredmények összefűzése
        // → mindkét liga teljes meccslistáját megkapjuk, nem csak a top-N keresztmetszetét
        const leagueArr = Array.from(selectedLeagues);
        const settled = await Promise.allSettled(
          leagueArr.map(l => fetchTopTips(l, limit, strategy))
        );
        const allTips = settled
          .filter((r): r is PromiseFulfilledResult<TopTipsResponse> => r.status === 'fulfilled')
          .flatMap(r => r.value.tips);
        const base = settled.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<TopTipsResponse> | undefined;
        result = base
          ? { ...base.value, tips: allTips }
          : { tips: [], generated: new Date().toISOString(), totalScanned: 0, totalAnalyzed: 0, totalValueBets: 0 };
      }

      setData(result);
    } catch {
      setError('Nem sikerült betölteni. Ellenőrizd a szervert (port 3005).');
    } finally {
      setLoading(false);
    }
  }, [selectedLeagues, limit, strategy]);

  // ── Live score polling (10 másodpercenként) ────────────────────────────────
  const [liveScores, setLiveScores] = useState<LiveScore[]>(() => {
    try {
      const stored = localStorage.getItem(LIVE_SCORES_CACHE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  // Utolsó ismert live score minden meccshez (auto Win/Loss detektáláshoz)
  const lastKnownLive = useRef<Map<string, LiveScore>>((() => {
    try {
      const stored = localStorage.getItem(LAST_KNOWN_LIVE_KEY);
      if (!stored) return new Map<string, LiveScore>();
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return new Map<string, LiveScore>(parsed as [string, LiveScore][]);
      return new Map<string, LiveScore>();
    } catch { return new Map<string, LiveScore>(); }
  })());

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const scores = await fetchLiveScores();
        if (cancelled) return;

        // Auto Win/Loss: ha egy korábban élő meccs eltűnt a listából → vége
        // Altenar félidőben is küldhet isLive=false-t, ezért csak eltűnést detektálunk
        const currentKeys = new Set(scores.map(s => `${s.playerA}|${s.playerB}`));
        for (const [key, prevScore] of lastKnownLive.current) {
          if (!currentKeys.has(key)) {
            // Meccs véget ért — megkeresi a Mérkőzés Listában
            setCheckedMatches(prev => {
              const updated = [...prev];
              const idx = updated.findIndex(m => {
                const nA = m.tip.playerA.toLowerCase();
                const nB = m.tip.playerB.toLowerCase();
                const sA = prevScore.playerA.toLowerCase();
                const sB = prevScore.playerB.toLowerCase();
                return (sA.includes(nA) || nA.includes(sA)) && (sB.includes(nB) || nB.includes(sB))
                    || (sA.includes(nB) || nB.includes(sA)) && (sB.includes(nA) || nA.includes(sB));
              });
              if (idx === -1) return prev;
              const m = updated[idx];
              if (m.result) return prev; // már be van állítva, nem írjuk felül
              if (!m.betType || !m.betLine) return prev;
              // Időablak: csak ha a meccs ütemezett ideje ±90 percen belül van
              const diffMin = (Date.now() - m.timestamp) / 60000;
              if (diffMin < -15 || diffMin > 90) return prev;
              const total = prevScore.scoreA + prevScore.scoreB;
              let outcome: 'Win' | 'Loss' | null = null;
              if (m.betType === 'Over')  outcome = total > m.betLine  ? 'Win' : 'Loss';
              if (m.betType === 'Under') outcome = total < m.betLine  ? 'Win' : 'Loss';
              if (!outcome) return prev;
              const finalScore = `${prevScore.scoreA}:${prevScore.scoreB}`;
              const next = { ...m, result: outcome, finalScore };
              updated[idx] = next;
              // Napló frissítése
              try {
                const journal = JSON.parse(localStorage.getItem(BETTING_JOURNAL_KEY) || '[]');
                const ji = journal.findIndex((j: any) => j.matchId === m.matchId);
                if (ji !== -1) journal[ji] = { ...journal[ji], result: outcome, finalScore };
                localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(journal));
                localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(updated));
                saveJournal(journal);
                window.dispatchEvent(new Event('journal-updated'));
              } catch { /* silent */ }
              // esoccerbet.org validáció 10 mp-cel később — javítja az Altenar féleredményt
              const validateM = { ...m };
              setTimeout(async () => {
                try {
                  if (!validateM.betType || !validateM.betLine) return;
                  const [res] = await resolveResults([{
                    matchId: validateM.matchId,
                    playerA: validateM.tip.playerA,
                    playerB: validateM.tip.playerB,
                    league: validateM.tip.league || 'GT Leagues',
                    timestamp: validateM.timestamp,
                    betType: validateM.betType,
                    betLine: validateM.betLine,
                  }]);
                  if (!res || res.pending || !res.outcome || !res.score) return;
                  if (res.score === finalScore && res.outcome === outcome) return; // match — no change
                  // Score differs → correct the result
                  console.warn(`⚠️ Altenar vs esoccerbet mismatch: ${finalScore} → ${res.score} (${outcome} → ${res.outcome})`);
                  const BKEY = 'betting_journal';
                  const GKEY = 'checked_green_matches';
                  const j2: any[] = (() => { try { return JSON.parse(localStorage.getItem(BKEY) || '[]'); } catch { return []; } })();
                  const g2: any[] = (() => { try { return JSON.parse(localStorage.getItem(GKEY) || '[]'); } catch { return []; } })();
                  const ji2 = j2.findIndex((x: any) => x.matchId === validateM.matchId);
                  const gi2 = g2.findIndex((x: any) => x.matchId === validateM.matchId);
                  if (ji2 !== -1) j2[ji2] = { ...j2[ji2], result: res.outcome, finalScore: res.score };
                  if (gi2 !== -1) g2[gi2] = { ...g2[gi2], result: res.outcome, finalScore: res.score };
                  localStorage.setItem(BKEY, JSON.stringify(j2));
                  localStorage.setItem(GKEY, JSON.stringify(g2));
                  saveJournal(j2);
                  window.dispatchEvent(new Event('journal-updated'));
                  window.dispatchEvent(new Event('checked-matches-updated'));
                } catch { /* silent */ }
              }, 10_000);
              return updated;
            });
            lastKnownLive.current.delete(key);
          }
        }
        // Frissítjük a lastKnownLive map-et az élő meccsekkel
        for (const s of scores) {
          if (s.isLive) lastKnownLive.current.set(`${s.playerA}|${s.playerB}`, s);
        }

        setLiveScores(scores);

        // Perzisztencia: liveScores + lastKnownLive mentése localStorage-ba
        try {
          localStorage.setItem(LIVE_SCORES_CACHE_KEY, JSON.stringify(scores));
          localStorage.setItem(LAST_KNOWN_LIVE_KEY, JSON.stringify(Array.from(lastKnownLive.current.entries())));
        } catch { /* silent */ }
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  /** Megkeresi a live score-t — csak ha a meccs ütemezett időpontjától max ±90 perc telt el */
  const findLiveScore = (pA: string, pB: string, matchTimestamp?: number): LiveScore | null => {
    if (matchTimestamp) {
      const diffMin = (Date.now() - matchTimestamp) / 60000;
      if (diffMin < -15 || diffMin > 90) return null; // túl korán vagy régen játszódott
    }
    const nA = pA.toLowerCase().trim();
    const nB = pB.toLowerCase().trim();
    return liveScores.find(s => {
      const sA = s.playerA.toLowerCase();
      const sB = s.playerB.toLowerCase();
      return (sA.includes(nA) || nA.includes(sA)) && (sB.includes(nB) || nB.includes(sB))
        || (sA.includes(nB) || nB.includes(sA)) && (sB.includes(nA) || nA.includes(sB));
    }) ?? null;
  };

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

  // Stratégia váltáskor: cache törlés, majd újratöltés
  const prevStrategyRef = useRef<string>(strategy);
  useEffect(() => {
    if (prevStrategyRef.current === strategy) { load(); return; }
    prevStrategyRef.current = strategy;
    clearServerCache().finally(() => load());
  }, [load]); // load változik ha strategy változik → ez fut le

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

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
          stake: globalStake,
          strategy,
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
        {/* Intraday Trend Widget */}
        <TrendWidget strategy={strategy} />

        {/* Controls — two-column: filters left, tall Frissítés right */}
        <div className="flex gap-3 items-stretch">
          <div className="flex-1 flex flex-col gap-2">

          {/* Felső sor: Liga gombok */}
          <div className="flex items-center gap-2">
            <button onClick={() => toggleLeague('GT Leagues')}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${selectedLeagues.has('GT Leagues') ? 'bg-green/20 text-green border-2 border-green' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'}`}>
              GT Leagues (12p)
            </button>
            <button onClick={() => toggleLeague('eAdriatic League')}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${selectedLeagues.has('eAdriatic League') ? 'bg-sky-500/20 text-sky-400 border-2 border-sky-500' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'}`}>
              eAdriatic League (10p)
            </button>
            <button onClick={() => toggleLeague('Esoccer H2H GG League')}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${selectedLeagues.has('Esoccer H2H GG League') ? 'bg-orange-500/20 text-orange-400 border-2 border-orange-400' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'}`}>
              H2H GG League (8p)
            </button>
            <button onClick={() => toggleLeague('Esoccer Battle')}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${selectedLeagues.has('Esoccer Battle') ? 'bg-yellow/20 text-yellow border-2 border-yellow' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'}`}>
              Esoccer Battle (8p)
            </button>
            <button onClick={() => toggleLeague('Esports Volta')}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${selectedLeagues.has('Esports Volta') ? 'bg-cyan-500/20 text-cyan-400 border-2 border-cyan-400' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'}`}>
              Esports Volta (6p)
            </button>
          </div>

          {/* Középső sor: Strategy + Tét */}
          <div className="flex items-center gap-2">
            {(['A', 'B', 'C'] as const).map(s => (
              <button key={s} onClick={() => setStrategy(s)}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                  strategy === s
                    ? s === 'C'
                      ? 'bg-cyan-500/20 text-cyan-300 border-2 border-cyan-400'
                      : 'bg-accent/20 text-accent-light border-2 border-accent'
                    : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'
                }`}>
                {s === 'A' ? 'Strategy A' : s === 'B' ? 'Strategy B' : '✦ Strategy C'}
              </button>
            ))}
            <span className="w-px h-4 bg-dark-border mx-1" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400 font-semibold">Tét:</span>
              <input
                type="number"
                step="500"
                min="100"
                value={globalStake}
                onChange={e => setGlobalStake(Math.max(100, parseInt(e.target.value) || 2000))}
                className="w-24 bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs text-white font-mono text-right focus:outline-none focus:border-accent"
              />
              <span className="text-xs text-slate-500">Ft</span>
            </div>
          </div>

          {/* Alsó sor: Top N + Rendezés + checkboxok */}
          <div className="flex items-center gap-2">
            {[5, 10, 15, 20].map(n => (
              <button key={n} onClick={() => setLimit(n)}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${limit === n ? 'bg-accent/20 text-accent-light border-2 border-accent' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover border border-dark-border'}`}>
                Top {n}
              </button>
            ))}
            <span className="w-px h-4 bg-dark-border mx-1" />
            <button onClick={() => setSortMode('time')}
              className={`text-xs px-3 py-1 rounded-lg font-semibold cursor-pointer ${sortMode === 'time' ? 'bg-accent text-white' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover'}`}>
              🕐 Idő szerint
            </button>
            <button onClick={() => setSortMode('probability')}
              className={`text-xs px-3 py-1 rounded-lg font-semibold cursor-pointer ${sortMode === 'probability' ? 'bg-accent text-white' : 'bg-dark-card text-slate-400 hover:bg-dark-card-hover'}`}>
              📊 Esély szerint
            </button>
            <span className="w-px h-4 bg-dark-border mx-1" />
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white cursor-pointer transition">
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="accent-accent w-3.5 h-3.5" />
              Auto (60s)
            </label>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white cursor-pointer transition">
              <input type="checkbox" checked={soundEnabled} onChange={toggleSound} className="accent-accent w-3.5 h-3.5" />
              Hang
            </label>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white cursor-pointer transition">
              <input type="checkbox" checked={browserNotifEnabled} onChange={e => e.target.checked ? enableBrowserNotif() : disableBrowserNotif()} className="accent-accent w-3.5 h-3.5" />
              Értesítés
            </label>
          </div>

          </div>{/* end left flex-col */}

          {/* Tall Frissítés button */}
          <button onClick={load} disabled={loading}
            className="self-stretch px-6 rounded-xl bg-accent/20 text-accent-light hover:bg-accent/30 font-semibold text-sm tracking-wide cursor-pointer disabled:opacity-50 transition border border-accent/30 min-w-[110px]">
            {loading ? '⏳ Keresés...' : '🔄 Frissítés'}
          </button>
        </div>{/* end two-column wrapper */}

        {error && <p className="text-red text-sm">{error}</p>}

        {/* Tips list */}
        {(() => {
          if (!data) return null;
          
          // Percek a most-tól (éjféli átfordulást kezelve)
          const minutesFromNow = (t: string) => {
            const [h, m] = t.split(':').map(Number);
            const matchMins = h * 60 + m;
            const now = new Date();
            const nowMins = now.getHours() * 60 + now.getMinutes();
            let diff = matchMins - nowMins;
            if (diff < -120) diff += 1440; // éjféli átfordulás: ha >2 órával a múltban, akkor holnap
            return diff;
          };

          let tips = [...data.tips];

          if (selectedLeagues.size > 0) {
            tips = tips.filter(tip => selectedLeagues.has(tip.league));
          }

          tips = tips.filter(tip => !checkedRed.has(getMatchId(tip)));

          // Több liga esetén: ha tartalmaz nem-msport ligát, 45-perces ablak
          // GT + eAdriatic esetén nincs időablak (mindkét liga folyamatosan megy)
          const msportOnlySelected =
            selectedLeagues.size >= 2 &&
            Array.from(selectedLeagues).every(l => l === 'GT Leagues' || l === 'eAdriatic League');
          if (selectedLeagues.size >= 2 && !msportOnlySelected) {
            tips = tips.filter(tip => {
              const diff = minutesFromNow(tip.time);
              return diff >= -5 && diff <= 45;
            });
          }

          if (sortMode === 'time') {
            tips = [...tips].sort((a, b) => minutesFromNow(a.time) - minutesFromNow(b.time));
          } else {
            tips = [...tips].sort((a, b) => {
              const maxA = Math.max(a.winEselyA, a.winEselyB);
              const maxB = Math.max(b.winEselyA, b.winEselyB);
              return maxB - maxA;
            });
          }

          if (tips.length === 0) return <p className="text-slate-400 text-sm">Nincs találat.</p>;

          const today = (() => {
            const n = new Date();
            return `${String(n.getMonth()+1).padStart(2,'0')}/${String(n.getDate()).padStart(2,'0')}`;
          })();
          const tomorrow = (() => {
            const n = new Date(Date.now() + 86400000);
            return `${String(n.getMonth()+1).padStart(2,'0')}/${String(n.getDate()).padStart(2,'0')}`;
          })();
          const dateLabel = (d: string) =>
            d === today ? 'Ma' : d === tomorrow ? 'Holnap' : d.replace('/', '.');

          return (
            <div className="grid gap-4">
              {tips.map((tip, idx) => {
                const matchId = getMatchId(tip);
                const prevDate = idx > 0 ? tips[idx - 1].date : null;
                const showDateSep = tip.date && tip.date !== prevDate;
                const isGreen = isGreenChecked(matchId);
                const isRed = checkedRed.has(matchId);
                const isChecked = isGreen || isRed;
                const isHighWin = hasHighWinChance(tip);

                const isTrendGreen = checkedMatches.some(m =>
                  m.fromTrend &&
                  m.tip.playerA?.toLowerCase() === tip.playerA?.toLowerCase() &&
                  m.tip.playerB?.toLowerCase() === tip.playerB?.toLowerCase()
                );
                const cardOpacity = isChecked ? 'opacity-50' : isTrendGreen ? 'opacity-60' : 'opacity-100';
                const hasGolValue = tip.ouLine > 0
                  && Math.abs(tip.vartGol - tip.ouLine) >= 0.6
                  && (tip.oddsSource === 'vegas.hu' || tip.oddsSource === 'msport.com');
                // bordó mindig prioritás — felülírja a zöld/sárga keretet
                const cardBorder = isTrendGreen ? 'border-red-600'
                  : isChecked ? 'border-dark-border'
                  : hasGolValue ? 'border-green'
                  : isHighWin ? 'border-yellow-500'
                  : 'border-dark-border';
                const cardGlow = isTrendGreen ? 'shadow-[0_0_18px_rgba(220,38,38,0.55)]'
                  : hasGolValue && !isChecked ? 'shadow-[0_0_12px_rgba(34,197,94,0.4)]'
                  : isHighWin && !isChecked ? 'shadow-yellow-glow'
                  : '';
                // O/U tip is primary; win tip only when no O/U line; n/a while waiting for real odds
                const ouDir = tip.vartGol > tip.ouLine ? 'OVER' : 'UNDER';
                const displayTip = tip.oddsSource === 'n/a'
                  ? 'Várakozás...'
                  : tip.ouLine > 0
                    ? `${ouDir} ${tip.ouLine}`
                    : tip.valueBet;

                return (
                  <div key={idx}>
                    {showDateSep && (
                      <div className="flex items-center gap-3 mb-4">
                        <div className="flex-1 h-px bg-dark-border" />
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest px-2">
                          {dateLabel(tip.date)}
                        </span>
                        <div className="flex-1 h-px bg-dark-border" />
                      </div>
                    )}
                  <div
                    className={`bg-dark-card border-2 ${cardBorder} rounded-xl overflow-hidden transition-all ${cardOpacity} ${cardGlow} min-w-[900px] w-full flex flex-col`}
                  >
                    <div className="flex items-center gap-4 px-5 py-3 bg-dark-bg/40 border-b border-dark-border">
                      <span className="text-xs font-bold text-slate-500 w-6 shrink-0">#{idx + 1}</span>
                      <div className={`px-2 py-1 rounded text-[10px] font-bold ${leagueBadge(tip.league)}`}>
                        {tip.league === 'GT Leagues' ? 'GT' : tip.league === 'Esoccer Battle' ? 'EB' : tip.league === 'eAdriatic League' ? 'ADR' : tip.league === 'Esoccer H2H GG League' ? 'H2H' : tip.league === 'Esports Volta' ? 'VOLTA' : 'EV'}
                      </div>

                      <span className="text-sm text-white font-mono font-bold whitespace-nowrap">{tip.time}</span>
                      {tip.oddsSource === 'n/a' ? (
                        <span className="text-sm font-semibold whitespace-nowrap text-slate-500 italic">
                          O/U <span className="text-slate-400">n/a</span>
                          <span className="ml-1 text-[10px] text-slate-600">várakozás...</span>
                        </span>
                      ) : (
                        <span className={`text-sm font-semibold whitespace-nowrap ${tip.oddsSource === 'vegas.hu' ? 'text-green-400' : tip.oddsSource === 'bet365' ? 'text-blue-400' : tip.oddsSource === 'msport.com' ? 'text-sky-400' : tip.oddsSource === 'cloudbet' ? 'text-orange-400' : 'text-accent-light'}`}>
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
                          {tip.oddsSource === 'msport.com' && (
                            <>
                              <span className="ml-1 text-[10px] text-sky-500">msport</span>
                              {tip.oddsOver && tip.oddsOver > 1 && (
                                <span className="ml-2 text-[11px] font-mono text-sky-400">
                                  ↑{tip.oddsOver.toFixed(2)} ↓{(tip.oddsUnder ?? 0).toFixed(2)}
                                </span>
                              )}
                            </>
                          )}
                          {tip.oddsSource === 'bet365' && <span className="ml-1 text-[10px] text-blue-500">b365</span>}
                          {tip.oddsSource === 'cloudbet' && (
                            <>
                              <span className="ml-1 text-[10px] text-orange-400">cloudbet</span>
                              {tip.oddsOver && tip.oddsOver > 1 && (
                                <span className="ml-2 text-[11px] font-mono text-orange-400">
                                  ↑{tip.oddsOver.toFixed(2)} ↓{(tip.oddsUnder ?? 0).toFixed(2)}
                                </span>
                              )}
                            </>
                          )}
                        </span>
                      )}
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
                        
                        <div className="flex flex-col items-end ml-4">
                          <span className={`text-sm font-semibold uppercase ${isHighWin && tip.winEselyA >= 0.7 && !isChecked ? 'text-yellow-400' : 'text-white'}`}>
                            {tip.playerA}
                          </span>
                          {tip.teamA && <span className="text-[10px] text-slate-500 leading-tight">{tip.teamA}</span>}
                        </div>
                        <span className="text-slate-500 text-sm">vs.</span>
                        <div className="flex flex-col items-start">
                          <span className={`text-sm font-semibold uppercase ${isHighWin && tip.winEselyB >= 0.7 && !isChecked ? 'text-yellow-400' : 'text-white'}`}>
                            {tip.playerB}
                          </span>
                          {tip.teamB && <span className="text-[10px] text-slate-500 leading-tight">{tip.teamB}</span>}
                        </div>
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
                            💰 {globalStake.toLocaleString('hu-HU')} Ft
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
                        const hist = tip.h2hMatchHistory!;
                        const now = new Date();
                        const dd = String(now.getDate()).padStart(2, '0');
                        const mm = String(now.getMonth() + 1).padStart(2, '0');
                        // Raw date: "MM/DD HH:MM" → today prefix: "MM/DD"
                        const todayPrefix = `${mm}/${dd}`;
                        const todayCount = hist.filter(m => m.date.startsWith(todayPrefix)).length;

                        return (
                          <div className="bg-dark-bg/40 border border-dark-border rounded-lg overflow-hidden mb-2">
                            {/* Fejléc */}
                            <div className="flex items-center justify-between px-2 py-1 border-b border-dark-border bg-dark-bg/60">
                              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wide">
                                Egymás elleni ({hist.length} meccs)
                              </span>
                              {todayCount > 0 && (
                                <span className="text-[10px] font-semibold text-accent-light">Ma: {todayCount} meccs</span>
                              )}
                            </div>
                            {/* Sorok */}
                            <div className="p-1">
                              {(() => {
                                // Mai meccseket elválasztjuk a régebbiektől
                                const todayMatches = hist.filter(m => m.date.startsWith(todayPrefix));
                                const olderMatches = hist.filter(m => !m.date.startsWith(todayPrefix));

                                const renderRow = (m: typeof hist[0], i: number, isToday: boolean) => {
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
            ✅ Mérkőzés Lista ({checkedMatches.length})
          </h3>
          
          {checkedMatches.length === 0 ? (
            <p className="text-xs text-slate-500 italic">Még nincs megtett meccs</p>
          ) : (
            <div className="space-y-3 max-h-[800px] overflow-y-auto pr-2">
              {checkedMatches
                .filter(match => match && match.tip)
                .sort((a, b) => b.timestamp - a.timestamp)
                .map((match, idx) => {
                  const live = findLiveScore(match.tip.playerA, match.tip.playerB, match.timestamp);
                  return (
                  <div
                    key={idx}
                    className={`border rounded-lg p-2.5 transition-all ${
                      live?.isLive
                        ? 'bg-green/5 border-green/30'
                        : match.trendType === 'VALUE'
                          ? 'bg-yellow-400/5 border-yellow-400/40'
                          : match.trendType === 'TREND'
                            ? 'bg-orange-500/5 border-orange-500/40'
                            : 'bg-dark-bg/40 border-dark-border'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5 text-xs flex-1 min-w-0">
                        <span className="text-slate-500 font-bold shrink-0">#{idx + 1}</span>
                        {match.trendType === 'VALUE' && (
                          <span style={{backgroundColor:'#facc15',color:'#111827'}} className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0">
                            💰 VALUE
                          </span>
                        )}
                        {match.trendType === 'TREND' && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 bg-orange-500 text-white">
                            🚀 TREND
                          </span>
                        )}
                        {match.tip.league && (
                          <span className={`px-1 py-0.5 rounded text-[9px] font-bold shrink-0 ${leagueBadge(match.tip.league)}`}>
                            {leagueAbbr(match.tip.league)}
                          </span>
                        )}
                        <span className="text-slate-400 font-mono shrink-0">{match.tip.time || '—'}</span>
                        <span className="text-white font-semibold truncate">
                          {match.tip.playerA || '?'} vs {match.tip.playerB || '?'}
                        </span>
                        <span className="text-slate-400 shrink-0">
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
                        placeholder={String(globalStake)}
                        value={match.stake ?? globalStake}
                        onChange={e => updateJournalEntry(match.matchId, 'stake', e.target.value ? parseFloat(e.target.value) : globalStake)}
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

                    {/* Fogadás összefoglaló + Live score + Win/Loss */}
                    {(() => {
                      // Projected outcome az aktuális score alapján
                      const projected = (() => {
                        if (!live || !match.betType || !match.betLine) return null;
                        const total = live.scoreA + live.scoreB;
                        if (match.betType === 'Over')  return total > match.betLine  ? 'Win' : 'Loss';
                        if (match.betType === 'Under') return total < match.betLine  ? 'Win' : 'Loss';
                        return null;
                      })();
                      const showBetLine = match.betType || match.betLine || match.result || live;
                      if (!showBetLine) return null;
                      return (
                        <div className="mt-2 pt-2 border-t border-dark-border flex items-center gap-2 flex-wrap">
                          {match.betType && match.betLine && (
                            <span className="text-accent-light font-semibold text-xs">
                              {match.betType} {match.betLine}
                            </span>
                          )}
                          {/* Score: live folyamán vagy rögzített eredmény */}
                          {live && (
                            <span className="font-mono font-bold text-base text-green tracking-wider">
                              {live.scoreA}:{live.scoreB}
                            </span>
                          )}
                          {/* Live idő jelző */}
                          {live?.isLive && (
                            <span className="flex items-center gap-1 text-[10px] text-white">
                              {live.periodName && <span className="font-semibold">{live.periodName}</span>}
                              {live.minute !== null && <span className="font-bold">{live.minute}'</span>}
                              <span className="text-[10px] font-bold text-green animate-pulse border border-green rounded px-1 py-px">Live</span>
                            </span>
                          )}
                          {/* Végleges eredmény (manuális vagy auto) */}
                          {match.result ? (
                            <span className={`font-semibold text-xs flex items-center gap-1 ${match.result === 'Win' ? 'text-green' : 'text-red'}`}>
                              {match.result === 'Win' ? '✅' : '❌'} {match.result}
                              {match.finalScore && !live && (
                                <span className="font-mono font-bold text-sm tracking-wider">{match.finalScore}</span>
                              )}
                            </span>
                          ) : projected ? (
                            /* Projected (live folyamán) */
                            <span className={`text-xs font-semibold opacity-60 ${projected === 'Win' ? 'text-green' : 'text-red'}`}>
                              {projected}
                            </span>
                          ) : null}
                        </div>
                      );
                    })()}
                  </div>
                  );
                })}
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