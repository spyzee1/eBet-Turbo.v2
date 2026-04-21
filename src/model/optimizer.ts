// Grid Search Optimizer: finds optimal model weights via backtesting
// Tests combinations of weights and returns the best performing set

import { runBacktest, BacktestMatch, BacktestResult } from './backtest';
import { Settings } from './types';
import { DEFAULT_SETTINGS } from './calculator';

export interface OptimizationResult {
  bestSettings: Settings;
  bestROI: number;
  bestHitRate: number;
  totalCombinations: number;
  testedCombinations: number;
  allResults: { settings: Partial<Settings>; roi: number; hitRate: number; bets: number }[];
}

// Generate weight combinations that sum to ~1.0
function* weightCombinations(steps: number[] = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40]): Generator<{
  wr: number; forma: number; h2h: number; atk: number; def: number;
}> {
  for (const wr of steps) {
    for (const forma of steps) {
      for (const h2h of steps) {
        for (const atk of steps) {
          const def = 1 - wr - forma - h2h - atk;
          if (def >= 0.05 && def <= 0.40) {
            yield { wr, forma, h2h, atk, def: Math.round(def * 100) / 100 };
          }
        }
      }
    }
  }
}

// Kelly multiplier and edge threshold optimization
function* kellyCombinations(): Generator<{ kelly: number; minEdgeWin: number; minEdgeOU: number }> {
  for (const kelly of [0.15, 0.20, 0.25, 0.30, 0.35]) {
    for (const minEdgeWin of [0.03, 0.04, 0.05, 0.06, 0.07]) {
      for (const minEdgeOU of [0.03, 0.04, 0.05, 0.06, 0.07]) {
        yield { kelly, minEdgeWin, minEdgeOU };
      }
    }
  }
}

export function optimizeWeights(
  matches: BacktestMatch[],
  mode: 'weights' | 'kelly' | 'both' = 'weights',
  progressCallback?: (pct: number) => void
): OptimizationResult {
  const allResults: OptimizationResult['allResults'] = [];
  let bestROI = -Infinity;
  let bestSettings = { ...DEFAULT_SETTINGS };
  let bestHitRate = 0;
  let totalCombinations = 0;
  let testedCombinations = 0;

  if (mode === 'weights' || mode === 'both') {
    // Count total
    const combos: ReturnType<typeof weightCombinations extends () => Generator<infer T> ? () => Generator<T> : never>[] = [];
    for (const w of weightCombinations()) {
      combos.push(w as never);
      totalCombinations++;
    }

    for (const w of weightCombinations()) {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        winRateSuly: w.wr,
        formaSuly: w.forma,
        h2hSuly: w.h2h,
        tamadasSuly: w.atk,
        vedekezesSuly: w.def,
      };

      const result = runBacktest(matches, settings);
      testedCombinations++;

      if (result.totalBets >= 5) {
        allResults.push({
          settings: { winRateSuly: w.wr, formaSuly: w.forma, h2hSuly: w.h2h, tamadasSuly: w.atk, vedekezesSuly: w.def },
          roi: result.roi,
          hitRate: result.hitRate,
          bets: result.totalBets,
        });

        if (result.roi > bestROI) {
          bestROI = result.roi;
          bestSettings = settings;
          bestHitRate = result.hitRate;
        }
      }

      if (progressCallback && testedCombinations % 50 === 0) {
        progressCallback(testedCombinations / totalCombinations);
      }
    }
  }

  if (mode === 'kelly' || mode === 'both') {
    const baseSettings = mode === 'both' ? bestSettings : DEFAULT_SETTINGS;

    for (const k of kellyCombinations()) {
      const settings: Settings = {
        ...baseSettings,
        kellySzorzo: k.kelly,
        minEdgeWin: k.minEdgeWin,
        minEdgeOU: k.minEdgeOU,
      };

      const result = runBacktest(matches, settings);
      testedCombinations++;
      totalCombinations++;

      if (result.totalBets >= 5) {
        allResults.push({
          settings: { kellySzorzo: k.kelly, minEdgeWin: k.minEdgeWin, minEdgeOU: k.minEdgeOU },
          roi: result.roi,
          hitRate: result.hitRate,
          bets: result.totalBets,
        });

        if (result.roi > bestROI) {
          bestROI = result.roi;
          bestSettings = settings;
          bestHitRate = result.hitRate;
        }
      }
    }
  }

  // Sort by ROI descending
  allResults.sort((a, b) => b.roi - a.roi);

  return {
    bestSettings,
    bestROI,
    bestHitRate,
    totalCombinations,
    testedCombinations,
    allResults: allResults.slice(0, 50), // top 50
  };
}

// Quick optimization with fewer steps (for real-time use)
export function quickOptimize(matches: BacktestMatch[]): BacktestResult & { optimizedSettings: Settings } {
  const coarseSteps = [0.10, 0.20, 0.30, 0.40];
  let bestROI = -Infinity;
  let bestSettings = DEFAULT_SETTINGS;
  let bestResult: BacktestResult | null = null;

  for (const wr of coarseSteps) {
    for (const forma of coarseSteps) {
      for (const h2h of [0.05, 0.10, 0.15, 0.20]) {
        const atk = Math.round((1 - wr - forma - h2h) * 0.6 * 100) / 100;
        const def = Math.round((1 - wr - forma - h2h - atk) * 100) / 100;
        if (atk < 0.05 || def < 0.05) continue;

        const settings: Settings = {
          ...DEFAULT_SETTINGS,
          winRateSuly: wr, formaSuly: forma, h2hSuly: h2h,
          tamadasSuly: atk, vedekezesSuly: def,
        };

        const result = runBacktest(matches, settings);
        if (result.totalBets >= 3 && result.roi > bestROI) {
          bestROI = result.roi;
          bestSettings = settings;
          bestResult = result;
        }
      }
    }
  }

  return { ...(bestResult || runBacktest([], DEFAULT_SETTINGS)), optimizedSettings: bestSettings };
}
