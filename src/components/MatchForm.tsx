import { useState } from 'react';
import { Liga, MatchInput, PiacTipus } from '../model/types';
import { lookupPlayers } from '../api';

interface Props {
  onSubmit: (m: MatchInput) => void;
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

const emptyMatch: Omit<MatchInput, 'id'> = {
  liga: 'GT Leagues',
  percek: 12,
  piacTipus: 'Over/Under',
  playerA: '',
  playerB: '',
  oddsA: 1.85,
  oddsB: 1.95,
  gfA: 0,
  gaA: 0,
  gfB: 0,
  gaB: 0,
  winRateA: 0.5,
  winRateB: 0.5,
  formaA: 0.5,
  formaB: 0.5,
  h2hA: 0.5,
  h2hB: 0.5,
  ouLine: 3.5,
  oddsOver: 1.85,
  oddsUnder: 1.95,
};

export default function MatchForm({ onSubmit }: Props) {
  const [form, setForm] = useState<Omit<MatchInput, 'id'>>(emptyMatch);
  const [loading, setLoading] = useState(false);
  const [lookupMsg, setLookupMsg] = useState('');

  const set = (key: keyof Omit<MatchInput, 'id'>, value: string | number) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleLigaChange = (liga: Liga) => {
    const updates: Partial<Omit<MatchInput, 'id'>> = { liga };
    if (liga === 'GT Leagues') {
      updates.percek = 12;
      updates.piacTipus = 'Over/Under';
    } else if (liga === 'eAdriaticLeague') {
      updates.percek = 10;
      updates.piacTipus = 'Win';
    }
    setForm(prev => ({ ...prev, ...updates }));
  };

  const handleAutoFill = async () => {
    if (!form.playerA.trim() || !form.playerB.trim()) {
      setLookupMsg('Add meg mindkét játékos nevét!');
      return;
    }
    setLoading(true);
    setLookupMsg('');
    try {
      const data = await lookupPlayers(form.playerA, form.playerB, form.liga);
      setForm(prev => ({
        ...prev,
        winRateA: Math.round(data.playerA.winRate * 100) / 100,
        winRateB: Math.round(data.playerB.winRate * 100) / 100,
        gfA: Math.round(data.playerA.gf * 100) / 100,
        gaA: Math.round(data.playerA.ga * 100) / 100,
        gfB: Math.round(data.playerB.gf * 100) / 100,
        gaB: Math.round(data.playerB.ga * 100) / 100,
        formaA: Math.round(data.playerA.forma * 100) / 100,
        formaB: Math.round(data.playerB.forma * 100) / 100,
        h2hA: data.h2h ? Math.round(data.h2h.h2hRatioA * 100) / 100 : 0.5,
        h2hB: data.h2h ? Math.round(data.h2h.h2hRatioB * 100) / 100 : 0.5,
      }));
      const h2hInfo = data.h2h && data.h2h.h2hTotal > 0
        ? ` | H2H: ${data.h2h.h2hWinsA}W-${data.h2h.h2hWinsB}L (${data.h2h.h2hTotal} meccs)`
        : '';
      setLookupMsg(`Betöltve: ${data.playerA.name} (${data.playerA.matches} meccs) vs ${data.playerB.name} (${data.playerB.matches} meccs)${h2hInfo}`);
    } catch {
      setLookupMsg('Nem sikerült lekérni az adatokat. Ellenőrizd a játékosneveket és hogy fut-e a szerver (port 3001).');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ ...form, id: genId() });
    setForm(emptyMatch);
    setLookupMsg('');
  };

  const ic = "w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition";
  const lc = "block text-xs text-slate-400 mb-1 font-medium";

  // String-backed number inputs to allow free editing (no stuck zeros, dots work)
  const [rawInputs, setRawInputs] = useState<Record<string, string>>({});

