// ============================================================================
// TOTALCORNER SCRAPER
// ============================================================================
// Scrapes player statistics and O/U data from totalcorner.com
// Supports: Esports Volta (6p), H2H GG League (8p), and all other leagues

import axios from 'axios';
import * as cheerio from 'cheerio';

// ============================================================================
// TYPES
// ============================================================================

export interface TotalCornerPlayer {
  name: string;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  avgGF: number;
  avgGA: number;
  points: number;
  winRate: number;
  forma: number;
  ouStats: { line: string; over: number; under: number }[];
}

export interface TotalCornerSchedule {
  time: string;
  date: string;
  playerHome: string;
  teamHome: string;
  playerAway: string;
  teamAway: string;
  scoreHome?: number;
  scoreAway?: number;
  league: string;
}

// ============================================================================
// LEAGUE CONFIGURATION
// ============================================================================

export const TOTALCORNER_LEAGUES = {
  'GT Leagues': { id: '12985', minutes: 12 },
  'Esoccer Battle': { id: '12995', minutes: 8 },
  'Cyber Live Arena': { id: '13321', minutes: 10 },
  'Esports Volta': { id: '38895', minutes: 6 },
  'Esoccer H2H GG League': { id: '37552', minutes: 8 },
} as const;

export type TotalCornerLeague = keyof typeof TOTALCORNER_LEAGUES;

const BASE_URL = 'https://www.totalcorner.com';

// ============================================================================
// SCRAPER FUNCTIONS
// ============================================================================

/**
 * Scrape player statistics from TotalCorner
 */
export async function scrapePlayerStats(league: TotalCornerLeague): Promise<TotalCornerPlayer[]> {
  const leagueConfig = TOTALCORNER_LEAGUES[league];
  const url = `${BASE_URL}/league/view/${leagueConfig.id}`;
  
  console.log(`🔍 Scraping ${league} player stats from ${url}...`);
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    const $ = cheerio.load(response.data);
    const players: TotalCornerPlayer[] = [];
    
    // Find the "Players Statistics" table (may have <p> between h2 and table)
    const playerTable = $('h2:contains("Players Statistics")').nextAll('table').first();
    
    if (playerTable.length === 0) {
      console.warn('⚠️  Player statistics table not found');
      return [];
    }
    
    // Parse player rows
    playerTable.find('tbody tr').each((idx, row) => {
      const cells = $(row).find('td');
      
      if (cells.length < 11) return; // Skip invalid rows
      
      const playerLink = $(cells[1]).find('a');
      const name = playerLink.text().trim();
      
      if (!name) return;
      
      const matches = parseInt($(cells[2]).text().trim()) || 0;
      const wins = parseInt($(cells[3]).text().trim()) || 0;
      const draws = parseInt($(cells[4]).text().trim()) || 0;
      const losses = parseInt($(cells[5]).text().trim()) || 0;
      const gf = parseInt($(cells[6]).text().trim()) || 0;
      const ga = parseInt($(cells[7]).text().trim()) || 0;
      const avgGF = parseFloat($(cells[8]).text().trim()) || 0;
      const avgGA = parseFloat($(cells[9]).text().trim()) || 0;
      const points = parseInt($(cells[11]).text().trim()) || 0;
      
      const winRate = matches > 0 ? wins / matches : 0;
      const forma = matches > 0 ? points / (matches * 3) : 0; // Normalize to 0-1
      
      players.push({
        name,
        matches,
        wins,
        draws,
        losses,
        gf,
        ga,
        avgGF,
        avgGA,
        points,
        winRate,
        forma,
        ouStats: [], // Will be filled by scrapeOUStats
      });
    });
    
    console.log(`✅ Scraped ${players.length} players from ${league}`);
    return players;
    
  } catch (error) {
    console.error(`❌ Error scraping ${league}:`, error);
    return [];
  }
}

/**
 * Scrape O/U statistics from TotalCorner
 */
export async function scrapeOUStats(league: TotalCornerLeague): Promise<Map<string, { line: string; over: number; under: number }[]>> {
  const leagueConfig = TOTALCORNER_LEAGUES[league];
  const url = `${BASE_URL}/league/view/${leagueConfig.id}`;
  
  console.log(`🔍 Scraping ${league} O/U stats from ${url}...`);
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    const $ = cheerio.load(response.data);
    const ouStatsMap = new Map<string, { line: string; over: number; under: number }[]>();
    
    // Find the "Total Goals Statistics & Prediction" table (may have <p> between h2 and table)
    const ouTable = $('h2:contains("Total Goals Statistics")').nextAll('table').first();
    
    if (ouTable.length === 0) {
      console.warn('⚠️  O/U statistics table not found');
      return ouStatsMap;
    }
    
    // Parse O/U rows
    ouTable.find('tbody tr').each((idx, row) => {
      const cells = $(row).find('td');
      
      if (cells.length < 14) return; // Skip invalid rows
      
      const playerLink = $(cells[1]).find('a');
      const name = playerLink.text().trim();
      
      if (!name) return;
      
      const ouStats: { line: string; over: number; under: number }[] = [];
      
      // Parse Over percentages for different lines
      // Columns: 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5
      const lines = ['1.5', '2.5', '3.5', '4.5', '5.5', '6.5', '7.5', '8.5', '9.5', '10.5'];
      
      for (let i = 0; i < lines.length; i++) {
        const overText = $(cells[4 + i]).text().trim();
        const overPct = parseFloat(overText.replace('%', '')) / 100;
        
        if (!isNaN(overPct)) {
          ouStats.push({
            line: lines[i],
            over: overPct,
            under: 1 - overPct,
          });
        }
      }
      
      ouStatsMap.set(name, ouStats);
    });
    
    console.log(`✅ Scraped O/U stats for ${ouStatsMap.size} players`);
    return ouStatsMap;
    
  } catch (error) {
    console.error(`❌ Error scraping O/U stats:`, error);
    return ouStatsMap;
  }
}

