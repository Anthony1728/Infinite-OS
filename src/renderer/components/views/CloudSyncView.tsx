import { useEffect } from 'react';
import { useCloudStore } from '../../../renderer/stores/cloud';
import { useNotificationStore } from '../../../renderer/stores/notifications';

export function CloudSyncView() {
  const { devices, backups, records, stats, loadDevices, loadBackups, loadRecords, loadStats, registerDevice, createBackup, restoreBackup } = useCloudStore();
  const addToast = useNotificationStore((s) => s.addToast);

  useEffect(() => { loadDevices(); loadBackups(); loadRecords(); loadStats(); }, []);

  const handleRegister = async () => {
    await registerDevice(`Device-${Date.now().toString(36)}`);
    addToast({ type: 'success', title: 'Device registered' });
  };

  const handleBackup = async () => {
    await createBackup();
    addToast({ type: 'success', title: 'Backup created' });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-500 flex items-center justify-center shadow-lg">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" /></svg>
            </div>
            Cloud Sync
          </h1>
          <p className="text-textMuted text-sm mt-1">Sync data across devices and create backups.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleRegister} className="btn-premium flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            Register Device
          </button>
          <button onClick={handleBackup} className="px-4 py-2 rounded-xl bg-bgCard border border-borderSubtle text-textMain hover:border-sky-500/30 transition-all flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" /></svg>
            Backup
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Devices', value: stats?.devices ?? devices.length },
          { label: 'Backups', value: stats?.backups ?? backups.length },
          { label: 'Records', value: stats?.records ?? records.length },
          { label: 'Last Sync', value: stats?.lastSync ? new Date(stats.lastSync).toLocaleDateString() : 'Never' },
        ].map((stat, i) => (
          <div key={i} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 25}ms` }}>
            <div className="text-xs text-textMuted mb-1">{stat.label}</div>
            <div className="text-lg font-bold text-textMain">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Devices */}
        <div>
          <h2 className="text-sm font-semibold text-textMain mb-3">Devices</h2>
          <div className="space-y-2">
            {devices.length === 0 ? <div className="text-center py-8 text-textMuted text-sm">No devices registered</div> : devices.map((d, i) => (
              <div key={d.id} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 20}ms` }}>
                <div className="flex items-center gap-3">
                  <div className="status-dot-active" />
                  <div className="flex-1">
                    <div className="font-medium text-textMain text-sm">{d.name}</div>
                    <div className="text-xs text-textMuted">Last sync: {new Date(d.lastSync).toLocaleString()}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Backups */}
        <div>
          <h2 className="text-sm font-semibold text-textMain mb-3">Backups</h2>
          <div className="space-y-2">
            {backups.length === 0 ? <div className="text-center py-8 text-textMuted text-sm">No backups yet</div> : backups.map((b, i) => (
              <div key={b.id} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 20}ms` }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-textMain text-sm">Backup {b.id.slice(0, 8)}</div>
                    <div className="text-xs text-textMuted">{new Date(b.createdAt).toLocaleString()} · {(b.size / 1024).toFixed(1)}KB</div>
                  </div>
                  <button onClick={() => { restoreBackup(b.id); addToast({ type: 'info', title: 'Restoring backup...' }); }} className="px-3 py-1.5 rounded-lg bg-bgCard border border-borderSubtle text-xs text-textMain hover:border-sky-500/30 transition-all">Restore</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

