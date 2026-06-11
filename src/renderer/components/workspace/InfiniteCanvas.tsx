import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';

function AgentNode({ data }: { data: { label: string; icon: string; status: string; color: string } }) {
  const statusColors: Record<string, string> = {
    working: 'bg-warning animate-pulse-dot',
    idle: 'bg-fg-subtle',
    complete: 'bg-success',
  };

  return (
    <div className="card p-3 min-w-[140px]">
      <Handle type="target" position={Position.Top} className="!bg-violet-500 !w-2 !h-2" />
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm text-white" style={{ background: data.color }}>
          {data.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{data.label}</div>
          <div className="flex items-center gap-1 mt-0.5">
            <span className={`status-dot ${statusColors[data.status] ?? 'bg-fg-subtle'}`} />
            <span className="text-[10px] text-fg-muted capitalize">{data.status}</span>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-violet-500 !w-2 !h-2" />
    </div>
  );
}

function ChatNode({ data }: { data: { label: string; icon: string } }) {
  return (
    <div className="card p-3 min-w-[120px]">
      <Handle type="target" position={Position.Top} className="!bg-violet-500 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <span className="text-lg">{data.icon}</span>
        <span className="text-xs font-medium">{data.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-violet-500 !w-2 !h-2" />
    </div>
  );
}

function TaskNode({ data }: { data: { label: string; progress: number } }) {
  return (
    <div className="card p-3 min-w-[130px]">
      <Handle type="target" position={Position.Top} className="!bg-violet-500 !w-2 !h-2" />
      <div className="text-xs font-medium mb-2">{data.label}</div>
      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
        <div className="h-full bg-gradient-progress" style={{ width: `${data.progress}%` }} />
      </div>
      <div className="text-[10px] text-fg-muted mt-1">{data.progress}%</div>
      <Handle type="source" position={Position.Bottom} className="!bg-violet-500 !w-2 !h-2" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  agent: AgentNode,
  chat: ChatNode,
  task: TaskNode,
};

const initialNodes: Node[] = [
  { id: 'chat-1', type: 'chat', position: { x: 350, y: 0 }, data: { label: 'User Chat', icon: '💬' } },
  { id: 'agent-research', type: 'agent', position: { x: 100, y: 120 }, data: { label: 'Research Agent', icon: '🔍', status: 'working', color: '#10b981' } },
  { id: 'agent-code', type: 'agent', position: { x: 350, y: 120 }, data: { label: 'Code Agent', icon: '⟨/⟩', status: 'working', color: '#a855f7' } },
  { id: 'agent-design', type: 'agent', position: { x: 600, y: 120 }, data: { label: 'Design Agent', icon: '◆', status: 'idle', color: '#ec4899' } },
  { id: 'task-1', type: 'task', position: { x: 100, y: 280 }, data: { label: 'Research market', progress: 100 } },
  { id: 'task-2', type: 'task', position: { x: 350, y: 280 }, data: { label: 'Build API', progress: 65 } },
  { id: 'task-3', type: 'task', position: { x: 600, y: 280 }, data: { label: 'Design UI', progress: 30 } },
  { id: 'deploy', type: 'chat', position: { x: 350, y: 420 }, data: { label: 'Deploy', icon: '🚀' } },
];

const initialEdges: Edge[] = [
  { id: 'e-chat-research', source: 'chat-1', target: 'agent-research', animated: true, style: { stroke: '#8b5cf6' } },
  { id: 'e-chat-code', source: 'chat-1', target: 'agent-code', animated: true, style: { stroke: '#8b5cf6' } },
  { id: 'e-chat-design', source: 'chat-1', target: 'agent-design', animated: true, style: { stroke: '#8b5cf6' } },
  { id: 'e-research-task', source: 'agent-research', target: 'task-1', style: { stroke: '#10b981' } },
  { id: 'e-code-task', source: 'agent-code', target: 'task-2', style: { stroke: '#a855f7' } },
  { id: 'e-design-task', source: 'agent-design', target: 'task-3', style: { stroke: '#ec4899' } },
  { id: 'e-task-deploy-1', source: 'task-1', target: 'deploy', style: { stroke: '#10b981' } },
  { id: 'e-task-deploy-2', source: 'task-2', target: 'deploy', style: { stroke: '#a855f7' } },
  { id: 'e-task-deploy-3', source: 'task-3', target: 'deploy', style: { stroke: '#ec4899' } },
];

export function InfiniteCanvas() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        className="bg-transparent"
        proOptions={{ hideAttribution: true }}
      >
        <Background color="rgba(255,255,255,0.03)" gap={20} />
        <Controls className="!bg-bg-subtle !border !border-white/8 !rounded-xl" />
        <MiniMap
          nodeColor={(node) => {
            if (node.type === 'agent') return node.data.color as string;
            return '#8b5cf6';
          }}
          className="!bg-bg-subtle !border !border-white/8"
          maskColor="rgba(0,0,0,0.5)"
        />
      </ReactFlow>
    </div>
  );
}
