import { useEffect, useState } from 'react';

interface Entry {
  name: string;
  isDirectory: boolean;
}
interface Group {
  title: string;
  items: Entry[];
}

export function ProjectCards({
  onOpenWorkspace,
  onOpenDeploy,
}: {
  onOpenWorkspace: () => void;
  onOpenDeploy: () => void;
}) {
  const [projectName, setProjectName] = useState('Project');
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
        const cwd = settings.cwd ?? '.';
        const normalized = cwd.replace(/\\/g, '/').replace(/\/$/, '');
        setProjectName(normalized.split('/').pop() || 'Project');
        const root = (await window.api.fileRead({ path: cwd })) as { type?: string; entries?: Entry[] };
        const entries = root.entries ?? [];
        const directories = entries.filter((entry) => entry.isDirectory && !entry.name.startsWith('.')).slice(0, 4);
        const nextGroups = await Promise.all(
          directories.map(async (directory) => {
            try {
              const child = (await window.api.fileRead({ path: `${cwd}/${directory.name}` })) as { entries?: Entry[] };
              return {
                title: directory.name,
                items: (child.entries ?? []).filter((entry) => !entry.name.startsWith('.')).slice(0, 4),
              };
            } catch {
              return { title: directory.name, items: [] };
            }
          }),
        );
        if (nextGroups.length < 4) {
          const files = entries.filter((entry) => !entry.isDirectory && !entry.name.startsWith('.')).slice(0, 4);
          if (files.length) nextGroups.push({ title: 'Root', items: files });
        }
        if (!cancelled) setGroups(nextGroups.slice(0, 4));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    window.addEventListener('storage', load);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', load);
    };
  }, []);

  return (
    <section className="mt-5 w-full rounded-xl border border-white/[0.07] bg-[#0c1019] p-6 shadow-[0_14px_36px_rgba(0,0,0,.16)]">
      <div className="flex items-center justify-between pb-2 border-b border-white/[0.055]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold text-zinc-200 truncate">{projectName}</span>
          <span className="rounded border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 text-[8px] text-zinc-600">
            workspace
          </span>
        </div>
        <button onClick={onOpenWorkspace} className="icon-button w-6 h-6" aria-label="Open full workspace">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 3.75h6.5v6.5h-6.5v-6.5Zm10 0h6.5v6.5h-6.5v-6.5Zm-10 10h6.5v6.5h-6.5v-6.5Zm10 0h6.5v6.5h-6.5v-6.5Z"
            />
          </svg>
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-6 pt-4 min-h-[104px]">
        {loading ? (
          <div className="col-span-4 flex items-center text-[10px] text-zinc-600">Loading workspace…</div>
        ) : groups.length === 0 ? (
          <div className="col-span-4 flex items-center text-[10px] text-zinc-600">
            Choose a project folder in Settings to populate the workspace.
          </div>
        ) : (
          groups.map((group) => (
            <button
              key={group.title}
              onClick={onOpenWorkspace}
              className="rounded-lg border border-white/[0.05] bg-white/[0.018] p-2.5 text-left hover:border-indigo-500/25 hover:bg-white/[0.03] transition-colors min-w-0"
            >
              <span className="block text-[10px] font-medium text-zinc-300 truncate mb-1.5">{group.title}</span>
              {group.items.length === 0 ? (
                <span className="text-[8px] text-zinc-700">Empty</span>
              ) : (
                group.items.map((item) => (
                  <span key={item.name} className="flex items-center gap-1.5 py-0.5 text-[8px] text-zinc-600 truncate">
                    <svg
                      className={item.isDirectory ? 'w-2.5 h-2.5 text-blue-400' : 'w-2.5 h-2.5 text-zinc-500'}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d={
                          item.isDirectory
                            ? 'M3.75 6.75h6l1.5 2.25h9v9.75a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-12Z'
                            : 'M6 3.75h8.25L18 7.5v12.75H6V3.75Z'
                        }
                      />
                    </svg>
                    <span className="truncate">{item.name}</span>
                  </span>
                ))
              )}
            </button>
          ))
        )}
        <div className="rounded-lg border border-white/[0.05] bg-white/[0.018] p-2.5 flex flex-col justify-between">
          <div>
            <span className="block text-[10px] font-medium text-zinc-300">Deploy</span>
            <span className="block mt-1 text-[8px] text-zinc-600">Build and release this workspace.</span>
          </div>
          <button
            onClick={onOpenDeploy}
            className="mt-2 h-6 rounded-md bg-gradient-to-r from-indigo-600 to-violet-600 text-[8px] font-medium text-white hover:from-indigo-500 hover:to-violet-500"
          >
            Open deploy
          </button>
        </div>
      </div>
    </section>
  );
}
