import { Liga, MatchInput, MatchResult, Settings } from './types';
import { overProbability, bttsProbability, matchOutcomeProbabilities } from './poisson';

export const DEFAULT_SETTINGS: Settings = {
  winRateSuly: 0.35,
  formaSuly: 0.25,
  h2hSuly: 0.15,
  tamadasSuly: 0.15,
  vedekezesSuly: 0.10,
  bankroll: 5000,
  minEdgeWin: 0.04,
  minEdgeOU: 0.05,
  gtTempoFaktor: 1.08,
  eAdriaticTempoFaktor: 0.96,
  alapTempoFaktor: 1.0,
  kellySzorzo: 0.25,
  maxStakePct: 0.03,
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function getLeagueWeights(liga: Liga, settings: Settings) {
  if (liga === 'GT Leagues') {
    return { wr: 0.25, forma: 0.15, h2h: 0.10, atk: 0.30, def: 0.20 };
  }
  if (liga === 'eAdriaticLeague') {
    return { wr: 0.40, forma: 0.30, h2h: 0.20, atk: 0.05, def: 0.05 };
  }
  return {
    wr: settings.winRateSuly,
    forma: settings.formaSuly,
    h2h: settings.h2hSuly,
    atk: settings.tamadasSuly,
    def: settings.vedekezesSuly,
  };
}

function getMinWinEdge(liga: Liga): number {
  if (liga === 'GT Leagues') return 0.06;
  if (liga === 'eAdriaticLeague') return 0.05;
  return 0.04;
}

function getOUSensitivity(liga: Liga): number {
  if (liga === 'GT Leagues') return 0.22;
  if (liga === 'eAdriaticLeague') return 0.15;
  return 0.18;
}

export interface EnhancedContext {
  eloA?: number;
  eloB?: number;
  h2hWinsA?: number;
  h2hWinsB?: number;
  h2hDraws?: number;
  h2hTotal?: number;
  // H2H goal stats (from totalcorner H2H scrape)
  h2hAvgGoalsA?: number;
  h2hAvgGoalsB?: number;
  h2hAvgTotalGoals?: number;
  h2hOverRates?: Record<string, number>; // line -> rate, e.g. "3.5" -> 0.62
}

const H2H_MIN_MATCHES = 5;

export function calculateMatch(input: MatchInput, settings: Settings, ctx?: EnhancedContext): MatchResult {
  const { liga, gfA, gaA, gfB, gaB, winRateA, winRateB, formaA, formaB, h2hA, h2hB, ouLine, oddsA, oddsB, oddsOver, oddsUnder } = input;

  // H2H-FIRST MODE DETECTION
  // If we have enough H2H data with goal stats, use pure H2H logic
  const h2hMode = !!(
    ctx?.h2hTotal && ctx.h2hTotal >= H2H_MIN_MATCHES &&
    ctx.h2hAvgGoalsA !== undefined &&
    ctx.h2hAvgGoalsB !== undefined
  );

  // Pace factor
  let paceFaktor = settings.alapTempoFaktor;
  if (liga === 'GT Leagues') paceFaktor = settings.gtTempoFaktor;
  if (liga === 'eAdriaticLeague') paceFaktor = settings.eAdriaticTempoFaktor;

  // Attack & Defense
  const atkA = (gfA + gaB) / 2;
  const atkB = (gfB + gaA) / 2;
  const defA = gfA + gaA > 0 ? 1 - gaA / (gaA + gfA) : 0.5;
  const defB = gfB + gaB > 0 ? 1 - gaB / (gaB + gfB) : 0.5;

  // Weighted score (original model)
  const w = getLeagueWeights(liga, settings);
  let scoreA: number, scoreB: number;
  let winEselyA: number, winEselyB: number;

  if (h2hMode && ctx) {
    // ======== H2H-FIRST MODE ========
    // Win probability directly from H2H win ratio (with draw weight)
    const total = ctx.h2hTotal!;
    const winsA = ctx.h2hWinsA || 0;
    const winsB = ctx.h2hWinsB || 0;
    const draws = ctx.h2hDraws || (total - winsA - winsB);
    // Laplace smoothing to avoid 0/100%
    winEselyA = (winsA + draws * 0.5 + 1) / (total + 2);
    winEselyB = (winsB + draws * 0.5 + 1) / (total + 2);
    const normTotal = winEselyA + winEselyB;
    winEselyA /= normTotal;
    winEselyB /= normTotal;
    // Score fields unused in H2H mode, fill with win probabilities for display
    scoreA = winEselyA;
    scoreB = winEselyB;
  } else {
    scoreA = w.wr * winRateA + w.forma * formaA + w.h2h * h2hA + w.atk * (atkA / 3) + w.def * defA;
    scoreB = w.wr * winRateB + w.forma * formaB + w.h2h * h2hB + w.atk * (atkB / 3) + w.def * defB;

    // Base win probability from weighted score
    const totalScore = scoreA + scoreB;
    winEselyA = totalScore > 0 ? scoreA / totalScore : 0.5;
    winEselyB = totalScore > 0 ? scoreB / totalScore : 0.5;
  }

  // --- POISSON MODEL ---
  const lambdaA = atkA * paceFaktor;
  const lambdaB = atkB * paceFaktor;

  let poissonOverEsely: number | undefined;
  let poissonUnderEsely: number | undefined;
  let poissonBtts: number | undefined;

  if (lambdaA > 0 && lambdaB > 0) {
    poissonOverEsely = overProbability(lambdaA, lambdaB, ouLine);
    poissonUnderEsely = 1 - poissonOverEsely;
    poissonBtts = bttsProbability(lambdaA, lambdaB);

    if (!h2hMode) {
      // Poisson win probabilities (skip in H2H mode)
      const poissonOutcome = matchOutcomeProbabilities(lambdaA, lambdaB);
      // Blend: 60% original model + 40% Poisson for win probability
      winEselyA = winEselyA * 0.6 + poissonOutcome.winA * 0.4;
      winEselyB = winEselyB * 0.6 + poissonOutcome.winB * 0.4;
      // Normalize
      const winTotal = winEselyA + winEselyB;
      winEselyA /= winTotal;
      winEselyB /= winTotal;
    }
  }

  // --- ELO BLEND ---
  let eloA: number | undefined, eloB: number | undefined;
  let eloProbA: number | undefined, eloProbB: number | undefined;

  if (ctx?.eloA && ctx?.eloB && !h2hMode) {
    eloA = ctx.eloA;
    eloB = ctx.eloB;
    eloProbA = 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
    eloProbB = 1 - eloProbA;
    // Blend: 75% model + 25% ELO
    winEselyA = winEselyA * 0.75 + eloProbA * 0.25;
    winEselyB = winEselyB * 0.75 + eloProbB * 0.25;
    const total = winEselyA + winEselyB;
    winEselyA /= total;
    winEselyB /= total;
  }

  // Implied probability from odds
  const impliedA = oddsA > 0 ? 1 / oddsA : 0;
  const impliedB = oddsB > 0 ? 1 / oddsB : 0;

  // Edge
  const edgeA = winEselyA - impliedA;
  const edgeB = winEselyB - impliedB;

  // Win tip
  const minWinEdge = getMinWinEdge(liga);
  let winTipp = 'PASS';
  if (edgeA >= minWinEdge || edgeB >= minWinEdge) {
    winTipp = edgeA >= edgeB ? 'A gyozelem' : 'B gyozelem';
  }

  // Expected goals
  let vartGolA: number;
  let vartGolB: number;
  if (h2hMode && ctx) {
    vartGolA = ctx.h2hAvgGoalsA || lambdaA;
    vartGolB = ctx.h2hAvgGoalsB || lambdaB;
  } else {
    vartGolA = lambdaA;
    vartGolB = lambdaB;
  }
  const vartOsszesGol = vartGolA + vartGolB;

  // --- Over/Under probability ---
  let overEsely: number;

  if (h2hMode && ctx?.h2hOverRates) {
    // H2H MODE: use direct H2H over rate for the nearest line
    const lineKey = String(ouLine);
    if (ctx.h2hOverRates[lineKey] !== undefined) {
      overEsely = ctx.h2hOverRates[lineKey];
    } else {
      // Interpolate from closest available line
      const available = Object.keys(ctx.h2hOverRates).map(parseFloat).sort((a, b) => a - b);
      const closest = available.reduce((a, b) => Math.abs(a - ouLine) < Math.abs(b - ouLine) ? a : b, available[0]);
      overEsely = ctx.h2hOverRates[String(closest)] ?? 0.5;
    }
    // Apply Laplace smoothing to avoid 0/100% with small samples
    const n = ctx.h2hTotal || 5;
    overEsely = (overEsely * n + 0.5) / (n + 1);
  } else {
    // Original blended model
    const sensitivity = getOUSensitivity(liga);
    const baseOver = liga === 'GT Leagues' ? 0.52 : liga === 'eAdriaticLeague' ? 0.48 : 0.50;
    const linearOver = clamp(baseOver + (vartOsszesGol - ouLine) * sensitivity, 0.05, 0.95);
    if (poissonOverEsely !== undefined) {
      overEsely = poissonOverEsely * 0.65 + linearOver * 0.35;
    } else {
      overEsely = linearOver;
    }
  }
  overEsely = clamp(overEsely, 0.05, 0.95);
  const underEsely = 1 - overEsely;

  // Implied O/U
  const impliedOver = oddsOver > 0 ? 1 / oddsOver : 0;
  const impliedUnder = oddsUnder > 0 ? 1 / oddsUnder : 0;

  const edgeOver = overEsely - impliedOver;
  const edgeUnder = underEsely - impliedUnder;

  // O/U tip
  let ouTipp = 'PASS';
  if (edgeOver >= settings.minEdgeOU || edgeUnder >= settings.minEdgeOU) {
    ouTipp = edgeOver >= edgeUnder ? 'OVER' : 'UNDER';
  }

  // Confidence
  let confidence: number;
  const maxWinEdge = Math.max(edgeA, edgeB);
  const maxOUEdge = Math.max(edgeOver, edgeUnder);
  if (liga === 'GT Leagues') {
    confidence = 0.48 + maxOUEdge * 1.9 + Math.abs(overEsely - 0.5) * 0.35 + maxWinEdge * 0.35;
  } else if (liga === 'eAdriaticLeague') {
    confidence = 0.48 + maxWinEdge * 2.1 + Math.abs(winEselyA - 0.5) * 0.45 + maxOUEdge * 0.25;
  } else {
    confidence = 0.48 + Math.max(maxWinEdge, maxOUEdge) * 1.8 + Math.abs(winEselyA - 0.5) * 0.3;
  }
  // ELO agreement bonus: if ELO and model agree, boost confidence
  if (eloProbA !== undefined) {
    const modelFavorsA = winEselyA > 0.5;
    const eloFavorsA = eloProbA > 0.5;
    if (modelFavorsA === eloFavorsA) confidence += 0.03;
  }
  confidence = clamp(confidence, 0, 0.95);

  // Value bet
  let valueBet = 'PASS';
  if (liga === 'GT Leagues') {
    if (ouTipp !== 'PASS') valueBet = ouTipp;
    else if (winTipp !== 'PASS') valueBet = winTipp;
  } else if (liga === 'eAdriaticLeague') {
    if (winTipp !== 'PASS') valueBet = winTipp;
    else if (ouTipp !== 'PASS') valueBet = ouTipp;
  } else {
    if (input.piacTipus === 'Win') {
      valueBet = winTipp !== 'PASS' ? winTipp : ouTipp;
    } else {
      valueBet = ouTipp !== 'PASS' ? ouTipp : winTipp;
    }
  }

  // Selected odds/probability/edge for Kelly
  let kivalasztottOdds = 0;
  let kivalasztottValoszinuseg = 0;
  let kivalasztottEdge = 0;

  if (valueBet === 'OVER') {
    kivalasztottOdds = oddsOver; kivalasztottValoszinuseg = overEsely; kivalasztottEdge = edgeOver;
  } else if (valueBet === 'UNDER') {
    kivalasztottOdds = oddsUnder; kivalasztottValoszinuseg = underEsely; kivalasztottEdge = edgeUnder;
  } else if (valueBet === 'A gyozelem') {
    kivalasztottOdds = oddsA; kivalasztottValoszinuseg = winEselyA; kivalasztottEdge = edgeA;
  } else if (valueBet === 'B gyozelem') {
    kivalasztottOdds = oddsB; kivalasztottValoszinuseg = winEselyB; kivalasztottEdge = edgeB;
  }

  // Kelly criterion
  let kellyPct = 0;
  if (kivalasztottOdds > 1 && kivalasztottValoszinuseg > 0) {
    const b = kivalasztottOdds - 1;
    kellyPct = ((b * kivalasztottValoszinuseg - (1 - kivalasztottValoszinuseg)) / b) * settings.kellySzorzo;
    kellyPct = clamp(kellyPct, 0, settings.maxStakePct);
  }

  const stakeFt = Math.max(0, Math.round(settings.bankroll * kellyPct));

  // Liga profile
  let ligaProfil = 'Altalanos';
  let preferaltPiac = 'Manualis piac';
  if (liga === 'GT Leagues') { ligaProfil = 'GT gol-fokusz'; preferaltPiac = 'Over/Under'; }
  else if (liga === 'eAdriaticLeague') { ligaProfil = 'eAdriatic win-fokusz'; preferaltPiac = 'Win'; }

  // Recommended tip
  let ajanlottTipp = 'PASS';
  if (valueBet !== 'PASS') {
    ajanlottTipp = `${valueBet} | conf ${Math.round(confidence * 100)}% | edge ${(kivalasztottEdge * 100).toFixed(1)}% | ${preferaltPiac}`;
  }

  return {
    input, paceFaktor,
    atkA, atkB, defA, defB,
    scoreA, scoreB,
    winEselyA, winEselyB,
    impliedA, impliedB,
    edgeA, edgeB, winTipp,
    vartGolA, vartGolB, vartOsszesGol,
    overEsely, underEsely,
    edgeOver, edgeUnder, ouTipp,
    confidence, valueBet,
    kivalasztottOdds, kivalasztottValoszinuseg, kivalasztottEdge,
    kellyPct, stakeFt, ajanlottTipp, ligaProfil, preferaltPiac,
    // Enhanced
    poissonOverEsely, poissonUnderEsely, poissonBtts,
    eloA, eloB, eloProbA, eloProbB,
    h2hWinsA: ctx?.h2hWinsA, h2hWinsB: ctx?.h2hWinsB, h2hTotal: ctx?.h2hTotal,
    h2hMode, h2hAvgGoalsA: ctx?.h2hAvgGoalsA, h2hAvgGoalsB: ctx?.h2hAvgGoalsB,
  };
}
