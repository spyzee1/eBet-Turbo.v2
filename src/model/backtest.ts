// Backtesting module: validate model predictions against historical results

import { calculateMatch } from './calculator';
import { Settings } from './types';
import { DEFAULT_SETTINGS } from './calculator';

export interface BacktestMatch {
  playerA: string;
  playerB: string;
  liga: string;
  oddsA: number;
  oddsB: number;
  oddsOver: number;
  oddsUnder: number;
  gfA: number;
  gaA: number;
  gfB: number;
  gaB: number;
  winRateA: number;
  winRateB: number;
  formaA: number;
  formaB: number;
  ouLine: number;
  // Actual result
  actualScoreA: number;
  actualScoreB: number;
}

export interface BacktestResult {
  totalMatches: number;
  totalBets: number;
  winBets: number;
  lossBets: number;
  passCount: number;
  hitRate: number;
  roi: number;
  totalStaked: number;
  totalProfit: number;
  byMarket: {
    win: { bets: number; wins: number; hitRate: number; roi: number };
    overUnder: { bets: number; wins: number; hitRate: number; roi: number };
  };
  byConfidence: {
    high: { bets: number; wins: number; hitRate: number };   // > 75%
    medium: { bets: number; wins: number; hitRate: number };  // 60-75%
    low: { bets: number; wins: number; hitRate: number };     // < 60%
  };
  details: BacktestDetail[];
}

export interface BacktestDetail {
  playerA: string;
  playerB: string;
  prediction: string;
  confidence: number;
  edge: number;
  odds: number;
  stake: number;
  actualScoreA: number;
  actualScoreB: number;
  betWon: boolean;
  profit: number;
}

export function runBacktest(
  matches: BacktestMatch[],
  settings: Settings = DEFAULT_SETTINGS
): BacktestResult {
  const details: BacktestDetail[] = [];

  let winBets = 0, lossBets = 0, passCount = 0;
  let totalStaked = 0, totalProfit = 0;
  const winMarket = { bets: 0, wins: 0, staked: 0, profit: 0 };
  const ouMarket = { bets: 0, wins: 0, staked: 0, profit: 0 };
  const confBuckets = {
    high: { bets: 0, wins: 0 },
    medium: { bets: 0, wins: 0 },
    low: { bets: 0, wins: 0 },
  };

  for (const m of matches) {
    const result = calculateMatch({
      id: 'backtest',
      liga: m.liga as 'GT Leagues' | 'eAdriaticLeague' | 'Other',
      percek: m.liga === 'GT Leagues' ? 12 : m.liga === 'eAdriaticLeague' ? 10 : 8,
      piacTipus: m.liga === 'GT Leagues' ? 'Over/Under' : 'Win',
      playerA: m.playerA,
      playerB: m.playerB,
      oddsA: m.oddsA,
      oddsB: m.oddsB,
      gfA: m.gfA,
      gaA: m.gaA,
      gfB: m.gfB,
      gaB: m.gaB,
      winRateA: m.winRateA,
      winRateB: m.winRateB,
      formaA: m.formaA,
      formaB: m.formaB,
      h2hA: 0.5,
      h2hB: 0.5,
      ouLine: m.ouLine,
      oddsOver: m.oddsOver,
      oddsUnder: m.oddsUnder,
    }, settings);

    if (result.valueBet === 'PASS') {
      passCount++;
      continue;
    }

    const totalGoals = m.actualScoreA + m.actualScoreB;
    const aWon = m.actualScoreA > m.actualScoreB;
    const bWon = m.actualScoreB > m.actualScoreA;

    let betWon = false;
    if (result.valueBet === 'A gyozelem') betWon = aWon;
    else if (result.valueBet === 'B gyozelem') betWon = bWon;
    else if (result.valueBet === 'OVER') betWon = totalGoals > m.ouLine;
    else if (result.valueBet === 'UNDER') betWon = totalGoals < m.ouLine;

    const profit = betWon
      ? result.stakeFt * (result.kivalasztottOdds - 1)
      : -result.stakeFt;

    totalStaked += result.stakeFt;
    totalProfit += profit;

    if (betWon) winBets++;
    else lossBets++;

    // Market tracking
    const isWinBet = result.valueBet.includes('gyozelem');
    if (isWinBet) {
      winMarket.bets++;
      winMarket.staked += result.stakeFt;
      winMarket.profit += profit;
      if (betWon) winMarket.wins++;
    } else {
      ouMarket.bets++;
      ouMarket.staked += result.stakeFt;
      ouMarket.profit += profit;
      if (betWon) ouMarket.wins++;
    }

    // Confidence buckets
    const bucket = result.confidence >= 0.75 ? 'high' : result.confidence >= 0.6 ? 'medium' : 'low';
    confBuckets[bucket].bets++;
    if (betWon) confBuckets[bucket].wins++;

    details.push({
      playerA: m.playerA,
      playerB: m.playerB,
      prediction: result.valueBet,
      confidence: result.confidence,
      edge: result.kivalasztottEdge,
      odds: result.kivalasztottOdds,
      stake: result.stakeFt,
      actualScoreA: m.actualScoreA,
      actualScoreB: m.actualScoreB,
      betWon,
      profit,
    });
  }

  const totalBets = winBets + lossBets;
  const safeDiv = (a: number, b: number) => b > 0 ? a / b : 0;

  return {
    totalMatches: matches.length,
    totalBets,
    winBets,
    lossBets,
    passCount,
    hitRate: safeDiv(winBets, totalBets),
    roi: safeDiv(totalProfit, totalStaked),
    totalStaked,
    totalProfit,
    byMarket: {
      win: {
        bets: winMarket.bets,
        wins: winMarket.wins,
        hitRate: safeDiv(winMarket.wins, winMarket.bets),
        roi: safeDiv(winMarket.profit, winMarket.staked),
      },
      overUnder: {
        bets: ouMarket.bets,
        wins: ouMarket.wins,
        hitRate: safeDiv(ouMarket.wins, ouMarket.bets),
        roi: safeDiv(ouMarket.profit, ouMarket.staked),
      },
    },
    byConfidence: {
      high: { ...confBuckets.high, hitRate: safeDiv(confBuckets.high.wins, confBuckets.high.bets) },
      medium: { ...confBuckets.medium, hitRate: safeDiv(confBuckets.medium.wins, confBuckets.medium.bets) },
      low: { ...confBuckets.low, hitRate: safeDiv(confBuckets.low.wins, confBuckets.low.bets) },
    },
    details,
  };
}
