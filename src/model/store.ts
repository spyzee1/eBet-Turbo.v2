import { MatchInput, MatchResult, Settings } from './types';
import { DEFAULT_SETTINGS } from './calculator';

const SETTINGS_KEY = 'esport-bet-settings';
const MATCHES_KEY = 'esport-bet-matches';
const HISTORY_KEY = 'esport-bet-history';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* empty */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function loadMatches(): MatchInput[] {
  try {
    const raw = localStorage.getItem(MATCHES_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* empty */ }
  return [];
}

export function saveMatches(m: MatchInput[]) {
  localStorage.setItem(MATCHES_KEY, JSON.stringify(m));
}

export interface HistoryEntry {
  result: MatchResult;
  timestamp: number;
  outcome?: 'win' | 'loss' | 'pending';
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* empty */ }
  return [];
}

export function saveHistory(h: HistoryEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
}

export function addToHistory(result: MatchResult): HistoryEntry[] {
  const history = loadHistory();
  history.unshift({ result, timestamp: Date.now(), outcome: 'pending' });
  saveHistory(history);
  return history;
}
