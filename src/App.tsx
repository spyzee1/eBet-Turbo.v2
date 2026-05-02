import { useState, useEffect, useCallback } from 'react';
import TopNav from './components/TopNav';
import Dashboard from './components/Dashboard';
import Upcoming from './components/Upcoming';
import MatchForm from './components/MatchForm';
import SettingsPanel from './components/SettingsPanel';
import History from './components/History';
import PlayerProfile from './components/PlayerProfile';
import TopTips from './components/TopTips';
import Backtest from './components/Backtest';
import Naplo from './components/Naplo';
import Segedlet from './components/Segedlet';
import Statisztika from './components/Statisztika';
import NapiMerkezesek from './components/NapiMerkezesek';
import ToastContainer from './components/ToastContainer';
import { MatchInput, MatchResult, Settings } from './model/types';
import { calculateMatch } from './model/calculator';
import {
  loadSettings, saveSettings,
  loadMatches, saveMatches,
  loadHistory, saveHistory, addToHistory,
  HistoryEntry,
} from './model/store';
import { autoCheckResults, resolveResults, fetchJournal, saveJournal } from './api';

type View = 'dashboard' | 'topTips' | 'napiMerkezesek' | 'naplo' | 'upcoming' | 'newMatch' | 'playerProfile' | 'backtest' | 'history' | 'settings' | 'statistics' | 'segedlet';

