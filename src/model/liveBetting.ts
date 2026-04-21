// Live Betting Module
// Calculates 2nd half value based on halftime score vs expected

import { overProbability, matchOutcomeProbabilities } from './poisson';

export interface HalftimeInput {
  // Pre-match expected goals (full match)
  expectedGoalsA: number;
  expectedGoalsB: number;
  // Actual halftime score
  htScoreA: number;
  htScoreB: number;
  // Match format
  totalMinutes: number; // 8, 10, or 12
  // Original O/U line
  ouLine: number;
  // Live odds (if available)
  liveOddsOver?: number;
  liveOddsUnder?: number;
  liveOddsA?: number;
  liveOddsB?: number;
}

export interface LiveBetResult {
  // Adjusted 2nd half expected goals
  expected2hGoalsA: number;
  expected2hGoalsB: number;
  expectedTotalGoals: number;
  // Current score context
  goalsSoFar: number;
  goalsNeededForOver: number;
  // Probabilities
  overProb: number;
  underProb: number;
  winProbA: number;
  winProbB: number;
  drawProb: number;
  // Value detection
  overEdge: number;
  underEdge: number;
  winEdgeA: number;
  winEdgeB: number;
  // Recommendation
  liveTipp: string;
  confidence: number;
  reasoning: string;
}

export function calculateLiveBet(input: HalftimeInput): LiveBetResult {
  const {
    expectedGoalsA, expectedGoalsB,
    htScoreA, htScoreB,
    ouLine,
    liveOddsOver, liveOddsUnder, liveOddsA, liveOddsB,
  } = input;

  // Estimate 2nd half expected goals
  // Base: half of full match expected, adjusted by 1st half performance
  const halfFactor = 0.5;

  // 1st half goal ratio vs expected
  const htExpectedA = expectedGoalsA * halfFactor;
  const htExpectedB = expectedGoalsB * halfFactor;

  // Momentum adjustment: if player scored more than expected, slight boost
  const momentumA = htExpectedA > 0 ? Math.min(1.3, Math.max(0.7, htScoreA / htExpectedA)) : 1.0;
  const momentumB = htExpectedB > 0 ? Math.min(1.3, Math.max(0.7, htScoreB / htExpectedB)) : 1.0;

  // 2nd half lambda (adjusted by momentum)
  const expected2hGoalsA = expectedGoalsA * halfFactor * momentumA;
  const expected2hGoalsB = expectedGoalsB * halfFactor * momentumB;

  const goalsSoFar = htScoreA + htScoreB;
  const expectedTotalGoals = goalsSoFar + expected2hGoalsA + expected2hGoalsB;
  const goalsNeededForOver = Math.max(0, Math.ceil(ouLine) - goalsSoFar);

  // O/U probability for remaining goals
  const remainingLine = Math.max(0, ouLine - goalsSoFar);
  const overProb = overProbability(expected2hGoalsA, expected2hGoalsB, remainingLine);
  const underProb = 1 - overProb;

  // Win probability from current position + expected 2nd half
  // Full match expected final score
  const finalExpectedA = htScoreA + expected2hGoalsA;
  const finalExpectedB = htScoreB + expected2hGoalsB;
  const outcomes = matchOutcomeProbabilities(finalExpectedA, finalExpectedB);

  // Edge calculations (vs live odds if provided)
  const overEdge = liveOddsOver ? overProb - (1 / liveOddsOver) : 0;
  const underEdge = liveOddsUnder ? underProb - (1 / liveOddsUnder) : 0;
  const winEdgeA = liveOddsA ? outcomes.winA - (1 / liveOddsA) : 0;
  const winEdgeB = liveOddsB ? outcomes.winB - (1 / liveOddsB) : 0;

  // Determine recommendation
  let liveTipp = 'PASS';
  let confidence = 0.5;
  let reasoning = '';

  const edges = [
    { tip: 'OVER', edge: overEdge, prob: overProb },
    { tip: 'UNDER', edge: underEdge, prob: underProb },
    { tip: 'A győzelem', edge: winEdgeA, prob: outcomes.winA },
    { tip: 'B győzelem', edge: winEdgeB, prob: outcomes.winB },
  ];

  const bestEdge = edges.filter(e => e.edge > 0.03).sort((a, b) => b.edge - a.edge)[0];

  if (bestEdge) {
    liveTipp = bestEdge.tip;
    confidence = Math.min(0.95, 0.5 + bestEdge.edge * 2 + Math.abs(bestEdge.prob - 0.5) * 0.3);

    if (bestEdge.tip === 'OVER') {
      reasoning = `Várt össz. gól: ${expectedTotalGoals.toFixed(1)} (${goalsSoFar} + ${(expected2hGoalsA + expected2hGoalsB).toFixed(1)}). ` +
        `Még ${goalsNeededForOver} gól kell az Overhez. Over esély: ${Math.round(overProb * 100)}%.`;
    } else if (bestEdge.tip === 'UNDER') {
      reasoning = `Alacsony 2. félidő várható (${(expected2hGoalsA + expected2hGoalsB).toFixed(1)} gól). ` +
        `Under esély: ${Math.round(underProb * 100)}%.`;
    } else {
      const leading = htScoreA > htScoreB ? 'A' : htScoreB > htScoreA ? 'B' : 'döntetlen';
      reasoning = `Félidő: ${htScoreA}-${htScoreB} (${leading} vezet). ` +
        `Várható végeredmény: ${finalExpectedA.toFixed(1)}-${finalExpectedB.toFixed(1)}.`;
    }
  } else {
    reasoning = `Nincs elég erős edge. Várt végeredmény: ${(htScoreA + expected2hGoalsA).toFixed(1)}-${(htScoreB + expected2hGoalsB).toFixed(1)}.`;
  }

  return {
    expected2hGoalsA,
    expected2hGoalsB,
    expectedTotalGoals,
    goalsSoFar,
    goalsNeededForOver,
    overProb,
    underProb,
    winProbA: outcomes.winA,
    winProbB: outcomes.winB,
    drawProb: outcomes.draw,
    overEdge,
    underEdge,
    winEdgeA,
    winEdgeB,
    liveTipp,
    confidence,
    reasoning,
  };
}
