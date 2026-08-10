import { useState, useEffect } from 'react';
import { useNotificationStore } from '../../stores/notifications';

interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  instructions: string;
  schedule: { type: 'manual' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'interval' | 'cron' | 'once'; value?: string; time?: string };
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  status: 'idle' | 'running' | 'success' | 'error';
  createdAt: number;
}

const SCHEDULE_PRESETS = [
  { type: 'manual' as const, label: 'Manual', desc: 'Run on demand' },
  { type: 'hourly' as const, label: 'Hourly', desc: 'Every hour' },
  { type: 'daily' as const, label: 'Daily', desc: 'Every day at specified time' },
  { type: 'weekdays' as const, label: 'Weekdays', desc: 'Mon-Fri at specified time' },
  { type: 'weekly' as const, label: 'Weekly', desc: 'Once per week' },
  { type: 'once' as const, label: 'One-shot', desc: 'Run once at specific time' },
];

export function ScheduledTasksView() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState({
    name: '',
    description: '',
    instructions: '',
    scheduleType: 'daily' as const,
    scheduleTime: '09:00',
    scheduleCron: '',
  });
  const addToast = useNotificationStore((s) => s.addToast);

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadTasks = async () => {
    try {
      const stored = localStorage.getItem('infinite-scheduled-tasks');
      if (stored) setTasks(JSON.parse(stored));
    } catch { /* ignore */ }
  };

  const saveTasks = (updated: ScheduledTask[]) => {
    setTasks(updated);
    localStorage.setItem('infinite-scheduled-tasks', JSON.stringify(updated));
  };

  const createTask = () => {
    if (!newTask.name.trim() || !newTask.instructions.trim()) return;
    const task: ScheduledTask = {
      id: `task-${Date.now()}`,
      name: newTask.name,
      description: newTask.description,
      instructions: newTask.instructions,
      schedule: {
        type: newTask.scheduleType,
        ...(newTask.scheduleType === 'daily' || newTask.scheduleType === 'weekdays' || newTask.scheduleType === 'weekly'
          ? { time: newTask.scheduleTime }
          : {}),
        ...(newTask.scheduleType === 'cron' ? { value: newTask.scheduleCron } : {}),
      },
      enabled: true,
      status: 'idle',
      createdAt: Date.now(),
    };
    saveTasks([...tasks, task]);
    setNewTask({ name: '', description: '', instructions: '', scheduleType: 'daily', scheduleTime: '09:00', scheduleCron: '' });
    setShowCreate(false);
    addToast({ type: 'success', title: `Task "${task.name}" created` });
  };

  const toggleTask = (id: string) => {
    saveTasks(tasks.map((t) => t.id === id ? { ...t, enabled: !t.enabled } : t));
  };

  const deleteTask = (id: string) => {
    saveTasks(tasks.filter((t) => t.id !== id));
    addToast({ type: 'info', title: 'Task deleted' });
  };

  const runTask = (task: ScheduledTask) => {
    addToast({ type: 'success', title: `Running "${task.name}"...` });
    saveTasks(tasks.map((t) => t.id === task.id ? { ...t, status: 'running' as const, lastRun: Date.now() } : t));
    // Simulate completion
    setTimeout(() => {
      saveTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: 'success' as const } : t));
      addToast({ type: 'success', title: `"${task.name}" completed` });
    }, 3000);
  };

  const getNextRunText = (task: ScheduledTask) => {
    if (!task.enabled) return 'Disabled';
    if (task.schedule.type === 'manual') return 'On demand';
    if (task.schedule.type === 'once') return task.schedule.time || 'Once';
    if (task.schedule.type === 'hourly') return 'Every hour';
    if (task.schedule.type === 'daily') return `Daily at ${task.schedule.time || '09:00'}`;
    if (task.schedule.type === 'weekdays') return `Weekdays at ${task.schedule.time || '09:00'}`;
    if (task.schedule.type === 'weekly') return `Weekly at ${task.schedule.time || '09:00'}`;
    return task.schedule.type;
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/25">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            Scheduled Tasks
          </h1>
          <p className="text-textMuted text-sm mt-1">Automate recurring work with scheduled routines.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl text-sm font-medium hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg shadow-amber-500/25 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
          New Task
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-[#0c1018] border border-amber-500/30 rounded-xl p-5 mb-6 shadow-lg shadow-amber-500/10">
          <h3 className="text-sm font-semibold text-textMain mb-4">Create Scheduled Task</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-textMuted mb-1.5 block">Task Name *</label>
              <input
                type="text"
                value={newTask.name}
                onChange={(e) => setNewTask((p) => ({ ...p, name: e.target.value }))}
                className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-amber-500/50"
                placeholder="Daily code review"
              />
            </div>
            <div>
              <label className="text-xs text-textMuted mb-1.5 block">Description</label>
              <input
                type="text"
                value={newTask.description}
                onChange={(e) => setNewTask((p) => ({ ...p, description: e.target.value }))}
                className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-amber-500/50"
                placeholder="Review all open PRs"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="text-xs text-textMuted mb-1.5 block">Instructions *</label>
            <textarea
              value={newTask.instructions}
              onChange={(e) => setNewTask((p) => ({ ...p, instructions: e.target.value }))}
              className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted h-20 resize-none focus:outline-none focus:border-amber-500/50"
              placeholder="What should the agent do? e.g. 'Check all open PRs, review for issues, and post a summary'"
            />
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-textMuted mb-1.5 block">Schedule</label>
              <div className="grid grid-cols-3 gap-1.5">
                {SCHEDULE_PRESETS.map((preset) => (
                  <button
                    key={preset.type}
                    onClick={() => setNewTask((p) => ({ ...p, scheduleType: preset.type }))}
                    className={`px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
                      newTask.scheduleType === preset.type
                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                        : 'bg-bgCard text-textMuted border border-borderSubtle hover:text-textMain'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            {(newTask.scheduleType === 'daily' || newTask.scheduleType === 'weekdays' || newTask.scheduleType === 'weekly') && (
              <div>
                <label className="text-xs text-textMuted mb-1.5 block">Time</label>
                <input
                  type="time"
                  value={newTask.scheduleTime}
                  onChange={(e) => setNewTask((p) => ({ ...p, scheduleTime: e.target.value }))}
                  className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain focus:outline-none focus:border-amber-500/50"
                />
              </div>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-textMuted hover:text-textMain text-sm rounded-lg transition-colors">Cancel</button>
            <button
              onClick={createTask}
              disabled={!newTask.name.trim() || !newTask.instructions.trim()}
              className="px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg text-sm font-medium hover:from-amber-600 hover:to-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-500/20"
            >
              Create Task
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      {tasks.length === 0 ? (
        <div className="text-center py-12 text-textMuted">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <p className="text-lg font-medium mb-1 text-textMain">No scheduled tasks</p>
          <p className="text-sm">Create a task to automate recurring work.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task, i) => (
            <div key={task.id} className="bg-[#0c1018] border border-white/[0.06] rounded-xl p-4 hover:border-amber-500/20 transition-all animate-slide-up" style={{ animationDelay: `${i * 30}ms` }}>
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0 ${
                  task.status === 'running' ? 'bg-gradient-to-br from-blue-500 to-cyan-500 shadow-blue-500/25 animate-pulse' :
                  task.status === 'success' ? 'bg-gradient-to-br from-emerald-500 to-green-500 shadow-emerald-500/25' :
                  task.status === 'error' ? 'bg-gradient-to-br from-red-500 to-rose-500 shadow-red-500/25' :
                  'bg-gradient-to-br from-amber-500 to-orange-500 shadow-amber-500/25'
                }`}>
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-textMain text-sm">{task.name}</div>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${
                      task.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-500/15 text-gray-400'
                    }`}>
                      {task.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    {task.status === 'running' && <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 text-[9px] font-semibold animate-pulse">Running</span>}
                  </div>
                  {task.description && <div className="text-xs text-textMuted mt-0.5">{task.description}</div>}
                  <div className="text-[10px] text-textMuted mt-1.5 font-mono">{task.instructions.slice(0, 80)}{task.instructions.length > 80 ? '...' : ''}</div>
                  <div className="flex items-center gap-4 mt-2">
                    <span className="text-[10px] text-amber-400 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {getNextRunText(task)}
                    </span>
                    {task.lastRun && (
                      <span className="text-[10px] text-textMuted">
                        Last: {new Date(task.lastRun).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  {task.schedule.type !== 'manual' && (
                    <button onClick={() => runTask(task)} className="px-2.5 py-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg text-[10px] font-medium hover:from-amber-600 hover:to-orange-600 transition-all shadow-md shadow-amber-500/20">
                      Run Now
                    </button>
                  )}
                  <button onClick={() => toggleTask(task.id)} className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${task.enabled ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/15 text-gray-400'}`}>
                    {task.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => deleteTask(task.id)} className="px-2.5 py-1 bg-red-500/10 text-red-400 rounded-lg text-[10px] font-medium hover:bg-red-500/20 transition-all">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
