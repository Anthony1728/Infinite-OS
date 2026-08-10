/**
 * Route requests that explicitly require fresh internet information before the
 * model answers. Keeping this deterministic lets non-tool-calling providers
 * benefit from WebSearch too: the agent loop executes the tool, then supplies
 * its result to the selected model on the continuation turn.
 */
export function routeForcedResearchTool(text: string): { name: 'WebSearch'; input: { query: string } } | null {
  const query = text.trim();
  if (!query) return null;

  const explicitWebSearch =
    /\b(?:web\s*search|search\s+(?:the\s+)?(?:web|internet|online)|browse\s+(?:the\s+)?(?:web|internet)|google)\b/i.test(query) ||
    /\b(?:look|check)\s+(?:it|this|that|them|[\w'’-]+(?:\s+[\w'’-]+){0,8})\s+up\s+(?:online|on\s+the\s+web)\b/i.test(query) ||
    /\b(?:find|research|look\s+up|check)\b[\s\S]{0,100}\b(?:online|on\s+the\s+web|on\s+the\s+internet)\b/i.test(query) ||
    /^(?:please\s+)?(?:search|look\s+up|google|browse|research)\b/i.test(query);

  const activeOnlineLearning = /\b(?:go\s+(?:and\s+)?|start|begin|keep)\b[\s\S]{0,60}\b(?:learn|learning|research|browsing)\b[\s\S]{0,80}\b(?:online|web|internet)\b/i.test(query);

  if (explicitWebSearch || activeOnlineLearning) return { name: 'WebSearch', input: { query } };

  // Freshness words alone are ambiguous (for example, "current file"). Only
  // force research when the request also names information that commonly
  // changes or directly asks who/what currently holds a role or value.
  const asksCurrentWhoOrWhat =
    /\b(?:who|what|which)\s+(?:is|are|was|were)\s+(?:the\s+)?(?:current|latest|newest|most\s+recent)\b/i.test(query);
  const freshnessWord = /\b(?:current|currently|latest|newest|recent|today(?:'s)?|right\s+now|this\s+week)\b/i.test(query);
  const changingSubject = /\b(?:news|headline|weather|forecast|price|exchange\s+rate|stock|market|score|standings|schedule|result|release|version|documentation|docs|api|law|regulation|rule|policy|president|prime\s+minister|governor|mayor|ceo|cto|leader|officeholder|availability|status|outage|event|election|poll)\b/i.test(query);

  if (asksCurrentWhoOrWhat || (freshnessWord && changingSubject)) {
    return { name: 'WebSearch', input: { query } };
  }

  return null;
}
