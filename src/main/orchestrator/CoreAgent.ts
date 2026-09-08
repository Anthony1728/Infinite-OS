/**
 * CoreAgent Orchestrator
 * 
 * The brain of Infinite AI. Takes user prompts, routes to the right provider,
 * manages tool execution via MCP, and loops until the task is complete.
 * 
 * This wraps the existing agent system with a unified interface for the
 * orchestrator architecture.
 */

import { randomUUID } from 'node:crypto';
import type { Message, ContentBlock } from '../../shared/types.js';
import { getProvider } from '../providers/registry.js';
import { getApiKey } from '../settings/secrets.js';
import { toolRegistry, unknownToolMessage } from '../tools/base.js';
import { executeToolCall } from '../agent/tool-execution.js';

// Types from core-types (inline to avoid import issues)
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  tool_calls?: ToolCall[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop';
}

export interface LLMStreamChunk {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'done';
  text?: string;
  tool_call?: ToolCall;
  tool_result?: string;
  error?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AgentConfig {
  provider: string;
  model: string;
  maxTurns?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface AgentTask {
  id: string;
  prompt: string;
  config: AgentConfig;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  toolCalls: ToolCall[];
}

export interface OrchestratorEvent {
  type: 'start' | 'text_delta' | 'tool_call' | 'tool_result' | 'complete' | 'error';
  taskId: string;
  data: Record<string, unknown>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<string>;
}

export interface CoreAgentOptions {
  defaultProvider?: string;
  defaultModel?: string;
  maxTurns?: number;
  onEvent?: (event: OrchestratorEvent) => void;
}

export class CoreAgent {
  private mcpRegistry: Map<string, MCPTool> = new Map();
  private tasks: Map<string, AgentTask> = new Map();
  private memory: ChatMessage[] = [];
  private options: Required<CoreAgentOptions>;

  constructor(options: CoreAgentOptions = {}) {
    this.options = {
      defaultProvider: options.defaultProvider ?? 'openrouter',
      defaultModel: options.defaultModel ?? 'google/gemma-4-31b-it:free',
      maxTurns: options.maxTurns ?? Number.POSITIVE_INFINITY,
      onEvent: options.onEvent ?? (() => {}),
    };
  }

  /**
   * Register an MCP tool for the agent to use
   */
  registerTool(tool: MCPTool): void {
    this.mcpRegistry.set(tool.name, tool);
  }

  /**
   * Register multiple tools at once
   */
  registerTools(tools: MCPTool[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): void {
    this.mcpRegistry.delete(name);
  }

  /**
   * Get list of registered tools
   */
  getTools(): MCPTool[] {
    return Array.from(this.mcpRegistry.values());
  }

  /**
   * Get a specific tool by name
   */
  getTool(name: string): MCPTool | undefined {
    return this.mcpRegistry.get(name);
  }

  /**
   * Execute a task with the agent
   */
  async executeTask(prompt: string, config?: Partial<AgentConfig>): Promise<string> {
    const taskId = randomUUID();
    const taskConfig: AgentConfig = {
      provider: config?.provider ?? this.options.defaultProvider,
      model: config?.model ?? this.options.defaultModel,
      maxTurns: config?.maxTurns ?? this.options.maxTurns,
      temperature: config?.temperature,
      systemPrompt: config?.systemPrompt,
    };

    const task: AgentTask = {
      id: taskId,
      prompt,
      config: taskConfig,
      status: 'running',
      startedAt: Date.now(),
      toolCalls: [],
    };

    this.tasks.set(taskId, task);
    this.emit({ type: 'start', taskId, data: { prompt } });

    try {
      const result = await this.runAgentLoop(task);
      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      this.emit({ type: 'complete', taskId, data: { result } });
      return result;
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      task.completedAt = Date.now();
      this.emit({ type: 'error', taskId, data: { error: task.error } });
      throw error;
    }
  }

  /**
   * Execute a task with streaming
   */
  async *executeTaskStream(
    prompt: string,
    config?: Partial<AgentConfig>,
  ): AsyncGenerator<LLMStreamChunk> {
    const taskId = randomUUID();
    const taskConfig: AgentConfig = {
      provider: config?.provider ?? this.options.defaultProvider,
      model: config?.model ?? this.options.defaultModel,
      maxTurns: config?.maxTurns ?? this.options.maxTurns,
      temperature: config?.temperature,
      systemPrompt: config?.systemPrompt,
    };

    const task: AgentTask = {
      id: taskId,
      prompt,
      config: taskConfig,
      status: 'running',
      startedAt: Date.now(),
      toolCalls: [],
    };

    this.tasks.set(taskId, task);
    this.emit({ type: 'start', taskId, data: { prompt } });

    try {
      const result = yield* this.runAgentLoopStream(task);
      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      this.emit({ type: 'complete', taskId, data: { result } });
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      task.completedAt = Date.now();
      this.emit({ type: 'error', taskId, data: { error: task.error } });
      yield { type: 'error', error: task.error };
    }
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks
   */
  getAllTasks(): AgentTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get conversation memory
   */
  getMemory(): ChatMessage[] {
    return [...this.memory];
  }

  /**
   * Clear conversation memory
   */
  clearMemory(): void {
    this.memory = [];
  }

  /**
   * Emit an event to the listener
   */
  private emit(event: OrchestratorEvent): void {
    this.options.onEvent(event);
  }

  /**
   * Core agent loop (non-streaming)
   */
  private async runAgentLoop(task: AgentTask): Promise<string> {
    const { provider: providerId, model, maxTurns, systemPrompt } = task.config;
    
    // Add user message to memory
    this.memory.push({ role: 'user', content: task.prompt });

    // Get provider
    const provider = getProvider(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const apiKey = await getApiKey(providerId);
    const tools = this.buildToolDefinitions();

    // Build messages for the LLM
    const messages = await this.buildMessages(task);

    for (let turn = 0; turn < (maxTurns ?? this.options.maxTurns); turn++) {
      // Build system prompt
      const system = systemPrompt ?? `You are Infinite AI, the brain inside Infinite OS. Infinite OS is the full AI-powered Windows workspace application. You have access to tools to help the user. Always be helpful and concise.`;

      // Call the LLM
      const stream = provider.streamChat(
        {
          model,
          messages,
          system,
          tools,
          stream: true,
        },
        apiKey,
      );

      const assistantContent: ContentBlock[] = [];
      const pendingToolCalls: Map<string, { name: string; json: string }> = new Map();

      // Process stream
      for await (const chunk of stream) {
        if (chunk.type === 'text_delta') {
          const text = chunk.text ?? '';
          if (text) {
            assistantContent.push({ type: 'text', text });
            this.emit({
              type: 'text_delta',
              taskId: task.id,
              data: { text },
            });
          }
        } else if (chunk.type === 'tool_use_start') {
          pendingToolCalls.set(chunk.id, {
            name: chunk.name,
            json: '',
          });
        } else if (chunk.type === 'tool_use_delta') {
          const tc = pendingToolCalls.get(chunk.id);
          if (tc) {
            tc.json += chunk.partial_json ?? '';
          }
        } else if (chunk.type === 'tool_use_end') {
          const tc = pendingToolCalls.get(chunk.id);
          if (tc) {
            tc.json = JSON.stringify(chunk.input);
          }
        } else if (chunk.type === 'error') {
          throw new Error(chunk.error ?? 'Stream error');
        }
      }

      // Process tool calls if any
      if (pendingToolCalls.size > 0) {
        const turnToolCalls: ToolCall[] = [];
        // Add assistant message with tool calls
        for (const [id, tc] of pendingToolCalls) {
          let input: Record<string, unknown> = {};
          try {
            input = tc.json ? JSON.parse(tc.json) : {};
          } catch {
            // Parse error, use empty input
          }
          assistantContent.push({
            type: 'tool_use',
            id,
            name: tc.name,
            input,
          });
          const toolCall = { id, name: tc.name, input };
          task.toolCalls.push(toolCall);
          turnToolCalls.push(toolCall);
        }

        const assistantMsg: Message = {
          id: randomUUID(),
          role: 'assistant',
          content: assistantContent,
          timestamp: Date.now(),
          model,
          provider: providerId,
        };
        messages.push(assistantMsg);

        this.emit({
          type: 'tool_call',
          taskId: task.id,
          data: { toolCalls: task.toolCalls },
        });

        // Execute tool calls
        for (const toolCall of turnToolCalls) {
          const result = await this.executeToolCall(toolCall, task);
          messages.push({
            id: randomUUID(),
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: toolCall.id, content: result }],
            timestamp: Date.now(),
          });
          this.emit({
            type: 'tool_result',
            taskId: task.id,
            data: { toolCallId: toolCall.id, result },
          });
        }

        continue;
      }

      // No tool calls, extract final response
      const textContent = assistantContent.find((b) => b.type === 'text');
      const response = textContent && textContent.type === 'text' ? textContent.text : '';

      this.memory.push({ role: 'assistant', content: response });
      return response;
    }

    throw new Error('Max turns exceeded');
  }

  /**
   * Core agent loop (streaming)
   */
  private async *runAgentLoopStream(task: AgentTask): AsyncGenerator<LLMStreamChunk, string> {
    const { provider: providerId, model, maxTurns, systemPrompt } = task.config;
    
    // Add user message to memory
    this.memory.push({ role: 'user', content: task.prompt });

    // Get provider
    const provider = getProvider(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const apiKey = await getApiKey(providerId);
    const tools = this.buildToolDefinitions();

    // Build messages for the LLM
    const messages = await this.buildMessages(task);

    for (let turn = 0; turn < (maxTurns ?? this.options.maxTurns); turn++) {
      const system = systemPrompt ?? `You are Infinite AI, the brain inside Infinite OS. Infinite OS is the full AI-powered Windows workspace application. You have access to tools to help the user. Always be helpful and concise.`;

      const stream = provider.streamChat(
        {
          model,
          messages,
          system,
          tools,
          stream: true,
        },
        apiKey,
      );

      const assistantContent: ContentBlock[] = [];
      let stopReason = 'end_turn';
      const pendingToolCalls: Map<string, { name: string; json: string }> = new Map();

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta') {
          const text = chunk.text ?? '';
          if (text) {
            assistantContent.push({ type: 'text', text });
            yield { type: 'text', text };
          }
        } else if (chunk.type === 'tool_use_start') {
          pendingToolCalls.set(chunk.id, {
            name: chunk.name,
            json: '',
          });
        } else if (chunk.type === 'tool_use_delta') {
          const tc = pendingToolCalls.get(chunk.id);
          if (tc) {
            tc.json += chunk.partial_json ?? '';
          }
        } else if (chunk.type === 'tool_use_end') {
          const tc = pendingToolCalls.get(chunk.id);
          if (tc) {
            tc.json = JSON.stringify(chunk.input);
          }
        } else if (chunk.type === 'message_end') {
          stopReason = chunk.stop_reason;
        } else if (chunk.type === 'error') {
          throw new Error(chunk.error ?? 'Stream error');
        }
      }

      // Process tool calls
      if (stopReason === 'tool_use' && pendingToolCalls.size > 0) {
        for (const [id, tc] of pendingToolCalls) {
          let input: Record<string, unknown> = {};
          try {
            input = tc.json ? JSON.parse(tc.json) : {};
          } catch {
            // Parse error
          }
          assistantContent.push({
            type: 'tool_use',
            id,
            name: tc.name,
            input,
          });
          task.toolCalls.push({ id, name: tc.name, input });
        }

        const assistantMsg: Message = {
          id: randomUUID(),
          role: 'assistant',
          content: assistantContent,
          timestamp: Date.now(),
          model,
          provider: providerId,
        };
        messages.push(assistantMsg);

        yield {
          type: 'tool_use',
          tool_call: task.toolCalls[task.toolCalls.length - 1],
        };

        // Execute tool calls
        for (const toolCall of task.toolCalls) {
          const result = await this.executeToolCall(toolCall, task);
          yield {
            type: 'tool_result',
            tool_result: result,
          };
        }

        continue;
      }

      // No tool calls, extract final response
      const textContent = assistantContent.find((b) => b.type === 'text');
      const response = textContent && textContent.type === 'text' ? textContent.text : '';

      this.memory.push({ role: 'assistant', content: response });
      yield { type: 'done' };
      return response;
    }

    throw new Error('Max turns exceeded');
  }

  /**
   * Build tool definitions for the LLM
   */
  private buildToolDefinitions(): ToolDefinition[] {
    const mcpTools = Array.from(this.mcpRegistry.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));

    // Also include built-in tools from the registry
    const builtInTools = toolRegistry.asProviderTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));

