import type { Tool, ToolResult } from './base.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { randomUUID } from 'node:crypto';

interface KnowledgeNode {
  id: string;
  type: 'concept' | 'person' | 'project' | 'tool' | 'file' | 'idea' | 'task' | 'note' | 'fact' | 'skill';
  name: string;
  content: string;
  metadata: Record<string, unknown>;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  accessCount: number;
}

interface KnowledgeEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: 'related_to' | 'part_of' | 'depends_on' | 'created_by' | 'uses' | 'reminds_me_of' | 'contradicts' | 'supports' | 'evolved_into' | 'similar_to';
  weight: number;
  metadata: Record<string, unknown>;
  createdAt: number;
}

const DATA_DIR = join(infiniteHome(), 'knowledge-graph');

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadNodes(): KnowledgeNode[] {
  ensureDir();
  const path = join(DATA_DIR, 'nodes.json');
  if (!existsSync(path)) return [];
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return []; }
}

function loadEdges(): KnowledgeEdge[] {
  ensureDir();
  const path = join(DATA_DIR, 'edges.json');
  if (!existsSync(path)) return [];
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return []; }
}

function saveNodes(nodes: KnowledgeNode[]): void {
  ensureDir();
  writeFileSync(join(DATA_DIR, 'nodes.json'), JSON.stringify(nodes, null, 2));
}

function saveEdges(edges: KnowledgeEdge[]): void {
  ensureDir();
  writeFileSync(join(DATA_DIR, 'edges.json'), JSON.stringify(edges, null, 2));
}

function findPath(edges: KnowledgeEdge[], startId: string, endId: string, maxDepth: number = 5): string[] | null {
  const visited = new Set<string>();
  const queue: Array<{ id: string; path: string[] }> = [{ id: startId, path: [startId] }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.id === endId) return current.path;
    if (current.path.length > maxDepth) continue;
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    for (const edge of edges) {
      if (edge.sourceId === current.id && !visited.has(edge.targetId)) {
        queue.push({ id: edge.targetId, path: [...current.path, edge.targetId] });
      }
      if (edge.targetId === current.id && !visited.has(edge.sourceId)) {
        queue.push({ id: edge.sourceId, path: [...current.path, edge.sourceId] });
      }
    }
  }
  return null;
}

function getRelatedNodes(nodes: KnowledgeNode[], edges: KnowledgeEdge[], nodeId: string, maxDepth: number = 2): KnowledgeNode[] {
  const related = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    for (const edge of edges) {
      let neighborId: string | null = null;
      if (edge.sourceId === current.id) neighborId = edge.targetId;
      if (edge.targetId === current.id) neighborId = edge.sourceId;
      if (neighborId && !related.has(neighborId)) {
        related.add(neighborId);
        queue.push({ id: neighborId, depth: current.depth + 1 });
      }
    }
  }

  return nodes.filter((n) => related.has(n.id));
}

function searchNodes(nodes: KnowledgeNode[], query: string): KnowledgeNode[] {
  const lower = query.toLowerCase();
  return nodes.filter(
    (n) =>
      n.name.toLowerCase().includes(lower) ||
      n.content.toLowerCase().includes(lower) ||
      n.tags.some((t) => t.toLowerCase().includes(lower)),
  ).sort((a, b) => b.accessCount - a.accessCount);
}

