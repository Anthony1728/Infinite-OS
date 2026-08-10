/** Select a compact, task-relevant schema set for small Ollama models. */
export function selectLocalModelTools<T extends { name: string }>(request: string, tools: T[]): T[] {
  const text = request.toLowerCase();
  const selected = new Set<string>(['WebSearch', 'WebFetch']);
  let matchedDomain = false;
  const add = (...names: string[]) => names.forEach((name) => selected.add(name));

   if (/\b(web|website|browser|chrome|google|amazon|url|page|online|search)\b/.test(text)) {
    add('browser_extension', 'Operator', 'Browser', 'Computer');
    matchedDomain = true;
  }
  if (/\b(computer|pc|desktop|screen|mouse|keyboard|click|type|scroll|window|application|app|notepad|excel|word|launch|open)\b/.test(text)) {
    add('Computer', 'System');
    matchedDomain = true;
  }
  if (/\b(code|coding|develop|developer|repository|repo|source|debug|bug|test|typecheck|lint|build|script|html|css|javascript|typescript|python|terminal|cmd|powershell|command)\b/.test(text)) {
    add('Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite', 'Git', 'Text', 'Math');
    matchedDomain = true;
  }
  if (/\b(calculate|math|statistics|mean|median|percent|convert|base|random number|expression|equation)\b/.test(text)) {
    add('Math');
    matchedDomain = true;
  }
  if (/\b(data|csv|json|parse|validate|extract|transform|schema|dataset|query)\b/.test(text)) {
    add('Json', 'Text');
    matchedDomain = true;
  }
  if (/\b(hash|encrypt|decrypt|password|uuid|base64|hmac|token|jwt|encode|decode|random|entropy)\b/.test(text)) {
    add('Crypto');
    matchedDomain = true;
  }
  if (/\b(time|date|timezone|timer|countdown|cron|schedule|pomodoro|when|deadline)\b/.test(text)) {
    add('Time', 'Timer');
    matchedDomain = true;
  }
  if (/\b(file|folder|directory|copy|move|rename|delete|compress|extract|desktop)\b/.test(text)) {
    add('Read', 'Write', 'Edit', 'Glob', 'Grep', 'FileOps', 'Delete');
    matchedDomain = true;
  }
  if (/\b(email|mail|inbox|recipient|subject|smtp|imap)\b/.test(text)) {
    add('Email');
    matchedDomain = true;
  }
  if (/\b(agent|subagent|parallel|delegate|specialist)\b/.test(text)) {
    add('Agent', 'CustomAgent');
    matchedDomain = true;
  }
  if (/\b(self.?improv|audit infinite os|buildfeature|rollback feature|new feature)\b/.test(text)) {
    add('SelfImprove', 'BuildFeature', 'RollbackFeature', 'Bash', 'Read', 'Edit', 'Glob', 'Grep');
    matchedDomain = true;
  }
  if (/\b(memory|knowledge|remember|rag|semantic)\b/.test(text)) { add('Knowledge'); matchedDomain = true; }
  if (/\b(project|board|sprint|milestone|checklist)\b/.test(text)) { add('Project'); matchedDomain = true; }
  if (/\b(automat|workflow|schedule|webhook|trigger)\b/.test(text)) { add('Automation'); matchedDomain = true; }
  if (/\b(deploy|deployment|publish|hosting|ci\/cd|release pipeline)\b/.test(text)) { add('Deploy', 'Bash'); matchedDomain = true; }
  if (/\b(app|application|react|electron|express|nextjs|fastify|react native|scaffold|template|build app|create app)\b/.test(text)) { add('AppBuilder', 'Bash', 'Read', 'Write', 'Edit'); matchedDomain = true; }
  if (/\b(website|webpage|portfolio|saas|ecommerce|landing page|build website|create website)\b/.test(text)) { add('WebsiteBuilder', 'Bash', 'Read', 'Write', 'Edit'); matchedDomain = true; }
  if (/\b(security|vulnerab|malware|defender|secret scan|hash)\b/.test(text)) { add('Security', 'Bash'); matchedDomain = true; }
  if (/\b(clipboard|copy and paste|paste)\b/.test(text)) { add('Clipboard'); matchedDomain = true; }
  if (/\b(notification|notify|progress alert)\b/.test(text)) { add('Notification'); matchedDomain = true; }
  if (/\b(full.?screen|background|behind the scenes|visible automation|show (?:me )?(?:the )?(?:browser|computer)|hide (?:the )?(?:browser|computer)|pc control mode)\b/.test(text)) { add('AutomationDisplay'); matchedDomain = true; }
  if (/\b(git|commit|branch|pull request|push|diff)\b/.test(text)) { add('Git'); matchedDomain = true; }

  // Ambiguous action requests still get a compact general executor set.
  if (!matchedDomain && /\b(do|run|make|create|fix|change|perform|execute|inspect)\b/.test(text)) {
    add('Computer', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Json', 'Text', 'Math', 'Time', 'Crypto', 'Timer');
  }

  return tools.filter((tool) => selected.has(tool.name));
}
