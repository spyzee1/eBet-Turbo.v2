// ============================================================================
// MSPORT.COM SCRAPER — Live O/U Odds for GT Leagues & eAdriatic League
// API: https://www.msport.com/api/gh/facts-center/query/frontend/live-matches/list
//      ?sportId=sr:sport:137&sortBy=DEFAULT&marketIds
// ============================================================================

import axios from 'axios';

// ── Cookie manager ────────────────────────────────────────────────────────────
// Az msport.com API JavaScript-által beállított session tokent igényel (bizCode 19000 nélkül).
// A felhasználó a böngésző DevTools-ból másolja be a Cookie stringet az API végpontba.
// Tárolás: memória + opcionálisan .env fájl (MSPORT_COOKIE változó).

let manualCookie = process.env.MSPORT_COOKIE || '';

/** Kívülről (API-ból) beállítható a cookie string */
export function setMsportCookie(cookie: string): void {
  manualCookie = cookie.trim();
  console.log(`[msport] cookie beállítva (${manualCookie.length} karakter)`);
  // Töröljük a cache-t, hogy az új cookie-val frissüljön
  cache = null;
}

export function getMsportCookieStatus(): { set: boolean; length: number } {
  return { set: !!manualCookie, length: manualCookie.length };
}

// Megpróbáljuk a főoldalt is (backup, ha nincs manuális cookie)
let autoCookie = '';
let autoCookieTs = 0;
const AUTO_COOKIE_TTL = 10 * 60 * 1000;

async function tryAutoSession(): Promise<void> {
  if (manualCookie) return; // ha van manuális cookie, azt használjuk
  if (autoCookie && Date.now() - autoCookieTs < AUTO_COOKIE_TTL) return;
  try {
    const resp = await axios.get('https://www.msport.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: 8_000,
      maxRedirects: 5,
    });
    const setCookie = resp.headers['set-cookie'];
    if (setCookie && setCookie.length > 0) {
      autoCookie = setCookie.map((c: string) => c.split(';')[0]).join('; ');
      autoCookieTs = Date.now();
      console.log(`[msport] auto-cookie (${setCookie.length} db)`);
    }
  } catch {
    // silent fail
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Base URL — minden lekérésnél ezt a live-matches endpointot használjuk.
// A comingSoons mező tartalmazza a hamarosan kezdő meccseket odds-okkal.
const API_URL_LIVE =
  'https://www.msport.com/api/gh/facts-center/query/frontend/live-matches/list' +
  '?sportId=sr:sport:137&sortBy=DEFAULT&marketIds';

// Alternatív upcoming endpoint próbák — ha a live-matches nem ad elég meccset
const API_URL_CANDIDATES = [
  // Live/upcoming kombó (ismert működő endpoint)
  API_URL_LIVE,
  // Pre-match endpoint (lehet hogy létezik)
  'https://www.msport.com/api/gh/facts-center/query/frontend/matches/list' +
    '?sportId=sr:sport:137&sortBy=DEFAULT&marketIds',
  // Upcoming-only
  'https://www.msport.com/api/gh/facts-center/query/frontend/upcoming-matches/list' +
    '?sportId=sr:sport:137&sortBy=DEFAULT&marketIds',
];

function buildHeaders(): Record<string, string> {
  const cookie = manualCookie || autoCookie;
  const h: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.msport.com/',
    'Origin': 'https://www.msport.com',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Connection': 'keep-alive',
    // Ghana operator ID — kinyerve a www.msport.com/gh homepage inline config-ból
    'operId': '3',
  };
  if (cookie) h['Cookie'] = cookie;
  return h;
}

