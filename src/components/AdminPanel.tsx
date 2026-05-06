import { useState, useEffect } from 'react';
import { fetchAdminUsers, adminExtend, adminRevoke, AdminUser } from '../api';

export default function AdminPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setUsers(await fetchAdminUsers());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const extend = async (userId: string, days: number) => {
    setBusy(userId);
    await adminExtend(userId, days);
    await load();
    setBusy(null);
  };

  const revoke = async (userId: string) => {
    if (!confirm('Biztosan visszavonod az előfizetést?')) return;
    setBusy(userId);
    await adminRevoke(userId);
    await load();
    setBusy(null);
  };

  const subStatus = (sub: AdminUser['subscription']) => {
    if (!sub) return { label: 'Nincs', color: 'text-slate-500' };
    const active = new Date(sub.expires_at) > new Date();
    return active
      ? { label: `Aktív · ${new Date(sub.expires_at).toLocaleDateString('hu-HU')}`, color: 'text-green-400' }
      : { label: `Lejárt · ${new Date(sub.expires_at).toLocaleDateString('hu-HU')}`, color: 'text-red-400' };
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-white text-2xl font-bold">Admin Panel</h1>
        <button onClick={load} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-sm transition cursor-pointer">
          Frissítés
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-px bg-dark-border text-xs text-slate-500 uppercase tracking-wider px-4 py-3">
            <span>Felhasználó</span>
            <span>Előfizetés</span>
            <span>Műveletek</span>
          </div>
          {users.length === 0 && (
            <div className="px-4 py-8 text-center text-slate-500 text-sm">Nincsenek felhasználók</div>
          )}
          {users.map(u => {
            const status = subStatus(u.subscription);
            const isBusy = busy === u.id;
            return (
              <div key={u.id} className="grid grid-cols-[1fr_1fr_auto] gap-4 items-center px-4 py-3 border-t border-dark-border hover:bg-white/2 transition">
                <div>
                  <p className="text-sm text-white font-medium truncate">{u.email}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {new Date(u.created_at).toLocaleDateString('hu-HU')}
                    {!u.email_confirmed && <span className="ml-2 text-yellow-500">· nem megerősített</span>}
                  </p>
                </div>
                <p className={`text-sm ${status.color}`}>{status.label}</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => extend(u.id, 30)}
                    disabled={isBusy}
                    className="px-3 py-1.5 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 text-xs font-medium transition cursor-pointer disabled:opacity-40"
                  >
                    +30 nap
                  </button>
                  <button
                    onClick={() => extend(u.id, 365)}
                    disabled={isBusy}
                    className="px-3 py-1.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 text-xs font-medium transition cursor-pointer disabled:opacity-40"
                  >
                    +1 év
                  </button>
                  {u.subscription && (
                    <button
                      onClick={() => revoke(u.id)}
                      disabled={isBusy}
                      className="px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 text-xs font-medium transition cursor-pointer disabled:opacity-40"
                    >
                      Visszavon
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
