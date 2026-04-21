import * as cheerio from 'cheerio';

const BASE = 'https://www.totalcorner.com';

// League IDs on totalcorner
export const TC_LEAGUES: Record<string, { id: number; name: string; slug: string }> = {
  'GT Leagues': { id: 12985, name: 'Esoccer GT Leagues - 12 mins play', slug: 'Esoccer-GT-Leagues-12-mins-play' },
  'Esoccer Battle': { id: 12995, name: 'Esoccer Battle - 8 mins play', slug: 'Esoccer-Battle-8-mins-play' },
  'Esoccer Adriatic League': { id: 29991, name: 'Esoccer Adriatic League - 10 mins play', slug: 'Esoccer-Adriatic-League-10-mins-play' },
};

export interface TCPlayerStats {
  rank: number;
  name: string;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  avgGf: number;
  avgGa: number;
  dangAttacksPerGoal: number;
  points: number;
}

export interface TCOverStats {
  rank: number;
  name: string;
  matches: number;
  avgGf: number;
  avgGa: number;
  over: Record<string, number>; // "1.5" -> 0.95
}

export interface TCFixture {
  matchId: string;
  startTime: string;
  playerHome: string;
  teamHome: string;
  playerAway: string;
  teamAway: string;
  score: string;
  handicap: string;
  goalLine: string;
  statsUrl: string;
  oddsUrl: string;
}

export interface TCLeagueData {
  playerStats: TCPlayerStats[];
  overStats: TCOverStats[];
  fixtures: TCFixture[];
}

export interface TCOdds1X2 {
  time: string;
  score: string;
  home: number;
  draw: number;
  away: number;
  timestamp: string;
}

export interface TCOddsHandicap {
  time: string;
  score: string;
  home: number;
  handicap: string;
  away: number;
  timestamp: string;
}

export interface TCOddsGoal {
  time: string;
  score: string;
  over: number;
  line: string; // e.g. "4.5" or "3.0"
  under: number;
  timestamp: string;
}

export interface OddsMovement {
  open: number;      // oldest pre-match odds
  close: number;     // newest pre-match odds
  delta: number;     // close - open
  direction: 'up' | 'down' | 'stable';
  change: number;    // percent change
}

export interface TCMatchOdds {
  bet365_1x2: TCOdds1X2[];
  xbet_1x2: TCOdds1X2[];
  bet365_handicap: TCOddsHandicap[];
  xbet_handicap: TCOddsHandicap[];
  bet365_goals: TCOddsGoal[];
  xbet_goals: TCOddsGoal[];
  // Latest snapshot helpers
  latest1x2?: { home: number; draw: number; away: number };
  latestGoals?: { line: string; lineValue: number; over: number; under: number };
  // Movement: how the pre-match odds changed from open to close
  movement1x2?: { home: OddsMovement; draw: OddsMovement; away: OddsMovement };
  movementGoals?: { over: OddsMovement; under: OddsMovement };
}

export interface TCH2HMatch {
  matchId: string;
  league: string;
  date: string;
  homePlayer: string;
  awayPlayer: string;
  homeGoal: number;
  awayGoal: number;
  handicap: string;
  goalLine: string;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

// Parse player name + team from "Rangers (Lio)" format
export function parsePlayerTeam(raw: string): { player: string; team: string } {
  const match = raw.match(/^(.+?)\s*\(([^)]+)\)$/);
  if (match) return { team: match[1].trim(), player: match[2].trim() };
  return { player: raw.trim(), team: '' };
}