/**
 * Scrape schedule from TotalCorner
 */
export async function scrapeSchedule(league: TotalCornerLeague): Promise<TotalCornerSchedule[]> {
  const leagueConfig = TOTALCORNER_LEAGUES[league];
  const url = `${BASE_URL}/league/view/${leagueConfig.id}`;
  
  console.log(`🔍 Scraping ${league} schedule from ${url}...`);
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    const $ = cheerio.load(response.data);
    const schedule: TotalCornerSchedule[] = [];
    
    // Find the schedule table (after "Schedule and Results" heading).
    // TotalCorner injects a hidden empty table first — skip it with .not('[style*="display:none"]')
    const scheduleTable = $('h2:contains("Schedule and Results")')
      .nextAll('table')
      .not('[style*="display:none"]')
      .first();
    
    if (scheduleTable.length === 0) {
      console.warn('⚠️  Schedule table not found');
      return [];
    }
    
    // Parse schedule rows
    scheduleTable.find('tbody tr').each((idx, row) => {
      const cells = $(row).find('td');
      
      if (cells.length < 5) return; // Skip invalid rows
      
      const timeText = $(cells[0]).text().trim();
      const homeTeamText = $(cells[2]).text().trim();
      const scoreText = $(cells[3]).text().trim();
      const awayTeamText = $(cells[4]).text().trim();
      
      // Extract player name from team text (e.g. "River Plate (Groma)" -> "Groma")
      const homeMatch = homeTeamText.match(/\(([^)]+)\)/);
      const awayMatch = awayTeamText.match(/\(([^)]+)\)/);
      
      if (!homeMatch || !awayMatch) return;
      
      const playerHome = homeMatch[1];
      const playerAway = awayMatch[1];
      const teamHome = homeTeamText.replace(/\s*\([^)]+\)/, '').trim();
      const teamAway = awayTeamText.replace(/\s*\([^)]+\)/, '').trim();
      
      // Parse score if available
      const scoreMatch = scoreText.match(/(\d+)\s*-\s*(\d+)/);
      const scoreHome = scoreMatch ? parseInt(scoreMatch[1]) : undefined;
      const scoreAway = scoreMatch ? parseInt(scoreMatch[2]) : undefined;
      
      // Parse date and time
      const [date, time] = timeText.split(' ');
      
      schedule.push({
        time: time || timeText,
        date: date || new Date().toISOString().split('T')[0],
        playerHome,
        teamHome,
        playerAway,
        teamAway,
        scoreHome,
        scoreAway,
        league,
      });
    });
    
    console.log(`✅ Scraped ${schedule.length} matches from schedule`);
    return schedule;
    
  } catch (error) {
    console.error(`❌ Error scraping schedule:`, error);
    return [];
  }
}

/**
 * Scrape full player data (stats + O/U)
 */
export async function scrapeFullPlayerData(league: TotalCornerLeague): Promise<TotalCornerPlayer[]> {
  console.log(`\n🚀 Scraping full player data for ${league}...`);
  
  // Scrape player stats
  const players = await scrapePlayerStats(league);
  
  if (players.length === 0) {
    console.warn('⚠️  No players found');
    return [];
  }
  
  // Scrape O/U stats
  const ouStatsMap = await scrapeOUStats(league);
  
  // Merge O/U stats into players
  players.forEach(player => {
    const ouStats = ouStatsMap.get(player.name);
    if (ouStats) {
      player.ouStats = ouStats;
    }
  });
  
  console.log(`\n✅ Total players scraped: ${players.length}`);
  console.log(`   - Players with O/U data: ${players.filter(p => p.ouStats.length > 0).length}`);
  
  return players;
}

/**
 * Get best players (top N by points)
 */
export async function getBestPlayers(league: TotalCornerLeague, limit: number = 50): Promise<TotalCornerPlayer[]> {
  const players = await scrapeFullPlayerData(league);
  
  return players
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

// ============================================================================
// EXPORTS
// ============================================================================

export type { TotalCornerPlayer, TotalCornerSchedule, TotalCornerLeague };

export default {
  scrapePlayerStats,
  scrapeOUStats,
  scrapeSchedule,
  scrapeFullPlayerData,
  getBestPlayers,
  TOTALCORNER_LEAGUES,
};