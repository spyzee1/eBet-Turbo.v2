// ============================================================================
// CLOUDBET BELSŐ WEB API SCRAPER (axios-alapú, Puppeteer NEM kell)
// Forrás: www.cloudbet.com/sports-api/c/v6/sports/events
//
// Felfedezett (2026-05-05) belső végpontok — API kulcs NEM szükséges:
//   GET https://www.cloudbet.com/sports-api/c/v6/sports/events?sport=esport-fifa&locale=en
//     → közelgő + élő meccsek, metadata.score (élő), metadata.resultedScores (végeredmény)
//
// Pusher real-time feed (jövőbeli integráció):
//   wss://ws-eu.pusher.com/app/c065c29ae4b4b2f23f53
//
// Adatok:
//   - Menetrend (mindkét liga, kulcs nélkül)
//   - Élő eredmény (metadata.score, metadata.eventStatus)
//   - Végeredmény (metadata.resultedScores)
//   - H2H adatbázis (saját akkumulátor, fájlba mentett)
// ============================================================================

import axios from 'axios';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname_esm = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const INTERNAL_API = 'https://www.cloudbet.com/sports-api/c/v6';
const EVENTS_URL   = `${INTERNAL_API}/sports/events?sport=esport-fifa&locale=en`;

// H2H adatbázis fájl útvonala (eredmények akkumulátora)
const H2H_DB_PATH = resolve(__dirname_esm, '../cloudbet-results.json');

const AXIOS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer':    'https://www.cloudbet.com/en/esports/esport-fifa',
  'Accept':     'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Liga nevekhez competition key megfeleltetés
const COMPETITION_NAME_MAP: Record<string, string> = {
  'GT Nations League':  'GT Leagues',
  'eAdriatic League':   'eAdriatic League',
};

// ── Típusok ───────────────────────────────────────────────────────────────────

export interface CbWebEvent {
  id:          number;
  key:         string;
  name:        string;
  homeTeam:    string;
  awayTeam:    string;
  league:      string;
  competitionKey: string;
  status:      string;            // TRADING, TRADING_LIVE, RESULTED, PRE_TRADING
  eventStatus: string;            // not_started, in_progress, finished
  startTime:   string;            // ISO UTC
  cutoffTime:  string;
  // Élő és végeredmény
  homeScore?:  number;
  awayScore?:  number;
  matchTimeSeconds?: number;
  eventTime?:  string;            // "45+2", "90" stb
  // Egyéb
  betradarId?: number;
}

export interface CbWebLiveScore {
  eventId:     number;
  homeTeam:    string;
  awayTeam:    string;
  league:      string;
  homeScore:   number;
  awayScore:   number;
  eventStatus: string;
  matchTimeSeconds: number;
  eventTime:   string;
  updatedAt:   string;
}

// H2H adatbázis struktúra
interface H2HResult {
  eventId:   number;
  homeTeam:  string;
  awayTeam:  string;
  league:    string;
  homeScore: number;
  awayScore: number;
  date:      string;     // ISO UTC
  savedAt:   string;     // mikor mentettük
}

interface H2HDatabase {
  lastUpdated: string;
  results: H2HResult[];
}

// ── H2H adatbázis ─────────────────────────────────────────────────────────────

function loadH2HDb(): H2HDatabase {
  try {
    if (existsSync(H2H_DB_PATH)) {
      const raw = readFileSync(H2H_DB_PATH, 'utf-8');
      return JSON.parse(raw) as H2HDatabase;
    }
  } catch (_e) {}
  return { lastUpdated: new Date().toISOString(), results: [] };
}