// Tournament id → belső liga név
// sr:tournament:39749  = eAdriatic League (10 mins)
// sr:tournament:33496  = GT Leagues (12 mins)
const TOURNAMENT_MAP: Record<string, string> = {
  'sr:tournament:39749': 'eAdriatic League',
  'sr:tournament:33496': 'GT Leagues',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MsportOdds {
  playerA: string;   // home játékos neve (zárójelből kinyerve)
  playerB: string;   // away játékos neve
  teamA: string;     // csapatnév (pl. "Manchester City FC")
  teamB: string;
  league: string;    // "eAdriatic League" | "GT Leagues"
  ouLine: number;    // pl. 6.5
  oddsOver: number;
  oddsUnder: number;
  startTime: number; // Unix ms
  eventId: string;
  source: 'msport.com';
}

export interface MsportLiveScore {
  playerA: string;   // lowercase játékosnév
  playerB: string;
  scoreA: number;
  scoreB: number;
  minute: number;
  isLive: boolean;
  source: 'msport.com';
  period: number | null;
  periodName: string | null;
}

interface MsportOutcome {
  description: string;  // "Over 6.5" | "Under 6.5"
  id: string;           // "12" = over, "13" = under
  isActive: number;
  odds: string;         // "2.06"
  probability: string;
}

interface MsportMarket {
  id: number;           // 18 = Over/Under
  name: string;
  description: string;
  specifiers: string;   // "total=6.5"
  outcomes: MsportOutcome[];
  status: number;
}

interface MsportEvent {
  homeTeam: string;       // "Manchester City FC (Andrew)"
  awayTeam: string;       // "FC Bayern Munich (Conde)"
  homeTeamId: string;
  awayTeamId: string;
  category: string;       // "eAdriatic League" | "GT Sports League"
  tournament: string;     // "eAdriatic League (10 mins)" | "GT Leagues (12 mins)"
  tournamentId: string;   // "sr:tournament:39749"
  eventId: string;
  startTime: number;      // Unix ms
  markets: MsportMarket[];
  status: number;         // 0 = upcoming, >0 = live
}

interface MsportResponse {
  bizCode: number;
  data: {
    comingSoons?: MsportEvent[];
    liveMatches?: MsportEvent[];
    matches?: MsportEvent[];
  };
}

// ── Cache ─────────────────────────────────────────────────────────────────────

interface Cache { data: MsportOdds[]; ts: number; }
let cache: Cache | null = null;
const CACHE_TTL = 30_000; // 30 másodperc

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * "Manchester City FC (Andrew)" → "Andrew"
 * "FC Bayern Munich (Conde)"   → "Conde"
 * Ha nincs zárójel → visszaadja a teljes nevet
 */
function extractPlayerName(fullName: string): string {
  const match = fullName.match(/\(([^)]+)\)\s*$/);
  return match ? match[1].trim() : fullName.trim();
}

/**
 * "Manchester City FC (Andrew)" → "Manchester City FC"
 * "Donatello"                   → "" (nincs külön csapatnév, csak játékos)
 */
function extractTeamName(fullName: string): string {
  if (!fullName.includes('(')) return ''; // nincs zárójel → nincs különálló csapatnév
  return fullName.replace(/\s*\([^)]+\)\s*$/, '').trim();
}

/**
 * Meghatározza a belső liga nevet tournamentId vagy tournament szöveg alapján
 */
function mapLeague(ev: MsportEvent): string | null {
  // Elsőként tournamentId alapján (legmegbízhatóbb)
  if (TOURNAMENT_MAP[ev.tournamentId]) return TOURNAMENT_MAP[ev.tournamentId];
  // Fallback: szöveg alapján
  const t = (ev.tournament || ev.category || '').toLowerCase();
  if (t.includes('adriatic')) return 'eAdriatic League';
  if (t.includes('gt league') || t.includes('gt sport')) return 'GT Leagues';
  return null;
}

/**
 * Kinyeri az Over/Under oddsokat egy meccs markets tömbéből.
 * Market id 18 = Over/Under, outcome id 12 = Over, 13 = Under.
 * Megjegyzés: pre-match meccseken market.status != 0 és outcome.isActive = 0 lehet,
 * ezért ezeket a szűrőket elhagyjuk — csak az odds értékére szűrünk.
 */
