import { useState } from 'react';
import Editor from '@monaco-editor/react';

const FILES = [
  { name: 'dashboard.tsx', language: 'typescript', content: `import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface DashboardProps {
  data: Metric[];
  onRefresh: () => void;
}

interface Metric {
  label: string;
  value: number;
  change: number;
}

export default function Dashboard({ data, onRefresh }: DashboardProps) {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <button onClick={onRefresh} className="btn-primary">
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {data.map((metric) => (
          <div key={metric.label} className="card p-4">
            <div className="text-sm text-gray-500">{metric.label}</div>
            <div className="text-2xl font-bold">{metric.value.toLocaleString()}</div>
            <div className={metric.change >= 0 ? 'text-green-500' : 'text-red-500'}>
              {metric.change >= 0 ? '+' : ''}{metric.change}%
            </div>
          </div>
        ))}
      </div>

      <div className="card p-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}` },
  { name: 'api/users.ts', language: 'typescript', content: `import { Router } from 'express';
import { z } from 'zod';

const UserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(['admin', 'user', 'viewer']),
});

const router = Router();

router.get('/', async (req, res) => {
  const users = await db.user.findMany({
    select: { id: true, name: true, email: true, role: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(users);
});

router.post('/', async (req, res) => {
  const data = UserSchema.parse(req.body);
  const user = await db.user.create({ data });
  res.status(201).json(user);
});

export default router;` },
  { name: 'schema.sql', language: 'sql', content: `CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  owner_id UUID REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_projects_owner ON projects(owner_id);` },
  { name: 'package.json', language: 'json', content: `{
  "name": "infinity-dashboard",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "recharts": "^2.12.0",
    "express": "^4.18.0",
    "zod": "^3.23.0"
  }
}` },
];

export function CodeEditor() {
  const [activeFile, setActiveFile] = useState(0);
  const file = FILES[activeFile];

  return (
    <div className="h-full flex flex-col">
      {/* File tabs */}
      <div className="flex items-center gap-0 border-b border-white/5 bg-white/[0.02] flex-shrink-0">
        {FILES.map((f, i) => (
          <button
            key={f.name}
            onClick={() => setActiveFile(i)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeFile === i
                ? 'border-violet-500 text-fg bg-white/[0.03]'
                : 'border-transparent text-fg-muted hover:text-fg hover:bg-white/[0.02]'
            }`}
          >
            {f.name}
          </button>
        ))}
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          language={file.language}
          theme="vs-dark"
          value={file.content}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "'JetBrains Mono', Menlo, monospace",
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            padding: { top: 12, bottom: 12 },
          }}
        />
      </div>
    </div>
  );
}
