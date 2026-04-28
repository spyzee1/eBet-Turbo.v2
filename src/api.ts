const API_BASE = '/api';

export interface ScrapedPlayer {
  name: string;
  winRate: number;
  gf: number;
  ga: number;
  forma: number;
  matches: number;
  form10: number;
  form50: number;
  bttsYes: number;
  ouStats: { line: string; over: number; under: number }[];
}

export interface H2HData {
  h2hWinsA: number;
  h2hWinsB: number;
  h2hDraws?: number;
  h2hTotal: number;
  h2hRatioA: number;
  h2hRatioB: number;
  h2hAvgGoalsA?: number;
  h2hAvgGoalsB?: number;
  h2hAvgTotalGoals?: number;
  h2hOverRates?: Record<string, number>;
  h2hSource?: string;
}

export interface LookupResult {
  playerA: ScrapedPlayer;
  playerB: ScrapedPlayer;
  h2h?: H2HData;
}

export interface ScheduleEntry {
  time: string;
  date: string;
  playerHome: string;
  teamHome: string;
  playerAway: string;
  teamAway: string;
  league: string;
}

export interface RankingEntry {
  position: number;
  name: string;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goalDiff: number;
  league: string;
}

export interface AutoCheckMatch {
  playerA: string;
  playerB: string;
  league: string;
  timestamp: number;
}

export interface AutoCheckResult extends AutoCheckMatch {
  outcome: 'win' | 'loss' | 'draw' | 'pending';
  score?: string;
}

export async function lookupPlayers(playerA: string, playerB: string, league: string): Promise<LookupResult> {
  const res = await fetch(`${API_BASE}/lookup/${encodeURIComponent(playerA)}/${encodeURIComponent(playerB)}?league=${encodeURIComponent(league)}`);
  if (!res.ok) throw new Error(`Hiba: ${res.status}`);
  return res.json();
}

