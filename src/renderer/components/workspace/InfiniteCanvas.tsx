import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Brain,
  Code2,
  Webhook,
  GitBranch,
  Timer,
  Mail,
  Rocket,
  ArrowLeftRight,
  Bot,
  Search,
  Play,
  Save,
  Trash2,
  X,
  GripVertical,
} from 'lucide-react';

type NodeTypeId = 'ai' | 'code' | 'webhook' | 'condition' | 'timer' | 'email' | 'deploy' | 'transform' | 'agent' | 'research';

interface NodeTypeConfig {
  id: NodeTypeId;
  label: string;
  description: string;
  color: string;
  borderClass: string;
  selectedBorderClass: string;
  icon: React.ReactNode;
  configFields: ConfigField[];
}

interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  placeholder?: string;
  options?: string[];
}

interface CanvasNode {
  id: string;
  typeId: NodeTypeId;
  x: number;
  y: number;
  config: Record<string, string>;
}

interface Connection {
  id: string;
  sourceNodeId: string;
  sourcePort: 'output';
  targetNodeId: string;
  targetPort: 'input';
}

const NODE_TYPES: NodeTypeConfig[] = [
  {
    id: 'ai',
    label: 'AI Task',
    description: 'Run an AI model inference',
    color: '#818cf8',
    borderClass: 'border-indigo-500/40',
    selectedBorderClass: 'border-indigo-400',
    icon: <Brain size={16} />,
    configFields: [
      { key: 'model', label: 'Model', type: 'select', options: ['gpt-4', 'claude-3', 'gemini-pro', 'llama-3'] },
      { key: 'prompt', label: 'Prompt', type: 'textarea', placeholder: 'Enter prompt template...' },
      { key: 'temperature', label: 'Temperature', type: 'text', placeholder: '0.7' },
    ],
  },
  {
    id: 'code',
    label: 'Code Execution',
    description: 'Execute custom code',
    color: '#4ade80',
    borderClass: 'border-green-500/40',
    selectedBorderClass: 'border-green-400',
    icon: <Code2 size={16} />,
    configFields: [
      { key: 'language', label: 'Language', type: 'select', options: ['python', 'javascript', 'typescript', 'rust', 'go'] },
      { key: 'code', label: 'Code', type: 'textarea', placeholder: 'Write your code here...' },
      { key: 'timeout', label: 'Timeout (ms)', type: 'text', placeholder: '30000' },
    ],
  },
  {
    id: 'webhook',
    label: 'Web Hook',
    description: 'Send or receive HTTP requests',
    color: '#fb923c',
    borderClass: 'border-orange-500/40',
    selectedBorderClass: 'border-orange-400',
    icon: <Webhook size={16} />,
    configFields: [
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://api.example.com/webhook' },
      { key: 'method', label: 'Method', type: 'select', options: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
      { key: 'headers', label: 'Headers (JSON)', type: 'textarea', placeholder: '{"Content-Type": "application/json"}' },
    ],
  },
  {
    id: 'condition',
    label: 'Condition',
    description: 'Branch based on logic',
    color: '#facc15',
    borderClass: 'border-yellow-500/40',
    selectedBorderClass: 'border-yellow-400',
    icon: <GitBranch size={16} />,
    configFields: [
      { key: 'expression', label: 'Expression', type: 'text', placeholder: 'data.status === "success"' },
      { key: 'trueBranch', label: 'True Label', type: 'text', placeholder: 'Pass' },
      { key: 'falseBranch', label: 'False Label', type: 'text', placeholder: 'Fail' },
    ],
  },
  {
    id: 'timer',
    label: 'Timer',
    description: 'Delay or schedule execution',
    color: '#9ca3af',
    borderClass: 'border-gray-500/40',
    selectedBorderClass: 'border-gray-400',
    icon: <Timer size={16} />,
    configFields: [
      { key: 'duration', label: 'Duration (ms)', type: 'text', placeholder: '1000' },
      { key: 'mode', label: 'Mode', type: 'select', options: ['delay', 'interval', 'cron'] },
      { key: 'cron', label: 'Cron Expression', type: 'text', placeholder: '0 * * * *' },
    ],
  },
  {
    id: 'email',
    label: 'Email',
    description: 'Send an email notification',
    color: '#f472b6',
    borderClass: 'border-pink-500/40',
    selectedBorderClass: 'border-pink-400',
    icon: <Mail size={16} />,
    configFields: [
      { key: 'to', label: 'To', type: 'text', placeholder: 'user@example.com' },
      { key: 'subject', label: 'Subject', type: 'text', placeholder: 'Workflow notification' },
      { key: 'body', label: 'Body', type: 'textarea', placeholder: 'Email content...' },
    ],
  },
  {
    id: 'deploy',
    label: 'Deploy',
    description: 'Deploy to a target environment',
    color: '#22d3ee',
    borderClass: 'border-cyan-500/40',
    selectedBorderClass: 'border-cyan-400',
    icon: <Rocket size={16} />,
    configFields: [
      { key: 'target', label: 'Target', type: 'select', options: ['aws', 'gcp', 'azure', 'vercel', 'netlify'] },
      { key: 'region', label: 'Region', type: 'text', placeholder: 'us-east-1' },
      { key: 'envVars', label: 'Environment Variables', type: 'textarea', placeholder: 'KEY=value' },
    ],
  },
  {
    id: 'transform',
    label: 'Transform Data',
    description: 'Map and reshape data between nodes',
    color: '#60a5fa',
    borderClass: 'border-blue-500/40',
    selectedBorderClass: 'border-blue-400',
    icon: <ArrowLeftRight size={16} />,
    configFields: [
      { key: 'inputPath', label: 'Input Path', type: 'text', placeholder: '$.data.results' },
      { key: 'outputPath', label: 'Output Path', type: 'text', placeholder: '$.transformed' },
      { key: 'mapping', label: 'Mapping (JSON)', type: 'textarea', placeholder: '{"key": "value"}' },
    ],
  },
  {
    id: 'agent',
    label: 'Agent Spawn',
    description: 'Spawn an autonomous AI agent',
    color: '#c084fc',
    borderClass: 'border-purple-500/40',
    selectedBorderClass: 'border-purple-400',
    icon: <Bot size={16} />,
    configFields: [
      { key: 'agentType', label: 'Agent Type', type: 'select', options: ['researcher', 'coder', 'analyst', 'writer'] },
      { key: 'task', label: 'Task Description', type: 'textarea', placeholder: 'Describe the agent task...' },
      { key: 'maxSteps', label: 'Max Steps', type: 'text', placeholder: '10' },
    ],
  },
  {
    id: 'research',
    label: 'Research',
    description: 'Search and gather information',
    color: '#2dd4bf',
    borderClass: 'border-teal-500/40',
    selectedBorderClass: 'border-teal-400',
    icon: <Search size={16} />,
    configFields: [
      { key: 'query', label: 'Query', type: 'text', placeholder: 'Search query...' },
      { key: 'sources', label: 'Sources', type: 'select', options: ['web', 'academic', 'news', 'documentation'] },
      { key: 'maxResults', label: 'Max Results', type: 'text', placeholder: '5' },
    ],
  },
];

const NODE_WIDTH = 220;
const NODE_HEIGHT = 72;
const PORT_RADIUS = 6;

function getNodeType(id: NodeTypeId): NodeTypeConfig {
  return NODE_TYPES.find((t) => t.id === id)!;
}

function getInputPortPos(node: CanvasNode) {
  return { x: node.x + NODE_WIDTH / 2, y: node.y };
}

function getOutputPortPos(node: CanvasNode) {
  return { x: node.x + NODE_WIDTH / 2, y: node.y + NODE_HEIGHT };
}

function makeBezier(x1: number, y1: number, x2: number, y2: number) {
  const dy = Math.abs(y2 - y1);
  const cp = Math.max(50, dy * 0.5);
  return `M ${x1} ${y1} C ${x1} ${y1 + cp}, ${x2} ${y2 - cp}, ${x2} ${y2}`;
}

let nextId = 1;
function genId() {
  return `n_${nextId++}_${Date.now()}`;
}

export function InfiniteCanvas() {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<{ nodeId: string; pos: { x: number; y: number } } | null>(null);
  const [mouseCanvas, setMouseCanvas] = useState<{ x: number; y: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const isDraggingNode = useRef(false);
  const dragNodeId = useRef<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.target !== canvasRef.current && !(e.target as HTMLElement).closest('[data-canvas-bg]')) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(3, Math.max(0.2, zoom * delta));
      const rect = canvasRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ratio = newZoom / zoom;
      setPan((p) => ({
        x: mx - (mx - p.x) * ratio,
        y: my - (my - p.y) * ratio,
      }));
      setZoom(newZoom);
    },
    [zoom],
  );

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        isPanning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
        e.preventDefault();
        return;
      }
      if (e.button === 0 && (e.target as HTMLElement).getAttribute('data-canvas-bg')) {
        setSelectedNodeId(null);
        setSelectedConnId(null);
        setConnectingFrom(null);
      }
    },
    [pan],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning.current) {
        setPan({
          x: panStart.current.px + (e.clientX - panStart.current.x),
          y: panStart.current.py + (e.clientY - panStart.current.y),
        });
        return;
      }
      if (isDraggingNode.current && dragNodeId.current) {
        const rect = canvasRef.current!.getBoundingClientRect();
        const cx = (e.clientX - rect.left - pan.x) / zoom - dragOffset.current.x;
        const cy = (e.clientY - rect.top - pan.y) / zoom - dragOffset.current.y;
        setNodes((prev) =>
          prev.map((n) => (n.id === dragNodeId.current ? { ...n, x: cx, y: cy } : n)),
        );
      }
      if (connectingFrom) {
        const rect = canvasRef.current!.getBoundingClientRect();
        setMouseCanvas({ x: (e.clientX - rect.left - pan.x) / zoom, y: (e.clientY - rect.top - pan.y) / zoom });
      }
    },
    [zoom, pan, connectingFrom],
  );

  const handleMouseUp = useCallback(
    (_e: React.MouseEvent) => {
      if (isPanning.current) {
        isPanning.current = false;
        return;
      }
      if (isDraggingNode.current) {
        isDraggingNode.current = false;
        dragNodeId.current = null;
        return;
      }
      if (connectingFrom && mouseCanvas) {
        const hitNode = nodes.find((n) => {
          const ip = getInputPortPos(n);
          const dx = mouseCanvas.x - ip.x;
          const dy = mouseCanvas.y - ip.y;
          return dx * dx + dy * dy < (PORT_RADIUS + 8) * (PORT_RADIUS + 8);
        });
        if (hitNode && hitNode.id !== connectingFrom.nodeId) {
          const exists = connections.some(
            (c) => c.sourceNodeId === connectingFrom.nodeId && c.targetNodeId === hitNode.id,
          );
          if (!exists) {
            const conn: Connection = {
              id: genId(),
              sourceNodeId: connectingFrom.nodeId,
              sourcePort: 'output',
              targetNodeId: hitNode.id,
              targetPort: 'input',
            };
            setConnections((prev) => [...prev, conn]);
          }
        }
        setConnectingFrom(null);
        setMouseCanvas(null);
      }
    },
    [connectingFrom, mouseCanvas, nodes, connections],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
        if (selectedNodeId) {
          setNodes((prev) => prev.filter((n) => n.id !== selectedNodeId));
          setConnections((prev) => prev.filter((c) => c.sourceNodeId !== selectedNodeId && c.targetNodeId !== selectedNodeId));
          setSelectedNodeId(null);
        } else if (selectedConnId) {
          setConnections((prev) => prev.filter((c) => c.id !== selectedConnId));
          setSelectedConnId(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedNodeId, selectedConnId]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const typeId = e.dataTransfer.getData('application/node-type') as NodeTypeId;
      if (!typeId) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const canvasX = (e.clientX - rect.left - pan.x) / zoom;
      const canvasY = (e.clientY - rect.top - pan.y) / zoom;
      const newNode: CanvasNode = {
        id: genId(),
        typeId,
        x: canvasX - NODE_WIDTH / 2,
        y: canvasY - NODE_HEIGHT / 2,
        config: {},
      };
      setNodes((prev) => [...prev, newNode]);
      setSelectedNodeId(newNode.id);
      setSelectedConnId(null);
    },
    [pan, zoom],
  );

  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      setSelectedNodeId(nodeId);
      setSelectedConnId(null);
      isDraggingNode.current = true;
      dragNodeId.current = nodeId;
      const node = nodes.find((n) => n.id === nodeId)!;
      const rect = canvasRef.current!.getBoundingClientRect();
      const cx = (e.clientX - rect.left - pan.x) / zoom;
      const cy = (e.clientY - rect.top - pan.y) / zoom;
      dragOffset.current = { x: cx - node.x, y: cy - node.y };
    },
    [nodes, pan, zoom],
  );

  const handleOutputPortClick = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.stopPropagation();
      e.preventDefault();
      const node = nodes.find((n) => n.id === nodeId)!;
      const pos = getOutputPortPos(node);
      setConnectingFrom({ nodeId, pos });
      setMouseCanvas(pos);
    },
    [nodes],
  );

  const handleConnectionClick = useCallback((e: React.MouseEvent, connId: string) => {
    e.stopPropagation();
    setSelectedConnId(connId);
    setSelectedNodeId(null);
  }, []);

  const handleSave = useCallback(() => {
    try {
      const data = JSON.stringify({ nodes, connections }, null, 2);
      localStorage.setItem('infinite-canvas-workflow', data);
      setConsoleLogs((prev) => [...prev, `[Save] Workflow saved (${nodes.length} nodes, ${connections.length} connections)`]);
    } catch {
      setConsoleLogs((prev) => [...prev, '[Save] Error saving workflow']);
    }
  }, [nodes, connections]);

  const handleRun = useCallback(() => {
    if (running) return;
    setRunning(true);
    const logs: string[] = [];
    logs.push('[Run] Starting workflow execution...');
    const sorted = [...nodes].sort((a, b) => a.y - b.y);
    const inDegree = new Map<string, number>();
    nodes.forEach((n) => inDegree.set(n.id, 0));
    connections.forEach((c) => { inDegree.set(c.targetNodeId, (inDegree.get(c.targetNodeId) ?? 0) + 1); });
    const queue: string[] = [];
    inDegree.forEach((deg, id) => {
      if (deg === 0) queue.push(id);
    });

    let step = 0;
    const executeStep = () => {
      if (step >= queue.length && step >= sorted.length) {
        logs.push('[Run] Workflow execution complete.');
        setConsoleLogs((prev) => [...prev, ...logs]);
        setRunning(false);
        return;
      }
      const nodeId = step < queue.length ? queue[step] : sorted[step]?.id;
      if (nodeId) {
        const node = nodes.find((n) => n.id === nodeId);
        if (node) {
          const nt = getNodeType(node.typeId);
          logs.push(`[Step ${step + 1}] Executing ${nt.label} node (${node.id.slice(0, 8)}...)`);
          const outConns = connections.filter((c) => c.sourceNodeId === nodeId);
          if (outConns.length > 0) {
            logs.push(`  → Routing to ${outConns.length} downstream node(s)`);
          }
        }
      }
      step++;
      setTimeout(executeStep, 300);
    };
    setTimeout(executeStep, 300);
  }, [nodes, connections, running]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedNodeId) {
      setNodes((prev) => prev.filter((n) => n.id !== selectedNodeId));
      setConnections((prev) => prev.filter((c) => c.sourceNodeId !== selectedNodeId && c.targetNodeId !== selectedNodeId));
      setSelectedNodeId(null);
    } else if (selectedConnId) {
      setConnections((prev) => prev.filter((c) => c.id !== selectedConnId));
      setSelectedConnId(null);
    }
  }, [selectedNodeId, selectedConnId]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedNodeType = selectedNode ? getNodeType(selectedNode.typeId) : null;

  const handleUpdateConfig = useCallback(
    (key: string, value: string) => {
      if (!selectedNodeId) return;
      setNodes((prev) =>
        prev.map((n) => (n.id === selectedNodeId ? { ...n, config: { ...n.config, [key]: value } } : n)),
      );
    },
    [selectedNodeId],
  );

  return (
    <div className="w-full h-full flex flex-col bg-[#0a0a0f] text-white select-none overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Sidebar - Palette */}
        <div className="w-52 flex-shrink-0 border-r border-white/[0.06] bg-[#0c0c12] flex flex-col">
          <div className="p-3 border-b border-white/[0.06]">
            <h2 className="text-xs font-semibold text-white/70 uppercase tracking-wider">Nodes</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {NODE_TYPES.map((nt) => (
              <div
                key={nt.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/node-type', nt.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-grab border ${nt.borderClass} bg-[#14141a] hover:bg-[#1a1a22] transition-colors active:cursor-grabbing`}
              >
                <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0" style={{ color: nt.color }}>
                  {nt.icon}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-white/90 truncate">{nt.label}</div>
                  <div className="text-[10px] text-white/40 truncate">{nt.description}</div>
                </div>
                <GripVertical size={12} className="text-white/20 ml-auto flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>

        {/* Canvas Area */}
        <div
          ref={canvasRef}
          className="flex-1 relative overflow-hidden"
          onWheel={handleWheel}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            isPanning.current = false;
            isDraggingNode.current = false;
            dragNodeId.current = null;
          }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div
            data-canvas-bg
            className="absolute inset-0"
            style={{
              backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)`,
              backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
              backgroundPosition: `${pan.x}px ${pan.y}px`,
            }}
          />

          <div
            className="absolute origin-top-left"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            {/* SVG Connections */}
            <svg
              className="absolute top-0 left-0 pointer-events-none"
              style={{ width: '10000px', height: '10000px', overflow: 'visible' }}
            >
              {connections.map((conn) => {
                const sourceNode = nodes.find((n) => n.id === conn.sourceNodeId);
                const targetNode = nodes.find((n) => n.id === conn.targetNodeId);
                if (!sourceNode || !targetNode) return null;
                const src = getOutputPortPos(sourceNode);
                const tgt = getInputPortPos(targetNode);
                const snt = getNodeType(sourceNode.typeId);
                const isSelected = conn.id === selectedConnId;
                return (
                  <path
                    key={conn.id}
                    d={makeBezier(src.x, src.y, tgt.x, tgt.y)}
                    fill="none"
                    stroke={isSelected ? '#fff' : snt.color}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    strokeOpacity={isSelected ? 1 : 0.6}
                    className="pointer-events-auto cursor-pointer"
                    onClick={(e) => handleConnectionClick(e, conn.id)}
                  />
                );
              })}
              {connectingFrom && mouseCanvas && (() => {
                const sourceNode = nodes.find((n) => n.id === connectingFrom.nodeId);
                if (!sourceNode) return null;
                const src = getOutputPortPos(sourceNode);
                const snt = getNodeType(sourceNode.typeId);
                return (
                  <path
                    d={makeBezier(src.x, src.y, mouseCanvas.x, mouseCanvas.y)}
                    fill="none"
                    stroke={snt.color}
                    strokeWidth={1.5}
                    strokeOpacity={0.5}
                    strokeDasharray="6 4"
                  />
                );
              })()}
            </svg>

            {/* Nodes */}
            {nodes.map((node) => {
              const nt = getNodeType(node.typeId);
              const isSelected = node.id === selectedNodeId;
              return (
                <div
                  key={node.id}
                  className={`absolute rounded-lg border ${isSelected ? nt.selectedBorderClass : nt.borderClass} bg-[#14141a] transition-shadow ${isSelected ? 'shadow-lg' : ''}`}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: NODE_WIDTH,
                    height: NODE_HEIGHT,
                    boxShadow: isSelected ? `0 0 16px ${nt.color}30` : undefined,
                  }}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                >
                  {/* Input Port */}
                  <div
                    className="absolute flex items-center justify-center cursor-crosshair z-10"
                    style={{
                      left: NODE_WIDTH / 2 - PORT_RADIUS,
                      top: -PORT_RADIUS,
                      width: PORT_RADIUS * 2,
                      height: PORT_RADIUS * 2,
                    }}
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full border-2 border-[#14141a]"
                      style={{ backgroundColor: nt.color }}
                    />
                  </div>

                  {/* Output Port */}
                  <div
                    className="absolute flex items-center justify-center cursor-crosshair z-10"
                    style={{
                      left: NODE_WIDTH / 2 - PORT_RADIUS,
                      top: NODE_HEIGHT - PORT_RADIUS,
                      width: PORT_RADIUS * 2,
                      height: PORT_RADIUS * 2,
                    }}
                    onMouseDown={(e) => handleOutputPortClick(e, node.id)}
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full border-2 border-[#14141a]"
                      style={{ backgroundColor: nt.color }}
                    />
                  </div>

                  {/* Node Content */}
                  <div className="flex items-start gap-2.5 p-3 h-full">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${nt.color}18`, color: nt.color }}
                    >
                      {nt.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-white/90 truncate">{nt.label}</div>
                      <div className="text-[10px] text-white/40 truncate mt-0.5">{nt.description}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Toolbar */}
          <div className="absolute top-3 left-3 flex items-center gap-1.5 z-20">
            <button
              onClick={handleRun}
              disabled={running}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600/90 hover:bg-green-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
            >
              <Play size={12} />
              {running ? 'Running...' : 'Run'}
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/80 text-xs font-medium transition-colors"
            >
              <Save size={12} />
              Save
            </button>
            {(selectedNodeId || selectedConnId) && (
              <button
                onClick={handleDeleteSelected}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs font-medium transition-colors"
              >
                <Trash2 size={12} />
                Delete
              </button>
            )}
            <div className="ml-2 px-2 py-1 rounded-md bg-white/[0.04] text-[10px] text-white/40">
              {nodes.length} nodes · {connections.length} connections
            </div>
          </div>

          {/* Zoom indicator */}
          <div className="absolute bottom-12 right-3 px-2 py-1 rounded-md bg-white/[0.04] text-[10px] text-white/40 z-20">
            {Math.round(zoom * 100)}%
          </div>
        </div>

        {/* Right Panel - Properties */}
        {selectedNode && selectedNodeType && (
          <div className="w-64 flex-shrink-0 border-l border-white/[0.06] bg-[#0c0c12] flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-white/[0.06]">
              <h2 className="text-xs font-semibold text-white/70 uppercase tracking-wider">Properties</h2>
              <button
                onClick={() => setSelectedNodeId(null)}
                className="p-1 rounded hover:bg-white/[0.06] text-white/40 hover:text-white/70 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              <div className="flex items-center gap-2.5 pb-3 border-b border-white/[0.06]">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${selectedNodeType.color}18`, color: selectedNodeType.color }}
                >
                  {selectedNodeType.icon}
                </div>
                <div>
                  <div className="text-sm font-semibold text-white/90">{selectedNodeType.label}</div>
                  <div className="text-[10px] text-white/40">{selectedNodeType.description}</div>
                </div>
              </div>
              {selectedNodeType.configFields.map((field) => (
                <div key={field.key}>
                  <label className="block text-[10px] font-medium text-white/50 mb-1">{field.label}</label>
                  {field.type === 'select' ? (
                    <select
                      value={selectedNode.config[field.key] ?? ''}
                      onChange={(e) => handleUpdateConfig(field.key, e.target.value)}
                      className="w-full px-2 py-1.5 rounded-md bg-[#14141a] border border-white/[0.06] text-xs text-white/80 outline-none focus:border-white/20 transition-colors"
                    >
                      <option value="">Select...</option>
                      {field.options?.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'textarea' ? (
                    <textarea
                      value={selectedNode.config[field.key] ?? ''}
                      onChange={(e) => handleUpdateConfig(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      rows={3}
                      className="w-full px-2 py-1.5 rounded-md bg-[#14141a] border border-white/[0.06] text-xs text-white/80 outline-none focus:border-white/20 transition-colors resize-none placeholder:text-white/20"
                    />
                  ) : (
                    <input
                      type="text"
                      value={selectedNode.config[field.key] ?? ''}
                      onChange={(e) => handleUpdateConfig(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="w-full px-2 py-1.5 rounded-md bg-[#14141a] border border-white/[0.06] text-xs text-white/80 outline-none focus:border-white/20 transition-colors placeholder:text-white/20"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Console */}
      <div className="h-32 flex-shrink-0 border-t border-white/[0.06] bg-[#0c0c12] flex flex-col">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06]">
          <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">Console</span>
          <button
            onClick={() => setConsoleLogs([])}
            className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
          >
            Clear
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] space-y-0.5">
          {consoleLogs.length === 0 ? (
            <div className="text-white/20 italic">No output yet. Run the workflow to see logs.</div>
          ) : (
            consoleLogs.map((log, i) => (
              <div key={i} className={log.startsWith('[Run]') || log.startsWith('[Step') ? 'text-green-400/80' : log.startsWith('[Save]') ? 'text-blue-400/80' : log.includes('→') ? 'text-white/50' : 'text-white/60'}>
                {log}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

