import { useCallback, useEffect, useRef, useState } from 'react';

const SOUND_KEY = 'esport-bet-sound-enabled';
const NOTIF_KEY = 'esport-bet-browser-notif-enabled';
const SEEN_KEY = 'esport-bet-seen-tips';

// Web Audio API beep (no external files needed)
function playBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    // Two-tone alert: 880Hz then 1100Hz
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // ignore
  }
}

export interface Toast {
  id: number;
  type: 'info' | 'success' | 'warning' | 'strong';
  title: string;
  body?: string;
  ttl?: number;
}

let toastIdCounter = 0;
const listeners = new Set<(toasts: Toast[]) => void>();
let toasts: Toast[] = [];

function notify() {
  for (const l of listeners) l([...toasts]);
}

export function pushToast(toast: Omit<Toast, 'id'>) {
  const id = ++toastIdCounter;
  const t: Toast = { id, ttl: 6000, ...toast };
  toasts = [...toasts, t];
  notify();
  if (t.ttl && t.ttl > 0) {
    setTimeout(() => removeToast(id), t.ttl);
  }
  return id;
}

export function removeToast(id: number) {
  toasts = toasts.filter(t => t.id !== id);
  notify();
}

export function useToasts(): Toast[] {
  const [list, setList] = useState<Toast[]>(toasts);
  useEffect(() => {
    listeners.add(setList);
    return () => { listeners.delete(setList); };
  }, []);
  return list;
}

export function useNotificationSettings() {
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem(SOUND_KEY) !== '0');
  const [browserNotifEnabled, setBrowserNotifEnabled] = useState(() => localStorage.getItem(NOTIF_KEY) === '1');

  const toggleSound = useCallback(() => {
    setSoundEnabled(v => {
      const next = !v;
      localStorage.setItem(SOUND_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  const enableBrowserNotif = useCallback(async () => {
    if (typeof Notification === 'undefined') return false;
    const perm = await Notification.requestPermission();
    const granted = perm === 'granted';
    if (granted) {
      localStorage.setItem(NOTIF_KEY, '1');
      setBrowserNotifEnabled(true);
    }
    return granted;
  }, []);

  const disableBrowserNotif = useCallback(() => {
    localStorage.setItem(NOTIF_KEY, '0');
    setBrowserNotifEnabled(false);
  }, []);

  return { soundEnabled, toggleSound, browserNotifEnabled, enableBrowserNotif, disableBrowserNotif };
}

// Trigger a notification with optional sound + browser notif
export function triggerNotification(opts: {
  type: 'info' | 'success' | 'warning' | 'strong';
  title: string;
  body?: string;
}) {
  pushToast(opts);

  // Sound (only if user enabled)
  if (localStorage.getItem(SOUND_KEY) !== '0') {
    playBeep();
  }

  // Browser notification (if permitted and enabled)
  if (localStorage.getItem(NOTIF_KEY) === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(opts.title, {
        body: opts.body,
        icon: '/ebet.png',
        tag: `esport-bet-${Date.now()}`,
      });
    } catch {
      // ignore
    }
  }
}

// Track seen tip keys to detect new ones
function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* empty */ }
  return new Set();
}

function saveSeen(set: Set<string>) {
  // Keep last 200 to avoid bloat
  const arr = Array.from(set).slice(-200);
  localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
}

export function useNewTipDetector<T extends { date: string; time: string; playerA: string; playerB: string; valueBet: string; category?: string }>(
  tips: T[] | undefined,
  enabled: boolean
) {
  const seenRef = useRef<Set<string>>(loadSeen());
  const firstRunRef = useRef(true);

  useEffect(() => {
    if (!enabled || !tips) return;

    const newStrong: T[] = [];
    for (const tip of tips) {
      if (tip.category !== 'STRONG_BET') continue;
      const key = `${tip.date}|${tip.time}|${[tip.playerA.toLowerCase(), tip.playerB.toLowerCase()].sort().join('-')}|${tip.valueBet}`;
      if (!seenRef.current.has(key)) {
        seenRef.current.add(key);
        newStrong.push(tip);
      }
    }

    if (newStrong.length > 0) {
      saveSeen(seenRef.current);
      // Don't notify on first load (avoid spam after refresh)
      if (!firstRunRef.current) {
        for (const tip of newStrong.slice(0, 3)) {
          triggerNotification({
            type: 'strong',
            title: `🔥 Új STRONG BET: ${tip.playerA} vs ${tip.playerB}`,
            body: `${tip.valueBet} | ${tip.time} ${tip.date}`,
          });
        }
        if (newStrong.length > 3) {
          triggerNotification({
            type: 'info',
            title: `+${newStrong.length - 3} további STRONG BET`,
          });
        }
      }
    }

    firstRunRef.current = false;
  }, [tips, enabled]);
}
