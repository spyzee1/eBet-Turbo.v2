// Poisson Goal Distribution Model for Over/Under predictions
// Uses expected goals (lambda) to calculate probability of exact goal counts

// Poisson probability: P(k) = (lambda^k * e^-lambda) / k!
function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

// Calculate probability of exact total goals
export function totalGoalsProbability(
  lambdaA: number,  // expected goals for player A
  lambdaB: number,  // expected goals for player B
  maxGoals: number = 15
): number[] {
  // probs[n] = probability of exactly n total goals
  const probs: number[] = new Array(maxGoals + 1).fill(0);

  for (let a = 0; a <= maxGoals; a++) {
    const pA = poissonPmf(a, lambdaA);
    if (pA < 1e-10) break;
    for (let b = 0; b <= maxGoals - a; b++) {
      const pB = poissonPmf(b, lambdaB);
      if (pB < 1e-10) break;
      probs[a + b] += pA * pB;
    }
  }

  return probs;
}

// Over probability: P(total > line)
export function overProbability(lambdaA: number, lambdaB: number, line: number): number {
  const probs = totalGoalsProbability(lambdaA, lambdaB);
  let over = 0;
  for (let i = 0; i < probs.length; i++) {
    if (i > line) over += probs[i];
    else if (i === line) over += probs[i] * 0.5; // push at exact line
  }
  return Math.max(0.01, Math.min(0.99, over));
}

// Under probability
export function underProbability(lambdaA: number, lambdaB: number, line: number): number {
  return 1 - overProbability(lambdaA, lambdaB, line);
}

// BTTS probability: both teams score at least 1
export function bttsProbability(lambdaA: number, lambdaB: number): number {
  const pAScores = 1 - poissonPmf(0, lambdaA);
  const pBScores = 1 - poissonPmf(0, lambdaB);
  return pAScores * pBScores;
}

// Exact score probability
export function exactScoreProbability(goalsA: number, goalsB: number, lambdaA: number, lambdaB: number): number {
  return poissonPmf(goalsA, lambdaA) * poissonPmf(goalsB, lambdaB);
}

// Win/Draw/Loss probabilities from Poisson
export function matchOutcomeProbabilities(
  lambdaA: number,
  lambdaB: number,
  maxGoals: number = 12
): { winA: number; draw: number; winB: number } {
  let winA = 0, draw = 0, winB = 0;

  for (let a = 0; a <= maxGoals; a++) {
    const pA = poissonPmf(a, lambdaA);
    if (pA < 1e-10) break;
    for (let b = 0; b <= maxGoals; b++) {
      const pB = poissonPmf(b, lambdaB);
      if (pB < 1e-10) break;
      const p = pA * pB;
      if (a > b) winA += p;
      else if (a < b) winB += p;
      else draw += p;
    }
  }

  const total = winA + draw + winB;
  return {
    winA: winA / total,
    draw: draw / total,
    winB: winB / total,
  };
}

// Full O/U distribution for display
export function ouDistribution(
  lambdaA: number,
  lambdaB: number,
  lines: number[] = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]
): { line: number; over: number; under: number }[] {
  return lines.map(line => ({
    line,
    over: overProbability(lambdaA, lambdaB, line),
    under: underProbability(lambdaA, lambdaB, line),
  }));
}
