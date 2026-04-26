// ============================================================================
// VEGAS.HU SCRAPER — Altenar API
// ============================================================================
// Uses the Altenar sportsbook widget API that powers vegas.hu.
// Fetches upcoming e-soccer events with real O/U lines and odds.
//
// Key endpoints:
//   GET /widget/GetUpcoming?integration=vegas.hu&culture=hu-HU&...&sportId=146
//   → Returns events[], markets[], odds[], competitors[]
//   Market typeId 18 = "Gólok száma összesen" (Total Goals / O/U)
//   Market.sv = O/U line (e.g. "7.5")
//   Odd typeId 12 = Over, typeId 13 = Under

import axios from 'axios';

export interface VegasOdds {
  playerA: string;
  playerB: string;
  ouLine: number;
  oddsOver: number;
  oddsUnder: number;
  oddsA?: number;
  oddsB?: number;
  source: 'vegas.hu';
}

export interface LiveScore {
  playerA: string;
  playerB: string;
  scoreA: number;
  scoreB: number;
  minute: number | null;      // null ha az API nem adja
  period: number | null;      // 1 = 1. félidő, 2 = 2. félidő
  periodName: string | null;  // pl. "1. félidő", "2. félidő"
  isLive: boolean;
  source: 'altenar';
}

// ──────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────────────────────────────────────────

const API_BASE = 'https://hu-sb2frontend-altenar2.biahosted.com/api';
const E_SOCCER_SPORT_ID = 146;
const MARKET_TOTAL_GOALS = 18;  // "Gólok száma összesen"
const ODD_OVER = 12;
const ODD_UNDER = 13;
const ODD_HOME = 1;   // 1X2 home/A
const ODD_AWAY = 3;   // 1X2 away/B

const COMMON_PARAMS = {
  integration: 'vegas.hu',
  culture: 'hu-HU',
  timezoneOffset: 120,
  deviceType: 2,
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Origin': 'https://vegas.hu',
  'Referer': 'https://vegas.hu/sports/e-labdarugas',
  'Accept': 'application/json',
};

// ──────────────────────────────────────────────────────────────────────────────
// CACHE
// ──────────────────────────────────────────────────────────────────────────────

interface AltenarEvent {
  id: number;
  name: string;
  competitorIds: number[];
  marketIds: number[];
  startDate: string;
  status: number;
  // Live score fields — tényleges Altenar formátum (debug-live alapján)
  score?: number[];          // [homeScore, awayScore] tömb
  liveTime?: string;         // pl. "1. félidő", "2. félidő"
  ls?: string;               // ugyanaz mint liveTime
  sc?: number;               // eltelt másodpercek az aktuális félidőben
}
interface AltenarMarket {
  id: number;
  typeId: number;
  name: string;
  oddIds: number[];
  sv?: string;  // selection value, e.g. "7.5" for O/U line
}
interface AltenarOdd {
  id: number;
  typeId: number;
  price: number;
  name: string;
  competitorId?: number;
  oddStatus: number;
}
interface AltenarCompetitor {
  id: number;
  name: string;
}
interface AltenarResponse {
  events: AltenarEvent[];
  markets: AltenarMarket[];
  odds: AltenarOdd[];
  competitors: AltenarCompetitor[];
}

let eventCache: { data: AltenarResponse; ts: number } | null = null;
const matchCache = new Map<string, { data: VegasOdds | null; ts: number }>();

const EVENT_CACHE_TTL = 10 * 1000;        // 10 sec — live GT Leagues odds update frequently
const MATCH_CACHE_TTL = 10 * 1000;        // 10 sec

// ──────────────────────────────────────────────────────────────────────────────
// FETCH ALL UPCOMING E-SOCCER EVENTS
// ──────────────────────────────────────────────────────────────────────────────

function mergeResponses(a: AltenarResponse, b: AltenarResponse): AltenarResponse {
  const mergeArr = <T extends { id: number }>(x: T[], y: T[]): T[] => {
    const map = new Map(x.map(i => [i.id, i]));
    for (const item of y) if (!map.has(item.id)) map.set(item.id, item);
    return [...map.values()];
  };
  return {
    events: mergeArr(a.events, b.events),
    markets: mergeArr(a.markets, b.markets),
    odds: mergeArr(a.odds, b.odds),
    competitors: mergeArr(a.competitors, b.competitors),
  };
}

async function fetchUpcomingEvents(): Promise<AltenarResponse> {
  if (eventCache && Date.now() - eventCache.ts < EVENT_CACHE_TTL) {
    return eventCache.data;
  }

  // Fetch both upcoming and live events (GT Leagues appear in live only)
  const [upcomingResp, liveResp] = await Promise.allSettled([
    axios.get<AltenarResponse>(`${API_BASE}/widget/GetUpcoming`, {
      headers: HEADERS,
      params: { ...COMMON_PARAMS, sportId: E_SOCCER_SPORT_ID },
      timeout: 12000,
    }),
    axios.get<AltenarResponse>(`${API_BASE}/widget/GetLivenow`, {
      headers: HEADERS,
      params: { ...COMMON_PARAMS, sportId: E_SOCCER_SPORT_ID },
      timeout: 12000,
    }),
  ]);

  const upcoming: AltenarResponse = upcomingResp.status === 'fulfilled'
    ? upcomingResp.value.data
    : { events: [], markets: [], odds: [], competitors: [] };

  const live: AltenarResponse = liveResp.status === 'fulfilled'
    ? liveResp.value.data
    : { events: [], markets: [], odds: [], competitors: [] };

  const data = mergeResponses(upcoming, live);
  eventCache = { data, ts: Date.now() };
  return data;
}