function extractOU(markets: MsportMarket[]): { ouLine: number; oddsOver: number; oddsUnder: number } | null {
  if (!markets || markets.length === 0) return null;

  // 1. Keresünk market id=18 alapján (bármilyen status)
  // 2. Fallback: name alapján (Over/Under, Goals)
  let ouMarket = markets.find(m => m.id === 18);
  if (!ouMarket) {
    ouMarket = markets.find(m => {
      const n = (m.name || m.description || '').toLowerCase();
      return n.includes('over') || n.includes('total') || n.includes('goal');
    });
  }
  if (!ouMarket || !ouMarket.outcomes || ouMarket.outcomes.length === 0) return null;

  // O/U vonal a specifiers-ből: "total=6.5" → 6.5
  const lineMatch = (ouMarket.specifiers || '').match(/total=([\d.]+)/);
  const ouLine = lineMatch ? parseFloat(lineMatch[1]) : 0;
  if (!ouLine) return null;

  let oddsOver = 0, oddsUnder = 0;
  for (const o of ouMarket.outcomes) {
    // NEM szűrünk isActive-ra — pre-match outcomes-nál isActive=0 lehet
    const desc = (o.description || '').toLowerCase();
    const val = parseFloat(o.odds);
    if (isNaN(val) || val <= 1) continue;
    // id "12" = Over, "13" = Under (string vagy szám formátum)
    // desc lehet: "Over 2.5", "Total Over 2.5", "Under 2.5", "Total Under 2.5"
    const idStr = String(o.id);
    const isOver  = idStr === '12' || desc.includes('over');
    const isUnder = idStr === '13' || desc.includes('under');
    if (isOver && !isUnder) oddsOver = val;
    else if (isUnder && !isOver) oddsUnder = val;
  }

  if (!oddsOver || !oddsUnder) return null;
  return { ouLine, oddsOver, oddsUnder };
}

/**
 * Egy MsportEvent listából kinyeri az MsportOdds rekordokat
 */
