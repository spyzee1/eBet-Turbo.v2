import { MatchResult } from '../model/types';

interface Props {
  result: MatchResult;
  onRemove?: () => void;
  onSaveToHistory?: () => void;
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function confidenceColor(c: number): string {
  if (c >= 0.75) return 'text-green';
  if (c >= 0.6) return 'text-yellow';
  return 'text-red';
}

function edgeColor(e: number): string {
  if (e >= 0.08) return 'text-green';
  if (e >= 0.04) return 'text-yellow-light';
  if (e > 0) return 'text-slate-300';
  return 'text-red-light';
}

function valueBetBg(v: string): string {
  if (v === 'PASS') return 'bg-slate-700/50';
  if (v.includes('OVER')) return 'bg-green/20 border-green/30';
  if (v.includes('UNDER')) return 'bg-yellow/20 border-yellow/30';
  return 'bg-accent/20 border-accent/30';
}

function classifyBet(conf: number, edge: number, valueBet: string): 'STRONG_BET' | 'BET' | 'NO_BET' {
  if (valueBet === 'PASS') return 'NO_BET';
  if (conf >= 0.80 && edge >= 0.08) return 'STRONG_BET';
  if (conf >= 0.65 && edge >= 0.04) return 'BET';
  return 'NO_BET';
}

export default function BetCard({ result, onRemove, onSaveToHistory }: Props) {
  const { input: m } = result;
  const isPass = result.valueBet === 'PASS';

  return (
    <div className={`bg-dark-card rounded-xl border border-dark-border overflow-hidden transition hover:border-slate-600 ${isPass ? 'opacity-60' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-dark-border bg-dark-card-hover/30">
        <div className="flex items-center gap-3">
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${m.liga === 'GT Leagues' ? 'bg-green/20 text-green' : m.liga === 'eAdriaticLeague' ? 'bg-purple/20 text-purple' : 'bg-slate-600/30 text-slate-400'}`}>
            {m.liga}
          </span>
          {m.matchTime && <span className="text-xs text-white font-semibold" title={m.matchDate ? `${m.matchDate} ${m.matchTime}` : m.matchTime}>{m.matchTime}</span>}
          <span className="text-xs text-slate-500">{m.percek} perc</span>
          {(() => {
            const cat = classifyBet(result.confidence, result.kivalasztottEdge, result.valueBet);
            if (cat === 'STRONG_BET') return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-green text-white">STRONG BET</span>;
            if (cat === 'BET') return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-yellow text-dark-bg">BET</span>;
            return null;
          })()}
          {result.h2hMode && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent/30 text-accent-light"
              title={`H2H ONLY mód: ${result.h2hTotal} egymás elleni meccs alapján`}
            >
              H2H ONLY · {result.h2hTotal}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onSaveToHistory && !isPass && (
            <button onClick={onSaveToHistory} className="text-xs text-accent hover:text-accent-light cursor-pointer" title="Mentés előzményekbe">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
              </svg>
            </button>
          )}
          {onRemove && (
            <button onClick={onRemove} className="text-xs text-red/60 hover:text-red cursor-pointer" title="Törlés">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Players */}
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-center flex-1">
            <p className="text-sm font-semibold text-white">{m.playerA || 'Player A'}</p>
            <p className="text-xs text-slate-500 mt-1">Odds: {m.oddsA}</p>
          </div>
          <div className="text-xs text-slate-600 font-bold px-4">VS</div>
          <div className="text-center flex-1">
            <p className="text-sm font-semibold text-white">{m.playerB || 'Player B'}</p>
            <p className="text-xs text-slate-500 mt-1">Odds: {m.oddsB}</p>
          </div>
        </div>

        {/* Win probabilities bar */}
        <div className="mb-4">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-accent-light">{pct(result.winEselyA)}</span>
            <span className="text-slate-500">Win esély</span>
            <span className="text-purple">{pct(result.winEselyB)}</span>
          </div>
          <div className="h-2 bg-dark-bg rounded-full overflow-hidden flex">
            <div className="bg-gradient-to-r from-accent to-accent-light rounded-l-full transition-all" style={{ width: pct(result.winEselyA) }} />
            <div className="bg-gradient-to-r from-purple to-purple/60 rounded-r-full flex-1" />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs mb-4">
          <div className="flex justify-between"><span className="text-slate-500">Score A</span><span className="text-slate-300">{result.scoreA.toFixed(4)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Score B</span><span className="text-slate-300">{result.scoreB.toFixed(4)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Edge A</span><span className={edgeColor(result.edgeA)}>{pct(result.edgeA)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Edge B</span><span className={edgeColor(result.edgeB)}>{pct(result.edgeB)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Várt gól</span><span className="text-slate-300">{result.vartOsszesGol.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">O/U Line</span><span className="text-slate-300">{m.ouLine}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Over esély</span><span className={edgeColor(result.edgeOver)}>{pct(result.overEsely)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Under esély</span><span className={edgeColor(result.edgeUnder)}>{pct(result.underEsely)}</span></div>
          {result.poissonOverEsely !== undefined && (
            <div className="flex justify-between"><span className="text-slate-500">Poisson O</span><span className="text-accent-light">{pct(result.poissonOverEsely)}</span></div>
          )}
          {result.poissonBtts !== undefined && (
            <div className="flex justify-between"><span className="text-slate-500">BTTS</span><span className="text-accent-light">{pct(result.poissonBtts)}</span></div>
          )}
          {result.eloA !== undefined && result.eloB !== undefined && (
            <>
              <div className="flex justify-between"><span className="text-slate-500">ELO A</span><span className="text-yellow-light">{result.eloA}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">ELO B</span><span className="text-yellow-light">{result.eloB}</span></div>
            </>
          )}
          {result.h2hTotal !== undefined && result.h2hTotal > 0 && (
            <div className="flex justify-between"><span className="text-slate-500">H2H</span><span className="text-slate-300">{result.h2hWinsA}W-{result.h2hWinsB}L ({result.h2hTotal})</span></div>
          )}
        </div>

        {/* Recommendation */}
        <div className={`rounded-lg border p-3 ${valueBetBg(result.valueBet)}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400 font-medium">Ajánlott tipp</span>
            <span className={`text-sm font-bold ${confidenceColor(result.confidence)}`}>
              {Math.round(result.confidence * 100)}% conf
            </span>
          </div>
          <p className="text-sm font-semibold text-white">
            {result.valueBet === 'PASS' ? 'PASS - Nincs value bet' : result.valueBet}
          </p>
          {!isPass && (
            <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
              <span>Edge: <span className={edgeColor(result.kivalasztottEdge)}>{pct(result.kivalasztottEdge)}</span></span>
              <span>Kelly: {pct(result.kellyPct)}</span>
              <span>Tét: <span className="text-white font-semibold">{result.stakeFt} Ft</span></span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
