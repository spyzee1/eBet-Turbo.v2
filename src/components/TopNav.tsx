import { useState } from 'react';
import logo from '../assets/ebet.png';
import DigitalClock from './DigitalClock';

type View = 'dashboard' | 'topTips' | 'naplo' | 'upcoming' | 'newMatch' | 'playerProfile' | 'backtest' | 'history' | 'settings' | 'statistics' | 'segedlet';

interface Props {
  current: View;
  onChange: (v: View) => void;
}

const NAV_ITEMS: { id: View; label: string }[] = [
  { id: 'topTips',    label: 'Kezdőlap' },
  { id: 'segedlet',   label: 'Segédlet' },
  { id: 'naplo',      label: 'Fogadási Napló' },
  { id: 'statistics', label: 'Statisztika' },
];

export default function TopNav({ current, onChange }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-50 bg-dark-card border-b border-dark-border shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-4 flex items-center h-20 gap-4">

          {/* Logo */}
          <div className="flex items-center shrink-0 self-stretch">
            <img src={logo} alt="eBet-Turbo" className="h-full w-auto object-contain" />
          </div>

          {/* Clock — center */}
          <div className="flex-1 flex justify-center">
            <DigitalClock />
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1 shrink-0">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                onClick={() => onChange(item.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition cursor-pointer ${
                  current === item.id
                    ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(o => !o)}
            className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
        </div>

        {/* Mobile dropdown menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-dark-border bg-dark-card px-4 pb-3 space-y-1">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                onClick={() => { onChange(item.id); setMobileOpen(false); }}
                className={`w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition cursor-pointer ${
                  current === item.id
                    ? 'bg-orange-500/20 text-orange-400'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </header>
    </>
  );
}
