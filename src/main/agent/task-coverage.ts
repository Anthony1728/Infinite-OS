export interface SuccessfulToolAction {
  name: string;
  input: unknown;
}

function computerAction(item: SuccessfulToolAction): string {
  if (!item.input || typeof item.input !== 'object') return '';
  const action = (item.input as { action?: unknown }).action;
  if (typeof action !== 'string') return '';
  // PCLiveMap is the preferred vector path — treat it as the modern equivalent of Computer observations/actions
  if (item.name === 'PCLiveMap' && ['live', 'agent', 'elements', 'health', 'events'].includes(action)) return 'visual_observe';
  if (item.name === 'PCLiveMap' && ['click', 'click_name', 'move', 'doubleclick', 'drag', 'type', 'keys', 'scroll', 'wait', 'focus'].includes(action)) return 'type_text';
  if (item.name !== 'Computer') return '';
  return action;
}

/** Required observable steps for common compound desktop requests. */
export function missingRequiredTaskActions(request: string, completed: SuccessfulToolAction[]): string[] {
  const text = request.toLowerCase();
  const opensDesktopApp = /\b(?:open|launch|start|run)\b[\s\S]{0,100}\b(?:notepad|word|excel|powerpoint|paint|calculator|cmd|terminal|powershell|vscode|code)\b/.test(text);
  const writesInDesktopApp = /\b(?:write|type|paste|put|enter|input)\b/.test(text) &&
    /\b(?:notepad|word|document|editor|field|window|app|application)\b/.test(text);
  if (!opensDesktopApp && !writesInDesktopApp) return [];

  const actions = completed.map(computerAction).filter(Boolean);
  const missing: string[] = [];
  if (opensDesktopApp && !actions.includes('launch_app')) missing.push('launch the requested desktop application');
  if (writesInDesktopApp) {
    const visualTypeIndex = actions.lastIndexOf('visual_type');
    const typeIndex = Math.max(visualTypeIndex, actions.lastIndexOf('type_text'));
    if (typeIndex < 0) {
      missing.push('type the requested content into the application');
    } else if (visualTypeIndex < 0) {
      const verifiedAfterTyping = actions.slice(typeIndex + 1).some((action) => action === 'visual_observe' || action === 'desktop_state');
      if (!verifiedAfterTyping) missing.push('visually verify the typed result');
    }
  }
  return missing;
}

export function isCompoundActionRequest(request: string): boolean {
  const actions = request.match(/\b(?:open|launch|start|run|write|type|paste|put|enter|input|click|search|create|save|send)\b/gi) ?? [];
  return actions.length >= 2 && /\b(?:and|then|after(?:\s+that)?|before|while)\b/i.test(request);
}
