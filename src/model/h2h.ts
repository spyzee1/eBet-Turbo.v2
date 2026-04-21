// Head-to-Head calculator from match history data

export interface H2HRecord {
  playerA: string;
  playerB: string;
  totalMatches: number;
  winsA: number;
  winsB: number;
  draws: number;
  avgGoalsA: number;
  avgGoalsB: number;
  h2hRatioA: number;  // 0-1 range, for model input
  h2hRatioB: number;
  lastMatches: { scoreA: number; scoreB: number; date: string }[];
}

export interface MatchData {
  opponent: string;
  scoreHome: number;
  scoreAway: number;
  result: 'win' | 'loss' | 'draw';
  date: string;
}

export function calculateH2H(
  playerA: string,
  playerB: string,
  matchesA: MatchData[],
  matchesB: MatchData[]
): H2HRecord {
  // Find matches where A played vs B
  const h2hFromA = matchesA.filter(m =>
    m.opponent.toLowerCase() === playerB.toLowerCase()
  );

  // Find matches where B played vs A
  const h2hFromB = matchesB.filter(m =>
    m.opponent.toLowerCase() === playerA.toLowerCase()
  );

  // Merge and deduplicate by date
  const seen = new Set<string>();
  const allH2H: { scoreA: number; scoreB: number; date: string }[] = [];

  for (const m of h2hFromA) {
    const key = `${m.date}-${m.scoreHome}-${m.scoreAway}`;
    if (!seen.has(key)) {
      seen.add(key);
      allH2H.push({ scoreA: m.scoreHome, scoreB: m.scoreAway, date: m.date });
    }
  }

  for (const m of h2hFromB) {
    // From B's perspective, home=B, away=A, so swap
    const key = `${m.date}-${m.scoreAway}-${m.scoreHome}`;
    if (!seen.has(key)) {
      seen.add(key);
      allH2H.push({ scoreA: m.scoreAway, scoreB: m.scoreHome, date: m.date });
    }
  }

  const totalMatches = allH2H.length;
  let winsA = 0, winsB = 0, draws = 0;
  let totalGoalsA = 0, totalGoalsB = 0;

  for (const m of allH2H) {
    totalGoalsA += m.scoreA;
    totalGoalsB += m.scoreB;
    if (m.scoreA > m.scoreB) winsA++;
    else if (m.scoreA < m.scoreB) winsB++;
    else draws++;
  }

  // H2H ratio: if no h2h data, default to 0.5
  let h2hRatioA = 0.5;
  let h2hRatioB = 0.5;
  if (totalMatches > 0) {
    // Weight: wins=1, draws=0.5, losses=0
    h2hRatioA = (winsA + draws * 0.5) / totalMatches;
    h2hRatioB = (winsB + draws * 0.5) / totalMatches;
  }

  return {
    playerA,
    playerB,
    totalMatches,
    winsA,
    winsB,
    draws,
    avgGoalsA: totalMatches > 0 ? totalGoalsA / totalMatches : 0,
    avgGoalsB: totalMatches > 0 ? totalGoalsB / totalMatches : 0,
    h2hRatioA,
    h2hRatioB,
    lastMatches: allH2H.slice(0, 10),
  };
}