// Scrape league page: player stats, over stats, fixtures
export async function scrapeTCLeague(league: string = 'GT Leagues'): Promise<TCLeagueData> {
  const tcLeague = TC_LEAGUES[league];
  if (!tcLeague) throw new Error(`Unknown league: ${league}`);

  const url = `${BASE}/league/view/${tcLeague.id}/end/${tcLeague.slug}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  // Parse player stats table (first stats_table with Points header)
  const playerStats: TCPlayerStats[] = [];
  const overStats: TCOverStats[] = [];

  $('table.stats_table').each((tableIdx, table) => {
    const headers = $(table).find('thead th').map((_, th) => $(th).text().trim()).get();
    const hasPoints = headers.includes('Points');
    const hasOver = headers.some(h => h.startsWith('Over'));

    $(table).find('tbody tr').each((_, row) => {
      const cells = $(row).find('td').map((_, td) => $(td).text().trim()).get();
      if (cells.length < 5) return;

      const nameLink = $(row).find('td a').first().text().trim();
      if (!nameLink) return;

      if (hasPoints && tableIdx === 0) {
        // Player stats table
        playerStats.push({
          rank: parseInt(cells[0]) || 0,
          name: nameLink,
          matches: parseInt(cells[2]) || 0,
          wins: parseInt(cells[3]) || 0,
          draws: parseInt(cells[4]) || 0,
          losses: parseInt(cells[5]) || 0,
          gf: parseInt(cells[6]) || 0,
          ga: parseInt(cells[7]) || 0,
          avgGf: parseFloat(cells[8]) || 0,
          avgGa: parseFloat(cells[9]) || 0,
          dangAttacksPerGoal: parseFloat(cells[10]) || 0,
          points: parseInt(cells[11]) || 0,
        });
      } else if (hasOver) {
        // Over stats table
        const over: Record<string, number> = {};
        const overColumns = headers.filter(h => h.startsWith('Over'));
        overColumns.forEach((col, i) => {
          const line = col.replace('Over ', '');
          // Over columns start at index 5 (rank, player, MP, Avg GF, Avg GA, then Over 1.5...)
          const val = cells[5 + i];
          if (val) over[line] = parseFloat(val.replace('%', '')) / 100;
        });
        overStats.push({
          rank: parseInt(cells[0]) || 0,
          name: nameLink,
          matches: parseInt(cells[2]) || 0,
          avgGf: parseFloat(cells[3]) || 0,
          avgGa: parseFloat(cells[4]) || 0,
          over,
        });
      }
    });
  });

  // Parse fixtures (background_table with match rows)
  const fixtures: TCFixture[] = [];
  $('table.background_table tbody tr').each((_, row) => {
    const $row = $(row);
    // Skip date separator rows
    if ($row.find('td[colspan]').length > 0) return;

    const cells = $row.find('td');
    if (cells.length < 6) return;

    const startTime = cells.eq(0).text().trim();
    const homeText = cells.eq(2).text().trim();
    const scoreText = cells.eq(3).text().trim();
    const awayText = cells.eq(4).text().trim();

    if (!startTime || !homeText || !awayText) return;

    // Handicap and goal line columns are variable - find them by content
    let handicap = '';
    let goalLine = '';
    cells.each((i, c) => {
      const txt = $(c).text().trim();
      // Handicap format: "0.0, +0.5" or "-0.5, -1.0"
      if (/^-?\d+(\.\d+)?\s*,\s*[+-]?\d+(\.\d+)?$/.test(txt)) {
        if (!handicap && i < 10) handicap = txt;
        else if (!goalLine && i > 8) goalLine = txt;
      }
    });

    // Extract match URL
    const statsLink = $row.find('a[href*="/stats/"]').attr('href') || '';
    const oddsLink = $row.find('a[href*="/odds/"]').attr('href') || '';
    const matchIdMatch = statsLink.match(/\/(\d+)$/);
    const matchId = matchIdMatch ? matchIdMatch[1] : '';

    const home = parsePlayerTeam(homeText);
    const away = parsePlayerTeam(awayText);

    fixtures.push({
      matchId,
      startTime,
      playerHome: home.player,
      teamHome: home.team,
      playerAway: away.player,
      teamAway: away.team,
      score: scoreText,
      handicap,
      goalLine,
      statsUrl: statsLink.startsWith('http') ? statsLink : `${BASE}${statsLink}`,
      oddsUrl: oddsLink.startsWith('http') ? oddsLink : `${BASE}${oddsLink}`,
    });
  });

  return { playerStats, overStats, fixtures };
}

// Calculate odds movement from a list of records (oldest to newest pre-match)
// Direction meaning:
// - DOWN (odds ↓): market is confident this outcome will happen → sharp money
// - UP (odds ↑): market is less confident → public money pulled back
function calcMovement(preMatchRecords: number[]): OddsMovement | undefined {
  if (preMatchRecords.length < 2) return undefined;
  // Records come newest-first in the table. So open = last, close = first.
  const close = preMatchRecords[0];
  const open = preMatchRecords[preMatchRecords.length - 1];
  if (!open || !close) return undefined;
  const delta = close - open;
  const change = open > 0 ? delta / open : 0;
  let direction: 'up' | 'down' | 'stable' = 'stable';
  if (Math.abs(change) >= 0.02) {
    direction = delta > 0 ? 'up' : 'down';
  }
  return { open, close, delta, direction, change };
}

// Parse "2.5, 3.0" Asian goal line -> 2.75 (average of split line)
export function parseGoalLine(raw: string): number {
  if (!raw) return 3.5;
  const trimmed = raw.trim();
  const parts = trimmed.split(/,\s*/).map(parseFloat).filter(n => !isNaN(n));
  if (parts.length === 0) return 3.5;
  if (parts.length === 1) return parts[0];
  return (parts[0] + parts[1]) / 2;
}

// Scrape specific match odds page
export async function scrapeTCMatchOdds(matchId: string, homePlayer: string, awayPlayer: string): Promise<TCMatchOdds> {
  const slugHome = encodeURIComponent(homePlayer);
  const slugAway = encodeURIComponent(awayPlayer);
  const url = `${BASE}/odds/${slugHome}-vs-${slugAway}/${matchId}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const parse1x2 = (tableId: string): TCOdds1X2[] => {
    const records: TCOdds1X2[] = [];
    $(`#${tableId} tbody tr`).each((_, row) => {
      const cells = $(row).find('td').map((_, c) => $(c).text().trim()).get();
      if (cells.length < 6) return;
      const home = parseFloat(cells[2]);
      const draw = parseFloat(cells[3]);
      const away = parseFloat(cells[4]);
      if (isNaN(home) || isNaN(draw) || isNaN(away)) return;
      records.push({
        time: cells[0],
        score: cells[1],
        home, draw, away,
        timestamp: cells[cells.length - 1] || '',
      });
    });
    return records;
  };

  const parseHandicap = (tableId: string): TCOddsHandicap[] => {
    const records: TCOddsHandicap[] = [];
    $(`#${tableId} tbody tr`).each((_, row) => {
      const cells = $(row).find('td').map((_, c) => $(c).text().trim()).get();
      if (cells.length < 6) return;
      const home = parseFloat(cells[2]);
      const away = parseFloat(cells[4]);
      if (isNaN(home) || isNaN(away)) return;
      records.push({
        time: cells[0],
        score: cells[1],
        home,
        handicap: cells[3],
        away,
        timestamp: cells[cells.length - 1] || '',
      });
    });
    return records;
  };

  const parseGoals = (tableId: string): TCOddsGoal[] => {
    const records: TCOddsGoal[] = [];
    $(`#${tableId} tbody tr`).each((_, row) => {
      const cells = $(row).find('td').map((_, c) => $(c).text().trim()).get();
      if (cells.length < 6) return;
      const over = parseFloat(cells[2]);
      const under = parseFloat(cells[4]);
      if (isNaN(over) || isNaN(under)) return;
      records.push({
        time: cells[0],
        score: cells[1],
        over,
        line: cells[3],
        under,
        timestamp: cells[cells.length - 1] || '',
      });
    });
    return records;
  };

  const bet365_1x2 = parse1x2('odds_full');
  const xbet_1x2 = parse1x2('xb_odds_full');
  const bet365_handicap = parseHandicap('handicap_full');
  const xbet_handicap = parseHandicap('xb_handicap_full');
  const bet365_goals = parseGoals('goals_full');
  const xbet_goals = parseGoals('xb_goals_full');

  // Pre-match odds: time is empty, "00 '", or time-prefix of "0"; score is "-" or empty.
  // The tables are ordered live updates first, pre-match at the bottom.
  const isPreMatch = (time: string, score: string): boolean => {
    const t = time.trim();
    const s = score.trim();
    // Score contains goals → live update (except "0 - 0" which could be 00')
    const scoreMatch = s.match(/^(\d+)\s*-\s*(\d+)$/);
    if (scoreMatch) {
      const total = parseInt(scoreMatch[1]) + parseInt(scoreMatch[2]);
      if (total > 0) return false; // has goals = live
    }
    // Time > 0' = live
    const tMatch = t.match(/^(\d+)\s*'?/);
    if (tMatch && parseInt(tMatch[1]) > 0) return false;
    return true;
  };

  // Latest pre-match snapshot (first pre-match row = most recent pre-match odds update)
  const latest1x2Rec = bet365_1x2.find(r => isPreMatch(r.time, r.score)) || bet365_1x2[bet365_1x2.length - 1];
  const latest1x2 = latest1x2Rec
    ? { home: latest1x2Rec.home, draw: latest1x2Rec.draw, away: latest1x2Rec.away }
    : undefined;

  const latestGoalsRec = bet365_goals.find(r => isPreMatch(r.time, r.score)) || bet365_goals[bet365_goals.length - 1];
  const latestGoals = latestGoalsRec
    ? {
        line: latestGoalsRec.line,
        lineValue: parseGoalLine(latestGoalsRec.line),
        over: latestGoalsRec.over,
        under: latestGoalsRec.under,
      }
    : undefined;

  // Compute odds movement (pre-match only)
  const preMatch1x2 = bet365_1x2.filter(r => isPreMatch(r.time, r.score));
  const movement1x2 = preMatch1x2.length >= 2
    ? {
        home: calcMovement(preMatch1x2.map(r => r.home))!,
        draw: calcMovement(preMatch1x2.map(r => r.draw))!,
        away: calcMovement(preMatch1x2.map(r => r.away))!,
      }
    : undefined;

  const preMatchGoals = bet365_goals.filter(r => isPreMatch(r.time, r.score));
  const movementGoals = preMatchGoals.length >= 2
    ? {
        over: calcMovement(preMatchGoals.map(r => r.over))!,
        under: calcMovement(preMatchGoals.map(r => r.under))!,
      }
    : undefined;

  return {
    bet365_1x2, xbet_1x2,
    bet365_handicap, xbet_handicap,
    bet365_goals, xbet_goals,
    latest1x2, latestGoals,
    movement1x2, movementGoals,
  };
}

// Scrape H2H history from match stats page
export async function scrapeTCH2H(matchId: string, homePlayer: string, awayPlayer: string): Promise<TCH2HMatch[]> {
  const slugHome = encodeURIComponent(homePlayer);
  const slugAway = encodeURIComponent(awayPlayer);
  const url = `${BASE}/stats/${slugHome}-vs-${slugAway}/${matchId}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const h2h: TCH2HMatch[] = [];
  $('#head_to_head_history_table tbody tr').each((_, row) => {
    const $row = $(row);
    const homeGoal = parseInt($row.attr('data-home_goal') || '0');
    const awayGoal = parseInt($row.attr('data-away_goal') || '0');
    const matchIdAttr = $row.attr('data-match_id') || '';

    const league = $row.find('.td_league').text().trim();
    const date = $row.find('.td_time').text().trim();
    const homeText = $row.find('.td_home .home').text().trim();
    const awayText = $row.find('.td_away span').first().text().trim();

    const handicap = $row.find('td').eq(7).text().trim();
    const goalLine = $row.find('td').eq(8).text().trim();

    const home = parsePlayerTeam(homeText);
    const away = parsePlayerTeam(awayText);

    h2h.push({
      matchId: matchIdAttr,
      league,
      date,
      homePlayer: home.player,
      awayPlayer: away.player,
      homeGoal,
      awayGoal,
      handicap,
      goalLine,
    });
  });

  return h2h;
}

// Aggregate H2H stats (for H2H-first mode)
export interface H2HAggregate {
  total: number;
  winsA: number;
  winsB: number;
  draws: number;
  avgGoalsA: number;
  avgGoalsB: number;
  avgTotalGoals: number;
  overRates: Record<string, number>; // over line -> rate
  effectiveSize?: number; // weighted sample size (if weighted)
}

// Normalized H2H match (unified schema from different sources)
export interface NormalizedH2H {
  date: string;      // "MM/DD" or "YYYY-MM-DD" format
  goalsA: number;    // from playerA perspective
  goalsB: number;    // from playerB perspective
  source: 'esoccerbet' | 'totalcorner';
}

export function aggregateH2H(matches: TCH2HMatch[], playerA: string, playerB: string): H2HAggregate {
  let winsA = 0, winsB = 0, draws = 0;
  let totalGoalsA = 0, totalGoalsB = 0;
  const totalGoalsList: number[] = [];

  for (const m of matches) {
    // Determine from whose perspective
    const aIsHome = m.homePlayer.toLowerCase() === playerA.toLowerCase();
    const goalsA = aIsHome ? m.homeGoal : m.awayGoal;
    const goalsB = aIsHome ? m.awayGoal : m.homeGoal;

    totalGoalsA += goalsA;
    totalGoalsB += goalsB;
    totalGoalsList.push(goalsA + goalsB);

    if (goalsA > goalsB) winsA++;
    else if (goalsA < goalsB) winsB++;
    else draws++;
  }

  const total = matches.length;
  const lines = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
  const overRates: Record<string, number> = {};
  for (const line of lines) {
    const over = totalGoalsList.filter(g => g > line).length;
    overRates[String(line)] = total > 0 ? over / total : 0;
  }

  return {
    total,
    winsA,
    winsB,
    draws,
    avgGoalsA: total > 0 ? totalGoalsA / total : 0,
    avgGoalsB: total > 0 ? totalGoalsB / total : 0,
    avgTotalGoals: total > 0 ? totalGoalsList.reduce((a, b) => a + b, 0) / total : 0,
    overRates,
  };
}

// Parse various date formats to days-ago. 0 = today, 7 = week old, etc.
function daysAgo(dateStr: string): number {
  if (!dateStr) return 365;
  // Try ISO format first: "2026-01-07"
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}`);
    return Math.max(0, (Date.now() - d.getTime()) / 86400000);
  }
  // "MM/DD HH:MM" or "MM/DD" format from esoccerbet
  const md = dateStr.match(/^(\d{2})\/(\d{2})/);
  if (md) {
    const now = new Date();
    const year = now.getFullYear();
    let d = new Date(`${year}-${md[1]}-${md[2]}`);
    // If the date is in the future, it was actually last year
    if (d.getTime() > Date.now() + 86400000) {
      d = new Date(`${year - 1}-${md[1]}-${md[2]}`);
    }
    return Math.max(0, (Date.now() - d.getTime()) / 86400000);
  }
  return 365;
}

