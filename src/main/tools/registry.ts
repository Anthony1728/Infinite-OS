// Built-in tool registrations.

import { toolRegistry } from './base.js';
import { bash } from './bash.js';
import { read } from './read.js';
import { write } from './write.js';
import { edit } from './edit.js';
import { glob } from './glob.js';
import { grep } from './grep.js';
import { webfetch } from './webfetch.js';
import { websearch } from './websearch.js';
import { todowrite } from './todowrite.js';
import { agent as agentTool } from './agent.js';
import { crewTool } from './crew.js';
import { createCustomAgentTool } from './custom-agent.js';
import { computerTool } from './computer.js';
import { browserTool } from './browser.js';
import { selfImprove } from './self-improve.js';
import { buildFeatureTool, rollbackFeatureTool } from './build-feature.js';
import { emailTool } from './email.js';
import { operatorTool } from './operator.js';
import { browserExtensionTool } from './browser-extension.js';
import { deleteTool } from './delete.js';
import { fileOpsTool } from './file-ops.js';
import { knowledgeTool } from './knowledge.js';
import { systemTool } from './system.js';
import { securityTool } from './security.js';
import { projectTool } from './project.js';
import { automationTool } from './automation.js';
import { taskGroupTool } from './task-group.js';
import { deployTool } from './deploy.js';
import { businessTool } from './business.js';
import { gameAssistantTool } from './game-assistant.js';
import { teachTool } from './teach.js';
import { skillsTool, skillManageTool } from './skills.js';
import { businessAdvisorTool } from './business-advisor.js';
import { taskExecutorTool } from './task-executor.js';
import { automationDisplayTool } from './automation-display.js';
import { appBuilderTool } from './app-builder.js';
import { websiteBuilderTool } from './website-builder.js';
// Phase 1 new tools
import { clipboardTool, clipboardReadTool, clipboardWriteTool, clipboardImageTool } from './clipboard.js';import {
  notificationTool,
  notificationProgressTool,
  notificationActionTool,
  notificationStatusTool,
  notificationClearTool,
} from './notification.js';
import {
  gitTool,
  gitStatusTool,
  gitLogTool,
  gitCommitTool,
  gitBranchTool,
  gitPushTool,
  gitPullTool,
  gitDiffTool,
} from './git.js';
// Deterministic utility tools (Json, Text, Crypto, Time, Math, Timer)
import { jsonTool } from './json.js';
import { textTool } from './text.js';
import { cryptoTool } from './crypto.js';
import { timeTool } from './time.js';
import { mathTool } from './math.js';
import { timerTool } from './timer.js';
// Phase 1: Document/Chart/Image/API tools
import { documentGeneratorTool } from './document-generator.js';
import { chartGeneratorTool } from './chart-generator.js';
import { imageEditorTool } from './image-editor.js';
import { apiTesterTool } from './api-tester.js';
// Phase 2: Docker, CI/CD, Calendar
import { dockerTool } from './docker.js';
import { cicdTool } from './cicd.js';
import { calendarTool } from './calendar.js';
// Dynamic tab tool
import { createTabTool } from './create-tab.js';
// Phase 3: Database and Voice tools
import { databaseTool } from './database.js';
import { voiceTool } from './voice.js';
// Phase 4: Superpowers - Universal API, Enhanced Computer, Workflows, Games, Business
import { apiConnectorTool } from './api-connector.js';
import { enhancedComputerTool } from './enhanced-computer.js';
import { workflowTemplatesTool } from './workflow-templates.js';
import { gameEngineTool } from './game-engine.js';
import { businessSuiteTool } from './business-suite.js';
// Phase 5: Intelligence - Smart Scheduler, Knowledge Graph, Proactive Assistant
import { smartSchedulerTool } from './smart-scheduler.js';
import { knowledgeGraphTool } from './knowledge-graph.js';
import { proactiveAssistantTool } from './proactive-assistant.js';
// Phase 6: Meta - Dynamic Tool Registration
import { dynamicToolTool } from './dynamic-tool.js';

// Phase 6: Self-help - Network diagnostics and router management (user's own devices)
import { networkTool } from './network.js';
import { routerAdminTool } from './router-admin.js';
import { tabBrowserTool } from './tab-browser.js';
import { askQuestionTool } from './ask-question.js';

export function registerBuiltinTools(): void {
  for (const t of [
    // Existing tools
    bash,
    read,
    write,
    edit,
    glob,
    grep,
    webfetch,
    websearch,
    todowrite,
    agentTool,
    crewTool,
    createCustomAgentTool,
    computerTool,
    browserTool,
    selfImprove,
    buildFeatureTool,
    rollbackFeatureTool,
    emailTool,
    operatorTool,
    browserExtensionTool,
    deleteTool,
    fileOpsTool,
    knowledgeTool,
    systemTool,
    securityTool,
    projectTool,
    automationTool,
    taskGroupTool,
    deployTool,
    businessTool,
    // Phase 2 capability tools
    gameAssistantTool,
    teachTool,
    skillsTool,
    skillManageTool,
    businessAdvisorTool,
    taskExecutorTool,
    automationDisplayTool,
    // Builder tools
    appBuilderTool,
    websiteBuilderTool,
    // Clipboard tools (all four must be registered)
    clipboardTool,
    clipboardReadTool,
    clipboardWriteTool,
    clipboardImageTool,
    // Notification tools (all five must be registered)
    notificationTool,
    notificationProgressTool,
    notificationActionTool,
    notificationStatusTool,
    notificationClearTool,
    // Git tools (all eight must be registered)
    gitTool,
    gitStatusTool,
    gitLogTool,
    gitCommitTool,
    gitBranchTool,
    gitPushTool,
    gitPullTool,
    gitDiffTool,
    // Deterministic utility tools
    jsonTool,
    textTool,
    cryptoTool,
    timeTool,
    mathTool,
    timerTool,
    // Phase 1: Document/Chart/Image/API tools
    documentGeneratorTool,
    chartGeneratorTool,
    imageEditorTool,
    apiTesterTool,
    // Phase 2: Docker, CI/CD, Calendar
    dockerTool,
    cicdTool,
    calendarTool,
    // Dynamic tabs
    createTabTool,
    // Phase 3: Database and Voice
    databaseTool,
    voiceTool,
    // Phase 4: Superpowers
    apiConnectorTool,
    enhancedComputerTool,
    workflowTemplatesTool,
    gameEngineTool,
    businessSuiteTool,
    // Phase 5: Intelligence
    smartSchedulerTool,
    knowledgeGraphTool,
    proactiveAssistantTool,
    // Phase 6: Meta - Dynamic Tool Registration
    dynamicToolTool,

    // Phase 7: Self-help (user's own PC and network)
    networkTool,
    routerAdminTool,
    tabBrowserTool,
    askQuestionTool,
  ]) {
    toolRegistry.register(t);
  }
}
