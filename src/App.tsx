import { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Upcoming from './components/Upcoming';
import MatchForm from './components/MatchForm';
import SettingsPanel from './components/SettingsPanel';
import History from './components/History';
import PlayerProfile from './components/PlayerProfile';
import TopTips from './components/TopTips';
import Backtest from './components/Backtest';
import Naplo from './components/Naplo';
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

type View = 'dashboard' | 'topTips' | 'naplo' | 'upcoming' | 'newMatch' | 'playerProfile' | 'backtest' | 'history' | 'settings';

function App() {
  const [view, setView] = useState<View>('dashboard');
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [matches, setMatches] = useState<MatchInput[]>(loadMatches);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('esport-bet-theme');
    return saved !== 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('light', !darkMode);
    localStorage.setItem('esport-bet-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

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
    <div className="flex h-screen overflow-hidden">
      <Sidebar current={view} onChange={setView} activeCount={results.filter(r => r.valueBet !== 'PASS').length} darkMode={darkMode} onToggleTheme={() => setDarkMode(d => !d)} />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-4 pt-14 lg:pt-6 lg:p-8">
          <div className="mb-6 lg:mb-8">
            <h1 className="text-xl lg:text-2xl font-bold text-white">
              {view === 'dashboard' && 'Dashboard'}
              {view === 'topTips' && 'Napi Top Tippek'}
              {view === 'naplo' && 'Napló'}
              {view === 'upcoming' && 'Közelgő meccsek'}
              {view === 'newMatch' && 'Új meccs elemzése'}
              {view === 'playerProfile' && 'Játékos profil'}
              {view === 'backtest' && 'Backtest'}
              {view === 'history' && 'Tipp előzmény'}
              {view === 'settings' && 'Beállítások'}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {view === 'dashboard' && 'Aktuális elemzések és statisztikák'}
              {view === 'topTips' && 'A modell automatikusan kiválogatja a legjobb value beteket'}
              {view === 'naplo' && 'Utolsó 30 nap megtett meccsek, ROI és statisztikák'}
              {view === 'upcoming' && 'Élő menetrend az EsoccerBet-ről — egy kattintással elemezd'}
              {view === 'newMatch' && 'Add meg a meccs adatait az elemzéshez'}
              {view === 'playerProfile' && 'Részletes statisztikák, forma, csapat és ellenfél bontás'}
              {view === 'backtest' && 'Modell teljesítmény historikus meccseken + súly optimalizálás'}
              {view === 'history' && 'Korábban lezárt tippek és eredmények'}
              {view === 'settings' && 'Modell paraméterek és bankroll beállítások'}
            </p>
          </div>
          {view === 'dashboard' && <Dashboard results={results} history={history} bankroll={settings.bankroll} onRemoveMatch={removeMatch} onSaveToHistory={saveToHistory} />}
          {view === 'topTips' && <TopTips onAddMatch={addMatch} />}
          {view === 'naplo' && <Naplo />}
          {view === 'upcoming' && <Upcoming onAnalyze={addMatch} />}
          {view === 'newMatch' && <MatchForm onSubmit={addMatch} />}
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