function App() {
  const [view, setView] = useState<View>('topTips');
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [matches, setMatches] = useState<MatchInput[]>(loadMatches);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);

  const results: MatchResult[] = matches.map(m => calculateMatch(m, settings));

  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { saveMatches(matches); }, [matches]);
  useEffect(() => { saveHistory(history); }, [history]);

  // Auto-check pending results every 5 minutes
  useEffect(() => {
    const check = async () => {
      const pending = history.filter(h => h.outcome === 'pending');
      if (pending.length === 0) return;

      try {
        const toCheck = pending.map(h => ({
          playerA: h.result.input.playerA,
          playerB: h.result.input.playerB,
          league: h.result.input.liga,
          timestamp: h.timestamp,
        }));
        const results = await autoCheckResults(toCheck);

        setHistory(prev => {
          const next = [...prev];
          for (const r of results) {
            if (r.outcome === 'pending') continue;
            const idx = next.findIndex(h =>
              h.outcome === 'pending' &&
              h.result.input.playerA === r.playerA &&
              h.result.input.playerB === r.playerB
            );
            if (idx !== -1) {
              // Map the match result to bet outcome
              const bet = next[idx].result.valueBet;
              let outcome: 'win' | 'loss' | 'pending' = 'pending';
              if (bet.includes('A gyozelem')) {
                outcome = r.outcome === 'win' ? 'win' : 'loss';
              } else if (bet.includes('B gyozelem')) {
                outcome = r.outcome === 'loss' ? 'win' : r.outcome === 'win' ? 'loss' : 'loss';
              } else if (bet === 'OVER' && r.score) {
                const goals = r.score.split('-').map(Number);
                const total = goals[0] + goals[1];
                outcome = total > next[idx].result.input.ouLine ? 'win' : 'loss';
              } else if (bet === 'UNDER' && r.score) {
                const goals = r.score.split('-').map(Number);
                const total = goals[0] + goals[1];
                outcome = total < next[idx].result.input.ouLine ? 'win' : 'loss';
              }
              if (outcome !== 'pending') {
                next[idx] = { ...next[idx], outcome };
              }
            }
          }
          return next;
        });
      } catch {
        // Silently fail - will retry next interval
      }
    };

    check();
    const interval = setInterval(check, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [history]);

  // ── Journal result validator — runs every 60 s regardless of active tab ──────
  // Fixes: Volta results missing, results lost on tab switch
  useEffect(() => {
    const BETTING_JOURNAL_KEY = 'betting_journal';
    const CHECKED_GREEN_KEY   = 'checked_green_matches';

    const validate = async () => {
      try {
        // Merge server journal with localStorage on first run (persistence fix)
        const serverJournal = await fetchJournal();
        if (serverJournal.length > 0) {
          const localRaw = localStorage.getItem(BETTING_JOURNAL_KEY);
          const local: any[] = localRaw ? (() => { try { return JSON.parse(localRaw); } catch { return []; } })() : [];
          if (serverJournal.length > local.length) {
            const merged = new Map<string, any>();
            for (const e of local) if (e?.matchId) merged.set(e.matchId, e);
            for (const e of serverJournal) if (e?.matchId) merged.set(e.matchId, e);
            const arr = Array.from(merged.values());
            localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(arr));
            window.dispatchEvent(new Event('journal-updated'));
          }
        }

        // Find pending journal entries that should have a result by now
        const journal: any[] = (() => {
          try { return JSON.parse(localStorage.getItem(BETTING_JOURNAL_KEY) || '[]'); } catch { return []; }
        })();

        const toResolve = journal.filter(m =>
          !m.result && m.betType && m.betLine != null && m.timestamp &&
          m.tip?.playerA && m.tip?.playerB
        );
        if (toResolve.length === 0) return;

        const resolved = await resolveResults(toResolve.map(m => ({
          matchId: m.matchId,
          playerA: m.tip.playerA,
          playerB: m.tip.playerB,
          league: m.tip.league || m.tip.liga || 'GT Leagues',
          timestamp: m.timestamp,
          betType: m.betType,
          betLine: m.betLine,
        })));

        let changed = false;
        for (const r of resolved) {
          if (r.pending || !r.outcome) continue;
          const idx = journal.findIndex((m: any) => m.matchId === r.matchId);
          if (idx !== -1 && !journal[idx].result) {
            journal[idx] = { ...journal[idx], result: r.outcome, finalScore: r.score };
            changed = true;
            console.log(`✅ Auto-result (esoccerbet): ${journal[idx].tip?.playerA} vs ${journal[idx].tip?.playerB} → ${r.outcome} (${r.score})`);
          }
        }

        if (changed) {
          localStorage.setItem(BETTING_JOURNAL_KEY, JSON.stringify(journal));
          saveJournal(journal);
          // Sync checked_green_matches
          const green: any[] = (() => { try { return JSON.parse(localStorage.getItem(CHECKED_GREEN_KEY) || '[]'); } catch { return []; } })();
          for (const r of resolved) {
            if (r.pending || !r.outcome) continue;
            const gi = green.findIndex((m: any) => m.matchId === r.matchId);
            if (gi !== -1 && !green[gi].result) {
              green[gi] = { ...green[gi], result: r.outcome, finalScore: r.score };
            }
          }
          localStorage.setItem(CHECKED_GREEN_KEY, JSON.stringify(green));
          window.dispatchEvent(new Event('journal-updated'));
          window.dispatchEvent(new Event('checked-matches-updated'));
        }
      } catch { /* silent */ }
    };

    validate();
    const id = setInterval(validate, 60_000);
    return () => clearInterval(id);
  }, []);

  const addMatch = useCallback((m: MatchInput) => {
    setMatches(prev => [...prev, m]);
    setView('dashboard');
  }, []);

  const removeMatch = useCallback((id: string) => {
    setMatches(prev => prev.filter(m => m.id !== id));
  }, []);

  const saveToHistory = useCallback((result: MatchResult) => {
    const updated = addToHistory(result);
    setHistory(updated);
    setMatches(prev => prev.filter(m => m.id !== result.input.id));
  }, []);

  const updateOutcome = useCallback((idx: number, outcome: 'win' | 'loss' | 'pending') => {
    setHistory(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], outcome };
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => { setHistory([]); }, []);

  return (
    <div className="min-h-screen bg-dark-bg flex flex-col">
      <TopNav current={view} onChange={setView} />
      <main className="flex-1">
        <div className="max-w-screen-2xl mx-auto p-4 lg:p-6">
          {view === 'topTips' && <TopTips onAddMatch={addMatch} />}
          {view === 'napiMerkezesek' && <NapiMerkezesek />}
          {view === 'naplo' && <Naplo />}
          {view === 'newMatch' && <MatchForm onSubmit={addMatch} />}
          {view === 'segedlet' && <Segedlet />}
          {view === 'statistics' && <Statisztika />}
          {view === 'dashboard' && <Dashboard results={results} history={history} bankroll={settings.bankroll} onRemoveMatch={removeMatch} onSaveToHistory={saveToHistory} />}
          {view === 'upcoming' && <Upcoming onAnalyze={addMatch} />}
          {view === 'playerProfile' && <PlayerProfile onBack={() => setView('dashboard')} />}
          {view === 'backtest' && <Backtest />}
          {view === 'history' && <History history={history} onUpdateOutcome={updateOutcome} onClear={clearHistory} />}
          {view === 'settings' && <SettingsPanel settings={settings} onChange={setSettings} />}
        </div>
      </main>
      <ToastContainer />
    </div>
  );
}

export default App;