export const knowledgeGraphTool: Tool = {
  name: 'KnowledgeGraph',
  description:
    'Interconnected knowledge graph for storing and retrieving information as nodes and edges. Build relationships between concepts, people, projects, ideas, and facts. Query by traversal, similarity, or path-finding. Perfect for complex reasoning and memory.',
  permission: 'ask',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add_node', 'add_edge', 'get_node', 'update_node', 'delete_node', 'search', 'related', 'path', 'neighbors', 'stats', 'export'],
        description: 'Knowledge graph action',
      },
      nodeType: { type: 'string', description: 'Node type (concept, person, project, tool, file, idea, task, note, fact, skill)' },
      name: { type: 'string', description: 'Node name' },
      content: { type: 'string', description: 'Node content/description' },
      nodeId: { type: 'string', description: 'Node ID for get/update/delete' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Node tags' },
      metadata: { type: 'object', description: 'Additional metadata' },
      sourceId: { type: 'string', description: 'Source node ID for edge' },
      targetId: { type: 'string', description: 'Target node ID for edge' },
      relation: { type: 'string', description: 'Edge relation type' },
      query: { type: 'string', description: 'Search query' },
      maxDepth: { type: 'number', description: 'Max traversal depth (default 2)' },
    },
    required: ['action'],
  },

  async execute(args): Promise<ToolResult> {
    const input = args as {
      action: string;
      nodeType?: string;
      name?: string;
      content?: string;
      nodeId?: string;
      tags?: string[];
      metadata?: Record<string, unknown>;
      sourceId?: string;
      targetId?: string;
      relation?: string;
      query?: string;
      maxDepth?: number;
    };

    try {
      const nodes = loadNodes();
      const edges = loadEdges();

      switch (input.action) {
        case 'add_node': {
          if (!input.name) return { content: 'name is required', is_error: true };

          const node: KnowledgeNode = {
            id: randomUUID(),
            type: (input.nodeType as KnowledgeNode['type']) || 'concept',
            name: input.name,
            content: input.content || '',
            metadata: input.metadata || {},
            tags: input.tags || [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            accessCount: 0,
          };

          nodes.push(node);
          saveNodes(nodes);

          return {
            content: [
              `Node created: ${node.name}`,
              `ID: ${node.id}`,
              `Type: ${node.type}`,
              `Tags: ${node.tags.join(', ') || 'none'}`,
            ].join('\n'),
          };
        }

        case 'add_edge': {
          if (!input.sourceId || !input.targetId) return { content: 'sourceId and targetId are required', is_error: true };

          const source = nodes.find((n) => n.id === input.sourceId);
          const target = nodes.find((n) => n.id === input.targetId);
          if (!source) return { content: `Source node not found: ${input.sourceId}`, is_error: true };
          if (!target) return { content: `Target node not found: ${input.targetId}`, is_error: true };

          const edge: KnowledgeEdge = {
            id: randomUUID(),
            sourceId: input.sourceId,
            targetId: input.targetId,
            relation: (input.relation as KnowledgeEdge['relation']) || 'related_to',
            weight: 1,
            metadata: input.metadata || {},
            createdAt: Date.now(),
          };

          edges.push(edge);
          saveEdges(edges);

          return {
            content: [
              `Edge created:`,
              `${source.name} --[${edge.relation}]--> ${target.name}`,
              `ID: ${edge.id}`,
            ].join('\n'),
          };
        }

        case 'get_node': {
          if (!input.nodeId) return { content: 'nodeId is required', is_error: true };
          const node = nodes.find((n) => n.id === input.nodeId);
          if (!node) return { content: `Node not found: ${input.nodeId}`, is_error: true };

          node.accessCount++;
          saveNodes(nodes);

          const nodeEdges = edges.filter((e) => e.sourceId === node.id || e.targetId === node.id);
          const connections = nodeEdges.map((e) => {
            const otherId = e.sourceId === node.id ? e.targetId : e.sourceId;
            const other = nodes.find((n) => n.id === otherId);
            return `  --[${e.relation}]--> ${other?.name || 'unknown'}`;
          });

          return {
            content: [
              `=== ${node.name} ===`,
              `ID: ${node.id}`,
              `Type: ${node.type}`,
              `Content: ${node.content}`,
              `Tags: ${node.tags.join(', ') || 'none'}`,
              `Created: ${new Date(node.createdAt).toLocaleString()}`,
              `Accessed: ${node.accessCount} times`,
              '',
              'Connections:',
              ...connections,
            ].join('\n'),
          };
        }

        case 'update_node': {
          if (!input.nodeId) return { content: 'nodeId is required', is_error: true };
          const node = nodes.find((n) => n.id === input.nodeId);
          if (!node) return { content: `Node not found: ${input.nodeId}`, is_error: true };

          if (input.name) node.name = input.name;
          if (input.content) node.content = input.content;
          if (input.tags) node.tags = input.tags;
          if (input.metadata) node.metadata = { ...node.metadata, ...input.metadata };
          node.updatedAt = Date.now();

          saveNodes(nodes);
          return { content: `Node updated: ${node.name}` };
        }

        case 'delete_node': {
          if (!input.nodeId) return { content: 'nodeId is required', is_error: true };
          const idx = nodes.findIndex((n) => n.id === input.nodeId);
          if (idx === -1) return { content: `Node not found: ${input.nodeId}`, is_error: true };

          const removed = nodes.splice(idx, 1)[0]!;
          const removedEdges = edges.filter((e) => e.sourceId === removed.id || e.targetId === removed.id);
          const remainingEdges = edges.filter((e) => e.sourceId !== removed.id && e.targetId !== removed.id);

          saveNodes(nodes);
          saveEdges(remainingEdges);
          return { content: `Deleted node: ${removed.name} and ${removedEdges.length} connected edge(s)` };
        }

        case 'search': {
          if (!input.query) return { content: 'query is required', is_error: true };
          const results = searchNodes(nodes, input.query);

          if (results.length === 0) return { content: `No nodes found for "${input.query}"` };

          const lines = [`=== Search Results for "${input.query}" (${results.length}) ===`, ''];
          for (const n of results.slice(0, 20)) {
            lines.push(`  [${n.type}] ${n.name}`);
            lines.push(`    ${n.content.slice(0, 100)}`);
            lines.push(`    Tags: ${n.tags.join(', ') || 'none'} | Accessed: ${n.accessCount}x`);
          }
          return { content: lines.join('\n') };
        }

        case 'related': {
          if (!input.nodeId) return { content: 'nodeId is required', is_error: true };
          const node = nodes.find((n) => n.id === input.nodeId);
          if (!node) return { content: `Node not found: ${input.nodeId}`, is_error: true };

          const related = getRelatedNodes(nodes, edges, node.id, input.maxDepth || 2);
          if (related.length === 0) return { content: `No related nodes found for "${node.name}"` };

          const lines = [`=== Related to "${node.name}" ===`, ''];
          for (const r of related) {
            lines.push(`  [${r.type}] ${r.name}`);
            lines.push(`    ${r.content.slice(0, 80)}`);
          }
          return { content: lines.join('\n') };
        }

        case 'path': {
          if (!input.sourceId || !input.targetId) return { content: 'sourceId and targetId are required', is_error: true };
          const source = nodes.find((n) => n.id === input.sourceId);
          const target = nodes.find((n) => n.id === input.targetId);
          if (!source) return { content: `Source node not found: ${input.sourceId}`, is_error: true };
          if (!target) return { content: `Target node not found: ${input.targetId}`, is_error: true };

          const path = findPath(edges, source.id, target.id);
          if (!path) return { content: `No path found between "${source.name}" and "${target.name}"` };

          const pathNodes = path.map((id) => nodes.find((n) => n.id === id)).filter(Boolean);
          const lines = [`=== Path: ${source.name} -> ${target.name} ===`, ''];
          for (let i = 0; i < pathNodes.length; i++) {
            const n = pathNodes[i]!;
            lines.push(`  ${i + 1}. [${n.type}] ${n.name}`);
            if (i < pathNodes.length - 1) lines.push(`     ↓`);
          }
          return { content: lines.join('\n') };
        }

        case 'neighbors': {
          if (!input.nodeId) return { content: 'nodeId is required', is_error: true };
          const node = nodes.find((n) => n.id === input.nodeId);
          if (!node) return { content: `Node not found: ${input.nodeId}`, is_error: true };

          const nodeEdges = edges.filter((e) => e.sourceId === node.id || e.targetId === node.id);
          const neighbors = nodeEdges.map((e) => {
            const otherId = e.sourceId === node.id ? e.targetId : e.sourceId;
            const other = nodes.find((n) => n.id === otherId);
            return { node: other, relation: e.relation, weight: e.weight };
          }).filter((n) => n.node);

          if (neighbors.length === 0) return { content: `No neighbors for "${node.name}"` };

          const lines = [`=== Neighbors of "${node.name}" ===`, ''];
          for (const { node: n, relation, weight } of neighbors) {
            lines.push(`  [${relation}] ${n!.name} (weight: ${weight})`);
          }
          return { content: lines.join('\n') };
        }

        case 'stats': {
          const typeCounts: Record<string, number> = {};
          for (const n of nodes) {
            typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
          }

          const relationCounts: Record<string, number> = {};
          for (const e of edges) {
            relationCounts[e.relation] = (relationCounts[e.relation] || 0) + 1;
          }

          return {
            content: [
              '=== Knowledge Graph Stats ===',
              `Total Nodes: ${nodes.length}`,
              `Total Edges: ${edges.length}`,
              '',
              'Node Types:',
              ...Object.entries(typeCounts).map(([type, count]) => `  ${type}: ${count}`),
              '',
              'Edge Relations:',
              ...Object.entries(relationCounts).map(([rel, count]) => `  ${rel}: ${count}`),
            ].join('\n'),
          };
        }

        case 'export': {
          return {
            content: JSON.stringify({ nodes, edges }, null, 2),
          };
        }

        default:
          return { content: `Unknown action: ${input.action}`, is_error: true };
      }
    } catch (error) {
      return { content: `KnowledgeGraph error: ${(error as Error).message}`, is_error: true };
    }
  },
};
