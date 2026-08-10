/**
 * Orchestrator Fastify Server
 * 
 * Optional HTTP server that exposes the CoreAgent via REST API.
 * Runs on port 3001 alongside the existing IPC backend.
 * 
 * Start with: node src/main/orchestrator/server.ts
 * Or from Electron main process as a background service.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { CoreAgent, createCoreAgent } from './CoreAgent.js';
import { toolRegistry } from '../tools/base.js';

const PORT = Number(process.env.ORCHESTRATOR_PORT ?? 3001);
const HOST = process.env.ORCHESTRATOR_HOST ?? '127.0.0.1';

let agent: CoreAgent | null = null;

function getAgent(): CoreAgent {
  if (!agent) {
    agent = createCoreAgent({
      onEvent: (_event) => {
        // Broadcast to SSE clients (TODO: implement SSE)
      },
    });
    // Register built-in tools
    registerBuiltInTools();
  }
  return agent;
}

function registerBuiltInTools(): void {
  const agent = getAgent();
  const tools = toolRegistry.list();
  for (const tool of tools) {
    agent.registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (input) => {
        const result = await tool.execute(input, {
          sessionId: 'orchestrator',
          cwd: process.cwd(),
          abortSignal: AbortSignal.timeout(30000),
          onUpdate: () => {},
        });
        return typeof result === 'string' ? result : JSON.stringify(result);
      },
    });
  }
}

export async function startOrchestratorServer(): Promise<void> {
  const fastify = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  });

  // Enable CORS
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Health check
  fastify.get('/api/health', async () => {
    return {
      status: 'ok',
      timestamp: Date.now(),
      uptime: process.uptime(),
    };
  });

  // List available tools
  fastify.get('/api/tools', async () => {
    const agent = getAgent();
    const tools = agent.getTools();
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
      count: tools.length,
    };
  });

  // List available providers/models
  fastify.get('/api/providers', async () => {
    // Return known providers - this could be enhanced to query the registry
    return {
      providers: [
        { id: 'openrouter', name: 'OpenRouter', requiresApiKey: true },
        { id: 'ollama', name: 'Ollama (Local)', requiresApiKey: false },
        { id: 'opencode', name: 'OpenCode', requiresApiKey: false },
        { id: 'openai', name: 'OpenAI', requiresApiKey: true },
        { id: 'anthropic', name: 'Anthropic', requiresApiKey: true },
        { id: 'gemini', name: 'Google Gemini', requiresApiKey: true },
      ],
    };
  });

  // Chat endpoint - non-streaming
  fastify.post('/api/chat', async (request, reply) => {
    const { prompt, provider, model, maxTurns, systemPrompt } = request.body as {
      prompt: string;
      provider?: string;
      model?: string;
      maxTurns?: number;
      systemPrompt?: string;
    };

    if (!prompt || typeof prompt !== 'string') {
      return reply.status(400).send({ error: 'prompt is required' });
    }

    const agent = getAgent();
    try {
      const result = await agent.executeTask(prompt, {
        provider,
        model,
        maxTurns,
        systemPrompt,
      });

      return {
        success: true,
        data: result,
        taskId: agent.getAllTasks().pop()?.id,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      fastify.log.error({ error: msg }, 'Chat execution failed');
      return reply.status(500).send({ error: msg });
    }
  });

  // Chat endpoint - streaming (SSE)
  fastify.post('/api/chat/stream', async (request, reply) => {
    const { prompt, provider, model, maxTurns, systemPrompt } = request.body as {
      prompt: string;
      provider?: string;
      model?: string;
      maxTurns?: number;
      systemPrompt?: string;
    };

    if (!prompt || typeof prompt !== 'string') {
      return reply.status(400).send({ error: 'prompt is required' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const agent = getAgent();
    try {
      const stream = agent.executeTaskStream(prompt, {
        provider,
        model,
        maxTurns,
        systemPrompt,
      });

      for await (const chunk of stream) {
        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      reply.raw.write(`data: [DONE]\n\n`);
      reply.raw.end();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`);
      reply.raw.end();
    }
  });

  // Execute a specific tool
  fastify.post('/api/tools/execute', async (request, reply) => {
    const { tool, input } = request.body as {
      tool: string;
      input: Record<string, unknown>;
    };

    if (!tool) {
      return reply.status(400).send({ error: 'tool name is required' });
    }

    const agent = getAgent();
    const mcpTool = agent.getTool(tool);

    if (!mcpTool) {
      return reply.status(404).send({ error: `Tool not found: ${tool}` });
    }

    try {
      const result = await mcpTool.execute(input ?? {});
      return { success: true, result };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: msg });
    }
  });

  // Get task status
  fastify.get('/api/tasks/:taskId', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const agent = getAgent();
    const task = agent.getTask(taskId);

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    return task;
  });

  // List all tasks
  fastify.get('/api/tasks', async () => {
    const agent = getAgent();
    return {
      tasks: agent.getAllTasks(),
    };
  });

  // Get conversation memory
  fastify.get('/api/memory', async () => {
    const agent = getAgent();
    return {
      memory: agent.getMemory(),
    };
  });

  // Clear memory
  fastify.delete('/api/memory', async () => {
    const agent = getAgent();
    agent.clearMemory();
    return { success: true };
  });

  // Register an MCP tool
  fastify.post('/api/tools/register', async (request, reply) => {
    const { name, description, inputSchema } = request.body as {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    };

    if (!name || !description) {
      return reply.status(400).send({ error: 'name and description are required' });
    }

    const agent = getAgent();
    agent.registerTool({
      name,
      description,
      inputSchema: inputSchema ?? {},
      execute: async () => {
        return `Tool ${name} executed (placeholder)`;
      },
    });

    return { success: true, message: `Tool ${name} registered` };
  });

  // Start server
  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`\n  Infinite AI Orchestrator running on http://${HOST}:${PORT}\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Run if called directly
const isMainModule = process.argv[1]?.includes('server');
if (isMainModule) {
  startOrchestratorServer().catch(console.error);
}

