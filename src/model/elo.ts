// ELO Rating System for FIFA eSport players
// K-factor is higher for fewer matches (more volatile early on)

const BASE_ELO = 1500;
const K_NEW = 40;      // K-factor for players with < 30 matches
const K_NORMAL = 24;   // K-factor for established players
const K_VETERAN = 16;  // K-factor for players with > 200 matches

export interface EloPlayer {
  name: string;
  elo: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  lastUpdated: number;
}

export interface EloStore {
  players: Record<string, EloPlayer>;
}

function getK(matches: number): number {
  if (matches < 30) return K_NEW;
  if (matches > 200) return K_VETERAN;
  return K_NORMAL;
}

function expectedScore(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

export function getOrCreatePlayer(store: EloStore, name: string): EloPlayer {
  const key = name.toLowerCase();
  if (!store.players[key]) {
    store.players[key] = {
      name,
      elo: BASE_ELO,
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      lastUpdated: Date.now(),
    };
  }
  return store.players[key];
}

export function updateElo(
  store: EloStore,
  playerA: string,
  playerB: string,
  scoreA: number,
  scoreB: number
): { eloA: number; eloB: number; deltaA: number; deltaB: number } {
  const a = getOrCreatePlayer(store, playerA);
  const b = getOrCreatePlayer(store, playerB);

  const expA = expectedScore(a.elo, b.elo);
  const expB = expectedScore(b.elo, a.elo);

  // Actual score: 1 for win, 0.5 for draw, 0 for loss
  let actualA: number, actualB: number;
  if (scoreA > scoreB) {
    actualA = 1; actualB = 0;
    a.wins++; b.losses++;
  } else if (scoreA < scoreB) {
    actualA = 0; actualB = 1;
    a.losses++; b.wins++;
  } else {
    actualA = 0.5; actualB = 0.5;
    a.draws++; b.draws++;
  }

  // Goal difference bonus: up to 50% extra K for large margins
  const goalDiff = Math.abs(scoreA - scoreB);
  const gdMultiplier = 1 + Math.min(goalDiff * 0.1, 0.5);

  const kA = getK(a.matches) * gdMultiplier;
  const kB = getK(b.matches) * gdMultiplier;

  const deltaA = Math.round(kA * (actualA - expA));
  const deltaB = Math.round(kB * (actualB - expB));

  a.elo += deltaA;
  b.elo += deltaB;
  a.matches++;
  b.matches++;
  a.lastUpdated = Date.now();
  b.lastUpdated = Date.now();

  return { eloA: a.elo, eloB: b.elo, deltaA, deltaB };
}

// Convert ELO difference to win probability
export function eloToWinProbability(eloA: number, eloB: number): number {
  return expectedScore(eloA, eloB);
}

// Initialize ELO from scraped match history
export function initializeFromHistory(
  store: EloStore,
  matches: { playerA: string; playerB: string; scoreA: number; scoreB: number }[]
): void {
  // Process matches chronologically
  for (const m of matches) {
    updateElo(store, m.playerA, m.playerB, m.scoreA, m.scoreB);
  }
}

// Persistence
const ELO_STORAGE_KEY = 'esport-bet-elo';

export function loadEloStore(): EloStore {
  try {
    const raw = localStorage.getItem(ELO_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* empty */ }
  return { players: {} };
}

export function saveEloStore(store: EloStore): void {
  localStorage.setItem(ELO_STORAGE_KEY, JSON.stringify(store));
}
