/**
 * Orchestrator Module
 * 
 * The core orchestrator layer for Infinite AI.
 * Provides the CoreAgent brain, MCP tool registry, and unified types.
 */

export { CoreAgent, createCoreAgent, getCoreAgent } from './CoreAgent.js';
export type {
  ChatMessage,
  ToolDefinition,
  LLMResponse,
  LLMStreamChunk,
  ToolCall,
  AgentConfig,
  AgentTask,
  OrchestratorEvent,
  MCPTool,
  CoreAgentOptions,
} from './CoreAgent.js';

export { InMemoryMCPRegistry, createMCPRegistry, getMCPRegistry } from './MCPRegistry.js';

export { startOrchestratorServer } from './server.js';

