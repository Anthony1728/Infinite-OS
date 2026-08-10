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
  ]) {
    toolRegistry.register(t);
  }
}
