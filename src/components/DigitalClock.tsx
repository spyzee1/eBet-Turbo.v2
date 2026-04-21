import { useState, useEffect } from 'react';

export default function DigitalClock() {
  const [time, setTime] = useState(new Date());
  const [hasPlayedSound, setHasPlayedSound] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Óra frissítés minden másodpercben
    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const hours = time.getHours();
    const minutes = time.getMinutes();
    const seconds = time.getSeconds();

    // Csak 0. másodpercnél játssz hangot
    if (seconds !== 0) return;

    // Ellenőrzés: egész óra, 15, 30, 45 perc?
    const shouldPlaySound = minutes === 0 || minutes === 15 || minutes === 30 || minutes === 45;
    
    if (shouldPlaySound) {
      const timeKey = `${hours}:${minutes}`;
      
      // Ha már játszottunk ezen az időponton, ne ismételjük
      if (hasPlayedSound.has(timeKey)) return;

      // Hang lejátszása
      playNotificationSound();
      
      // Jelöljük hogy lejátszottuk
      setHasPlayedSound(prev => {
        const next = new Set(prev);
        next.add(timeKey);
        
        // Csak az utolsó 10 időpontot tartsuk meg (memória spórolás)
        if (next.size > 10) {
          const first = Array.from(next)[0];
          next.delete(first);
        }
        
        return next;
      });

      console.log(`🔔 GT League meccs kezdés! ${timeKey}`);
    }
  }, [time, hasPlayedSound]);

  const playNotificationSound = () => {
    try {
      // Web Audio API használata
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Kellemes hangszín beállítása
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime); // Hz

      // Hangerő fade in/out
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.1);
      gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.5);

      // Lejátszás
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
      console.error('Hang lejátszási hiba:', e);
    }
  };

  const formatTime = () => {
    const hours = String(time.getHours()).padStart(2, '0');
    const minutes = String(time.getMinutes()).padStart(2, '0');
    const seconds = String(time.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-dark-bg/40 rounded-lg border border-dark-border">
      <svg className="w-4 h-4 text-accent-light" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span className="text-sm font-mono font-bold text-white tabular-nums">
        {formatTime()}
      </span>
    </div>
  );
}