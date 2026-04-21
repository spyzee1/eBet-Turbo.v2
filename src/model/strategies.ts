import { Settings } from './types';

export interface Strategy {
  id: string;
  name: string;
  description: string;
  settings: Settings;
  kellyEnabled: boolean;
  h2hExpiryDays: number;
}

export const STRATEGY_A: Strategy = {
  id: 'A',
  name: 'Original Strategy',
  description: 'Eredeti algoritmus – azonos DEFAULT_SETTINGS súlyokkal',
  settings: {
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
  },
  kellyEnabled: false,
  h2hExpiryDays: 365,
};

export const STRATEGY_B: Strategy = {
  id: 'B',
  name: 'Enhanced Strategy 🏆',
  description: 'Módosított algoritmus – nagyobb H2H súly, Kelly Criterion, 6 hónapos H2H cutoff',
  settings: {
    winRateSuly: 0.20,
    formaSuly: 0.25,
    h2hSuly: 0.20,
    tamadasSuly: 0.20,
    vedekezesSuly: 0.15,
    bankroll: 5000,
    minEdgeWin: 0.03,
    minEdgeOU: 0.04,
    gtTempoFaktor: 1.08,
    eAdriaticTempoFaktor: 0.96,
    alapTempoFaktor: 1.0,
    kellySzorzo: 0.25,
    maxStakePct: 0.03,
  },
  kellyEnabled: true,
  h2hExpiryDays: 180,
};

export const STRATEGIES: Record<string, Strategy> = {
  A: STRATEGY_A,
  B: STRATEGY_B,
};