    return [...mcpTools, ...builtInTools];
  }

  /**
   * Build messages array for the LLM
   */
  private async buildMessages(_task: AgentTask): Promise<Message[]> {
    const messages: Message[] = [];

    // Add conversation memory
    for (const msg of this.memory) {
      messages.push({
        id: randomUUID(),
        role: msg.role,
        content: [{ type: 'text', text: msg.content }],
        timestamp: Date.now(),
      });
    }

    return messages;
  }

  /**
   * Execute a tool call
   */
  private async executeToolCall(toolCall: ToolCall, task: AgentTask): Promise<string> {
    const { name, input } = toolCall;

    // Check MCP registry first
    const mcpTool = this.mcpRegistry.get(name);
    if (mcpTool) {
      try {
        const result = await mcpTool.execute(input);
        return result;
      } catch (error) {
        const errorMsg = `Tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`;
        return errorMsg;
      }
    }

    // Fall back to built-in tools
    const builtInTool = toolRegistry.get(name);
    if (builtInTool) {
      try {
        const result = await executeToolCall({
          tool: builtInTool,
          toolUse: { type: 'tool_use', id: toolCall.id, name: builtInTool.name, input },
          sessionId: task.config.provider,
          cwd: process.cwd(),
          parentSignal: new AbortController().signal,
          onUpdate: () => {},
        });
        return typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      } catch (error) {
        const errorMsg = `Tool ${builtInTool.name} failed: ${error instanceof Error ? error.message : String(error)}`;
        return errorMsg;
      }
    }

    if (!name?.trim()) {
      return 'The model emitted a tool call with an empty tool name. Always include a non-empty tool name in every tool_use block.';
    }
    return unknownToolMessage(name);
  }
}

// Singleton instance
let coreAgent: CoreAgent | null = null;

export function getCoreAgent(): CoreAgent {
  if (!coreAgent) {
    coreAgent = new CoreAgent({
      onEvent: (event) => {
        // Default event handler - can be overridden
        console.log('[CoreAgent Event]', event.type, event.taskId);
      },
    });
  }
  return coreAgent;
}

export function createCoreAgent(options?: CoreAgentOptions): CoreAgent {
  return new CoreAgent(options);
}

