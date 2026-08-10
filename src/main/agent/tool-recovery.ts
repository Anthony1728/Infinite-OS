export interface FailedToolAttempt {
  name: string;
  input: unknown;
  error: string;
}

export function toolAttemptSignature(name: string, input: unknown): string {
  let serialized = '';
  try { serialized = JSON.stringify(input) ?? ''; }
  catch { serialized = String(input); }
  return `${name}:${serialized}`.toLowerCase();
}

export function fallbackToolsFor(toolName: string): string[] {
  const routes: Record<string, string[]> = {
    Operator: ['browser_extension', 'Browser', 'WebFetch', 'WebSearch', 'Computer'],
    browser_extension: ['Operator', 'Browser', 'WebFetch', 'WebSearch', 'Computer'],
    Browser: ['Operator', 'browser_extension', 'WebFetch', 'WebSearch'],
    WebFetch: ['Browser', 'Operator', 'browser_extension', 'WebSearch'],
    WebSearch: ['Browser', 'Operator', 'browser_extension', 'WebFetch'],
    Computer: ['Operator', 'browser_extension', 'Bash', 'System', 'FileOps'],
    Bash: ['System', 'Read', 'Write', 'Edit', 'FileOps'],
    System: ['Bash', 'Computer'],
    Read: ['Glob', 'Grep', 'Bash'],
    Write: ['Edit', 'FileOps', 'Bash'],
    Edit: ['Write', 'FileOps', 'Bash'],
    Email: ['Operator', 'Browser', 'browser_extension'],
    Deploy: ['Bash', 'Git', 'WebFetch'],
    AppBuilder: ['Bash', 'Write', 'Edit', 'Read', 'Glob'],
    WebsiteBuilder: ['Bash', 'Write', 'Edit', 'Read', 'Glob'],
  };
  return routes[toolName] ?? ['inspect the error', 'use another authorized tool family'];
}

export function buildToolRecoveryDirective(failures: FailedToolAttempt[]): string {
  const unique = failures.filter((failure, index, items) =>
    items.findIndex((item) => item.name === failure.name && item.error === failure.error) === index,
  );
  const lines = unique.map((failure) => {
    const alternatives = fallbackToolsFor(failure.name).join(', ');
    return `- ${failure.name} failed: ${failure.error.slice(0, 300)}. Different routes to consider: ${alternatives}.`;
  });
  return [
    '[Tool recovery directive - continue working; do not repeat this text to the user.]',
    ...lines,
    'Diagnose the returned error. Retry only if you can change the arguments or conditions; otherwise use a materially different authorized tool or route. If this is a repeatable workflow and no suitable procedure exists, use Skills to search for one or SkillManage to create a reusable skill, then invoke it. Preserve completed work. Verify the outcome before claiming success. Permission denial, missing credentials, authentication, or an explicit user cancellation are real blockers and must not be bypassed.',
  ].join('\n');
}
