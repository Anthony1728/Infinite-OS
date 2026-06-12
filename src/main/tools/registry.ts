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
import { computerTool } from './computer.js';
import { browserTool } from './browser.js';
import { selfImprove } from './self-improve.js';

export function registerBuiltinTools(): void {
  for (const t of [bash, read, write, edit, glob, grep, webfetch, websearch, todowrite, agentTool, computerTool, browserTool, selfImprove]) {
    toolRegistry.register(t);
  }
}