// Weighted H2H aggregation with exponential decay
// half_life_days: how many days until a match's weight is 0.5 (default 30 days)
export function aggregateH2HWeighted(
  matches: NormalizedH2H[],
  halfLifeDays: number = 30
): H2HAggregate {
  let wWinsA = 0, wWinsB = 0, wDraws = 0;
  let wGoalsA = 0, wGoalsB = 0;
  let wTotalGoals = 0;
  let wTotal = 0;
  const weightedGoalsList: { g: number; w: number }[] = [];

  for (const m of matches) {
    const age = daysAgo(m.date);
    const weight = Math.pow(0.5, age / halfLifeDays);
    wTotal += weight;
    wGoalsA += m.goalsA * weight;
    wGoalsB += m.goalsB * weight;
    const totalG = m.goalsA + m.goalsB;
    wTotalGoals += totalG * weight;
    weightedGoalsList.push({ g: totalG, w: weight });

    if (m.goalsA > m.goalsB) wWinsA += weight;
    else if (m.goalsA < m.goalsB) wWinsB += weight;
    else wDraws += weight;
  }

  const lines = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
  const overRates: Record<string, number> = {};
  for (const line of lines) {
    const wOver = weightedGoalsList.filter(x => x.g > line).reduce((s, x) => s + x.w, 0);
    overRates[String(line)] = wTotal > 0 ? wOver / wTotal : 0;
  }

  return {
    total: matches.length,
    effectiveSize: Math.round(wTotal * 10) / 10,
    // Round weighted counts to nearest integer for display
    winsA: Math.round(wWinsA),
    winsB: Math.round(wWinsB),
    draws: Math.round(wDraws),
    avgGoalsA: wTotal > 0 ? wGoalsA / wTotal : 0,
    avgGoalsB: wTotal > 0 ? wGoalsB / wTotal : 0,
    avgTotalGoals: wTotal > 0 ? wTotalGoals / wTotal : 0,
    overRates,
  };
}

// Normalize TC H2H to common format
export function normalizeTCH2H(matches: TCH2HMatch[], playerA: string): NormalizedH2H[] {
  return matches.map(m => {
    const aIsHome = m.homePlayer.toLowerCase() === playerA.toLowerCase();
    return {
      date: m.date,
      goalsA: aIsHome ? m.homeGoal : m.awayGoal,
      goalsB: aIsHome ? m.awayGoal : m.homeGoal,
      source: 'totalcorner' as const,
    };
  });
}

// Merge multi-source H2H, dedupe by (date, score)
export function mergeH2HSources(
  esoccerbet: NormalizedH2H[],
  totalcorner: NormalizedH2H[]
): NormalizedH2H[] {
  const seen = new Set<string>();
  const merged: NormalizedH2H[] = [];
  // Prefer totalcorner (more reliable historical data)
  for (const m of [...totalcorner, ...esoccerbet]) {
    const key = `${m.date.trim()}|${m.goalsA}-${m.goalsB}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(m);
  }
  return merged;
}
