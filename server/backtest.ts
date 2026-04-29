import { scrapePlayerStats, scrapeBestPlayers, PlayerStats } from './scraper.js';
import { calculateMatch } from '../src/model/calculator.js';
import { estimateMatchOdds } from '../src/model/fairOdds.js';
import { Strategy } from '../src/model/strategies.js';

interface BacktestMatch {
  date: string;
  playerA: string;
  playerB: string;
  teamA: string;
  teamB: string;
  scoreA: number;
  scoreB: number;
  league: string;
  statsA: PlayerStats;
  statsB: PlayerStats;
}

export interface BacktestResult {
  strategy: Strategy;
  period: string;
  totalMatches: number;
  totalBets: number;
  wins: number;
  losses: number;
  passes: number;
  hitRate: number;
  roi: number;
  totalStaked: number;
  totalProfit: number;
  avgStake: number;
  finalBankroll: number;
  byMarket: {
    win: { bets: number; wins: number; hitRate: number; profit: number };
    overUnder: { bets: number; wins: number; hitRate: number; profit: number };
  };
  byConfidence: {
    high: { bets: number; wins: number; hitRate: number; profit: number };
    mid: { bets: number; wins: number; hitRate: number; profit: number };
    low: { bets: number; wins: number; hitRate: number; profit: number };
  };
  details: Array<{
    date: string;
    playerA: string;
    playerB: string;
    scoreA: number;
    scoreB: number;
    prediction: string;
    confidence: number;
    edge: number;
    stake: number;
    odds: number;
    won: boolean | null;
    profit: number;
  }>;
}

export async function buildBacktestDataset(
  league: string,
  topN: number = 50
): Promise<BacktestMatch[]> {
  console.log(`🔍 Building backtest dataset for ${league}...`);
  
  const bestPlayers = await scrapeBestPlayers();
  const leaguePlayers = bestPlayers
    .filter(p => p.league === league)
    .slice(0, topN)
    .map(p => p.name);
  
  if (leaguePlayers.length === 0) {
    throw new Error(`No players found for league: ${league}`);
  }
  
  console.log(`📊 Scraping ${leaguePlayers.length} players (${topN} requested)...`);
  
  const allMatches: BacktestMatch[] = [];
  const seenMatchKeys = new Set<string>();
  
  let scrapedCount = 0;
  for (const playerName of leaguePlayers) {
    try {
      const stats = await scrapePlayerStats(playerName, league);
      scrapedCount++;
      
      if (scrapedCount % 10 === 0) {
        console.log(`  ⏳ Progress: ${scrapedCount}/${leaguePlayers.length} players...`);
      }
      
      for (const match of stats.lastMatches) {
        const key = `${match.date}|${playerName}|${match.opponent}`;
        const reverseKey = `${match.date}|${match.opponent}|${playerName}`;
        
        if (seenMatchKeys.has(key) || seenMatchKeys.has(reverseKey)) {
          continue;
        }
        
        seenMatchKeys.add(key);
        
        let oppStats: PlayerStats | null = null;
        try {
          oppStats = await scrapePlayerStats(match.opponent, league);
        } catch {
          continue;
        }
        
        allMatches.push({
          date: match.date,
          playerA: playerName,
          playerB: match.opponent,
          teamA: match.team,
          teamB: match.opponentTeam,
          scoreA: match.scoreHome,
          scoreB: match.scoreAway,
          league: league,
          statsA: stats,
          statsB: oppStats,
        });
      }
    } catch (err) {
      console.error(`  ❌ Failed to scrape ${playerName}:`, err instanceof Error ? err.message : 'Unknown');
    }
  }
  
  allMatches.sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    return dateA - dateB;
  });
  
  console.log(`✅ Dataset built: ${allMatches.length} unique matches`);
  if (allMatches.length > 0) {
    console.log(`📅 Date range: ${allMatches[0].date} → ${allMatches[allMatches.length - 1].date}`);
  }
  
  return allMatches;
}

function calculateKellyStake(
  probability: number,
  odds: number,
  bankroll: number,
  fraction: number = 0.25
): number {
  const b = odds - 1;
  const p = probability;
  const q = 1 - p;
  const kellyPercent = (b * p - q) / b;
  
  if (kellyPercent <= 0) return 0;
  
  const stake = bankroll * kellyPercent * fraction;
  const maxStake = bankroll * 0.10;
  
  return Math.min(Math.round(stake), maxStake);
}

