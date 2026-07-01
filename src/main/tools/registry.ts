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
// Phase 1 new tools
import { clipboardTool, clipboardReadTool, clipboardWriteTool, clipboardImageTool } from './clipboard.js';
import { notificationTool, notificationProgressTool, notificationActionTool, notificationStatusTool, notificationClearTool } from './notification.js';
import { gitTool, gitStatusTool, gitLogTool, gitCommitTool, gitBranchTool, gitPushTool, gitPullTool, gitDiffTool } from './git.js';

export function registerBuiltinTools(): void {
  for (const t of [
    // Existing tools
    bash, read, write, edit, glob, grep, webfetch, websearch,
    todowrite, agentTool, createCustomAgentTool, computerTool, browserTool, selfImprove,
    // Clipboard tools
    clipboardTool, clipboardReadTool, clipboardWriteTool, clipboardImageTool,
    // Notification tools
    notificationTool, notificationProgressTool, notificationActionTool,
    notificationStatusTool, notificationClearTool,
    // Git tools
    gitTool, gitStatusTool, gitLogTool, gitCommitTool, gitBranchTool,
    gitPushTool, gitPullTool, gitDiffTool,
  ]) {
    toolRegistry.register(t);
  }
}

