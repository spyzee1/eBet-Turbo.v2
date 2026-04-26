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
import ToastContainer from './components/ToastContainer';
import { MatchInput, MatchResult, Settings } from './model/types';
import { calculateMatch } from './model/calculator';
import {
  loadSettings, saveSettings,
  loadMatches, saveMatches,
  loadHistory, saveHistory, addToHistory,
  HistoryEntry,
} from './model/store';
import { autoCheckResults } from './api';

type View = 'dashboard' | 'topTips' | 'naplo' | 'upcoming' | 'newMatch' | 'playerProfile' | 'backtest' | 'history' | 'settings' | 'statistics' | 'segedlet';

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