export async function fetchSchedule(league?: string): Promise<ScheduleEntry[]> {
  const url = league
    ? `${API_BASE}/schedule?league=${encodeURIComponent(league)}`
    : `${API_BASE}/schedule`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hiba: ${res.status}`);
  return res.json();
}

export async function fetchBestPlayers(): Promise<RankingEntry[]> {
  const res = await fetch(`${API_BASE}/best-players`);
  if (!res.ok) throw new Error(`Hiba: ${res.status}`);
  return res.json();
}

export async function fetchRankings(league: string): Promise<RankingEntry[]> {
  const res = await fetch(`${API_BASE}/rankings?league=${encodeURIComponent(league)}`);
  if (!res.ok) throw new Error(`Hiba: ${res.status}`);
  return res.json();
}

export interface TeamStat {
  wins: number; losses: number; draws: number;
  gf: number; ga: number; matches: number;
}

export interface FormPoint {
  idx: number; winRate: number; date: string;
  opponent: string; result: string;
}

export interface PlayerProfile {
  name: string;
  league: string;
  matches: number;
  wins: number; draws: number; losses: number;
  winRate: number; lossRate: number; drawRate: number;
  gfPerMatch: number; gaPerMatch: number;
  form10: number; form50: number; form200: number;
  bttsYes: number;
  ouStats: { line: string; over: number; under: number }[];
  lastMatches: { opponent: string; opponentTeam: string; team: string; scoreHome: number; scoreAway: number; result: string; date: string }[];
  teamStats: Record<string, TeamStat>;
  opponentStats: Record<string, TeamStat>;
  formCurve: FormPoint[];
  timeInsights: string[];
  timePeriods: { morning: number; afternoon: number; evening: number; night: number };
  insights: {
    bestTeam: (TeamStat & { name: string }) | null;
    worstTeam: (TeamStat & { name: string }) | null;
    easiestOpponent: (TeamStat & { name: string }) | null;
    toughestOpponent: (TeamStat & { name: string }) | null;
  };
}

export async function fetchPlayerProfile(name: string, league: string = 'GT Leagues'): Promise<PlayerProfile> {
  const res = await fetch(`${API_BASE}/profile/${encodeURIComponent(name)}?league=${encodeURIComponent(league)}`);
  if (!res.ok) throw new Error(`Hiba: ${res.status}`);
  return res.json();
}

export type BetCategory = 'STRONG_BET' | 'BET' | 'NO_BET';

export interface RecentMatch {
  opponent: string;
  scoreHome: number;
  scoreAway: number;
  result: 'win' | 'loss' | 'draw';
  date: string;
}

export interface TopTip {
  time: string; date: string; league: string;
  playerA: string; teamA: string; playerB: string; teamB: string;
  valueBet: string; confidence: number; edge: number; stake: number;
  winEselyA: number; winEselyB: number;
  overEsely: number; underEsely: number;
  vartGol: number; ouLine: number;
  ajanlottTipp: string;
  h2hMode?: boolean;
  h2hTotal?: number;
  h2hWinsA?: number;
  h2hWinsB?: number;
  h2hSource?: string;
  tcMatchId?: string;
  oddsSource?: string;
  oddsA?: number;
  oddsB?: number;
  oddsOver?: number;
  oddsUnder?: number;
  category?: BetCategory;
  warning?: string | null;
  h2hOverRates?: Record<string, number>;
  h2hEffectiveSize?: number;
  movement1x2?: { home?: string; draw?: string; away?: string; homeChange?: number; awayChange?: number };
  movementGoals?: { over?: string; under?: string; overChange?: number; underChange?: number };
  // Friss meccsadatok
  lastMatchesA?: RecentMatch[];
  lastMatchesB?: RecentMatch[];
  gfPerMatchA?: number;
  gaPerMatchA?: number;
  gfPerMatchB?: number;
  gaPerMatchB?: number;
  h2hMatchHistory?: Array<{ date: string; goalsA: number; goalsB: number; winner: 'A' | 'B' | 'draw' }>;
}

export interface TopTipsResponse {
  generated: string;
  totalScanned: number;
  totalAnalyzed: number;
  totalValueBets: number;
  tips: TopTip[];
  strategy?: {
    id: string;
    name: string;
    settings: any;
    kellyEnabled: boolean;
  };
}

// ========== MÓDOSÍTOTT fetchTopTips - STRATEGY PARAMÉTERREL ==========
export async function fetchTopTips(league?: string, limit: number = 5, strategy: 'A' | 'B' | 'C' = 'B'): Promise<TopTipsResponse> {
  const params = new URLSearchParams();
  if (league) params.set('league', league);
  params.set('limit', String(limit));
  params.set('strategy', strategy); // ← ÚJ: Strategy paraméter!
  
  const res = await fetch(`${API_BASE}/top-tips?${params}`);
  if (!res.ok) throw new Error(`Hiba: ${res.status}`);
  return res.json();
}

export interface H2HDetailMatch {
  date: string;
  playerA: string; teamA: string;
  playerB: string; teamB: string;
  scoreA: number; scoreB: number;
  winner: 'A' | 'B' | 'draw';
}

export interface H2HDetail {
  total: number;
  winsA: number;
  winsB: number;
  draws: number;
  avgGoalsA: number;
  avgGoalsB: number;
  avgTotalGoals: number;
  matches: H2HDetailMatch[];
}

export async function configureTelegramBot(botToken: string, chatId: string): Promise<{ configured: boolean; testMessageSent: boolean }> {
  const res = await fetch(`${API_BASE}/telegram/configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botToken, chatId }),
  });
  if (!res.ok) throw new Error(`Hiba: ${res.status}`);
  return res.json();
}

export async function getTelegramStatus(): Promise<{ configured: boolean }> {
  const res = await fetch(`${API_BASE}/telegram/status`);
  if (!res.ok) throw new Error(`Hiba: ${res.status}`);
  return res.json();
}

export interface ScannerStatus {
  lastRun: number;
  lastRunISO: string | null;
  errors: number;
  cachedTipCount: number;
  pushedCount: number;
  isRunning: boolean;
}

export async function getScannerStatus(): Promise<ScannerStatus> {
  const res = await fetch(`${API_BASE}/scanner/status`);
  if (!res.ok) throw new Error(`Hiba: ${res.status}`);
  return res.json();
}

export async function triggerScan(): Promise<{ ran: boolean; tipsFound: number }> {
  const res = await fetch(`${API_BASE}/scanner/run`, { method: 'POST' });
  if (!res.ok) throw new Error(`Hiba: ${res.status}`);
  return res.json();
}

export interface BacktestDetail {
  date: string;
  playerA: string; playerB: string;
  scoreA: number; scoreB: number;
  valueBet: string;
  confidence: number;
  edge: number;
  stake: number;
  won: boolean | null;
  profit: number;
}

export interface BacktestResult {
  league: string;
  totalMatches: number;
  totalBets: number;
  wins: number;
  losses: number;
  passes: number;
  hitRate: number;
  roi: number;
  totalStaked: number;
  totalProfit: number;
  byMarket: {
    win: { bets: number; wins: number; hitRate: number };
    overUnder: { bets: number; wins: number; hitRate: number };
  };
  byConfidence: {
    high: { bets: number; wins: number; hitRate: number };
    medium: { bets: number; wins: number; hitRate: number };
    low: { bets: number; wins: number; hitRate: number };
  };
  details: BacktestDetail[];
}