  const numInput = (key: keyof Omit<MatchInput, 'id'>) => ({
    type: 'text' as const,
    inputMode: 'decimal' as const,
    value: key in rawInputs ? rawInputs[key] : String(form[key]),
    className: ic,
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      setRawInputs(prev => ({ ...prev, [key]: String(form[key]) }));
      e.target.select();
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setRawInputs(prev => ({ ...prev, [key]: e.target.value }));
    },
    onBlur: () => {
      const raw = rawInputs[key] ?? '';
      const num = parseFloat(raw);
      set(key, !isNaN(num) ? num : 0);
      setRawInputs(prev => { const n = { ...prev }; delete n[key]; return n; });
    },
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-dark-card rounded-xl border border-dark-border p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Meccs adatok</h2>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div>
            <label className={lc}>Liga</label>
            <select value={form.liga} onChange={e => handleLigaChange(e.target.value as Liga)} className={ic}>
              <option value="GT Leagues">GT Leagues</option>
              <option value="eAdriaticLeague">eAdriaticLeague</option>
              <option value="Other">Egyéb</option>
            </select>
          </div>
          <div>
            <label className={lc}>Percek</label>
            <input {...numInput('percek')} />
          </div>
          <div>
            <label className={lc}>Piac típus</label>
            <select value={form.piacTipus} onChange={e => set('piacTipus', e.target.value as PiacTipus)} className={ic}>
              <option value="Win">Win</option>
              <option value="Over/Under">Over/Under</option>
            </select>
          </div>
        </div>

        {/* Auto-fill bar */}
        <div className="bg-dark-bg rounded-lg border border-dark-border p-4 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <svg className="w-4 h-4 text-green shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            <span className="text-sm text-white font-medium">Auto-kitöltés (EsoccerBet)</span>
            <button
              type="button"
              onClick={handleAutoFill}
              disabled={loading}
              className="ml-auto bg-green/20 text-green hover:bg-green/30 text-xs font-semibold px-4 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-50"
            >
              {loading ? 'Betöltés...' : 'Adatok lekérése'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">Írd be a játékosok neveit, majd kattints az „Adatok lekérése" gombra. Win rate, GF, GA, forma automatikusan kitöltődik.</p>
          {lookupMsg && (
            <p className={`text-xs mt-2 ${lookupMsg.includes('Betöltve') ? 'text-green' : 'text-yellow'}`}>{lookupMsg}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Player A */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-accent-light border-b border-dark-border pb-2">Player A</h3>
            <div>
              <label className={lc}>Név</label>
              <input type="text" value={form.playerA} onChange={e => set('playerA', e.target.value)} placeholder="Player A" className={ic} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lc}>Odds A</label><input {...numInput('oddsA')} /></div>
              <div><label className={lc}>Win Rate</label><input {...numInput('winRateA')} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lc}>GF (átl.)</label><input {...numInput('gfA')} /></div>
              <div><label className={lc}>GA (átl.)</label><input {...numInput('gaA')} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lc}>Forma</label><input {...numInput('formaA')} /></div>
              <div><label className={lc}>H2H</label><input {...numInput('h2hA')} /></div>
            </div>
          </div>
          {/* Player B */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-purple border-b border-dark-border pb-2">Player B</h3>
            <div>
              <label className={lc}>Név</label>
              <input type="text" value={form.playerB} onChange={e => set('playerB', e.target.value)} placeholder="Player B" className={ic} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lc}>Odds B</label><input {...numInput('oddsB')} /></div>
              <div><label className={lc}>Win Rate</label><input {...numInput('winRateB')} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lc}>GF (átl.)</label><input {...numInput('gfB')} /></div>
              <div><label className={lc}>GA (átl.)</label><input {...numInput('gaB')} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lc}>Forma</label><input {...numInput('formaB')} /></div>
              <div><label className={lc}>H2H</label><input {...numInput('h2hB')} /></div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-dark-card rounded-xl border border-dark-border p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Over / Under</h2>
        <div className="grid grid-cols-3 gap-4">
          <div><label className={lc}>O/U Line</label><input {...numInput('ouLine')} /></div>
          <div><label className={lc}>Odds Over</label><input {...numInput('oddsOver')} /></div>
          <div><label className={lc}>Odds Under</label><input {...numInput('oddsUnder')} /></div>
        </div>
      </div>

      <button type="submit" className="w-full bg-gradient-to-r from-accent to-purple hover:from-accent-light hover:to-purple/80 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-accent/20 cursor-pointer">
        Számítás és hozzáadás
      </button>
    </form>
  );
}