function parseEvents(events: MsportEvent[]): MsportOdds[] {
  const results: MsportOdds[] = [];
  for (const ev of events) {
    const league = mapLeague(ev);
    if (!league) continue; // nem GT Leagues vagy eAdriatic League

    const ou = extractOU(ev.markets ?? []);
    if (!ou) continue; // nincs O/U odds

    const playerA = extractPlayerName(ev.homeTeam);
    const teamA   = extractTeamName(ev.homeTeam);
    const playerB = extractPlayerName(ev.awayTeam);
    const teamB   = extractTeamName(ev.awayTeam);
    // Első alkalommal logoljuk a nyers neveket — megmutatja hogy van-e csapatnév az API-ban
    if (results.length === 0) {
      console.log(`[msport] nyers nevek (${league}): home="${ev.homeTeam}" away="${ev.awayTeam}" → player="${playerA}" team="${teamA}"`);
    }
    results.push({
      playerA,
      playerB,
      teamA,
      teamB,
      league,
      ouLine:   ou.ouLine,
      oddsOver: ou.oddsOver,
      oddsUnder: ou.oddsUnder,
      startTime: ev.startTime,
      eventId:  ev.eventId,
      source:   'msport.com',
    });
  }
  return results;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Lekéri az msport.com live-matches listát és visszaadja a GT Leagues +
 * eAdriatic League O/U oddsokat. 30 mp-es cache-sel.
 */
async function fetchFromUrl(url: string): Promise<MsportOdds[]> {
  await tryAutoSession();
  const resp = await axios.get<MsportResponse>(url, { headers: buildHeaders(), timeout: 10_000 });
  if (resp.data.bizCode !== 10000) throw new Error(`bizCode ${resp.data.bizCode}`);
  const d = resp.data.data;
  const allEvents: MsportEvent[] = [
    ...(d.comingSoons ?? []),
    ...(d.liveMatches ?? []),
    ...(d.matches     ?? []),
  ];
  return parseEvents(allEvents);
}

export async function getMsportOdds(): Promise<MsportOdds[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data;

  // Minden ismert URL-t megpróbálunk, az eredményeket összevonjuk (eventId alapján deduplikálva)
  const seen = new Set<string>();
  const allOdds: MsportOdds[] = [];

  for (const url of API_URL_CANDIDATES) {
    try {
      const odds = await fetchFromUrl(url);
      let added = 0;
      for (const o of odds) {
        const key = o.eventId || `${o.playerA}|${o.playerB}|${o.startTime}`;
        if (!seen.has(key)) {
          seen.add(key);
          allOdds.push(o);
          added++;
        }
      }
      console.log(`[msport] ✅ ${url.includes('live') ? 'live' : url.includes('upcoming') ? 'upcoming' : 'matches'} API: ${odds.length} odds (+${added} új)`);
      // Ha az első (live) URL elég eredményt adott, nem próbálunk tovább
      if (allOdds.length >= 10) break;
    } catch (e: any) {
      console.warn(`[msport] ⚠️ API hiba (${e.message}): ${url.slice(-40)}`);
    }
  }

  console.log(`[msport] összesen ${allOdds.length} odds (GT: ${allOdds.filter(o => o.league === 'GT Leagues').length}, eAdr: ${allOdds.filter(o => o.league === 'eAdriatic League').length})`);
  cache = { data: allOdds, ts: Date.now() };
  return allOdds;
}

/**
 * Egy konkrét meccshez keres O/U oddst — játékosnév alapján fuzzy egyeztetés.
 * Visszaadja a legjobb egyezést vagy null-t.
 */
export async function getMsportOddsForMatch(
  playerA: string,
  playerB: string,
): Promise<{ ouLine: number; oddsOver: number; oddsUnder: number } | null> {
  const all = await getMsportOdds();
  if (all.length === 0) {
    console.log(`[msport] getMsportOddsForMatch(${playerA}, ${playerB}): cache üres`);
    return null;
  }

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const nA = norm(playerA);
  const nB = norm(playerB);

  // 1. Pontos egyezés
  let match = all.find(o => norm(o.playerA) === nA && norm(o.playerB) === nB);
  if (!match) match = all.find(o => norm(o.playerA) === nB && norm(o.playerB) === nA);

  // 2. Fuzzy: egyik névben tartalmazza-e a másik első N karakterét
  const fuzzyLen = (a: string, b: string) => Math.min(Math.max(a.length, b.length, 4), 6);
  if (!match) {
    match = all.find(o => {
      const oA = norm(o.playerA), oB = norm(o.playerB);
      const lenA = fuzzyLen(oA, nA), lenB = fuzzyLen(oB, nB);
      return (oA.startsWith(nA.slice(0, lenA)) || nA.startsWith(oA.slice(0, lenA))) &&
             (oB.startsWith(nB.slice(0, lenB)) || nB.startsWith(oB.slice(0, lenB)));
    });
  }
  // 3. Fordított fuzzy
  if (!match) {
    match = all.find(o => {
      const oA = norm(o.playerA), oB = norm(o.playerB);
      const lenA = fuzzyLen(oA, nB), lenB = fuzzyLen(oB, nA);
      return (oA.startsWith(nB.slice(0, lenA)) || nB.startsWith(oA.slice(0, lenA))) &&
             (oB.startsWith(nA.slice(0, lenB)) || nA.startsWith(oB.slice(0, lenB)));
    });
  }

  if (!match) {
    // Logoljuk a miss-t: megmutatja milyen nevek vannak a cache-ben
    const sampleNames = all.slice(0, 6).map(o => `${o.playerA}|${o.playerB}(${o.league})`).join(', ');
    console.log(`[msport] ❌ nem talált: ${playerA} vs ${playerB} | cache minták: ${sampleNames}`);
    return null;
  }

  console.log(`[msport] ✅ talált: ${playerA} vs ${playerB} → ${match.playerA} vs ${match.playerB} | O/U ${match.ouLine}`);
  return { ouLine: match.ouLine, oddsOver: match.oddsOver, oddsUnder: match.oddsUnder };
}

/**
 * Schedule-kompatibilis nézet az msport upcoming meccsekhez.
 * Visszaadja az eAdriatic League ÉS a GT Leagues meccseket — csak azokat,
 * amelyekhez az msport-ban valódi O/U odds van (comingSoons ablak).
 * GT Leagues: az esoccerbet schedule ezt kiegészíti, de a dedup kiszűri az ismétléseket.
 */
export async function getMsportSchedule(): Promise<Array<{
  playerHome: string;
  playerAway: string;
  league: string;
  time: string;   // "HH:MM" — Közép-európai idő
  date: string;   // "MM/DD"
}>> {
  const all = await getMsportOdds();
  return all
    .filter(o => o.league === 'eAdriatic League' || o.league === 'GT Leagues')
    .map(o => {
      const d = new Date(o.startTime);
      const mm  = String(d.getMonth() + 1).padStart(2, '0');
      const dd  = String(d.getDate()).padStart(2, '0');
      const hh  = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return {
        playerHome: o.playerA,
        playerAway: o.playerB,
        teamHome:   o.teamA,   // pl. "Manchester City FC"
        teamAway:   o.teamB,
        league: o.league,
        time: `${hh}:${min}`,
        date: `${mm}/${dd}`,
      };
    });
}

// ── Live Score ────────────────────────────────────────────────────────────────

const DETAIL_URL = 'https://www.msport.com/api/gh/facts-center/query/frontend/match/detail';

// Kis cache: eventId → {data, ts}  (10 mp TTL, meccs max 12 perc)
const detailCache = new Map<string, { data: MsportLiveScore | null; ts: number }>();
const DETAIL_CACHE_TTL = 10_000; // 10 másodperc

async function fetchMatchDetail(eventId: string): Promise<MsportLiveScore | null> {
  const cached = detailCache.get(eventId);
  if (cached && Date.now() - cached.ts < DETAIL_CACHE_TTL) return cached.data;

  try {
    await tryAutoSession();
    const resp = await axios.get(DETAIL_URL, {
      headers: buildHeaders(),
      params: { eventId },
      timeout: 8_000,
    });
    const d = resp.data?.data;
    if (!d || resp.data?.bizCode !== 10000) {
      detailCache.set(eventId, { data: null, ts: Date.now() });
      return null;
    }

    // status: 0 = upcoming, 1 = live, 2 = ended
    if (d.status < 1) {
      detailCache.set(eventId, { data: null, ts: Date.now() });
      return null;
    }

    // Score: "1:4" → scoreA=1, scoreB=4
    const scoreMatch = (d.scoreOfWholeMatch || '').match(/^(\d+):(\d+)$/);
    if (!scoreMatch) {
      detailCache.set(eventId, { data: null, ts: Date.now() });
      return null;
    }

    // Játékosnevek kinyerése: "Real Madrid (Liam)" → "liam"
    const playerA = extractPlayerName(d.homeTeam || '').toLowerCase();
    const playerB = extractPlayerName(d.awayTeam || '').toLowerCase();
    if (!playerA || !playerB) {
      detailCache.set(eventId, { data: null, ts: Date.now() });
      return null;
    }

    // Menetidő: "10'00\"" → 10, "6'44\"" → 6
    const timeStr = d.totalPlayedTime || d.playedTime || '';
    const minMatch = timeStr.match(/^(\d+)'/);
    const minute = minMatch ? parseInt(minMatch[1]) : 0;

    const result: MsportLiveScore = {
      playerA,
      playerB,
      scoreA: parseInt(scoreMatch[1]),
      scoreB: parseInt(scoreMatch[2]),
      minute,
      isLive: d.status === 1,
      source: 'msport.com',
      period: 1,   // eAdriatic/GT: egységes meccs (nincs félidő)
      periodName: `${minute}'`,
    };

    detailCache.set(eventId, { data: result, ts: Date.now() });
    console.log(`[msport-live] ✅ ${playerA} vs ${playerB} → ${d.scoreOfWholeMatch} (${minute}')`);
    return result;
  } catch (e: any) {
    console.warn(`[msport-live] ⚠️ detail hiba (${eventId}): ${e.message}`);
    detailCache.set(eventId, { data: null, ts: Date.now() });
    return null;
  }
}

/**
 * Lekéri az élő meccsek gólállását msport detail API-n keresztül.
 * @param eventIds  A napi accumulatorból szűrt, jelenleg élő meccsek eventId listája
 */
export async function getMsportLiveScores(eventIds: string[]): Promise<MsportLiveScore[]> {
  if (eventIds.length === 0) return [];
  const results = await Promise.all(eventIds.map(id => fetchMatchDetail(id)));
  return results.filter((r): r is MsportLiveScore => r !== null);
}

/**
 * Debug: nyers API válasz (GET /api/msport-debug)
 */
export async function getMsportRawDebug(): Promise<unknown> {
  const testUrl = async (url: string) => {
    try {
      await tryAutoSession();
      const resp = await axios.get(url, { headers: buildHeaders(), timeout: 10_000 });
      const d = resp.data?.data;
      const allEvents: MsportEvent[] = [
        ...(d?.comingSoons ?? []),
        ...(d?.liveMatches ?? []),
        ...(d?.matches ?? []),
      ];
      const parsed = parseEvents(allEvents);

      // Első 2 event nyers market adatai
      const rawMarketSample = allEvents.slice(0, 2).map(ev => ({
        homeTeam: ev.homeTeam,
        awayTeam: ev.awayTeam,
        tournamentId: ev.tournamentId,
        markets: ev.markets?.slice(0, 3).map(m => ({
          id: m.id, name: m.name, status: m.status, specifiers: m.specifiers,
          outcomes: m.outcomes?.map(o => ({ id: o.id, desc: o.description, isActive: o.isActive, odds: o.odds })),
        })),
      }));

      // Első élő event TELJES nyers struktúrája (score mezők megismeréséhez)
      const liveEvents: any[] = d?.liveMatches ?? [];
      const rawLiveSample = liveEvents.slice(0, 2).map(ev => {
        // Mindent visszaadunk, kivéve a markets tömböt (azt külön mutatjuk)
        const { markets, ...rest } = ev;
        return { ...rest, marketsCount: markets?.length ?? 0 };
      });

      // "events" kulcs vizsgálata — lehet live score adatforrás
      const eventsKey: any[] = d?.events ?? [];
      const rawEventsSample = eventsKey.slice(0, 3).map(ev => {
        const { markets, ...rest } = ev ?? {};
        return { ...rest, marketsCount: markets?.length ?? 0 };
      });

      return {
        ok: true,
        bizCode: resp.data?.bizCode,
        comingSoonsCount: d?.comingSoons?.length ?? 0,
        liveMatchesCount: d?.liveMatches?.length ?? 0,
        matchesCount: d?.matches?.length ?? 0,
        eventsKeyCount: eventsKey.length,
        totalEventsCount: allEvents.length,
        parsedOddsCount: parsed.length,
        parsedOdds: parsed.slice(0, 5),
        rawMarketSample,
        rawLiveSample,       // ← élő meccsek teljes struktúrája (score mezők!)
        rawEventsSample,     // ← "events" kulcs tartalma
        dataKeys: Object.keys(d ?? {}),
      };
    } catch (e: any) {
      return { ok: false, error: e.message, status: e.response?.status };
    }
  };

  const results: Record<string, unknown> = {};
  for (const url of API_URL_CANDIDATES) {
    const key = url.includes('upcoming-matches') ? 'upcoming' : url.includes('live-matches') ? 'live' : 'matches';
    results[key] = await testUrl(url);
    results[`${key}Url`] = url;
  }
  return results;
}