export async function runBacktest(player: string, league: string, opponent?: string): Promise<BacktestResult> {
  const params = new URLSearchParams({ league });
  if (opponent) params.set('opponent', opponent);
  const res = await fetch(`${API_BASE}/backtest/${encodeURIComponent(player)}?${params}`);
  if (!res.ok) throw new Error(`Hiba: ${res.status}`);
  return res.json();
}

export interface OptimizeWeights {
  wr: number; forma: number; h2h: number; atk: number; def: number;
}

export interface OptimizeResultEntry {
  settings: OptimizeWeights;
  roi: number;
  hitRate: number;
  bets: number;
  profit: number;
}

export interface OptimizeResponse {
  totalCombinations: number;
  best: OptimizeResultEntry | null;
  top20: OptimizeResultEntry[];
  defaultSettings: OptimizeWeights;
}

export async function runOptimize(player: string, league: string): Promise<OptimizeResponse> {
  const res = await fetch(`${API_BASE}/optimize/${encodeURIComponent(player)}?league=${encodeURIComponent(league)}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Hiba: ${res.status}`);
  return res.json();
}

export async function fetchH2HDetail(playerA: string, playerB: string, league: string): Promise<H2HDetail> {
  const res = await fetch(`${API_BASE}/h2h/${encodeURIComponent(playerA)}/${encodeURIComponent(playerB)}?league=${encodeURIComponent(league)}`);
  if (!res.ok) throw new Error(`Hiba: ${res.status}`);
  return res.json();
}

export interface LiveScore {
  playerA: string;
  playerB: string;
  scoreA: number;
  scoreB: number;
  minute: number | null;
  period: number | null;
  periodName: string | null;
  isLive: boolean;
  source: 'altenar';
}

export async function fetchLiveScores(): Promise<LiveScore[]> {
  const res = await fetch(`${API_BASE}/live-scores`);
  if (!res.ok) return [];
  return res.json();
}

export async function clearServerCache(): Promise<{ cleared: number }> {
  const res = await fetch(`${API_BASE}/cache/clear`, { method: 'POST' });
  if (!res.ok) return { cleared: 0 };
  return res.json();
}

export interface TrendSignal {
  playerA: string;
  playerB: string;
  league: string;
  nextMatchTime: string;
  minutesUntil: number;
  todayH2H: Array<{ time: string; goalsA: number; goalsB: number; total: number }>;
  trendSlope: number;
  avgTotalGoals: number;
  ouLine: number;
  oddsOver?: number;
  aboveLinePct: number;
  aboveLineCount: number;
  lastTwoAboveLine: boolean;
  signalStrength: 'VALUE' | 'TREND';
}

export interface TrendScannerStatus {
  lastRun: number;
  lastRunISO: string | null;
  lastSignalCount: number;
  pushedCount: number;
  errors: number;
  isRunning: boolean;
}

export async function getTrendStatus(): Promise<TrendScannerStatus> {
  const res = await fetch(`${API_BASE}/trend/status`);
  if (!res.ok) throw new Error(`Hiba: ${res.status}`);
  return res.json();
}

export async function triggerTrendScan(): Promise<{ ran: boolean; signalsFound: number; pushed: number; signals: TrendSignal[] }> {
  const res = await fetch(`${API_BASE}/trend/run`, { method: 'POST' });
  if (!res.ok) throw new Error(`Hiba: ${res.status}`);
  return res.json();
}

export interface ResolveMatch {
  matchId: string;
  playerA: string;
  playerB: string;
  league: string;
  timestamp: number;
  betType: string;
  betLine: number;
}

export interface ResolveResult {
  matchId: string;
  pending: boolean;
  score?: string;
  total?: number;
  outcome?: 'Win' | 'Loss' | null;
}

export async function resolveResults(matches: ResolveMatch[]): Promise<ResolveResult[]> {
  try {
    const res = await fetch(`${API_BASE}/resolve-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matches }),
    });
    if (!res.ok) return matches.map(m => ({ matchId: m.matchId, pending: true }));
    return res.json();
  } catch { return matches.map(m => ({ matchId: m.matchId, pending: true })); }
}

export async function fetchJournal(): Promise<any[]> {
  try {
    const res = await fetch(`${API_BASE}/journal`);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export async function saveJournal(entries: any[]): Promise<void> {
  try {
    await fetch(`${API_BASE}/journal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entries),
    });
  } catch { /* silent */ }
}

export async function autoCheckResults(matches: AutoCheckMatch[]): Promise<AutoCheckResult[]> {
  const res = await fetch(`${API_BASE}/auto-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matches }),
  });
  if (!res.ok) throw new Error(`Hiba: ${res.status}`);
  return res.json();
}