// ──────────────────────────────────────────────────────────────────────────────
// PLAYER NAME MATCHING
// ──────────────────────────────────────────────────────────────────────────────

// Extract player from competitor name: "Aston Villa (Kril)" → "kril"
function extractPlayer(competitorName: string): string {
  const m = competitorName.match(/\(([^)]+)\)/);
  return m ? m[1].toLowerCase().trim() : competitorName.toLowerCase().trim();
}

// Normalize for comparison: remove spaces, lowercase
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_-]/g, '');
}

function playersMatch(name: string, target: string): boolean {
  return norm(name) === norm(target) || norm(name).includes(norm(target)) || norm(target).includes(norm(name));
}

// ──────────────────────────────────────────────────────────────────────────────
// EXTRACT ODDS FROM EVENT
// ──────────────────────────────────────────────────────────────────────────────

function extractOddsFromEvent(
  event: AltenarEvent,
  data: AltenarResponse,
  playerA: string,
  playerB: string
): VegasOdds | null {
  const markets = data.markets.filter(m => event.marketIds.includes(m.id));

  // 1X2 odds (always try)
  const market1x2 = markets.find(m => m.typeId === 1);
  let oddsA: number | undefined;
  let oddsB: number | undefined;
  if (market1x2) {
    const odds1x2 = data.odds.filter(o => market1x2.oddIds.includes(o.id) && o.oddStatus === 0);
    const homeOdd = odds1x2.find(o => o.typeId === ODD_HOME);
    const awayOdd = odds1x2.find(o => o.typeId === ODD_AWAY);
    if (homeOdd && awayOdd) {
      oddsA = homeOdd.price;
      oddsB = awayOdd.price;
    }
  }

  // O/U market (may not be available for all leagues, e.g. GT Leagues)
  // Try all markets with typeId 18 (live API may have multiple, pick the valid one)
  const ouMarkets = markets.filter(m => m.typeId === MARKET_TOTAL_GOALS);
  for (const ouMarket of ouMarkets) {
    if (!ouMarket.sv) continue;
    const ouLine = parseFloat(ouMarket.sv.replace(',', '.'));
    // Reject whole-number lines (e.g. "4") — Altenar live API artifact; real lines end in .5
    if (isNaN(ouLine) || ouLine % 1 === 0) continue;
    const ouOdds = data.odds.filter(o => ouMarket.oddIds.includes(o.id) && o.oddStatus === 0);
    const overOdd = ouOdds.find(o => o.typeId === ODD_OVER);
    const underOdd = ouOdds.find(o => o.typeId === ODD_UNDER);
    // Reject unrealistic odds (live API sometimes bleeds wrong market data)
    const validOdds = overOdd && underOdd
      && overOdd.price >= 1.05 && overOdd.price <= 5.0
      && underOdd.price >= 1.05 && underOdd.price <= 5.0;
    if (validOdds) {
      return { playerA, playerB, ouLine, oddsOver: overOdd!.price, oddsUnder: underOdd!.price, oddsA, oddsB, source: 'vegas.hu' };
    }
  }

  // No O/U available — return with 1X2 only if we have those
  if (oddsA && oddsB) {
    return { playerA, playerB, ouLine: 0, oddsOver: 0, oddsUnder: 0, oddsA, oddsB, source: 'vegas.hu' };
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Returns real Vegas.hu O/U line and odds for a specific player matchup.
 * Searches all upcoming e-soccer events and matches by player name.
 * Returns null if the match is not found or API is unavailable.
 */
export async function getVegasOdds(playerA: string, playerB: string): Promise<VegasOdds | null> {
  const pA = playerA.toLowerCase().trim();
  const pB = playerB.toLowerCase().trim();
  const cacheKey = [pA, pB].sort().join('|');

  const cached = matchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < MATCH_CACHE_TTL) return cached.data;

  try {
    const data = await fetchUpcomingEvents();
    const competitorMap = new Map(data.competitors.map(c => [c.id, extractPlayer(c.name)]));

    // Find matching event
    for (const event of data.events) {
      if (event.competitorIds.length < 2) continue;
      const [cA, cB] = event.competitorIds;
      const nameA = competitorMap.get(cA) || '';
      const nameB = competitorMap.get(cB) || '';

      const matchAB = playersMatch(nameA, pA) && playersMatch(nameB, pB);
      const matchBA = playersMatch(nameA, pB) && playersMatch(nameB, pA);

      if (matchAB || matchBA) {
        const odds = extractOddsFromEvent(
          event, data,
          matchAB ? pA : pB,
          matchAB ? pB : pA
        );
        matchCache.set(cacheKey, { data: odds, ts: Date.now() });
        return odds;
      }
    }

    matchCache.set(cacheKey, { data: null, ts: Date.now() });
    return null;
  } catch {
    matchCache.set(cacheKey, { data: null, ts: Date.now() });
    return null;
  }
}

/**
 * Clears the cache (useful for testing).
 */
export function clearVegasCache(): void {
  matchCache.clear();
  eventCache = null;
}

/**
 * Returns all upcoming e-soccer events with their O/U odds.
 * Useful for bulk pre-loading odds data.
 */
export async function getAllVegasOdds(): Promise<VegasOdds[]> {
  try {
    const data = await fetchUpcomingEvents();
    const competitorMap = new Map(data.competitors.map(c => [c.id, extractPlayer(c.name)]));
    const result: VegasOdds[] = [];

    for (const event of data.events) {
      if (event.competitorIds.length < 2) continue;
      const [cA, cB] = event.competitorIds;
      const pA = competitorMap.get(cA) || '';
      const pB = competitorMap.get(cB) || '';
      if (!pA || !pB) continue;

      const odds = extractOddsFromEvent(event, data, pA, pB);
      if (odds) result.push(odds);
    }

    return result;
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// LIVE SCORES
// ──────────────────────────────────────────────────────────────────────────────

// Separate live-only cache (rövid TTL, real-time adatokhoz)
let liveCache: { data: AltenarResponse; ts: number } | null = null;
const LIVE_CACHE_TTL = 8 * 1000; // 8 mp — live adathoz gyors frissítés

async function fetchLiveOnly(): Promise<AltenarResponse> {
  if (liveCache && Date.now() - liveCache.ts < LIVE_CACHE_TTL) {
    return liveCache.data;
  }
  try {
    const resp = await axios.get<AltenarResponse>(`${API_BASE}/widget/GetLivenow`, {
      headers: HEADERS,
      params: { ...COMMON_PARAMS, sportId: E_SOCCER_SPORT_ID },
      timeout: 10000,
    });
    liveCache = { data: resp.data, ts: Date.now() };
    return resp.data;
  } catch {
    return liveCache?.data ?? { events: [], markets: [], odds: [], competitors: [] };
  }
}

/** Parsol score-t: score = [homeScore, awayScore] tömb */
function parseScore(event: AltenarEvent): { scoreA: number; scoreB: number } {
  if (Array.isArray(event.score) && event.score.length >= 2) {
    return { scoreA: event.score[0], scoreB: event.score[1] };
  }
  return { scoreA: 0, scoreB: 0 };
}

/** Parsol percet: startDate alapján számolt valós eltelt perc.
 *  Az Altenar sc mezője nem megbízható időszámláló, ezért a kezdési időből számolunk.
 */
function parseMinute(event: AltenarEvent): number | null {
  if (!event.startDate) return null;
  const started = new Date(event.startDate).getTime();
  const elapsed = Math.floor((Date.now() - started) / 60000);
  return Math.max(0, elapsed);
}

/** Parsol félidőt: liveTime = "1. félidő" / "2. félidő" */
function parsePeriod(event: AltenarEvent): number | null {
  const lt = event.liveTime ?? event.ls ?? '';
  if (lt.includes('1')) return 1;
  if (lt.includes('2')) return 2;
  return null;
}

/** Visszaadja a félidő nevét megjelenítéshez */
function parsePeriodName(event: AltenarEvent): string | null {
  return event.liveTime ?? event.ls ?? null;
}

/**
 * Visszaadja az összes élő e-soccer meccs gólállását és menetidejét.
 */
export async function getAllLiveScores(): Promise<LiveScore[]> {
  try {
    const data = await fetchLiveOnly();
    const competitorMap = new Map(data.competitors.map(c => [c.id, extractPlayer(c.name)]));
    const result: LiveScore[] = [];

    for (const event of data.events) {
      if (event.competitorIds.length < 2) continue;
      // status: 0 = upcoming, 1+ = live (Altenar konvenció)
      const isLive = event.status >= 1;
      const [cA, cB] = event.competitorIds;
      const pA = competitorMap.get(cA) || '';
      const pB = competitorMap.get(cB) || '';
      if (!pA || !pB) continue;

      const { scoreA, scoreB } = parseScore(event);
      result.push({
        playerA: pA,
        playerB: pB,
        scoreA,
        scoreB,
        minute: parseMinute(event),
        period: parsePeriod(event),
        periodName: parsePeriodName(event),
        isLive,
        source: 'altenar',
      });
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Nyers Altenar live response — debug célra.
 * Visszaad 3 eseményt az összes mezőjükkel együtt.
 */
export async function getRawLiveDebug(): Promise<{ eventCount: number; sample: AltenarEvent[]; competitorSample: AltenarCompetitor[] }> {
  const data = await fetchLiveOnly();
  return {
    eventCount: data.events.length,
    sample: data.events.slice(0, 3),
    competitorSample: data.competitors.slice(0, 6),
  };
}
