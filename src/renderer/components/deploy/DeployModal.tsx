import { useState } from 'react';
import { motion } from 'framer-motion';

type DeployStatus = 'idle' | 'building' | 'deploying' | 'success' | 'failed';

interface DeployStep {
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  duration?: string;
}

const INITIAL_STEPS: DeployStep[] = [
  { label: 'Building project', status: 'pending' },
  { label: 'Optimizing assets', status: 'pending' },
  { label: 'Running tests', status: 'pending' },
  { label: 'Deploying to Vercel', status: 'pending' },
  { label: 'Configuring domain', status: 'pending' },
];

export function DeployModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<DeployStatus>('idle');
  const [steps, setSteps] = useState<DeployStep[]>(INITIAL_STEPS);
  const [progress, setProgress] = useState(0);

  const startDeploy = () => {
    setStatus('building');
    setProgress(0);

    let current = 0;
    const timer = setInterval(() => {
      current++;
      setProgress(Math.min(100, current));

      if (current <= 20) {
        setSteps((s) => s.map((step, i) => i === 0 ? { ...step, status: 'running' } : step));
      } else if (current <= 40) {
        setSteps((s) => s.map((step, i) => {
          if (i === 0) return { ...step, status: 'done', duration: '2.3s' };
          if (i === 1) return { ...step, status: 'running' };
          return step;
        }));
      } else if (current <= 60) {
        setSteps((s) => s.map((step, i) => {
          if (i === 1) return { ...step, status: 'done', duration: '1.8s' };
          if (i === 2) return { ...step, status: 'running' };
          return step;
        }));
        setStatus('deploying');
      } else if (current <= 85) {
        setSteps((s) => s.map((step, i) => {
          if (i === 2) return { ...step, status: 'done', duration: '4.1s' };
          if (i === 3) return { ...step, status: 'running' };
          return step;
        }));
      } else if (current <= 100) {
        setSteps((s) => s.map((step, i) => {
          if (i === 3) return { ...step, status: 'done', duration: '3.2s' };
          if (i === 4) return { ...step, status: 'running' };
          return step;
        }));
      }

      if (current >= 100) {
        clearInterval(timer);
        setSteps((s) => s.map((step, i) => i === 4 ? { ...step, status: 'done', duration: '0.8s' } : step));
        setStatus('success');
      }
    }, 100);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative bg-bg-subtle/95 backdrop-blur-xl border border-white/8 rounded-2xl shadow-panel w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-brand flex items-center justify-center text-white text-sm shadow-glow-sm">🚀</div>
            <h2 className="text-lg font-semibold">Deploy Project</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-white/5 text-fg-muted hover:text-fg flex items-center justify-center text-sm">✕</button>
        </div>

        <div className="p-6">
          {status === 'idle' ? (
            <>
              <div className="card p-4 mb-4">
                <div className="flex items-center gap-3 mb-3">
                  <span>▲</span>
                  <span className="font-medium">Vercel</span>
                  <span className="text-xs text-fg-muted">~</span>
                  <span className="text-xs bg-white/5 border border-white/8 rounded-full px-2 py-0.5 text-fg-muted">Free Tier</span>
                </div>
                <div className="text-xs text-fg-muted mb-2">app.infinityai.dev</div>
                <div className="text-xs text-fg-subtle">Last deployed 2 hours ago</div>
              </div>
              <button onClick={startDeploy} className="btn-primary w-full text-sm">
                Deploy Now
              </button>
            </>
          ) : (
            <>
              {/* Progress bar */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    {status === 'building' && 'Building...'}
                    {status === 'deploying' && 'Deploying...'}
                    {status === 'success' && 'Deployed!'}
                    {status === 'failed' && 'Failed'}
                  </span>
                  <span className="text-xs text-fg-muted">{progress}%</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.3 }}
                    className={`h-full rounded-full ${
                      status === 'success' ? 'bg-success' : status === 'failed' ? 'bg-danger' : 'bg-gradient-progress'
                    }`}
                  />
                </div>
              </div>

              {/* Steps */}
              <div className="space-y-3">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      step.status === 'done' ? 'border-success bg-success' :
                      step.status === 'running' ? 'border-violet-500 bg-violet-500/20' :
                      step.status === 'failed' ? 'border-danger bg-danger' :
                      'border-white/15'
                    }`}>
                      {step.status === 'done' && <span className="text-white text-[10px]">✓</span>}
                      {step.status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />}
                    </div>
                    <span className={`text-sm flex-1 ${step.status === 'pending' ? 'text-fg-subtle' : ''}`}>{step.label}</span>
                    {step.duration && <span className="text-xs text-fg-muted">{step.duration}</span>}
                  </div>
                ))}
              </div>

              {status === 'success' && (
                <div className="mt-6 flex gap-2">
                  <button className="btn-primary flex-1 text-sm">Visit Site</button>
                  <button onClick={onClose} className="btn-ghost text-sm">Close</button>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

