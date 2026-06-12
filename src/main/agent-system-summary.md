/*
 * Infinite AI OS - Agent System
 *
 * Overview:
 * This file contains the complete Agent system for InfiniteAI OS, which allows users to create and run
 * AI agents with access to tools, permissions, and provider integrations.
 *
 * Key Components:
 * 1. Agent Runtime (runtime.ts) - Manages agent spawning, execution, and lifecycle
 * 2. Agent Context (context.ts) - Builds system prompts and manages memory
 * 3. Agent Registry (registry.ts) - Defines built-in agents and custom agent support
 * 4. Agent Permissions (permissions.ts) - Controls tool usage permissions
 * 5. Agent Hooks (hooks.ts) - Hooks for tool execution and pre/post processing
 *
 * Provider Integration:
 * - 5 providers supported: OpenRouter, Groq, Ollama, Gemini, Anthropic
 * - API keys stored securely using Electron's safeStorage
 * - Provider registry allows dynamic discovery of providers
 * - Agent configuration includes provider selection
 *
 * Agent Types:
 * 1. General Agent - Full capability with all tools
 * 2. Research Agent - Read-only tools for web research
 * 3. Code Agent - Code development tools
 * 4. Design Agent - UI/UX and content tools
 * 5. Data Agent - Data analysis and processing tools
 * 6. SEO Agent - Search optimization analysis
 *
 * Custom Agents:
 * - Users can create custom agents with their own configurations
 * - Supports custom system prompts, allowed tools, and parameters
 * - Full CRUD operations for custom agents
 *
 * API Key Management:
 * - Users can add API keys for any provider through SettingsModal
 * - API key validation is performed when testing connections
 * - API keys are encrypted and stored locally
 * - Providers can have optional API keys (e.g., Ollama)
 */

export {};