function saveH2HDb(db: H2HDatabase): void {
  try {
    db.lastUpdated = new Date().toISOString();
    writeFileSync(H2H_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
  } catch (e) {
    console.error('[cloudbet-web] H2H DB mentési hiba:', e);
  }
}

/**
 * Befejezett meccs eredményét menti el a H2H adatbázisba.
 * Duplikátumot nem ment (eventId alapján).
 */
function saveResultToH2H(event: CbWebEvent): boolean {
  if (event.homeScore === undefined || event.awayScore === undefined) return false;
  const db = loadH2HDb();
  const exists = db.results.some(r => r.eventId === event.id);
  if (exists) return false;

  db.results.push({
    eventId:   event.id,
    homeTeam:  event.homeTeam,
    awayTeam:  event.awayTeam,
    league:    event.league,
    homeScore: event.homeScore,
    awayScore: event.awayScore,
    date:      event.startTime,
    savedAt:   new Date().toISOString(),
  });

  // Tartsunk csak 30 napot
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  db.results = db.results.filter(r => r.date > cutoff);

  saveH2HDb(db);
  console.log(`[cloudbet-web] H2H mentve: ${event.homeTeam} ${event.homeScore}-${event.awayScore} ${event.awayTeam} (${event.league})`);
  return true;
}

// ── Belső API hívások ──────────────────────────────────────────────────────────

/** Nyers API válasz parsálása CbWebEvent tömbbé */
function parseApiResponse(data: any): CbWebEvent[] {
  const events: CbWebEvent[] = [];

  for (const sport of (data.sports ?? [])) {
    for (const comp of (sport.competitions ?? [])) {
      const leagueName = COMPETITION_NAME_MAP[comp.name] ?? comp.name;

      for (const ev of (comp.events ?? [])) {
        const meta     = ev.metadata ?? {};
        const efv3     = meta.esportFifaV3 ?? {};
        const score    = meta.score ?? [];           // élő: [home, away]
        const resulted = meta.resultedScores ?? {};  // végeredmény object

        // Próbáljuk kinyerni a végeredményt
        let homeScore: number | undefined;
        let awayScore: number | undefined;

        if (Array.isArray(score) && score.length >= 2) {
          homeScore = Number(score[0]);
          awayScore = Number(score[1]);
        } else if (resulted && typeof resulted === 'object' && Object.keys(resulted).length > 0) {
          // resultedScores lehet: {"home": 2, "away": 1} vagy {"ft": {"home": 2, "away": 1}}
          const ft = resulted['ft'] ?? resulted;
          if (ft.home !== undefined) {
            homeScore = Number(ft.home);
            awayScore = Number(ft.away);
          }
        }

        events.push({
          id:               ev.id,
          key:              ev.key ?? '',
          name:             ev.name ?? '',
          homeTeam:         ev.home?.name ?? '',
          awayTeam:         ev.away?.name ?? '',
          league:           leagueName,
          competitionKey:   comp.key ?? '',
          status:           ev.status ?? '',
          eventStatus:      meta.eventStatus ?? 'not_started',
          startTime:        ev.startTime ?? ev.cutoffTime ?? '',
          cutoffTime:       ev.cutoffTime ?? '',
          homeScore,
          awayScore,
          matchTimeSeconds: efv3.matchTimeSeconds ?? 0,
          eventTime:        meta.eventTime ?? '',
          betradarId:       ev.betradarId,
        });
      }
    }
  }

  return events;
}

/** Fő API hívás — összes esport-fifa esemény */
async function fetchAllEvents(): Promise<CbWebEvent[]> {
  try {
    const resp = await axios.get(EVENTS_URL, {
      headers: AXIOS_HEADERS,
      timeout: 12000,
    });
    return parseApiResponse(resp.data);
  } catch (e: any) {
    console.error('[cloudbet-web] API hiba:', e.message);
    return [];
  }
}

// ── Cache ─────────────────────────────────────────────────────────────────────

let eventsCache: { data: CbWebEvent[]; ts: number } = { data: [], ts: 0 };
const CACHE_TTL = 25_000; // 25 másodperc

async function getCachedEvents(): Promise<CbWebEvent[]> {
  if (Date.now() - eventsCache.ts < CACHE_TTL && eventsCache.data.length > 0) {
    return eventsCache.data;
  }
  const events = await fetchAllEvents();

  // Automatikusan mentsük a befejezett meccseket a H2H DB-be
  for (const ev of events) {
    if (
      (ev.eventStatus === 'finished' || ev.status === 'RESULTED') &&
      ev.homeScore !== undefined
    ) {
      saveResultToH2H(ev);
    }
  }

  eventsCache = { data: events, ts: Date.now() };
  return events;
}

// ── Publikus API ──────────────────────────────────────────────────────────────

/**
 * Közelgő meccsek menetrendje (mindkét liga).
 * Ugyanaz mint getCloudbetSchedule() de kulcs nélkül a belső API-ból.
 */
export async function getCloudbetWebSchedule(leagueFilter?: string): Promise<CbWebEvent[]> {
  const events = await getCachedEvents();
  const upcoming = events.filter(ev =>
    ev.eventStatus === 'not_started' || ev.status === 'TRADING' || ev.status === 'PRE_TRADING'
  );
  if (leagueFilter) {
    return upcoming.filter(ev => ev.league === leagueFilter);
  }
  return upcoming;
}

/**
 * Élő meccsek eredményei.
 * Ha eventStatus === 'in_progress' és score tömb nem üres → élő score.
 */
export async function getCloudbetWebLiveScores(leagueFilter?: string): Promise<CbWebLiveScore[]> {
  const events = await getCachedEvents();
  const live = events.filter(ev =>
    ev.eventStatus === 'in_progress' ||
    ev.status === 'TRADING_LIVE' ||
    (ev.homeScore !== undefined && ev.eventStatus !== 'finished')
  );

  return (leagueFilter ? live.filter(e => e.league === leagueFilter) : live)
    .map(ev => ({
      eventId:          ev.id,
      homeTeam:         ev.homeTeam,
      awayTeam:         ev.awayTeam,
      league:           ev.league,
      homeScore:        ev.homeScore ?? 0,
      awayScore:        ev.awayScore ?? 0,
      eventStatus:      ev.eventStatus,
      matchTimeSeconds: ev.matchTimeSeconds ?? 0,
      eventTime:        ev.eventTime ?? '',
      updatedAt:        new Date().toISOString(),
    }));
}

/**
 * Befejezett meccsek (a helyi H2H DB-ből + API-ból).
 */
export async function getCloudbetWebResults(leagueFilter?: string): Promise<H2HResult[]> {
  // Frissítés: hívjuk az API-t hogy az újonnan befejezetteket is mentsük
  await getCachedEvents();

  const db = loadH2HDb();
  const results = db.results.slice().reverse(); // legújabb elől
  if (leagueFilter) {
    return results.filter(r => r.league === leagueFilter);
  }
  return results;
}

/**
 * H2H adatok két csapat között a helyi DB-ből.
 * @param teamA — normalizált csapatnév (player neve nélkül)
 * @param teamB — normalizált csapatnév (player neve nélkül)
 * @param maxDays — hány napra visszamenőleg (default: 30)
 */
export async function getCloudbetWebH2H(
  teamA: string,
  teamB: string,
  leagueFilter?: string,
  maxDays = 30
): Promise<H2HResult[]> {
  const cutoff = new Date(Date.now() - maxDays * 24 * 3600 * 1000).toISOString();
  const db = loadH2HDb();

  const normA = teamA.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
  const normB = teamB.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();

  return db.results.filter(r => {
    if (r.date < cutoff) return false;
    if (leagueFilter && r.league !== leagueFilter) return false;

    const homeNorm = r.homeTeam.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
    const awayNorm = r.awayTeam.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();

    return (homeNorm.includes(normA) && awayNorm.includes(normB)) ||
           (homeNorm.includes(normB) && awayNorm.includes(normA));
  }).slice().reverse();
}

/**
 * Összes esemény (debug/feltáráshoz)
 */
export async function getCloudbetWebAllEvents(): Promise<CbWebEvent[]> {
  return getCachedEvents();
}

/**
 * H2H DB stats
 */
export function getCloudbetWebH2HStats(): { count: number; leagues: Record<string, number>; lastUpdated: string } {
  const db = loadH2HDb();
  const leagues: Record<string, number> = {};
  for (const r of db.results) {
    leagues[r.league] = (leagues[r.league] ?? 0) + 1;
  }
  return { count: db.results.length, leagues, lastUpdated: db.lastUpdated };
}

/**
 * Cache invalidálás
 */
export function clearCloudbetWebCache(): void {
  eventsCache = { data: [], ts: 0 };
}

// ── Pusher WebSocket (jövőbeli real-time integráció) ──────────────────────────
// App key: c065c29ae4b4b2f23f53
// Szerver: wss://ws-eu.pusher.com
// Csatornák: feltérképezés folyamatban
// TODO: pusher-js csomag telepítése és csatorna feliratkozás
