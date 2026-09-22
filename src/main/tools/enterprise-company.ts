/**
 * EnterpriseCompany — the agent's handle on the Enterprise tab's company
 * board. Read the company profile before answering business questions;
 * record complaints, decisions, contacts, and situational notes as they come
 * up so the owner sees them in the Enterprise view. Notes added here appear
 * in the UI; notes the user adds in the UI are visible here on the next call.
 */
import type { Tool, ToolResult } from './base.js';
import { getCompany, updateCompany, addCompanyNote, deleteCompanyNote } from '../enterprise/company.js';
import type { CompanyNoteKind } from '../enterprise/company.js';

const KINDS: CompanyNoteKind[] = ['note', 'complaint', 'decision', 'contact'];

export const enterpriseCompanyTool: Tool = {
  name: 'EnterpriseCompany',
  description: 'Read/edit the Enterprise-tab company board: profile + timestamped notes. get before business answers; add_note records complaints/decisions/facts; update keeps profile current. Shared with the Enterprise UI.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['get', 'update', 'add_note', 'delete_note'] },
      name: { type: 'string' },
      industry: { type: 'string' },
      website: { type: 'string' },
      text: { type: 'string', description: 'add_note: the note text' },
      kind: { type: 'string', enum: KINDS },
      id: { type: 'string', description: 'delete_note: the note id' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const input = args as { action: string; name?: string; industry?: string; website?: string; text?: string; kind?: string; id?: string };
    try {
      if (input.action === 'get') return json(getCompany());
      if (input.action === 'update') {
        return json(updateCompany({
          ...(typeof input.name === 'string' ? { name: input.name } : {}),
          ...(typeof input.industry === 'string' ? { industry: input.industry } : {}),
          ...(typeof input.website === 'string' ? { website: input.website } : {}),
        }));
      }
      if (input.action === 'add_note') {
        if (!input.text?.trim()) return bad('add_note requires text.');
        const kind: CompanyNoteKind = KINDS.includes(input.kind as CompanyNoteKind) ? (input.kind as CompanyNoteKind) : 'note';
        return json(addCompanyNote(input.text.trim(), kind, 'agent'));
      }
      if (input.action === 'delete_note') {
        if (!input.id) return bad('delete_note requires id.');
        return json({ deleted: deleteCompanyNote(input.id) });
      }
      return bad(`Unknown EnterpriseCompany action: ${input.action}`);
    } catch (error) { return bad((error as Error).message); }
  },
};

function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
