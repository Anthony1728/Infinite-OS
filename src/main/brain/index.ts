/**
 * Brain Module Barrel Export
 * 
 * Central export for all brain subsystems.
 */

export { InfiniteBrain } from './core.js';
export type { BrainConfig, BrainEvent, BrainState } from './core.js';

export { DecisionRouter } from './router.js';
export type { RouterConfig, TaskAnalysis, RoutingDecision } from './router.js';

export { SafetyGovernor } from './safety.js';
export type { SafetyConfig, ActionRequest, ValidationResult } from './safety.js';

export { OfflineManager } from './offline.js';
export type { OfflineConfig, ConnectivityStatus, OfflineCapability } from './offline.js';

export { ReasoningLoop } from './reasoning.js';
export type { ReasoningConfig, Thought, ReasoningResult } from './reasoning.js';

export { WorkflowEngine } from './workflow.js';
export type { WorkflowConfig, WorkflowStep, WorkflowResult } from './workflow.js';

export { SystemMonitor } from './monitor.js';
export type { MonitorConfig, SystemMetrics, AgentHealth, Alert } from './monitor.js';

export { SelfImprovementEngine } from './improvement.js';
export type { ImprovementConfig, TaskPattern, ErrorPattern, PerformanceMetric, ImprovementAction } from './improvement.js';

export { ToolMarketplace } from './marketplace.js';
export type { Tool, ToolCategory, ToolInstallation } from './marketplace.js';

export { DeveloperSDK } from './sdk.js';
export type { SDKConfig, ToolDefinition, AgentDefinition, WorkflowDefinition, PluginManifest } from './sdk.js';
