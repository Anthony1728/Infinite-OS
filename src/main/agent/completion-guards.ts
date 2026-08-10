const ACTION_REQUEST = /\b(run|do|use|control|build|create|write|edit|fix|inspect|audit|test|open|launch|search|browse|browsing|research|learn|learning|install|send|move|click|type|delete|deploy)\b/i;
const EXECUTION_COMMAND = /(?:^|\b(?:please|kindly|now|go\s+and)\s+)(?:run|use|control|fix|inspect|audit|test|open|launch|search|browse|research|learn|install|send|move|click|type|delete|deploy)\b/i;
const REQUESTED_EXECUTION = /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:run|use|control|build|create|write|edit|fix|inspect|audit|test|open|launch|search|install|send|move|click|type|delete|deploy)\b|\bi\s+(?:need|want)\s+you\s+to\s+(?:run|use|control|build|create|write|edit|fix|inspect|audit|test|open|launch|search|install|send|move|click|type|delete|deploy)\b/i;
const ARTIFACT_COMMAND = /\b(?:build|create|write|edit)\b[\s\S]{0,80}\b(?:app|application|website|project|code|file|folder|document|spreadsheet|presentation|database|script|feature|component|page|dashboard|api)\b/i;
const EXPLANATION_ONLY = /^(?:please\s+)?(?:explain|describe|tell me|show me how|how|why|what)\b/i;
const ONLINE_LEARNING_ACTION = /\b(?:go\s+(?:and\s+)?|start|begin|keep)\b[\s\S]{0,60}\b(?:learn|learning|research|browsing)\b[\s\S]{0,80}\b(?:online|web|internet)\b/i;

/** True when a reply is expected to change or inspect real external state. */
export function requiresToolExecution(request: string): boolean {
  if (EXPLANATION_ONLY.test(request.trim()) && !REQUESTED_EXECUTION.test(request)) return false;
  return EXECUTION_COMMAND.test(request.trim()) || REQUESTED_EXECUTION.test(request) || ARTIFACT_COMMAND.test(request) || ONLINE_LEARNING_ACTION.test(request);
}

export function isUnfulfilledActionPromise(request: string, response: string): boolean {
  const promiseOnly = /\b(i(?:'ll| will| am going to)|let me|i can|i(?:'m| am) now)\b[\s\S]{0,160}\b(start|inspect|run|check|fix|build|create|open|search|brows(?:e|ing)|research|learn(?:ing)?)\b/i.test(response) &&
    !/\b(completed|finished|done|passed|failed|changed files|result|created|fixed)\b/i.test(response);
  const simulatedAction = /\*(?:moves?|clicks?|types?|opens?|navigates?|scrolls?|selects?|launches?|presses?)[^*]*\*/i.test(response);
  return ACTION_REQUEST.test(request) && (promiseOnly || simulatedAction);
}

export function isExplicitActionFailure(request: string, response: string): boolean {
  if (!ACTION_REQUEST.test(request)) return false;
  return /\b(?:i\s+(?:cannot|can't|couldn't|was unable to)|could not|unable to|failed to)\s+(?:complete|perform|execute|run|open|launch|create|write|edit|fix|send|control|access|connect)\b/i.test(response);
}
