import { getVegasOdds, getAllVegasOdds, clearVegasCache, getAllLiveScores, getRawLiveDebug } from './vegas-scraper.js';
import {
  scrapeFullPlayerData,
  scrapeSchedule as tcScrapeSchedule,
  getBestPlayers,
  TotalCornerLeague,
  TOTALCORNER_LEAGUES,
} from './totalcorner-scraper.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrapePlayerStats, scrapeRankings, scrapeBestPlayers, scrapeSchedule as esbScrapeSchedule, scrapePlayerResults, PlayerStats } from './scraper.js';
import { calculateMatch, DEFAULT_SETTINGS } from '../src/model/calculator.js';
import { estimateMatchOdds } from '../src/model/fairOdds.js';
import { STRATEGIES } from '../src/model/strategies.js';
import { buildBacktestDataset, runBacktest } from './backtest.js';
import { analyzeTimePerformance, getTimeSummary } from '../src/model/timeFactors.js';
import {
  scrapeTCLeague, scrapeTCMatchOdds, scrapeTCH2H, aggregateH2H,
  aggregateH2HWeighted, normalizeTCH2H, mergeH2HSources,
  TC_LEAGUES, NormalizedH2H,
} from './totalcorner.js';
import {
  configureTelegram, isTelegramConfigured, loadConfigFromEnv,
  startBotPolling, sendMessage, sendTopTipsList,
} from './telegram.js';
import {
  configureScanner, startScanner, runScan, getScannerState, getCachedResult,
} from './scanner.js';
import {
  configureTrendScanner, startTrendScanner, getTrendScannerState, runTrendScanOnce,
} from './trend-scanner.js';

const app = express();
app.use(cors());
app.use(express.json());

// ── TC-only leagues not on esoccerbet.org ─────────────────────────────────────
// Volta is on esoccerbet.org — use that for rich per-match history. H2H GG is TC-only.
const TC_ONLY_LEAGUES = new Set(['Esoccer H2H GG League']);

