import { useCallback, useEffect, useState } from 'react';

const PRESETS_KEY = 'esport-bet-tip-presets';

export interface TipFilterPreset {
  name: string;
  league: string;        // "" = all
  filter: 'all' | 'strong' | 'h2h' | 'liveOdds';
  limit: number;
}

const DEFAULT_PRESETS: TipFilterPreset[] = [
  { name: 'STRONG H2H Bet365', league: 'Esoccer Battle', filter: 'strong', limit: 10 },
  { name: 'Csak STRONG', league: '', filter: 'strong', limit: 10 },
  { name: 'GT Top 5', league: 'GT Leagues', filter: 'all', limit: 5 },
];

function load(): TipFilterPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* empty */ }
  return DEFAULT_PRESETS;
}

function save(presets: TipFilterPreset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

export function useFilterPresets() {
  const [presets, setPresets] = useState<TipFilterPreset[]>(load);

  useEffect(() => { save(presets); }, [presets]);

  const addPreset = useCallback((preset: TipFilterPreset) => {
    setPresets(prev => {
      const filtered = prev.filter(p => p.name !== preset.name);
      return [...filtered, preset];
    });
  }, []);

  const removePreset = useCallback((name: string) => {
    setPresets(prev => prev.filter(p => p.name !== name));
  }, []);

  const resetToDefaults = useCallback(() => {
    setPresets(DEFAULT_PRESETS);
  }, []);

  return { presets, addPreset, removePreset, resetToDefaults };
}
