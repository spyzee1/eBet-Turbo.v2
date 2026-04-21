export type Liga = 'GT Leagues' | 'eAdriaticLeague' | 'Other';
export type PiacTipus = 'Win' | 'Over/Under';

export interface Settings {
  winRateSuly: number;
  formaSuly: number;
  h2hSuly: number;
  tamadasSuly: number;
  vedekezesSuly: number;
  bankroll: number;
  minEdgeWin: number;
  minEdgeOU: number;
  gtTempoFaktor: number;
  eAdriaticTempoFaktor: number;
  alapTempoFaktor: number;
  kellySzorzo: number;
  maxStakePct: number;
}

export interface MatchInput {
  id: string;
  liga: Liga;
  percek: number;
  matchTime?: string; // "10:30" - meccs kezdési idő
  matchDate?: string; // "04/02" - meccs dátum
  piacTipus: PiacTipus;
  playerA: string;
  playerB: string;
  oddsA: number;
  oddsB: number;
  gfA: number;
  gaA: number;
  gfB: number;
  gaB: number;
  winRateA: number;
  winRateB: number;
  formaA: number;
  formaB: number;
  h2hA: number;
  h2hB: number;
  ouLine: number;
  oddsOver: number;
  oddsUnder: number;
}

export interface MatchResult {
  input: MatchInput;
  paceFaktor: number;
  atkA: number;
  atkB: number;
  defA: number;
  defB: number;
  scoreA: number;
  scoreB: number;
  winEselyA: number;
  winEselyB: number;
  impliedA: number;
  impliedB: number;
  edgeA: number;
  edgeB: number;
  winTipp: string;
  vartGolA: number;
  vartGolB: number;
  vartOsszesGol: number;
  overEsely: number;
  underEsely: number;
  edgeOver: number;
  edgeUnder: number;
  ouTipp: string;
  confidence: number;
  valueBet: string;
  kivalasztottOdds: number;
  kivalasztottValoszinuseg: number;
  kivalasztottEdge: number;
  kellyPct: number;
  stakeFt: number;
  ajanlottTipp: string;
  ligaProfil: string;
  preferaltPiac: string;
  // Enhanced model data
  poissonOverEsely?: number;
  poissonUnderEsely?: number;
  poissonBtts?: number;
  eloA?: number;
  eloB?: number;
  eloProbA?: number;
  eloProbB?: number;
  h2hWinsA?: number;
  h2hWinsB?: number;
  h2hTotal?: number;
  h2hMode?: boolean;
  h2hSource?: string; // 'totalcorner' | 'esoccerbet'
  h2hAvgGoalsA?: number;
  h2hAvgGoalsB?: number;
}
