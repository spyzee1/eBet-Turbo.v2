// Time-based performance factors
// FIFA esport players often perform differently based on time of day and day of week

export interface TimePerformance {
  hour: number;      // 0-23
  dayOfWeek: number; // 0=Sun, 6=Sat
  winRate: number;
  matches: number;
  gfAvg: number;
  gaAvg: number;
}

export interface MatchWithTime {
  result: 'win' | 'loss' | 'draw';
  scoreHome: number;
  scoreAway: number;
  date: string; // "MM/DD HH:MM" format from EsoccerBet
}

// Parse EsoccerBet date format "04/01 16:41"
function parseTime(dateStr: string): { hour: number; dayOfWeek: number } | null {
  const match = dateStr.match(/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, month, day, hourStr] = match;
  const hour = parseInt(hourStr);
  // Estimate day of week from date (approximate, current year)
  const now = new Date();
  const date = new Date(now.getFullYear(), parseInt(month) - 1, parseInt(day));
  return { hour, dayOfWeek: date.getDay() };
}

// Analyze time-based performance from match history
export function analyzeTimePerformance(matches: MatchWithTime[]): {
  byHour: Map<number, { wins: number; total: number; gf: number; ga: number }>;
  byDayOfWeek: Map<number, { wins: number; total: number; gf: number; ga: number }>;
  byPeriod: { morning: number; afternoon: number; evening: number; night: number };
} {
  const byHour = new Map<number, { wins: number; total: number; gf: number; ga: number }>();
  const byDayOfWeek = new Map<number, { wins: number; total: number; gf: number; ga: number }>();

  for (const m of matches) {
    const time = parseTime(m.date);
    if (!time) continue;

    // By hour
    if (!byHour.has(time.hour)) byHour.set(time.hour, { wins: 0, total: 0, gf: 0, ga: 0 });
    const h = byHour.get(time.hour)!;
    h.total++;
    h.gf += m.scoreHome;
    h.ga += m.scoreAway;
    if (m.result === 'win') h.wins++;

    // By day
    if (!byDayOfWeek.has(time.dayOfWeek)) byDayOfWeek.set(time.dayOfWeek, { wins: 0, total: 0, gf: 0, ga: 0 });
    const d = byDayOfWeek.get(time.dayOfWeek)!;
    d.total++;
    d.gf += m.scoreHome;
    d.ga += m.scoreAway;
    if (m.result === 'win') d.wins++;
  }

  // Aggregate periods
  const periodWr = (startHour: number, endHour: number) => {
    let wins = 0, total = 0;
    for (const [hr, data] of byHour) {
      if (hr >= startHour && hr < endHour) {
        wins += data.wins;
        total += data.total;
      }
    }
    return total > 0 ? wins / total : 0.5;
  };

  return {
    byHour,
    byDayOfWeek,
    byPeriod: {
      morning: periodWr(6, 12),
      afternoon: periodWr(12, 17),
      evening: periodWr(17, 22),
      night: periodWr(22, 6),
    },
  };
}

// Calculate time adjustment factor for a given match time
// Returns a multiplier for win probability (0.9 = weaker, 1.1 = stronger)
export function getTimeAdjustment(
  matchHour: number,
  playerPerformance: ReturnType<typeof analyzeTimePerformance>
): number {
  const hourData = playerPerformance.byHour.get(matchHour);
  if (!hourData || hourData.total < 3) return 1.0; // Not enough data

  // Calculate player's overall win rate
  let totalWins = 0, totalMatches = 0;
  for (const [, data] of playerPerformance.byHour) {
    totalWins += data.wins;
    totalMatches += data.total;
  }
  const overallWr = totalMatches > 0 ? totalWins / totalMatches : 0.5;
  const hourWr = hourData.wins / hourData.total;

  // Adjustment: ratio of hour performance vs overall
  // Clamped to ±15% adjustment
  const ratio = overallWr > 0 ? hourWr / overallWr : 1.0;
  return Math.max(0.85, Math.min(1.15, ratio));
}

// Get a human-readable summary
export function getTimeSummary(perf: ReturnType<typeof analyzeTimePerformance>): string[] {
  const insights: string[] = [];
  const { byPeriod } = perf;

  const periods = [
    { name: 'Reggel (6-12)', wr: byPeriod.morning },
    { name: 'Délután (12-17)', wr: byPeriod.afternoon },
    { name: 'Este (17-22)', wr: byPeriod.evening },
    { name: 'Éjszaka (22-6)', wr: byPeriod.night },
  ].filter(p => p.wr > 0);

  if (periods.length >= 2) {
    const best = periods.reduce((a, b) => a.wr > b.wr ? a : b);
    const worst = periods.reduce((a, b) => a.wr < b.wr ? a : b);
    if (best.wr - worst.wr > 0.1) {
      insights.push(`Legerősebb: ${best.name} (${Math.round(best.wr * 100)}%)`);
      insights.push(`Leggyengébb: ${worst.name} (${Math.round(worst.wr * 100)}%)`);
    }
  }

  const dayNames = ['Vasárnap', 'Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat'];
  const days = [...perf.byDayOfWeek.entries()]
    .filter(([, d]) => d.total >= 2)
    .map(([day, d]) => ({ name: dayNames[day], wr: d.wins / d.total }));

  if (days.length >= 2) {
    const bestDay = days.reduce((a, b) => a.wr > b.wr ? a : b);
    const worstDay = days.reduce((a, b) => a.wr < b.wr ? a : b);
    if (bestDay.wr - worstDay.wr > 0.1) {
      insights.push(`Legjobb nap: ${bestDay.name} (${Math.round(bestDay.wr * 100)}%)`);
    }
  }

  return insights;
}