/** TotalCorner serves times in UTC. Budapest is CEST (UTC+2). Add 2 hours. */
function shiftTCTime<T extends { time?: string }>(entry: T): T {
  const [h, m] = (entry.time || '00:00').split(':').map(Number);
  const newH = (h + 2) % 24;
  return { ...entry, time: `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
}

/** Filter a TC schedule array to upcoming/in-progress matches.
 *  Times have already been shifted to Budapest local (CEST = UTC+2).
 *  Compare directly against server local time — no further offset needed.
 */
function filterTCSchedule<T extends { time?: string; scoreHome?: number; scoreAway?: number }>(
  raw: T[]
): T[] {
  return raw.filter(m => {
    const hasScore = m.scoreHome !== undefined && m.scoreAway !== undefined
      && (m.scoreHome > 0 || m.scoreAway > 0);
    if (hasScore) return false;
    const [mH, mM] = (m.time || '00:00').split(':').map(Number);
    const matchLocalMinutes = mH * 60 + mM;
    const now = new Date();
    const nowLocalMinutes = now.getHours() * 60 + now.getMinutes();
    let diff = matchLocalMinutes - nowLocalMinutes;
    if (diff < -720) diff += 1440;
    if (diff > 720) diff -= 1440;
    return diff >= -3; // keep up to 3 min past start (then score filter takes over)
  });
}

/** Combined schedule: esoccerbet.org + TotalCorner-only leagues (upcoming only) */
async function getCombinedSchedule() {
  const [esbResult, h2hResult, voltaResult] = await Promise.allSettled([
    esbScrapeSchedule(),
    tcScrapeSchedule('Esoccer H2H GG League'),
    tcScrapeSchedule('Esports Volta'),
  ]);
  const esb      = esbResult.status    === 'fulfilled' ? esbResult.value    : [];
  const h2hRaw   = h2hResult.status    === 'fulfilled' ? h2hResult.value    : [];
  const voltaRaw = voltaResult.status  === 'fulfilled' ? voltaResult.value  : [];

  // Shift TC times from BST/CET (UTC+1) to Budapest CEST (UTC+2), then filter
  return [
    ...esb,
    ...filterTCSchedule(h2hRaw.map(shiftTCTime)),
    ...filterTCSchedule(voltaRaw.map(shiftTCTime)),
  ];
}

// ── Sticky buffer: keep GT Leagues match cards for 3 min after scheduled start ──
type ScheduleEntry = Awaited<ReturnType<typeof getCombinedSchedule>>[number];
const stickyBuffer = new Map<string, { entry: ScheduleEntry; startMs: number }>();

function updateStickyBuffer(schedule: ScheduleEntry[]) {
  const now = Date.now();
  const today = new Date();
  const dayBase = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const STICKY_LEAGUES = new Set(['GT Leagues', 'Esoccer H2H GG League', 'Esports Volta']);
  for (const entry of schedule) {
    if (!STICKY_LEAGUES.has(entry.league)) continue;
    const key = `${entry.playerHome}|${entry.playerAway}|${entry.time}`;
    if (!stickyBuffer.has(key)) {
      const [h, m] = (entry.time || '00:00').split(':').map(Number);
      stickyBuffer.set(key, { entry, startMs: dayBase + h * 3600000 + m * 60000 });
    }
  }
  // Clean entries older than 5 min past start
  for (const [key, { startMs }] of stickyBuffer) {
    if (now - startMs > 5 * 60 * 1000) stickyBuffer.delete(key);
  }
}

function applySticky(schedule: ScheduleEntry[]): ScheduleEntry[] {
  const now = Date.now();
  const currentKeys = new Set(schedule.map(e => `${e.playerHome}|${e.playerAway}|${e.time}`));
  const extra: ScheduleEntry[] = [];
  for (const [, { entry, startMs }] of stickyBuffer) {
    if (currentKeys.has(`${entry.playerHome}|${entry.playerAway}|${entry.time}`)) continue;
    const msPastStart = now - startMs;
    if (msPastStart >= 0 && msPastStart <= 3 * 60 * 1000) extra.push(entry);
  }
  return extra.length > 0 ? [...schedule, ...extra] : schedule;
}

/** Promise-based cache for TC bulk player data (prevents parallel fetches) */
const tcPlayerBulkPromise = new Map<string, Promise<import('./totalcorner-scraper.js').TotalCornerPlayer[]>>();
const tcPlayerBulkTs = new Map<string, number>();
const TC_BULK_TTL = 10 * 60 * 1000;

async function getTCPlayerBulk(league: TotalCornerLeague) {
  const ts = tcPlayerBulkTs.get(league) ?? 0;
  if (Date.now() - ts < TC_BULK_TTL && tcPlayerBulkPromise.has(league)) {
    return tcPlayerBulkPromise.get(league)!;
  }
  const p = scrapeFullPlayerData(league);
  tcPlayerBulkPromise.set(league, p);
  tcPlayerBulkTs.set(league, Date.now());
  return p;
}

/** Convert TotalCornerPlayer → PlayerStats for TC-only leagues.
 *  Builds per-match history from the TC schedule (which contains full results history).
 */
async function getPlayerStatsTC(playerName: string, league: TotalCornerLeague): Promise<PlayerStats> {
  const pNameLow = playerName.toLowerCase();

  const [bulk, fullSchedule] = await Promise.all([
    getTCPlayerBulk(league),
    cached(`tc:full-schedule:${league}`, () => tcScrapeSchedule(league)),
  ]);

  const p = bulk.find(pl => pl.name.toLowerCase() === pNameLow);
  if (!p) throw new Error(`Player ${playerName} not found in TC ${league}`);

  // Build per-match history from the TC schedule (completed matches = both scores defined)
  const lastMatches = fullSchedule
    .filter(m =>
      m.scoreHome !== undefined && m.scoreAway !== undefined &&
      (m.playerHome.toLowerCase() === pNameLow || m.playerAway.toLowerCase() === pNameLow)
    )
    .map(m => {
      const isHome = m.playerHome.toLowerCase() === pNameLow;
      const gf = isHome ? (m.scoreHome ?? 0) : (m.scoreAway ?? 0);
      const ga = isHome ? (m.scoreAway ?? 0) : (m.scoreHome ?? 0);
      return {
        date: m.time ? `${m.date} ${m.time}` : m.date,
        opponent: isHome ? m.playerAway : m.playerHome,
        team: isHome ? m.teamHome : m.teamAway,
        opponentTeam: isHome ? m.teamAway : m.teamHome,
        result: (gf > ga ? 'win' : gf < ga ? 'loss' : 'draw') as 'win' | 'loss' | 'draw',
        scoreHome: gf,
        scoreAway: ga,
      };
    })
    .slice(0, 20); // TC table is already newest-first

  // Recent form delta vs season average
  const last10 = lastMatches.slice(0, 10);
  const recentWR = last10.length > 0 ? last10.filter(m => m.result === 'win').length / last10.length : p.winRate;
  const form10 = recentWR - p.winRate;

  return {
    name: p.name,
    league,
    matches: p.matches,
    wins: p.wins,
    draws: p.draws,
    losses: p.losses,
    winRate: p.winRate,
    lossRate: p.matches > 0 ? p.losses / p.matches : 0,
    drawRate: p.matches > 0 ? p.draws / p.matches : 0,
    goalDiff: p.gf - p.ga,
    gfPerMatch: p.avgGF,
    gaPerMatch: p.avgGA,
    form10,
    form50: 0,
    form200: 0,
    bttsYes: 0.5,
    ouStats: p.ouStats,
    lastMatches,
  };
}

/** Unified player stats: esoccerbet.org or TC fallback */
async function getPlayerStats(playerName: string, league: string): Promise<PlayerStats> {
  if (TC_ONLY_LEAGUES.has(league)) {
    return getPlayerStatsTC(playerName, league as TotalCornerLeague);
  }
  return scrapePlayerStats(playerName, league);
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), node: process.version });
});

app.post('/api/cache/clear', (_req, res) => {
  const before = cache.size;
  cache.clear();
  res.json({ cleared: before });
});

// Classify a bet into STRONG_BET / BET / NO_BET based on confidence + edge
function classifyBet(confidence: number, edge: number, valueBet: string): 'STRONG_BET' | 'BET' | 'NO_BET' {
  if (valueBet === 'PASS') return 'NO_BET';
  if (confidence >= 0.80 && edge >= 0.08) return 'STRONG_BET';
  if (confidence >= 0.65 && edge >= 0.04) return 'BET';
  return 'NO_BET';
}

// Strategy-specific classification (uses custom thresholds from Strategy definition)
function classifyBetWithStrategy(
  confidence: number, edge: number, valueBet: string,
  strategy: import('../src/model/strategies.js').Strategy
): 'STRONG_BET' | 'BET' | 'NO_BET' {
  if (valueBet === 'PASS') return 'NO_BET';
  const sc = strategy.strongBetConf ?? 0.80;
  const se = strategy.strongBetEdge ?? 0.08;
  const bc = strategy.betConf ?? 0.65;
  const be = strategy.betEdge ?? 0.04;
  if (confidence >= sc && edge >= se) return 'STRONG_BET';
  if (confidence >= bc && edge >= be) return 'BET';
  return 'NO_BET';
}

// "MM/DD" today prefix for fatigue detection (matches lastMatches date format)
function todayMMDD(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

// Sanity check: edge > 50% is suspicious (likely data error or mispriced market)
function sanityWarning(edge: number, h2hTotal: number, oddsSource: string): string | null {
  if (edge >= 0.50) {
    return `Gyanúsan magas edge (${(edge * 100).toFixed(0)}%) — ellenőrizd a valós oddsot`;
  }
  if (edge >= 0.35 && oddsSource === 'estimated') {
    return 'Magas edge becsült oddsszal — a valós piaci odds eltérhet';
  }
  if (edge >= 0.30 && h2hTotal < 8) {
    return 'Magas edge kis H2H mintán — óvatosan';
  }
  return null;
}

// Test Vegas.hu scraper:
//   /api/test-vegas?playerA=donatello&playerB=peconi  → specific match
//   /api/test-vegas                                   → all e-soccer events
app.get('/api/test-vegas', async (req, res) => {
  const playerA = req.query.playerA as string | undefined;
  const playerB = req.query.playerB as string | undefined;
  try {
    clearVegasCache();
    if (playerA && playerB) {
      const odds = await getVegasOdds(playerA, playerB);
      res.json({ playerA, playerB, result: odds, found: odds !== null });
    } else {
      const all = await getAllVegasOdds();
      res.json({ count: all.length, all, sample: all.slice(0, 5) });
    }
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// Debug: raw TC schedule for H2H GG League (megmutatja van-e score a múltbeli meccseken)
app.get('/api/debug-tc-schedule', async (req, res) => {
  const league = (req.query.league as string) || 'Esoccer H2H GG League';
  try {
    const raw = await tcScrapeSchedule(league as TotalCornerLeague);
    const withScore = raw.filter(m => m.scoreHome !== undefined || m.scoreAway !== undefined);
    const withoutScore = raw.filter(m => m.scoreHome === undefined && m.scoreAway === undefined);
    res.json({
      total: raw.length,
      withScore: withScore.length,
      withoutScore: withoutScore.length,
      sampleWithScore: withScore.slice(0, 5),
      sampleWithoutScore: withoutScore.slice(0, 5),
      serverLocalTime: new Date().toLocaleString('hu-HU'),
      serverUTCTime: new Date().toUTCString(),
    });
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// GET /api/live-scores — élő meccsek gólállása + menetideje (Altenar)
app.get('/api/live-scores', async (_req, res) => {
  try {
    const scores = await getAllLiveScores();
    res.json(scores);
  } catch {
    res.json([]);
  }
});

// GET /api/debug-live — nyers Altenar live mezők (fejlesztéshez)
app.get('/api/debug-live', async (_req, res) => {
  try {
    const raw = await getRawLiveDebug();
    res.json(raw);
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown' });
  }
});

// Test scraper connectivity
app.get('/api/test-scrape', async (_req, res) => {
  try {
    const r = await fetch('https://esoccerbet.org/schedule/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    const html = await r.text();
    res.json({ status: r.status, htmlLength: html.length, first100: html.substring(0, 100) });
  } catch (e: unknown) {
    res.json({ error: e instanceof Error ? e.message : 'Unknown', stack: e instanceof Error ? e.stack : '' });
  }
});

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 3 * 60 * 1000;

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) {
    return Promise.resolve(entry.data as T);
  }
  return fn().then(data => {
    cache.set(key, { data, ts: Date.now() });
    return data;
  });
}

app.get('/api/player/:name', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const data = await cached(`player:${req.params.name}:${league}`, () =>
      scrapePlayerStats(req.params.name, league)
    );
    res.json(data);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

app.get('/api/rankings', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const data = await cached(`rankings:${league}`, () => scrapeRankings(league));
    res.json(data);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

app.get('/api/best-players', async (_req, res) => {
  try {
    const data = await cached('best-players', scrapeBestPlayers);
    res.json(data);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

app.get('/api/schedule', async (req, res) => {
  try {
    const league = req.query.league as string | undefined;
    let data = await cached('schedule', getCombinedSchedule);
    if (league) data = data.filter(m => m.league === league);
    res.json(data);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

app.get('/api/lookup/:playerA/:playerB', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const tcMatchId = req.query.tcMatchId as string | undefined;

    const [a, b] = await Promise.all([
      cached(`player:${req.params.playerA}:${league}`, () =>
        scrapePlayerStats(req.params.playerA, league)
      ),
      cached(`player:${req.params.playerB}:${league}`, () =>
        scrapePlayerStats(req.params.playerB, league)
      ),
    ]);

    // H2H from esoccerbet last matches (with goal stats)
    const h2hFromA = a.lastMatches.filter(m => m.opponent.toLowerCase() === req.params.playerB.toLowerCase());
    const h2hFromB = b.lastMatches.filter(m => m.opponent.toLowerCase() === req.params.playerA.toLowerCase());
    let h2hWinsA = h2hFromA.filter(m => m.result === 'win').length + h2hFromB.filter(m => m.result === 'loss').length;
    let h2hWinsB = h2hFromA.filter(m => m.result === 'loss').length + h2hFromB.filter(m => m.result === 'win').length;
    let h2hDraws = h2hFromA.filter(m => m.result === 'draw').length + h2hFromB.filter(m => m.result === 'draw').length;
    let h2hTotal = h2hFromA.length + h2hFromB.length;

    // Calculate H2H goal averages from last matches
    let h2hAvgGoalsA: number | undefined;
    let h2hAvgGoalsB: number | undefined;
    let h2hAvgTotalGoals: number | undefined;
    let h2hOverRates: Record<string, number> | undefined;
    let h2hSource = 'esoccerbet';

    if (h2hTotal > 0) {
      let totalGoalsA = 0, totalGoalsB = 0;
      const totalGoalsList: number[] = [];
      // From A's perspective: scoreHome = A goals, scoreAway = B goals
      for (const m of h2hFromA) {
        totalGoalsA += m.scoreHome;
        totalGoalsB += m.scoreAway;
        totalGoalsList.push(m.scoreHome + m.scoreAway);
      }
      // From B's perspective: scoreHome = B goals, scoreAway = A goals (flip)
      for (const m of h2hFromB) {
        totalGoalsA += m.scoreAway;
        totalGoalsB += m.scoreHome;
        totalGoalsList.push(m.scoreHome + m.scoreAway);
      }
      h2hAvgGoalsA = totalGoalsA / h2hTotal;
      h2hAvgGoalsB = totalGoalsB / h2hTotal;
      h2hAvgTotalGoals = totalGoalsList.reduce((a, b) => a + b, 0) / h2hTotal;
      const rates: Record<string, number> = {};
      for (const line of [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]) {
        rates[String(line)] = totalGoalsList.filter(g => g > line).length / h2hTotal;
      }
      h2hOverRates = rates;
    }

    // Try to get richer H2H data from totalcorner if matchId provided
    if (tcMatchId) {
      try {
        const tcH2H = await cached(`tc:h2h:${tcMatchId}`, () =>
          scrapeTCH2H(tcMatchId, req.params.playerA, req.params.playerB)
        );
        if (tcH2H.length > 0) {
          const agg = aggregateH2H(tcH2H, req.params.playerA, req.params.playerB);
          h2hWinsA = agg.winsA;
          h2hWinsB = agg.winsB;
          h2hDraws = agg.draws;
          h2hTotal = agg.total;
          h2hAvgGoalsA = agg.avgGoalsA;
          h2hAvgGoalsB = agg.avgGoalsB;
          h2hAvgTotalGoals = agg.avgTotalGoals;
          h2hOverRates = agg.overRates;
          h2hSource = 'totalcorner';
        }
      } catch {
        // ignore, use esoccerbet fallback
      }
    }

    const h2hRatioA = h2hTotal > 0 ? (h2hWinsA + h2hDraws * 0.5) / h2hTotal : 0.5;
    const h2hRatioB = h2hTotal > 0 ? 1 - h2hRatioA : 0.5;

    const formToWinRate = (p: PlayerStats) => {
      if (p.winRate > 0) return p.winRate;
      if (p.matches > 0) return p.wins / p.matches;
      return 0.5;
    };

    const forma = (p: PlayerStats) => {
      const base = formToWinRate(p);
      return Math.max(0, Math.min(1, base + p.form10));
    };

    res.json({
      playerA: {
        name: a.name, winRate: formToWinRate(a), gf: a.gfPerMatch, ga: a.gaPerMatch,
        forma: forma(a), matches: a.matches, form10: a.form10, form50: a.form50,
        bttsYes: a.bttsYes, ouStats: a.ouStats,
      },
      playerB: {
        name: b.name, winRate: formToWinRate(b), gf: b.gfPerMatch, ga: b.gaPerMatch,
        forma: forma(b), matches: b.matches, form10: b.form10, form50: b.form50,
        bttsYes: b.bttsYes, ouStats: b.ouStats,
      },
      h2h: {
        h2hWinsA, h2hWinsB, h2hDraws, h2hTotal, h2hRatioA, h2hRatioB,
        h2hAvgGoalsA, h2hAvgGoalsB, h2hAvgTotalGoals, h2hOverRates,
        h2hSource,
      },
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// GET /api/h2h/:playerA/:playerB - detailed H2H match history
app.get('/api/h2h/:playerA/:playerB', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const [a, b] = await Promise.all([
      cached(`player:${req.params.playerA}:${league}`, () =>
        scrapePlayerStats(req.params.playerA, league)
      ),
      cached(`player:${req.params.playerB}:${league}`, () =>
        scrapePlayerStats(req.params.playerB, league)
      ),
    ]);

    // Collect H2H matches from both sides (dedupe by date)
    const seen = new Set<string>();
    const h2hMatches: Array<{
      date: string;
      playerA: string; teamA: string;
      playerB: string; teamB: string;
      scoreA: number; scoreB: number;
      winner: 'A' | 'B' | 'draw';
    }> = [];

    // From A's lastMatches: opponent is B
    for (const m of a.lastMatches) {
      if (m.opponent.toLowerCase() !== req.params.playerB.toLowerCase()) continue;
      const key = `${m.date}|${m.scoreHome}-${m.scoreAway}`;
      if (seen.has(key)) continue;
      seen.add(key);
      h2hMatches.push({
        date: m.date,
        playerA: req.params.playerA,
        teamA: m.team,
        playerB: req.params.playerB,
        teamB: m.opponentTeam,
        scoreA: m.scoreHome,
        scoreB: m.scoreAway,
        winner: m.scoreHome > m.scoreAway ? 'A' : m.scoreHome < m.scoreAway ? 'B' : 'draw',
      });
    }

    // From B's lastMatches: opponent is A, flip scores
    for (const m of b.lastMatches) {
      if (m.opponent.toLowerCase() !== req.params.playerA.toLowerCase()) continue;
      const key = `${m.date}|${m.scoreAway}-${m.scoreHome}`;
      if (seen.has(key)) continue;
      seen.add(key);
      h2hMatches.push({
        date: m.date,
        playerA: req.params.playerA,
        teamA: m.opponentTeam,
        playerB: req.params.playerB,
        teamB: m.team,
        scoreA: m.scoreAway,
        scoreB: m.scoreHome,
        winner: m.scoreAway > m.scoreHome ? 'A' : m.scoreAway < m.scoreHome ? 'B' : 'draw',
      });
    }

    // Sort by date (most recent first - they come in that order already)
    const total = h2hMatches.length;
    const winsA = h2hMatches.filter(m => m.winner === 'A').length;
    const winsB = h2hMatches.filter(m => m.winner === 'B').length;
    const draws = h2hMatches.filter(m => m.winner === 'draw').length;
    const avgGoalsA = total > 0 ? h2hMatches.reduce((s, m) => s + m.scoreA, 0) / total : 0;
    const avgGoalsB = total > 0 ? h2hMatches.reduce((s, m) => s + m.scoreB, 0) / total : 0;
    const avgTotalGoals = avgGoalsA + avgGoalsB;

    res.json({
      total, winsA, winsB, draws,
      avgGoalsA, avgGoalsB, avgTotalGoals,
      matches: h2hMatches,
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// GET /api/check-result/:player - check last match result for auto-tracking
app.get('/api/check-result/:player', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const results = await cached(`results:${req.params.player}:${league}`, () =>
      scrapePlayerResults(req.params.player, league)
    );
    res.json(results.slice(0, 5));
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// GET /api/profile/:name - full player profile with breakdowns
app.get('/api/profile/:name', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const stats = await cached(`player:${req.params.name}:${league}`, () =>
      scrapePlayerStats(req.params.name, league)
    );

    // Team breakdown
    const teamStats: Record<string, { wins: number; losses: number; draws: number; gf: number; ga: number; matches: number }> = {};
    for (const m of stats.lastMatches) {
      if (!teamStats[m.team]) teamStats[m.team] = { wins: 0, losses: 0, draws: 0, gf: 0, ga: 0, matches: 0 };
      const t = teamStats[m.team];
      t.matches++;
      t.gf += m.scoreHome;
      t.ga += m.scoreAway;
      if (m.result === 'win') t.wins++;
      else if (m.result === 'loss') t.losses++;
      else t.draws++;
    }

    // Opponent breakdown
    const opponentStats: Record<string, { wins: number; losses: number; draws: number; gf: number; ga: number; matches: number }> = {};
    for (const m of stats.lastMatches) {
      const opp = m.opponent;
      if (!opponentStats[opp]) opponentStats[opp] = { wins: 0, losses: 0, draws: 0, gf: 0, ga: 0, matches: 0 };
      const o = opponentStats[opp];
      o.matches++;
      o.gf += m.scoreHome;
      o.ga += m.scoreAway;
      if (m.result === 'win') o.wins++;
      else if (m.result === 'loss') o.losses++;
      else o.draws++;
    }

    // Form curve: rolling win rate over last matches
    const formCurve = stats.lastMatches.map((m, i) => {
      const slice = stats.lastMatches.slice(0, i + 1);
      const wr = slice.filter(s => s.result === 'win').length / slice.length;
      return { idx: i + 1, winRate: Math.round(wr * 100), date: m.date, opponent: m.opponent, result: m.result };
    });

    // Best/worst team
    const teamEntries = Object.entries(teamStats).filter(([, v]) => v.matches >= 2);
    const bestTeam = teamEntries.sort((a, b) => (b[1].wins / b[1].matches) - (a[1].wins / a[1].matches))[0];
    const worstTeam = teamEntries.sort((a, b) => (a[1].wins / a[1].matches) - (b[1].wins / b[1].matches))[0];

    // Toughest/easiest opponent
    const oppEntries = Object.entries(opponentStats).filter(([, v]) => v.matches >= 2);
    const easiestOpp = oppEntries.sort((a, b) => (b[1].wins / b[1].matches) - (a[1].wins / a[1].matches))[0];
    const toughestOpp = oppEntries.sort((a, b) => (a[1].wins / a[1].matches) - (b[1].wins / b[1].matches))[0];

    // Time performance analysis
    const timePerf = analyzeTimePerformance(stats.lastMatches);
    const timeInsights = getTimeSummary(timePerf);

    res.json({
      ...stats,
      teamStats,
      opponentStats,
      formCurve,
      timeInsights,
      timePeriods: timePerf.byPeriod,
      insights: {
        bestTeam: bestTeam ? { name: bestTeam[0], ...bestTeam[1] } : null,
        worstTeam: worstTeam ? { name: worstTeam[0], ...worstTeam[1] } : null,
        easiestOpponent: easiestOpp ? { name: easiestOpp[0], ...easiestOpp[1] } : null,
        toughestOpponent: toughestOpp ? { name: toughestOpp[0], ...toughestOpp[1] } : null,
      },
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// POST /api/auto-check - check multiple matches for results
app.post('/api/auto-check', async (req, res) => {
  try {
    const { matches } = req.body as { matches: { playerA: string; playerB: string; league: string; timestamp: number }[] };
    const results = await Promise.all(
      matches.map(async (m) => {
        try {
          const playerResults = await cached(`results:${m.playerA}:${m.league}`, () =>
            scrapePlayerResults(m.playerA, m.league)
          );
          // Find a match vs playerB after the bet timestamp
          const found = playerResults.find(r =>
            r.opponent.toLowerCase() === m.playerB.toLowerCase()
          );
          if (found) {
            return { ...m, outcome: found.result, score: `${found.scoreHome}-${found.scoreAway}` };
          }
          return { ...m, outcome: 'pending' as const };
        } catch {
          return { ...m, outcome: 'pending' as const };
        }
      })
    );
    res.json(results);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// GET /api/top-tips?league=...&limit=5 - auto-scan schedule and return best value bets
app.get('/api/top-tips', async (req, res) => {
  try {
    const leagueFilter = req.query.league as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 5, 20);
    const strategyId = (req.query.strategy as string)?.toUpperCase() || 'A';
    const selectedStrategy = STRATEGIES[strategyId] || STRATEGIES.A;
    // minConf/minEdge: strategy-specific thresholds take precedence
    const minConf = parseFloat(req.query.minConf as string) || (selectedStrategy.betConf ?? 0.55);
    const minEdge = parseFloat(req.query.minEdge as string) || (selectedStrategy.betEdge ?? 0.02);

    console.log(`\n🎯 Strategy: ${selectedStrategy.name} (${selectedStrategy.id})`);
    console.log(`   Settings: WR=${selectedStrategy.settings.winRateSuly}, Forma=${selectedStrategy.settings.formaSuly}, H2H=${selectedStrategy.settings.h2hSuly}`);
    // 1. Get schedule (+ keep GT Leagues cards visible 3 min after start)
    let schedule = await cached('schedule', getCombinedSchedule);
    updateStickyBuffer(schedule);
    schedule = applySticky(schedule);
    if (leagueFilter) schedule = schedule.filter(m => m.league === leagueFilter);

    // 1b. Load totalcorner fixtures for matchId lookup (per league)
    // Map EsoccerBet league names to TC league names where applicable.
    // Note: EsoccerBet "GT Leagues" and TC "Esoccer GT Leagues" are DIFFERENT leagues
    // with different player rosters, so no mapping for that.
    const esbToTcLeague: Record<string, string> = {
      'Esoccer Battle': 'Esoccer Battle',
      'Cyber Live Arena': 'Esoccer Adriatic League',
    };
    const tcFixturesByLeague = new Map<string, Map<string, string>>();
    // Map: ESB league -> "playerA|playerB" (both directions) -> matchId
    const esbLeaguesToLoad = Array.from(new Set(
      schedule.map(s => s.league).filter(l => l in esbToTcLeague)
    ));
    await Promise.allSettled(
      esbLeaguesToLoad.map(async (esbLg) => {
        const tcLg = esbToTcLeague[esbLg];
        try {
          const tcData = await cached(`tc:league:${tcLg}`, () => scrapeTCLeague(tcLg));
          const m = new Map<string, string>();
          for (const f of tcData.fixtures) {
            if (!f.matchId || !f.playerHome || !f.playerAway) continue;
            const k1 = `${f.playerHome.toLowerCase()}|${f.playerAway.toLowerCase()}`;
            const k2 = `${f.playerAway.toLowerCase()}|${f.playerHome.toLowerCase()}`;
            m.set(k1, f.matchId);
            m.set(k2, f.matchId);
          }
          tcFixturesByLeague.set(esbLg, m);
        } catch {
          // ignore - TC is optional enrichment
        }
      })
    );

    // 2. Analyze each match (parallel, batched to avoid overload)
    const batchSize = 6;
    const allResults: {
      time: string; date: string; league: string;
      playerA: string; teamA: string; playerB: string; teamB: string;
      valueBet: string; confidence: number; edge: number; stake: number;
      winEselyA: number; winEselyB: number;
      overEsely: number; underEsely: number;
      vartGol: number; ouLine: number;
      ajanlottTipp: string;
      h2hMode: boolean;
      h2hTotal: number;
      h2hWinsA: number;
      h2hWinsB: number;
      h2hSource: string;
      tcMatchId?: string;
      oddsSource: string;
      oddsA: number;
      oddsB: number;
      oddsOver: number;
      oddsUnder: number;
      category: 'STRONG_BET' | 'BET' | 'NO_BET';
      warning?: string | null;
      h2hOverRates?: Record<string, number>;
      h2hEffectiveSize?: number;
      movement1x2?: { home?: string; draw?: string; away?: string; homeChange?: number; awayChange?: number };
      movementGoals?: { over?: string; under?: string; overChange?: number; underChange?: number };
    }[] = [];

    for (let i = 0; i < schedule.length; i += batchSize) {
      const batch = schedule.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (entry) => {
          const [a, b] = await Promise.all([
            cached(`player:${entry.playerHome}:${entry.league}`, () =>
              getPlayerStats(entry.playerHome, entry.league)
            ),
            cached(`player:${entry.playerAway}:${entry.league}`, () =>
              getPlayerStats(entry.playerAway, entry.league)
            ),
          ]);

          const formToWinRate = (p: PlayerStats) => p.winRate > 0 ? p.winRate : (p.matches > 0 ? p.wins / p.matches : 0.5);
          const forma = (p: PlayerStats) => Math.max(0, Math.min(1, formToWinRate(p) + p.form10));

          // === MULTI-SOURCE H2H (esoccerbet + totalcorner, weighted by recency) ===

          // 1. Normalize esoccerbet H2H to common format
          const esbH2H: NormalizedH2H[] = [];
          const h2hFromA = a.lastMatches.filter(m => m.opponent.toLowerCase() === entry.playerAway.toLowerCase());
          const h2hFromB = b.lastMatches.filter(m => m.opponent.toLowerCase() === entry.playerHome.toLowerCase());
          for (const m of h2hFromA) {
            esbH2H.push({ date: m.date, goalsA: m.scoreHome, goalsB: m.scoreAway, source: 'esoccerbet' });
          }
          for (const m of h2hFromB) {
            esbH2H.push({ date: m.date, goalsA: m.scoreAway, goalsB: m.scoreHome, source: 'esoccerbet' });
          }

          // 2. Totalcorner fixture matchId lookup
          const fixtureMap = tcFixturesByLeague.get(entry.league);
          const tcMatchId = fixtureMap?.get(`${entry.playerHome.toLowerCase()}|${entry.playerAway.toLowerCase()}`);
          let tcH2H: NormalizedH2H[] = [];
          if (tcMatchId) {
            try {
              const tcRaw = await cached(`tc:h2h:${tcMatchId}`, () =>
                scrapeTCH2H(tcMatchId, entry.playerHome, entry.playerAway)
              );
              tcH2H = normalizeTCH2H(tcRaw, entry.playerHome);
            } catch {
              // ignore
            }
          }

          // H2H meccs-lista a kártyán való megjelenítéshez
          const h2hMatchHistoryRaw: Array<{date: string; goalsA: number; goalsB: number; winner: 'A'|'B'|'draw'}> = [];
          const seenH2HKeys = new Set<string>();
          for (const m of h2hFromA) {
            const key = `${m.date}|${m.scoreHome}-${m.scoreAway}`;
            if (!seenH2HKeys.has(key)) {
              seenH2HKeys.add(key);
              h2hMatchHistoryRaw.push({ date: m.date, goalsA: m.scoreHome, goalsB: m.scoreAway,
                winner: m.scoreHome > m.scoreAway ? 'A' : m.scoreHome < m.scoreAway ? 'B' : 'draw' });
            }
          }
          for (const m of h2hFromB) {
            const key = `${m.date}|${m.scoreAway}-${m.scoreHome}`;
            if (!seenH2HKeys.has(key)) {
              seenH2HKeys.add(key);
              h2hMatchHistoryRaw.push({ date: m.date, goalsA: m.scoreAway, goalsB: m.scoreHome,
                winner: m.scoreAway > m.scoreHome ? 'A' : m.scoreAway < m.scoreHome ? 'B' : 'draw' });
            }
          }
          const h2hMatchHistory = h2hMatchHistoryRaw
            .sort((x, y) => y.date.localeCompare(x.date))
            .slice(0, 10);

          // 3. Merge + dedupe, H2H expiry szűrés stratégia szerint
          const h2hExpiryDays = selectedStrategy.h2hExpiryDays ?? 365;
          const mergedH2HRaw = mergeH2HSources(esbH2H, tcH2H);
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - h2hExpiryDays);
          const mergedH2H = mergedH2HRaw.filter(m => {
            // m.date: "MM/DD HH:MM" formátum → parse mint idei/tavalyi dátum
            if (!m.date) return true;
            const parts = m.date.split(' ')[0].split('/'); // ["MM", "DD"]
            if (parts.length < 2) return true;
            const now = new Date();
            let year = now.getFullYear();
            const mDate = new Date(year, parseInt(parts[0]) - 1, parseInt(parts[1]));
            if (mDate > now) mDate.setFullYear(year - 1); // ha jövőre mutat → tavaly
            return mDate >= cutoff;
          });

          // 4. Weighted aggregation (30-day half-life)
          const agg = aggregateH2HWeighted(mergedH2H, 30);

          const h2hTotal = agg.total;
          const h2hWinsA = agg.winsA;
          const h2hWinsB = agg.winsB;
          const h2hDraws = agg.draws;
          const h2hAvgGoalsA = agg.total > 0 ? agg.avgGoalsA : undefined;
          const h2hAvgGoalsB = agg.total > 0 ? agg.avgGoalsB : undefined;
          const h2hOverRates = agg.total > 0 ? agg.overRates : undefined;
          const h2hEffectiveSize = agg.effectiveSize;
          const h2hSource =
            tcH2H.length > 0 && esbH2H.length > 0 ? 'merged'
              : tcH2H.length > 0 ? 'totalcorner'
                : 'esoccerbet';

          const h2hRatioA = h2hTotal > 0 ? (h2hWinsA + h2hDraws * 0.5) / h2hTotal : 0.5;

          const liga = entry.league === 'GT Leagues' ? 'GT Leagues' as const
            : entry.league === 'Cyber Live Arena' ? 'eAdriaticLeague' as const
              : 'Other' as const;
          const percek = entry.league === 'GT Leagues' ? 12 : entry.league === 'Cyber Live Arena' ? 10 : (entry.league === 'Esoccer Battle' || entry.league === 'Esoccer H2H GG League') ? 8 : 6; // Esports Volta = 6

          // Try to get real odds, goal line, and movement from totalcorner
          let realOddsA: number | undefined;
          let realOddsB: number | undefined;
          let realOddsOver: number | undefined;
          let realOddsUnder: number | undefined;
          let realOuLine: number | undefined;
          let oddsSource = 'estimated';
          let movement1x2: { home?: string; draw?: string; away?: string; homeChange?: number; awayChange?: number } | undefined;
          let movementGoals: { over?: string; under?: string; overChange?: number; underChange?: number } | undefined;

          if (tcMatchId) {
            try {
              const tcOdds = await cached(`tc:odds:${tcMatchId}`, () =>
                scrapeTCMatchOdds(tcMatchId, entry.playerHome, entry.playerAway)
              );
              if (tcOdds.latest1x2) {
                realOddsA = tcOdds.latest1x2.home;
                realOddsB = tcOdds.latest1x2.away;
                oddsSource = 'bet365';
              }
              if (tcOdds.latestGoals) {
                realOuLine = tcOdds.latestGoals.lineValue;
                realOddsOver = tcOdds.latestGoals.over;
                realOddsUnder = tcOdds.latestGoals.under;
              }
              if (tcOdds.movement1x2) {
                movement1x2 = {
                  home: tcOdds.movement1x2.home?.direction,
                  draw: tcOdds.movement1x2.draw?.direction,
                  away: tcOdds.movement1x2.away?.direction,
                  homeChange: tcOdds.movement1x2.home?.change,
                  awayChange: tcOdds.movement1x2.away?.change,
                };
              }
              if (tcOdds.movementGoals) {
                movementGoals = {
                  over: tcOdds.movementGoals.over?.direction,
                  under: tcOdds.movementGoals.under?.direction,
                  overChange: tcOdds.movementGoals.over?.change,
                  underChange: tcOdds.movementGoals.under?.change,
                };
              }
            } catch {
              // ignore - fallback to estimated
            }
          }

          // Vegas.hu: always try — live O/U overrides b365 (b365 esports O/U is often wrong)
          try {
            const vegasOdds = await getVegasOdds(entry.playerHome, entry.playerAway);
            if (vegasOdds) {
              // Prefer Vegas.hu O/U over b365 (live line is more accurate)
              if (vegasOdds.ouLine > 0) {
                realOuLine = vegasOdds.ouLine;
                realOddsOver = vegasOdds.oddsOver;
                realOddsUnder = vegasOdds.oddsUnder;
                oddsSource = 'vegas.hu';
              }
              // Use Vegas.hu 1X2 only if b365 hasn't provided them
              realOddsA = realOddsA ?? vegasOdds.oddsA;
              realOddsB = realOddsB ?? vegasOdds.oddsB;
              if (oddsSource === 'estimated' && (vegasOdds.oddsA || vegasOdds.oddsB)) {
                oddsSource = 'vegas.hu';
              }
            }
          } catch {
            // ignore - fallback to estimated
          }

          // GT Leagues + H2H GG League: only real Vegas.hu odds are meaningful; n/a until they arrive
          if ((entry.league === 'GT Leagues' || entry.league === 'Esoccer H2H GG League') && oddsSource !== 'vegas.hu') {
            oddsSource = 'n/a';
          }

          // Fallback: estimated odds
          const wrA = formToWinRate(a);
          const wrB = formToWinRate(b);
          const rawWinA = wrA / (wrA + wrB);
          const estimatedOdds = estimateMatchOdds(rawWinA, 1 - rawWinA, 0.55);

          const finalOddsA = realOddsA ?? estimatedOdds.oddsA;
          const finalOddsB = realOddsB ?? estimatedOdds.oddsB;
          const finalOddsOver = realOddsOver ?? estimatedOdds.oddsOver;
          const finalOddsUnder = realOddsUnder ?? estimatedOdds.oddsUnder;

          // Smart O/U line fallback: find line where over rate ≈ 50% from player ouStats
          const fairLine = (ouStats: { line: string; over: number }[]) => {
            if (!ouStats || ouStats.length === 0) return null;
            let best = ouStats[0];
            for (const s of ouStats) {
              if (Math.abs(s.over - 0.5) < Math.abs(best.over - 0.5)) best = s;
            }
            return parseFloat(best.line);
          };
          const lineA = fairLine(a.ouStats);
          const lineB = fairLine(b.ouStats);
          const smartOuLine = lineA && lineB
            ? Math.round((lineA + lineB) / 2 * 2) / 2   // average, rounded to nearest 0.5
            : lineA ?? lineB ?? 3.5;
          const finalOuLine = realOuLine ?? smartOuLine;

          const result = calculateMatch({
            id: `scan-${i}`,
            liga,
            percek,
            piacTipus: liga === 'GT Leagues' ? 'Over/Under' : 'Win',
            playerA: entry.playerHome,
            playerB: entry.playerAway,
            oddsA: finalOddsA,
            oddsB: finalOddsB,
            gfA: a.gfPerMatch, gaA: a.gaPerMatch,
            gfB: b.gfPerMatch, gaB: b.gaPerMatch,
            winRateA: wrA, winRateB: wrB,
            formaA: forma(a), formaB: forma(b),
            h2hA: h2hRatioA, h2hB: 1 - h2hRatioA,
            ouLine: finalOuLine,
            oddsOver: finalOddsOver,
            oddsUnder: finalOddsUnder,
          }, selectedStrategy.settings, {
            h2hWinsA, h2hWinsB, h2hDraws, h2hTotal,
            h2hAvgGoalsA, h2hAvgGoalsB, h2hOverRates,
          });

          // ========== KELLY STAKE CALCULATION ==========
          let stake = result.stakeFt;
          if (selectedStrategy.kellyEnabled) {
            const b = result.kivalasztottOdds - 1;
            const p = result.confidence;
            const q = 1 - p;
            const kellyPercent = (b * p - q) / b;
            if (kellyPercent > 0) {
              stake = Math.min(50000 * kellyPercent * selectedStrategy.settings.kellySzorzo, 5000);
              stake = Math.round(stake);
            }
          }
          // ========== END KELLY ==========

          // ========== STRATEGY C POST-PROCESSING ==========
          let finalConfidence = result.confidence;
          let finalValueBet = result.valueBet;

          if (selectedStrategy.id === 'C') {
            const today = todayMMDD();

            // 1. Fáradsági szűrő: ha valamelyik játékos maxMatchesToday+ meccset játszott ma → kizárás
            if (selectedStrategy.fatiguePenalty && selectedStrategy.maxMatchesToday !== undefined) {
              const matchesTodayA = a.lastMatches.filter(m => m.date.startsWith(today)).length;
              const matchesTodayB = b.lastMatches.filter(m => m.date.startsWith(today)).length;
              if (matchesTodayA >= selectedStrategy.maxMatchesToday || matchesTodayB >= selectedStrategy.maxMatchesToday) {
                finalValueBet = 'PASS'; // kizárás
              } else if (matchesTodayA >= 2 || matchesTodayB >= 2) {
                // 2+ meccs ma → konfidencia -7%
                finalConfidence = finalConfidence * 0.93;
              }
            }

            // 2. Forma-trend adjusztáció: form10 vs form50 alapján
            if (selectedStrategy.formTrendBonus && finalValueBet !== 'PASS') {
              // Melyik játékos a favorit (nagyobb winEsely)
              const favoritIsA = result.winEselyA >= result.winEselyB;
              const formTrendFav = favoritIsA ? (a.form10 - a.form50) : (b.form10 - b.form50);
              const formTrendUnder = favoritIsA ? (b.form10 - b.form50) : (a.form10 - a.form50);
              if (formTrendFav < -0.05) {
                // Favorit hanyatlik → konfidencia -8%
                finalConfidence = finalConfidence * 0.92;
              } else if (formTrendFav > 0.05 && formTrendUnder <= 0) {
                // Favorit javul, ellenfél stagnál/romlik → kis bónusz +3%
                finalConfidence = Math.min(0.95, finalConfidence * 1.03);
              }
            }

            // 3. Gól-vonal delta szűrő: várható gól nem elég messze a vonaltól → O/U PASS
            if (selectedStrategy.goalLineDeltaMin !== undefined && finalValueBet !== 'PASS') {
              const isOUBet = finalValueBet === 'OVER' || finalValueBet === 'UNDER';
              if (isOUBet && Math.abs(result.vartOsszesGol - finalOuLine) < selectedStrategy.goalLineDeltaMin) {
                finalValueBet = 'PASS'; // túl bizonytalan
              }
            }

            // 4. H2H kötelező szűrő
            if (selectedStrategy.requireH2H && h2hTotal < (selectedStrategy.minH2HMatches ?? 8)) {
              finalValueBet = 'PASS';
            }
          }
          // ========== END STRATEGY C ==========

          return {
            time: entry.time, date: entry.date, league: entry.league,
            playerA: entry.playerHome, teamA: entry.teamHome,
            playerB: entry.playerAway, teamB: entry.teamAway,
            valueBet: finalValueBet,
            confidence: finalConfidence,
            edge: result.kivalasztottEdge,
            stake: stake,
            winEselyA: result.winEselyA,
            winEselyB: result.winEselyB,
            overEsely: result.overEsely,
            underEsely: result.underEsely,
            vartGol: result.vartOsszesGol,
            ouLine: finalOuLine,
            ajanlottTipp: result.ajanlottTipp,
            h2hMode: result.h2hMode || false,
            h2hTotal: h2hTotal,
            h2hWinsA, h2hWinsB,
            h2hSource,
            tcMatchId: tcMatchId || undefined,
            oddsSource,
            oddsA: finalOddsA,
            oddsB: finalOddsB,
            oddsOver: finalOddsOver,
            oddsUnder: finalOddsUnder,
            category: classifyBetWithStrategy(finalConfidence, result.kivalasztottEdge, finalValueBet, selectedStrategy),
            warning: sanityWarning(result.kivalasztottEdge, h2hTotal, oddsSource),
            h2hOverRates: h2hOverRates || undefined,
            h2hEffectiveSize,
            movement1x2, movementGoals,
            strategy: selectedStrategy.id,
            lastMatchesA: a.lastMatches.slice(0, 10).map(m => ({
              opponent: m.opponent, scoreHome: m.scoreHome,
              scoreAway: m.scoreAway, result: m.result, date: m.date,
            })),
            lastMatchesB: b.lastMatches.slice(0, 10).map(m => ({
              opponent: m.opponent, scoreHome: m.scoreHome,
              scoreAway: m.scoreAway, result: m.result, date: m.date,
            })),
            gfPerMatchA: a.gfPerMatch,
            gaPerMatchA: a.gaPerMatch,
            gfPerMatchB: b.gfPerMatch,
            gaPerMatchB: b.gaPerMatch,
            h2hMatchHistory: h2hMatchHistory.length > 0 ? h2hMatchHistory : undefined,
          };
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled') allResults.push(r.value);
      }
    }

    // 3. Deduplicate: same match pair (A vs B == B vs A for same time)
    const seen = new Set<string>();
    const deduplicated = allResults.filter(r => {
      const pair = [r.playerA.toLowerCase(), r.playerB.toLowerCase()].sort().join('|');
      const key = `${r.time}|${pair}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 4. Filter & rank (categories: STRONG_BET > BET, H2H boost, real odds boost)
    const valueBets = deduplicated
      .filter(r => r.category !== 'NO_BET' && r.confidence >= minConf && r.edge >= minEdge)
      .sort((a, b) => {
        // Category score: STRONG_BET = 2, BET = 1
        const catScore = (t: typeof a) => (t.category === 'STRONG_BET' ? 2 : 1);
        if (catScore(b) !== catScore(a)) return catScore(b) - catScore(a);

        // Within same category: H2H + real odds + weighted conf/edge
        const h2hBoost = (t: typeof a) => (t.h2hMode ? 0.10 : 0);
        const oddsBoost = (t: typeof a) => (t.oddsSource === 'bet365' ? 0.05 : 0);
        const scoreA = a.confidence * 0.6 + a.edge * 4 + h2hBoost(a) + oddsBoost(a);
        const scoreB = b.confidence * 0.6 + b.edge * 4 + h2hBoost(b) + oddsBoost(b);
        return scoreB - scoreA;
      })
      .slice(0, limit);

    res.json({
      generated: new Date().toISOString(),
      totalScanned: schedule.length,
      totalAnalyzed: allResults.length,
      totalValueBets: allResults.filter(r => r.valueBet !== 'PASS').length,
      tips: valueBets,
      strategy: {
        id: selectedStrategy.id,
        name: selectedStrategy.name,
        settings: selectedStrategy.settings,
        kellyEnabled: selectedStrategy.kellyEnabled,
      },
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});
// ============ TOTALCORNER ENDPOINTS ============

// GET /api/tc/league?league=GT+Leagues
app.get('/api/tc/league', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const data = await cached(`tc:league:${league}`, () => scrapeTCLeague(league));
    res.json(data);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// GET /api/tc/odds/:matchId?home=...&away=...
app.get('/api/tc/odds/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const home = req.query.home as string;
    const away = req.query.away as string;
    if (!home || !away) {
      res.status(400).json({ error: 'home and away query params required' });
      return;
    }
    const data = await cached(`tc:odds:${matchId}`, () => scrapeTCMatchOdds(matchId, home, away));
    res.json(data);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// GET /api/tc/h2h/:matchId?home=...&away=...
app.get('/api/tc/h2h/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const home = req.query.home as string;
    const away = req.query.away as string;
    if (!home || !away) {
      res.status(400).json({ error: 'home and away query params required' });
      return;
    }
    const h2hMatches = await cached(`tc:h2h:${matchId}`, () => scrapeTCH2H(matchId, home, away));
    const aggregate = aggregateH2H(h2hMatches, home, away);
    res.json({ matches: h2hMatches, aggregate });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// GET /api/tc/leagues - list available leagues
app.get('/api/tc/leagues', (_req, res) => {
  res.json(TC_LEAGUES);
});

// ============ BACKTEST + OPTIMIZER ENDPOINTS ============

interface BacktestMatchData {
  date: string;
  playerA: string;
  playerB: string;
  scoreA: number;
  scoreB: number;
  // Snapshot of player stats at backtest time (current stats, lookahead bias)
  wrA: number; wrB: number;
  gfA: number; gaA: number;
  gfB: number; gaB: number;
  formaA: number; formaB: number;
}

// Build backtest match data from a player's lastMatches history
async function buildBacktestData(playerName: string, league: string, opponentFilter?: string): Promise<BacktestMatchData[]> {
  const stats = await cached(`player:${playerName}:${league}`, () =>
    scrapePlayerStats(playerName, league)
  );

  const formToWinRate = (p: PlayerStats) => p.winRate > 0 ? p.winRate : (p.matches > 0 ? p.wins / p.matches : 0.5);

  const wrA = formToWinRate(stats);
  const formaA = Math.max(0, Math.min(1, wrA + stats.form10));

  const matches: BacktestMatchData[] = [];

  for (const m of stats.lastMatches) {
    if (opponentFilter && m.opponent.toLowerCase() !== opponentFilter.toLowerCase()) continue;

    // Get opponent stats (cached)
    let oppStats: PlayerStats | null = null;
    try {
      oppStats = await cached(`player:${m.opponent}:${league}`, () =>
        scrapePlayerStats(m.opponent, league)
      );
    } catch {
      continue;
    }

    const wrB = formToWinRate(oppStats);
    const formaB = Math.max(0, Math.min(1, wrB + oppStats.form10));

    matches.push({
      date: m.date,
      playerA: playerName,
      playerB: m.opponent,
      scoreA: m.scoreHome,
      scoreB: m.scoreAway,
      wrA, wrB,
      gfA: stats.gfPerMatch,
      gaA: stats.gaPerMatch,
      gfB: oppStats.gfPerMatch,
      gaB: oppStats.gaPerMatch,
      formaA, formaB,
    });
  }

  return matches;
}

// Run backtest with given settings on the data
function runBacktestOnData(matches: BacktestMatchData[], settings: typeof DEFAULT_SETTINGS, league: 'GT Leagues' | 'eAdriaticLeague' | 'Other') {
  const percek = league === 'GT Leagues' ? 12 : league === 'eAdriaticLeague' ? 10 : 8;
  let totalBets = 0, wins = 0, losses = 0, passes = 0;
  let totalStaked = 0, totalProfit = 0;
  const byMarket = { win: { bets: 0, wins: 0 }, ou: { bets: 0, wins: 0 } };
  const byConf = { high: { bets: 0, wins: 0 }, mid: { bets: 0, wins: 0 }, low: { bets: 0, wins: 0 } };
  const details: Array<{
    date: string; playerA: string; playerB: string;
    scoreA: number; scoreB: number;
    valueBet: string; confidence: number; edge: number; stake: number;
    won: boolean | null; profit: number;
  }> = [];

  for (const m of matches) {
    // Estimate odds from current stats (Bet365 ~6% margin)
    const rawWinA = m.wrA / (m.wrA + m.wrB);
    const estimatedOdds = estimateMatchOdds(rawWinA, 1 - rawWinA, 0.55);

    const result = calculateMatch({
      id: 'bt',
      liga: league,
      percek,
      piacTipus: league === 'GT Leagues' ? 'Over/Under' : 'Win',
      playerA: m.playerA,
      playerB: m.playerB,
      oddsA: estimatedOdds.oddsA,
      oddsB: estimatedOdds.oddsB,
      gfA: m.gfA, gaA: m.gaA,
      gfB: m.gfB, gaB: m.gaB,
      winRateA: m.wrA, winRateB: m.wrB,
      formaA: m.formaA, formaB: m.formaB,
      h2hA: 0.5, h2hB: 0.5,
      ouLine: 3.5,
      oddsOver: estimatedOdds.oddsOver,
      oddsUnder: estimatedOdds.oddsUnder,
    }, DEFAULT_SETTINGS);  // ← HAGYD DEFAULT_SETTINGS! (Ez backtest endpoint, nem top-tips!)

    const totalGoals = m.scoreA + m.scoreB;
    let won: boolean | null = null;

    if (result.valueBet === 'PASS') {
      passes++;
      details.push({ ...m, valueBet: 'PASS', confidence: result.confidence, edge: 0, stake: 0, won: null, profit: 0 });
      continue;
    }

    if (result.valueBet === 'OVER') won = totalGoals > 3.5;
    else if (result.valueBet === 'UNDER') won = totalGoals < 3.5;
    else if (result.valueBet === 'A gyozelem') won = m.scoreA > m.scoreB;
    else if (result.valueBet === 'B gyozelem') won = m.scoreB > m.scoreA;

    const isOu = result.valueBet === 'OVER' || result.valueBet === 'UNDER';
    const market = isOu ? byMarket.ou : byMarket.win;
    market.bets++;
    if (won) market.wins++;

    const conf = result.confidence;
    const bucket = conf >= 0.75 ? byConf.high : conf >= 0.6 ? byConf.mid : byConf.low;
    bucket.bets++;
    if (won) bucket.wins++;

    totalBets++;
    if (won) wins++;
    else losses++;

    const profit = won
      ? result.stakeFt * (result.kivalasztottOdds - 1)
      : -result.stakeFt;
    totalStaked += result.stakeFt;
    totalProfit += profit;

    details.push({
      date: m.date, playerA: m.playerA, playerB: m.playerB,
      scoreA: m.scoreA, scoreB: m.scoreB,
      valueBet: result.valueBet,
      confidence: result.confidence,
      edge: result.kivalasztottEdge,
      stake: result.stakeFt,
      won, profit,
    });
  }

  return {
    totalMatches: matches.length,
    totalBets, wins, losses, passes,
    hitRate: totalBets > 0 ? wins / totalBets : 0,
    roi: totalStaked > 0 ? totalProfit / totalStaked : 0,
    totalStaked, totalProfit,
    byMarket: {
      win: { ...byMarket.win, hitRate: byMarket.win.bets > 0 ? byMarket.win.wins / byMarket.win.bets : 0 },
      overUnder: { ...byMarket.ou, hitRate: byMarket.ou.bets > 0 ? byMarket.ou.wins / byMarket.ou.bets : 0 },
    },
    byConfidence: {
      high: { ...byConf.high, hitRate: byConf.high.bets > 0 ? byConf.high.wins / byConf.high.bets : 0 },
      medium: { ...byConf.mid, hitRate: byConf.mid.bets > 0 ? byConf.mid.wins / byConf.mid.bets : 0 },
      low: { ...byConf.low, hitRate: byConf.low.bets > 0 ? byConf.low.wins / byConf.low.bets : 0 },
    },
    details: details.slice(0, 100),
  };
}

// GET /api/backtest/:player?league=...&opponent=...
app.get('/api/backtest/:player', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const opponent = req.query.opponent as string | undefined;
    const liga = league === 'GT Leagues' ? 'GT Leagues' as const
      : league === 'Cyber Live Arena' ? 'eAdriaticLeague' as const
        : 'Other' as const;

    const matches = await buildBacktestData(req.params.player, league, opponent);
    const result = runBacktestOnData(matches, DEFAULT_SETTINGS, liga);
    res.json({ league, ...result });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// POST /api/optimize/:player - run grid search optimizer
app.post('/api/optimize/:player', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const liga = league === 'GT Leagues' ? 'GT Leagues' as const
      : league === 'Cyber Live Arena' ? 'eAdriaticLeague' as const
        : 'Other' as const;

    const matches = await buildBacktestData(req.params.player, league);
    if (matches.length < 5) {
      res.status(400).json({ error: 'Not enough matches for optimization (need at least 5)' });
      return;
    }

    // Grid search: try various weight combinations
    const steps = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40];
    const results: Array<{
      settings: { wr: number; forma: number; h2h: number; atk: number; def: number };
      roi: number; hitRate: number; bets: number; profit: number;
    }> = [];

    for (const wr of steps) {
      for (const forma of steps) {
        for (const h2h of [0.05, 0.10, 0.15, 0.20]) {
          for (const atk of steps) {
            const def = Math.round((1 - wr - forma - h2h - atk) * 100) / 100;
            if (def < 0.05 || def > 0.40) continue;

            const settings = {
              ...DEFAULT_SETTINGS,
              winRateSuly: wr, formaSuly: forma, h2hSuly: h2h,
              tamadasSuly: atk, vedekezesSuly: def,
            };
            const result = runBacktestOnData(matches, settings, liga);
            if (result.totalBets >= 3) {
              results.push({
                settings: { wr, forma, h2h, atk, def },
                roi: result.roi,
                hitRate: result.hitRate,
                bets: result.totalBets,
                profit: result.totalProfit,
              });
            }
          }
        }
      }
    }

    // Sort by ROI descending
    results.sort((a, b) => b.roi - a.roi);

    res.json({
      totalCombinations: results.length,
      best: results[0] || null,
      top20: results.slice(0, 20),
      defaultSettings: {
        wr: DEFAULT_SETTINGS.winRateSuly,      // ← JAVÍTVA!
        forma: DEFAULT_SETTINGS.formaSuly,      // ← JAVÍTVA!
        h2h: DEFAULT_SETTINGS.h2hSuly,          // ← JAVÍTVA!
        atk: DEFAULT_SETTINGS.tamadasSuly,      // ← JAVÍTVA!
        def: DEFAULT_SETTINGS.vedekezesSuly,    // ← JAVÍTVA!
      },
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// ============ TELEGRAM + SCANNER ENDPOINTS ============

// POST /api/telegram/configure { botToken, chatId }
app.post('/api/telegram/configure', async (req, res) => {
  const { botToken, chatId } = req.body as { botToken?: string; chatId?: string };
  if (!botToken || !chatId) {
    res.status(400).json({ error: 'botToken and chatId required' });
    return;
  }
  configureTelegram(botToken, chatId);
  // Send a test message
  const ok = await sendMessage('🟢 *eSport Bet* — Telegram bot konfigurálva!\n\nMostantól push értesítéseket fogsz kapni új STRONG BET tippekre.');
  res.json({ configured: true, testMessageSent: ok });
});

// GET /api/telegram/status
app.get('/api/telegram/status', (_req, res) => {
  res.json({ configured: isTelegramConfigured() });
});

// POST /api/telegram/test - send a test message
app.post('/api/telegram/test', async (_req, res) => {
  if (!isTelegramConfigured()) {
    res.status(400).json({ error: 'Telegram not configured' });
    return;
  }
  const ok = await sendMessage('🧪 Test üzenet az eSport Bet-ből.');
  res.json({ sent: ok });
});

// GET /api/scanner/status
app.get('/api/scanner/status', (_req, res) => {
  res.json(getScannerState());
});

// POST /api/scanner/run - manually trigger a scan
app.post('/api/scanner/run', async (_req, res) => {
  const result = await runScan();
  res.json({ ran: result !== null, tipsFound: result?.tips.length || 0 });
});

// GET /api/trend/status
app.get('/api/trend/status', (_req, res) => {
  res.json(getTrendScannerState());
});

// POST /api/trend/run - manually trigger a trend scan
app.post('/api/trend/run', async (_req, res) => {
  try {
    const { signals, pushed } = await runTrendScanOnce();
    res.json({ ran: true, signalsFound: signals.length, pushed, signals });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// Configure scanner to call our own /api/top-tips endpoint
const SELF_URL = `http://localhost:${process.env.PORT || '3005'}`;
configureScanner(async () => {
  const r = await fetch(`${SELF_URL}/api/top-tips?limit=20&minConf=0.65&minEdge=0.04`);
  if (!r.ok) throw new Error(`Top-tips fetch failed: ${r.status}`);
  return r.json() as Promise<ReturnType<typeof getCachedResult> & object>;
});

// Configure intraday H2H trend scanner
configureTrendScanner({
  getSchedule: getCombinedSchedule,
  getPlayerStats: async (name, league) => {
    return cached(`player:${name}:${league}`, () => getPlayerStats(name, league));
  },
  getOdds: async (playerA, playerB) => {
    try {
      const v = await getVegasOdds(playerA, playerB);
      if (v && v.ouLine > 0) return { ouLine: v.ouLine, oddsOver: v.oddsOver };
      return null;
    } catch {
      return null;
    }
  },
});

// Telegram bot command handler
async function handleBotCommand(cmd: string, args: string): Promise<string> {
  switch (cmd) {
    case 'start':
    case 'help':
      return [
        '*eSport Bet — Bot parancsok*',
        '',
        '/top — Napi top 5 tipp',
        '/strong — Csak STRONG BET tippek',
        '/scan — Friss scan futtatása',
        '/trend — Intraday H2H trend jelzések',
        '/status — Scanner állapot',
        '',
        '_STRONG BET: 15 percenként · Trend jelzés: 5 percenként_',
      ].join('\n');

    case 'top': {
      const cached = getCachedResult();
      if (!cached) return '_Még nincs scan eredmény. Próbáld a /scan parancsot._';
      const top5 = cached.tips.slice(0, 5);
      await sendTopTipsList(top5, '*Top 5 Tipp*');
      return '';
    }

    case 'strong': {
      const cached = getCachedResult();
      if (!cached) return '_Még nincs scan eredmény. Próbáld a /scan parancsot._';
      const strong = cached.tips.filter(t => t.category === 'STRONG_BET').slice(0, 10);
      await sendTopTipsList(strong, '*🔥 STRONG BET Tippek*');
      return '';
    }

    case 'scan': {
      await sendMessage('🔄 Scan elindult, néhány másodperc...');
      const r = await runScan();
      if (!r) return '❌ Scan sikertelen';
      const strongCount = r.tips.filter(t => t.category === 'STRONG_BET').length;
      return `✅ Scan kész\n\n${r.totalScanned} meccs scannelve\n${r.tips.length} tipp\n${strongCount} STRONG BET`;
    }

    case 'trend': {
      await sendMessage('🔄 Trend scan elindult...');
      try {
        const { signals, pushed } = await runTrendScanOnce();
        if (signals.length === 0) return '📊 Nincs aktív trend jelzés most.';
        return `📈 ${signals.length} trend jelzés találva, ${pushed} Telegram értesítés küldve.`;
      } catch {
        return '❌ Trend scan sikertelen';
      }
    }

    case 'status': {
      const s = getScannerState();
      const ts = getTrendScannerState();
      return [
        '*Scanner állapot*',
        '',
        `Fut: ${s.isRunning ? '🟢 Igen' : '🔴 Nem'}`,
        `Utolsó top-tips scan: ${s.lastRunISO || 'soha'}`,
        `Cache-elt tippek: ${s.cachedTipCount}`,
        `Push-olt tippek: ${s.pushedCount}`,
        '',
        '*Trend Scanner*',
        `Fut: ${ts.isRunning ? '🟢 Igen' : '🔴 Nem'}`,
        `Utolsó trend scan: ${ts.lastRunISO || 'soha'}`,
        `Utolsó jelzések: ${ts.lastSignalCount}`,
        `Push-olt jelzések: ${ts.pushedCount}`,
        `Hibák: ${ts.errors}`,
      ].join('\n');
    }

    default:
      return `Ismeretlen parancs: /${cmd}\n\n/help — parancsok listája`;
  }
}

// ============ BACKTEST COMPARISON ENDPOINT ============

// GET /api/backtest-compare?league=GT+Leagues&topN=50
app.get('/api/backtest-compare', async (req, res) => {
  try {
    const league = (req.query.league as string) || 'GT Leagues';
    const topN = parseInt(req.query.topN as string) || 50;
    const initialBankroll = parseInt(req.query.bankroll as string) || 50000;

    console.log(`🚀 Starting backtest comparison for ${league} (top ${topN} players)...`);

    // 1. Build historical dataset
    const startTime = Date.now();
    const dataset = await buildBacktestDataset(league, topN);
    const scrapeDuration = ((Date.now() - startTime) / 1000).toFixed(1);

    if (dataset.length === 0) {
      res.status(400).json({ error: 'No historical data found for this league' });
      return;
    }

    console.log(`⏱️  Dataset ready in ${scrapeDuration}s`);
    console.log(`🔬 Running Strategy A...`);

    // 2. Run Strategy A
    const resultA = runBacktest(dataset, STRATEGIES.A, initialBankroll);
    console.log(`   ✅ Strategy A complete: ${resultA.totalBets} bets, ${(resultA.roi * 100).toFixed(2)}% ROI`);

    console.log(`🔬 Running Strategy B...`);

    // 3. Run Strategy B
    const resultB = runBacktest(dataset, STRATEGIES.B, initialBankroll);
    console.log(`   ✅ Strategy B complete: ${resultB.totalBets} bets, ${(resultB.roi * 100).toFixed(2)}% ROI`);

    // 4. Calculate winner
    const winner = resultB.roi > resultA.roi ? 'B' : 'A';
    const roiDiff = Math.abs(resultB.roi - resultA.roi);
    const profitDiff = resultB.totalProfit - resultA.totalProfit;

    console.log(`🏆 Winner: Strategy ${winner} (${(roiDiff * 100).toFixed(2)}% better)`);

    res.json({
      meta: {
        league,
        datasetSize: dataset.length,
        period: resultA.period,
        scrapeDuration: scrapeDuration + 's',
        initialBankroll,
      },
      strategyA: {
        id: 'A',
        name: resultA.strategy.name,
        description: resultA.strategy.description,
        settings: resultA.strategy.settings,
        totalBets: resultA.totalBets,
        wins: resultA.wins,
        losses: resultA.losses,
        passes: resultA.passes,
        hitRate: (resultA.hitRate * 100).toFixed(1) + '%',
        roi: (resultA.roi * 100).toFixed(2) + '%',
        totalStaked: resultA.totalStaked.toFixed(0) + ' Ft',
        totalProfit: resultA.totalProfit.toFixed(0) + ' Ft',
        avgStake: resultA.avgStake.toFixed(0) + ' Ft',
        finalBankroll: resultA.finalBankroll.toFixed(0) + ' Ft',
        byMarket: {
          win: {
            bets: resultA.byMarket.win.bets,
            wins: resultA.byMarket.win.wins,
            hitRate: (resultA.byMarket.win.hitRate * 100).toFixed(1) + '%',
            profit: resultA.byMarket.win.profit.toFixed(0) + ' Ft',
          },
          overUnder: {
            bets: resultA.byMarket.overUnder.bets,
            wins: resultA.byMarket.overUnder.wins,
            hitRate: (resultA.byMarket.overUnder.hitRate * 100).toFixed(1) + '%',
            profit: resultA.byMarket.overUnder.profit.toFixed(0) + ' Ft',
          },
        },
        byConfidence: {
          high: {
            bets: resultA.byConfidence.high.bets,
            wins: resultA.byConfidence.high.wins,
            hitRate: (resultA.byConfidence.high.hitRate * 100).toFixed(1) + '%',
            profit: resultA.byConfidence.high.profit.toFixed(0) + ' Ft',
          },
          mid: {
            bets: resultA.byConfidence.mid.bets,
            wins: resultA.byConfidence.mid.wins,
            hitRate: (resultA.byConfidence.mid.hitRate * 100).toFixed(1) + '%',
            profit: resultA.byConfidence.mid.profit.toFixed(0) + ' Ft',
          },
          low: {
            bets: resultA.byConfidence.low.bets,
            wins: resultA.byConfidence.low.wins,
            hitRate: (resultA.byConfidence.low.hitRate * 100).toFixed(1) + '%',
            profit: resultA.byConfidence.low.profit.toFixed(0) + ' Ft',
          },
        },
      },
      strategyB: {
        id: 'B',
        name: resultB.strategy.name,
        description: resultB.strategy.description,
        settings: resultB.strategy.settings,
        totalBets: resultB.totalBets,
        wins: resultB.wins,
        losses: resultB.losses,
        passes: resultB.passes,
        hitRate: (resultB.hitRate * 100).toFixed(1) + '%',
        roi: (resultB.roi * 100).toFixed(2) + '%',
        totalStaked: resultB.totalStaked.toFixed(0) + ' Ft',
        totalProfit: resultB.totalProfit.toFixed(0) + ' Ft',
        avgStake: resultB.avgStake.toFixed(0) + ' Ft',
        finalBankroll: resultB.finalBankroll.toFixed(0) + ' Ft',
        byMarket: {
          win: {
            bets: resultB.byMarket.win.bets,
            wins: resultB.byMarket.win.wins,
            hitRate: (resultB.byMarket.win.hitRate * 100).toFixed(1) + '%',
            profit: resultB.byMarket.win.profit.toFixed(0) + ' Ft',
          },
          overUnder: {
            bets: resultB.byMarket.overUnder.bets,
            wins: resultB.byMarket.overUnder.wins,
            hitRate: (resultB.byMarket.overUnder.hitRate * 100).toFixed(1) + '%',
            profit: resultB.byMarket.overUnder.profit.toFixed(0) + ' Ft',
          },
        },
        byConfidence: {
          high: {
            bets: resultB.byConfidence.high.bets,
            wins: resultB.byConfidence.high.wins,
            hitRate: (resultB.byConfidence.high.hitRate * 100).toFixed(1) + '%',
            profit: resultB.byConfidence.high.profit.toFixed(0) + ' Ft',
          },
          mid: {
            bets: resultB.byConfidence.mid.bets,
            wins: resultB.byConfidence.mid.wins,
            hitRate: (resultB.byConfidence.mid.hitRate * 100).toFixed(1) + '%',
            profit: resultB.byConfidence.mid.profit.toFixed(0) + ' Ft',
          },
          low: {
            bets: resultB.byConfidence.low.bets,
            wins: resultB.byConfidence.low.wins,
            hitRate: (resultB.byConfidence.low.hitRate * 100).toFixed(1) + '%',
            profit: resultB.byConfidence.low.profit.toFixed(0) + ' Ft',
          },
        },
      },
      comparison: {
        winner,
        roiDifference: (roiDiff * 100).toFixed(2) + '%',
        profitDifference: profitDiff.toFixed(0) + ' Ft',
        bankrollGrowth: {
          strategyA: ((resultA.finalBankroll / initialBankroll - 1) * 100).toFixed(2) + '%',
          strategyB: ((resultB.finalBankroll / initialBankroll - 1) * 100).toFixed(2) + '%',
        },
        message: winner === 'B'
          ? `✅ Strategy B outperforms by ${(roiDiff * 100).toFixed(2)}%! Enhanced algorithm is superior.`
          : roiDiff < 0.01
            ? `⚖️  Both strategies nearly equal (${(roiDiff * 100).toFixed(2)}% difference)`
            : `⚠️  Strategy A still better by ${(roiDiff * 100).toFixed(2)}%. Consider more testing.`,
      },
    });
  } catch (e: unknown) {
    console.error('❌ Backtest error:', e);
    res.status(500).json({
      error: e instanceof Error ? e.message : 'Unknown error',
      stack: e instanceof Error ? e.stack : undefined,
    });
  }
});

// Serve static frontend in production
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '..', 'dist');

app.use(express.static(distPath));
// SPA fallback - only for non-API routes
//app.get('*', (req, res) => {
  // Skip API routes - let them 404 naturally
  //if (req.path.startsWith('/api')) {
  //  res.status(404).json({ error: 'API endpoint not found' });
  //  return;
  //}
  // SPA fallback for non-API routes
  //res.sendFile(path.join(distPath, 'index.html'));
//});

// ============ TOTALCORNER ENDPOINTS ============  

app.get('/api/tc/players/:league', async (req, res) => {
  try {
    const league = req.params.league as TotalCornerLeague;
    
    if (!TOTALCORNER_LEAGUES[league]) {
      res.status(400).json({ error: 'Invalid league' });
      return;
    }
    
    const players = await scrapeFullPlayerData(league);
    
    res.json({
      league,
      players,
      count: players.length,
      scraped: new Date().toISOString(),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

app.get('/api/tc/best-players/:league', async (req, res) => {
  try {
    const league = req.params.league as TotalCornerLeague;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    
    if (!TOTALCORNER_LEAGUES[league]) {
      res.status(400).json({ error: 'Invalid league' });
      return;
    }
    
    const players = await getBestPlayers(league, limit);
    
    res.json({
      league,
      players,
      count: players.length,
      limit,
      scraped: new Date().toISOString(),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

app.get('/api/tc/schedule/:league', async (req, res) => {
  try {
    const league = req.params.league as TotalCornerLeague;
    
    if (!TOTALCORNER_LEAGUES[league]) {
      res.status(400).json({ error: 'Invalid league' });
      return;
    }
    
    const schedule = await tcScrapeSchedule(league);
    
    res.json({
      league,
      schedule,
      count: schedule.length,
      scraped: new Date().toISOString(),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});
// ============ RESULT RESOLVER — esoccerbet.org ============
const MATCH_DURATION_MIN: Record<string, number> = {
  'GT Leagues': 12,
  'Cyber Live Arena': 10,
  'Esoccer Battle': 8,
  'Esports Volta': 6,
  'Esoccer H2H GG League': 8,
};

function fuzzyNameMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const nA = norm(a);
  const nB = norm(b);
  if (nA === nB) return true;
  const short = nA.length < nB.length ? nA : nB;
  const long  = nA.length < nB.length ? nB : nA;
  return long.includes(short.slice(0, Math.min(6, short.length)));
}

function parseDateToMs(dateStr: string, refTimestamp: number): number | null {
  // Formats seen: "04/26 14:30", "14:30", "04/26"
  const parts = dateStr.trim().split(/\s+/);
  const ref = new Date(refTimestamp);
  const year = ref.getFullYear();

  if (parts.length === 2) {
    // "MM/DD HH:MM"
    const [md, hm] = parts;
    const [mo, dy] = md.split('/').map(Number);
    const [hh, mm] = hm.split(':').map(Number);
    return new Date(year, mo - 1, dy, hh, mm).getTime();
  }
  if (parts.length === 1) {
    if (parts[0].includes('/')) {
      // "MM/DD"
      const [mo, dy] = parts[0].split('/').map(Number);
      return new Date(year, mo - 1, dy, ref.getHours(), ref.getMinutes()).getTime();
    }
    if (parts[0].includes(':')) {
      // "HH:MM" — assume same day
      const [hh, mm] = parts[0].split(':').map(Number);
      return new Date(year, ref.getMonth(), ref.getDate(), hh, mm).getTime();
    }
  }
  return null;
}

app.post('/api/resolve-results', async (req, res) => {
  try {
    const { matches } = req.body as {
      matches: {
        matchId: string;
        playerA: string;
        playerB: string;
        league: string;
        timestamp: number;
        betType: string;
        betLine: number;
      }[];
    };

    const results = await Promise.all(matches.map(async (m) => {
      try {
        const duration = MATCH_DURATION_MIN[m.league] ?? 10;
        const matchEndMs = m.timestamp + (duration + 3) * 60 * 1000;
        if (Date.now() < matchEndMs + 5000) {
          return { matchId: m.matchId, pending: true };
        }

        // Fresh scrape — no cache so we always get the latest results
        const playerResults = await scrapePlayerResults(m.playerA, m.league);

        // Find the specific match: fuzzy opponent name + date proximity (±30 min)
        const found = playerResults.find(r => {
          if (!fuzzyNameMatch(r.opponent, m.playerB)) return false;
          const rMs = parseDateToMs(r.date, m.timestamp);
          if (rMs === null) return true; // no date info → accept name match
          return Math.abs(rMs - m.timestamp) < 30 * 60 * 1000;
        });

        if (!found) {
          // Fallback: try scraping from playerB's perspective
          const playerBResults = await scrapePlayerResults(m.playerB, m.league);
          const foundB = playerBResults.find(r => {
            if (!fuzzyNameMatch(r.opponent, m.playerA)) return false;
            const rMs = parseDateToMs(r.date, m.timestamp);
            if (rMs === null) return true;
            return Math.abs(rMs - m.timestamp) < 30 * 60 * 1000;
          });
          if (!foundB) return { matchId: m.matchId, pending: true };

          // From playerB's perspective: scoreHome=B, scoreAway=A → swap
          const total = foundB.scoreHome + foundB.scoreAway;
          const scoreA = foundB.scoreAway;
          const scoreB = foundB.scoreHome;
          let outcome: 'Win' | 'Loss' | null = null;
          if (m.betType === 'Over')  outcome = total > m.betLine ? 'Win' : 'Loss';
          if (m.betType === 'Under') outcome = total < m.betLine ? 'Win' : 'Loss';
          return { matchId: m.matchId, score: `${scoreA}:${scoreB}`, total, outcome, pending: false };
        }

        const total = found.scoreHome + found.scoreAway;
        let outcome: 'Win' | 'Loss' | null = null;
        if (m.betType === 'Over')  outcome = total > m.betLine ? 'Win' : 'Loss';
        if (m.betType === 'Under') outcome = total < m.betLine ? 'Win' : 'Loss';
        return { matchId: m.matchId, score: `${found.scoreHome}:${found.scoreAway}`, total, outcome, pending: false };
      } catch {
        return { matchId: m.matchId, pending: true };
      }
    }));

    res.json(results);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// ============ JOURNAL PERSISTENCE ============
import fs from 'fs';
const JOURNAL_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/journal.json');
if (!fs.existsSync(path.dirname(JOURNAL_FILE))) fs.mkdirSync(path.dirname(JOURNAL_FILE), { recursive: true });

app.get('/api/journal', (_req, res) => {
  try {
    if (!fs.existsSync(JOURNAL_FILE)) return res.json([]);
    res.json(JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf-8')));
  } catch { res.json([]); }
});

app.post('/api/journal', (req, res) => {
  try {
    fs.writeFileSync(JOURNAL_FILE, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch { res.status(500).json({ ok: false }); }
});

// ============ VÉGÜK ============

app.listen(3005, '0.0.0.0', () => {
  console.log('--- FIGYELEM: EZ A 3005-OS VERZIO ---');

  // Load Telegram config from env (if set)
  loadConfigFromEnv();

  // Start background scanners
  startScanner(15 * 60 * 1000);           // top-tips scan every 15 min
  startTrendScanner(5 * 60 * 1000);       // intraday trend scan every 5 min

  // Start Telegram bot polling for commands
  startBotPolling(handleBotCommand);
});
