// Fair Odds Calculator
// Converts model probabilities to estimated bookmaker odds with margin

// Typical esport bookmaker margin: 5-8% (overround)
const DEFAULT_MARGIN = 0.06;

// Convert probability to fair (no margin) decimal odds
export function probToFairOdds(prob: number): number {
  if (prob <= 0) return 99;
  if (prob >= 1) return 1.01;
  return Math.round((1 / prob) * 100) / 100;
}

// Convert probability to bookmaker odds (with margin applied)
export function probToBookmakerOdds(prob: number, margin: number = DEFAULT_MARGIN): number {
  if (prob <= 0) return 99;
  if (prob >= 1) return 1.01;
  // Apply margin proportionally
  const adjustedProb = prob + (margin * prob);
  return Math.round((1 / adjustedProb) * 100) / 100;
}

// Convert decimal odds to implied probability
export function oddsToProb(odds: number): number {
  if (odds <= 1) return 1;
  return 1 / odds;
}

// Estimate realistic bookmaker odds for a match
export function estimateMatchOdds(
  winProbA: number,
  winProbB: number,
  overProb: number,
  margin: number = DEFAULT_MARGIN
): {
  oddsA: number;
  oddsB: number;
  oddsOver: number;
  oddsUnder: number;
  fairOddsA: number;
  fairOddsB: number;
  fairOddsOver: number;
  fairOddsUnder: number;
} {
  const underProb = 1 - overProb;

  return {
    oddsA: probToBookmakerOdds(winProbA, margin),
    oddsB: probToBookmakerOdds(winProbB, margin),
    oddsOver: probToBookmakerOdds(overProb, margin),
    oddsUnder: probToBookmakerOdds(underProb, margin),
    fairOddsA: probToFairOdds(winProbA),
    fairOddsB: probToFairOdds(winProbB),
    fairOddsOver: probToFairOdds(overProb),
    fairOddsUnder: probToFairOdds(underProb),
  };
}

// Detect value: compare model probability with actual bookmaker odds
export function detectValue(
  modelProb: number,
  bookmakerOdds: number,
  minEdge: number = 0.03
): { isValue: boolean; edge: number; expectedValue: number } {
  const impliedProb = oddsToProb(bookmakerOdds);
  const edge = modelProb - impliedProb;
  // EV = (prob * (odds - 1)) - (1 - prob) = prob * odds - 1
  const expectedValue = modelProb * bookmakerOdds - 1;
  return {
    isValue: edge >= minEdge,
    edge,
    expectedValue,
  };
}
