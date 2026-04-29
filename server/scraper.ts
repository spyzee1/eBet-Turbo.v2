import * as cheerio from 'cheerio';

const BASE = 'https://esoccerbet.org';

const LEAGUE_PATHS: Record<string, string> = {
  'GT Leagues': '/fifa-12-minutes',
  'eAdriatic League': '/fifa-10-minutes',
  'Esoccer Battle': '/fifa-8-minutes',
  'Esports Volta': '/fifa-6-minutes',
};

export interface PlayerStats {
  name: string;
  league: string;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  lossRate: number;
  drawRate: number;
  goalDiff: number;
  gfPerMatch: number;
  gaPerMatch: number;
  form10: number;
  form50: number;
  form200: number;
  bttsYes: number;
  ouStats: { line: string; over: number; under: number }[];
  lastMatches: MatchEntry[];
}

export interface MatchEntry {
  opponent: string;
  opponentTeam: string;
  team: string;
  scoreHome: number;
  scoreAway: number;
  result: 'win' | 'loss' | 'draw';
  date: string;
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

// Convert "HH:MM" from UTC to Budapest time (UTC+2 CEST / UTC+1 CET)
function adjustTimezone(utcTime: string): string {
  const match = utcTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return utcTime;
  // Use Intl to get the correct offset dynamically (handles CET/CEST)
  const now = new Date();
  const utcH = parseInt(match[1]);
  const utcM = match[2];
  now.setUTCHours(utcH, parseInt(utcM), 0, 0);
  const budapest = now.toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit', hour12: false });
  return budapest;
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

export async function scrapePlayerStats(playerName: string, league: string = 'GT Leagues'): Promise<PlayerStats> {
  const leaguePath = LEAGUE_PATHS[league] || LEAGUE_PATHS['GT Leagues'];
  const url = `${BASE}${leaguePath}/${encodeURIComponent(playerName.toLowerCase())}/`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  // --- Stats from .estatisticas .box ---
  const statsBox = $('.estatisticas .box').first();
  const divStats = statsBox.find('.divStats');

  // First divStats: win% / loss%
  const winPctText = divStats.eq(0).find('.green').first().text().trim(); // e.g. "66%"
  const lossPctText = divStats.eq(0).find('.red').first().text().trim();  // e.g. "19%"
  const winRate = parseFloat(winPctText) / 100 || 0;
  const lossRate = parseFloat(lossPctText) / 100 || 0;
  const drawRate = Math.max(0, 1 - winRate - lossRate);

  // Second divStats: avg goals scored / conceded
  const gfText = divStats.eq(1).find('.green').first().text().trim(); // e.g. "3.45"
  const gaText = divStats.eq(1).find('.red').first().text().trim();   // e.g. "2.05"
  const gfPerMatch = parseFloat(gfText) || 0;
  const gaPerMatch = parseFloat(gaText) || 0;

  // --- Match count from header ---
  const headerText = $('.statsJogador .header').text(); // "Result: 500 matches of Hit"
  const matchCountMatch = headerText.match(/(\d+)\s*match/i);
  const matches = matchCountMatch ? parseInt(matchCountMatch[1]) : 0;

  const wins = Math.round(matches * winRate);
  const draws = Math.round(matches * drawRate);
  const losses = Math.round(matches * lossRate);

  // --- Form: .box.vars .var ---
  const vars = $('.estatisticas .box.vars .var');
  const parseForm = (idx: number): number => {
    const text = vars.eq(idx).find('span').last().text().trim(); // e.g. "+30%" or "-8%"
    return (parseFloat(text) || 0) / 100;
  };
  const form10 = parseForm(0);
  const form50 = parseForm(1);
  const form200 = parseForm(2);

  // --- O/U stats from .tabela .linha ---
  const ouStats: { line: string; over: number; under: number }[] = [];
  let bttsYes = 0;

  // First .subbox = Match totals O/U
  const matchOUBox = $('.estatisticas .subbox').first();
  matchOUBox.find('.tabela .linha').each((_, el) => {
    const spans = $(el).find('span');
    const label = spans.eq(0).text().trim();
    const overText = spans.eq(1).text().trim();
    const underText = spans.eq(2).text().trim();

    if (label === 'BTTS') {
      bttsYes = parseFloat(overText) / 100 || 0;
    } else {
      ouStats.push({
        line: label,
        over: parseFloat(overText) / 100 || 0,
        under: parseFloat(underText) / 100 || 0,
      });
    }
  });

  // --- Last 20 matches from .partida ---
  const lastMatches: MatchEntry[] = [];
  $('.partidas .partida').each((_, el) => {
    const $el = $(el);
    const resultDiv = $el.find('.h').first();
    const classList = resultDiv.attr('class') || '';

    let result: 'win' | 'loss' | 'draw' = 'draw';
    if (classList.includes('ptdWin')) result = 'win';
    else if (classList.includes('ptdLoss')) result = 'loss';

    const players = $el.find('.jogador');
    const scoreSpan = $el.find('.placarEstilo');

    if (players.length >= 2 && scoreSpan.length > 0) {
      const team = players.eq(0).find('.time').text().trim();
      const opponent = players.eq(1).find('.nick').text().trim();
      const opponentTeam = players.eq(1).find('.time').text().trim();
      const date = $el.find('.palpite').text().trim();

      // Parse score: the placarEstilo has structure like (1)2 - 3(1)
      const scoreText = scoreSpan.text().replace(/\([^)]*\)/g, '').trim();
      const scoreParts = scoreText.split('-').map(s => parseInt(s.trim()));

      if (scoreParts.length === 2 && !isNaN(scoreParts[0]) && !isNaN(scoreParts[1])) {
        lastMatches.push({
          opponent,
          opponentTeam,
          team,
          scoreHome: scoreParts[0],
          scoreAway: scoreParts[1],
          result,
          date,
        });
      }
    }
  });

  return {
    name: playerName,
    league,
    matches,
    wins,
    draws,
    losses,
    winRate,
    lossRate,
    drawRate,
    goalDiff: Math.round((gfPerMatch - gaPerMatch) * matches),
    gfPerMatch,
    gaPerMatch,
    form10,
    form50,
    form200,
    bttsYes,
    ouStats,
    lastMatches: lastMatches.slice(0, 20),
  };
}

export async function scrapeRankings(league: string = 'GT Leagues'): Promise<RankingEntry[]> {
  const leaguePath = LEAGUE_PATHS[league] || LEAGUE_PATHS['GT Leagues'];
  const url = `${BASE}${leaguePath}/`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const rankings: RankingEntry[] = [];
  let pos = 1;
  $('table tr').each((_, el) => {
    const cells = $(el).find('td');
    if (cells.length >= 6) {
      const link = $(el).find('a').first();
      const name = link.text().trim();
      if (!name) return;
      rankings.push({
        position: pos++,
        name,
        matches: parseInt(cells.eq(1).text().trim()) || 0,
        wins: parseInt(cells.eq(2).text().trim()) || 0,
        draws: parseInt(cells.eq(3).text().trim()) || 0,
        losses: parseInt(cells.eq(4).text().trim()) || 0,
        goalDiff: parseInt(cells.eq(5).text().trim()) || 0,
        league,
      });
    }
  });

  return rankings;
}

export async function scrapeBestPlayers(): Promise<RankingEntry[]> {
  const url = `${BASE}/best-players/today/`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const players: RankingEntry[] = [];
  let pos = 1;
  $('table tr').each((_, el) => {
    const cells = $(el).find('td');
    if (cells.length >= 6) {
      const link = $(el).find('a').first();
      const name = link.text().trim();
      if (!name) return;

      const href = link.attr('href') || '';
      let league = 'Other';
      if (href.includes('12-minutes')) league = 'GT Leagues';
      else if (href.includes('10-minutes')) league = 'eAdriatic League';
      else if (href.includes('8-minutes')) league = 'Esoccer Battle';
      else if (href.includes('6-minutes')) league = 'Esports Volta';

      players.push({
        position: pos++,
        name,
        matches: parseInt(cells.eq(1).text().trim()) || 0,
        wins: parseInt(cells.eq(2).text().trim()) || 0,
        draws: parseInt(cells.eq(3).text().trim()) || 0,
        losses: parseInt(cells.eq(4).text().trim()) || 0,
        goalDiff: parseInt(cells.eq(5).text().trim()) || 0,
        league,
      });
    }
  });

  return players;
}

export async function scrapeSchedule(): Promise<ScheduleEntry[]> {
  const url = `${BASE}/schedule/`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const schedule: ScheduleEntry[] = [];
  // Structure: 3 columns: Start | Home | Away
  // Start: "10:30<br><span>04/02</span>"
  // Home: "<a href='/fifa-12-minutes/player/'>player</a><span class='teamName'>team</span>"
  // Away: same structure
  $('table.tabelas tbody tr.linhasTR').each((_, el) => {
    const cells = $(el).find('td');
    if (cells.length < 3) return;

    const timeHtml = cells.eq(0).html() || '';
    const timeParts = timeHtml.split(/<br\s*\/?>/i);
    const rawTime = cheerio.load(timeParts[0] || '')('body').text().trim();
    const date = timeParts[1] ? cheerio.load(timeParts[1])('body').text().trim() : '';

    // Convert UTC to Europe/Budapest (UTC+2 CEST / UTC+1 CET)
    const time = adjustTimezone(rawTime);

    const homeLink = cells.eq(1).find('a').first();
    const awayLink = cells.eq(2).find('a').first();

    const homeHref = homeLink.attr('href') || '';
    let league = 'Other';
    if (homeHref.includes('12-minutes')) league = 'GT Leagues';
    else if (homeHref.includes('10-minutes')) league = 'eAdriatic League';
    else if (homeHref.includes('8-minutes')) league = 'Esoccer Battle';
    else if (homeHref.includes('6-minutes')) league = 'Esports Volta';

    schedule.push({
      time,
      date,
      playerHome: homeLink.text().trim(),
      teamHome: cells.eq(1).find('.teamName').text().trim(),
      playerAway: awayLink.text().trim(),
      teamAway: cells.eq(2).find('.teamName').text().trim(),
      league,
    });
  });

  return schedule;
}

// Scrape recent results for a player (for auto result tracking)
export async function scrapePlayerResults(playerName: string, league: string = 'GT Leagues'): Promise<MatchEntry[]> {
  const stats = await scrapePlayerStats(playerName, league);
  return stats.lastMatches;
}