export function runBacktest(
  matches: BacktestMatch[],
  strategy: Strategy,
  initialBankroll: number = 50000
): BacktestResult {
  let currentBankroll = initialBankroll;
  let totalBets = 0;
  let wins = 0;
  let losses = 0;
  let passes = 0;
  let totalStaked = 0;
  let totalProfit = 0;
  
  const byMarket = {
    win: { bets: 0, wins: 0, profit: 0 },
    ou: { bets: 0, wins: 0, profit: 0 },
  };
  
  const byConf = {
    high: { bets: 0, wins: 0, profit: 0 },
    mid: { bets: 0, wins: 0, profit: 0 },
    low: { bets: 0, wins: 0, profit: 0 },
  };
  
  const details: BacktestResult['details'] = [];
  
  const percek = matches[0]?.league === 'GT Leagues' ? 12 
    : matches[0]?.league === 'eAdriatic League' ? 10 
    : matches[0]?.league === 'Esoccer Battle' ? 8
    : 6;
  
  const liga = matches[0]?.league === 'GT Leagues' ? 'GT Leagues' as const
    : matches[0]?.league === 'eAdriatic League' ? 'eAdriaticLeague' as const
    : matches[0]?.league === 'Esoccer Battle' ? 'GT Leagues' as const
    : 'Other' as const;
  
  const marketType = liga === 'GT Leagues' ? 'Over/Under' : 'Win';
  
  console.log(`\n📊 Backtest config:`);
  console.log(`   League: ${matches[0]?.league}`);
  console.log(`   Liga type: ${liga}`);
  console.log(`   Market: ${marketType}`);
  console.log(`   Strategy: ${strategy.name}`);
  console.log(`   Settings: WR=${strategy.settings.winRateSuly}, Forma=${strategy.settings.formaSuly}, H2H=${strategy.settings.h2hSuly}`);
  console.log(`   Thresholds: minConf=${(strategy.settings.minConfidence * 100)}%, minEdge=${(strategy.settings.minEdge * 100)}%\n`);
  
  for (const match of matches) {
    const statsA = match.statsA;
    const statsB = match.statsB;
    
    const wrA = statsA.winRate > 0 ? statsA.winRate : (statsA.matches > 0 ? statsA.wins / statsA.matches : 0.5);
    const wrB = statsB.winRate > 0 ? statsB.winRate : (statsB.matches > 0 ? statsB.wins / statsB.matches : 0.5);
    const formaA = Math.max(0, Math.min(1, wrA + statsA.form10));
    const formaB = Math.max(0, Math.min(1, wrB + statsB.form10));
    
    const rawWinA = wrA / (wrA + wrB);
    const estimatedOdds = estimateMatchOdds(rawWinA, 1 - rawWinA, 0.55);
    
    const result = calculateMatch({
      id: `bt-${match.date}`,
      liga,
      percek,
      piacTipus: marketType,
      playerA: match.playerA,
      playerB: match.playerB,
      oddsA: estimatedOdds.oddsA,
      oddsB: estimatedOdds.oddsB,
      gfA: statsA.gfPerMatch,
      gaA: statsA.gaPerMatch,
      gfB: statsB.gfPerMatch,
      gaB: statsB.gaPerMatch,
      winRateA: wrA,
      winRateB: wrB,
      formaA,
      formaB,
      h2hA: 0.5,
      h2hB: 0.5,
      ouLine: 3.5,
      oddsOver: estimatedOdds.oddsOver,
      oddsUnder: estimatedOdds.oddsUnder,
    }, strategy.settings);
    
    if (totalBets + passes < 5) {
      console.log(`🔍 Match #${totalBets + passes + 1}: ${match.playerA} vs ${match.playerB}`);
      console.log(`   Confidence: ${(result.confidence * 100).toFixed(1)}%, Edge: ${(result.kivalasztottEdge * 100).toFixed(2)}%`);
      console.log(`   ValueBet: ${result.valueBet}`);
      if (result.valueBet === 'PASS') {
        const reason = result.confidence < strategy.settings.minConfidence 
          ? `Low confidence (${(result.confidence * 100).toFixed(1)}% < ${(strategy.settings.minConfidence * 100)}%)`
          : result.kivalasztottEdge < strategy.settings.minEdge 
          ? `Low edge (${(result.kivalasztottEdge * 100).toFixed(2)}% < ${(strategy.settings.minEdge * 100)}%)`
          : 'Unknown';
        console.log(`   → PASS: ${reason}`);
      }
    }
    
    const totalGoals = match.scoreA + match.scoreB;
    let won: boolean | null = null;
    let marketCat: 'win' | 'ou' = 'ou';
    
    if (result.valueBet === 'PASS') {
      passes++;
      details.push({
        date: match.date,
        playerA: match.playerA,
        playerB: match.playerB,
        scoreA: match.scoreA,
        scoreB: match.scoreB,
        prediction: 'PASS',
        confidence: result.confidence,
        edge: result.kivalasztottEdge,
        stake: 0,
        odds: 0,
        won: null,
        profit: 0,
      });
      continue;
    }
    
    if (result.valueBet === 'OVER') {
      won = totalGoals > 3.5;
      marketCat = 'ou';
    } else if (result.valueBet === 'UNDER') {
      won = totalGoals < 3.5;
      marketCat = 'ou';
    } else if (result.valueBet === 'A gyozelem') {
      won = match.scoreA > match.scoreB;
      marketCat = 'win';
    } else if (result.valueBet === 'B gyozelem') {
      won = match.scoreB > match.scoreA;
      marketCat = 'win';
    }
    
    let stake = result.stakeFt || 1000;
    if (strategy.kellyEnabled) {
      const kellyStake = calculateKellyStake(
        result.confidence,
        result.kivalasztottOdds,
        currentBankroll,
        0.25
      );
      stake = kellyStake > 0 ? kellyStake : 1000;
    }
    
    if (isNaN(stake) || stake <= 0) {
      stake = 1000;
    }
    
    const profit = won 
      ? stake * (result.kivalasztottOdds - 1)
      : -stake;
    
    totalBets++;
    if (won) wins++;
    else losses++;
    totalStaked += stake;
    totalProfit += profit;
    currentBankroll += profit;
    
    const market = marketCat === 'ou' ? byMarket.ou : byMarket.win;
    market.bets++;
    if (won) market.wins++;
    market.profit += profit;
    
    const conf = result.confidence;
    const bucket = conf >= 0.75 ? byConf.high : conf >= 0.6 ? byConf.mid : byConf.low;
    bucket.bets++;
    if (won) bucket.wins++;
    bucket.profit += profit;
    
    details.push({
      date: match.date,
      playerA: match.playerA,
      playerB: match.playerB,
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      prediction: result.valueBet,
      confidence: result.confidence,
      edge: result.kivalasztottEdge,
      stake,
      odds: result.kivalasztottOdds,
      won,
      profit,
    });
  }
  
  return {
    strategy,
    period: matches.length > 0 
      ? `${matches[0].date} → ${matches[matches.length - 1].date}`
      : 'No data',
    totalMatches: matches.length,
    totalBets,
    wins,
    losses,
    passes,
    hitRate: totalBets > 0 ? wins / totalBets : 0,
    roi: totalStaked > 0 ? totalProfit / totalStaked : 0,
    totalStaked,
    totalProfit,
    avgStake: totalBets > 0 ? totalStaked / totalBets : 0,
    finalBankroll: currentBankroll,
    byMarket: {
      win: {
        ...byMarket.win,
        hitRate: byMarket.win.bets > 0 ? byMarket.win.wins / byMarket.win.bets : 0,
      },
      overUnder: {
        ...byMarket.ou,
        hitRate: byMarket.ou.bets > 0 ? byMarket.ou.wins / byMarket.ou.bets : 0,
      },
    },
    byConfidence: {
      high: { 
        ...byConf.high, 
        hitRate: byConf.high.bets > 0 ? byConf.high.wins / byConf.high.bets : 0 
      },
      mid: { 
        ...byConf.mid, 
        hitRate: byConf.mid.bets > 0 ? byConf.mid.wins / byConf.mid.bets : 0 
      },
      low: { 
        ...byConf.low, 
        hitRate: byConf.low.bets > 0 ? byConf.low.wins / byConf.low.bets : 0 
      },
    },
    details: details.slice(-100),
  };
}