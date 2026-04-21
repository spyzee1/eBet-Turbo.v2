// Background scanner: runs top-tips analysis periodically and pushes new STRONG_BETs

import { pushTip, isTelegramConfigured, TipForTelegram } from './telegram.js';

export interface TopTipsResponse {
  generated: string;
  totalScanned: number;
  totalAnalyzed: number;
  totalValueBets: number;
  tips: TipForTelegram[];
}

interface ScannerState {
  lastResult: TopTipsResponse | null;
  lastRun: number;
  pushedKeys: Set<string>; // unique keys of tips already pushed
  errors: number;
}

const state: ScannerState = {
  lastResult: null,
  lastRun: 0,
  pushedKeys: new Set(),
  errors: 0,
};

let scanFn: (() => Promise<TopTipsResponse>) | null = null;
let intervalHandle: NodeJS.Timeout | null = null;

export function configureScanner(fn: () => Promise<TopTipsResponse>) {
  scanFn = fn;
}

function tipKey(tip: TipForTelegram): string {
  return `${tip.date}|${tip.time}|${[tip.playerA.toLowerCase(), tip.playerB.toLowerCase()].sort().join('-')}|${tip.valueBet}`;
}

export async function runScan(): Promise<TopTipsResponse | null> {
  if (!scanFn) return null;
  try {
    const result = await scanFn();
    state.lastResult = result;
    state.lastRun = Date.now();
    state.errors = 0;

    // Push new STRONG_BETs
    if (isTelegramConfigured()) {
      const newStrong = result.tips.filter(t => {
        if (t.category !== 'STRONG_BET') return false;
        const key = tipKey(t);
        if (state.pushedKeys.has(key)) return false;
        return true;
      });

      // Cap to 5 pushes per scan to avoid spam
      const toPush = newStrong.slice(0, 5);
      for (const tip of toPush) {
        await pushTip(tip);
        state.pushedKeys.add(tipKey(tip));
        // small delay between messages
        await new Promise(r => setTimeout(r, 500));
      }

      // Cleanup old keys (keep last 500)
      if (state.pushedKeys.size > 500) {
        const arr = Array.from(state.pushedKeys);
        state.pushedKeys = new Set(arr.slice(arr.length - 500));
      }
    }

    return result;
  } catch (e) {
    state.errors++;
    console.error('Scanner error:', e);
    return null;
  }
}

export function startScanner(intervalMs: number = 15 * 60 * 1000) {
  if (intervalHandle) return;
  console.log(`Background scanner started (interval: ${intervalMs / 1000}s)`);
  // Run once immediately
  runScan();
  intervalHandle = setInterval(runScan, intervalMs);
}

export function stopScanner() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export function getScannerState() {
  return {
    lastRun: state.lastRun,
    lastRunISO: state.lastRun ? new Date(state.lastRun).toISOString() : null,
    errors: state.errors,
    cachedTipCount: state.lastResult?.tips.length || 0,
    pushedCount: state.pushedKeys.size,
    isRunning: intervalHandle !== null,
  };
}

export function getCachedResult(): TopTipsResponse | null {
  return state.lastResult;
}

export function clearPushedKeys() {
  state.pushedKeys.clear();
}
