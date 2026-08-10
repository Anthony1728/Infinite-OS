import type { Tool, ToolResult } from './base.js';
import { hasEmailConfig, listEmails, readEmail, sendEmail } from '../email/index.js';

export const emailTool: Tool = {
  name: 'Email',
  description:
    'Use the configured mailbox from chat. Check configuration, list messages, read a message, or send an email. Always use send only after the user specifies or confirms the recipient and content.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['status', 'list', 'read', 'send'] },
      folder: { type: 'string', description: 'Mailbox folder, default INBOX' },
      limit: { type: 'number', description: 'Maximum messages to list' },
      uid: { type: 'string', description: 'Message UID for read' },
      to: { type: 'string', description: 'Recipient email address for send' },
      subject: { type: 'string', description: 'Email subject for send' },
      body: { type: 'string', description: 'Plain text email body for send' },
      in_reply_to: { type: 'string', description: 'Optional message ID being replied to' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const input = args as {
      action: 'status' | 'list' | 'read' | 'send';
      folder?: string;
      limit?: number;
      uid?: string;
      to?: string;
      subject?: string;
      body?: string;
      in_reply_to?: string;
    };

    try {
      if (input.action === 'status') {
        return { content: (await hasEmailConfig()) ? 'Email is configured.' : 'Email is not configured.' };
      }
      if (input.action === 'list') {
        const messages = await listEmails(input.folder ?? 'INBOX', input.limit ?? 20);
        return { content: JSON.stringify(messages, null, 2) };
      }
      if (input.action === 'read') {
        if (!input.uid) return required('uid');
        return { content: JSON.stringify(await readEmail(input.uid, input.folder ?? 'INBOX'), null, 2) };
      }
      if (!input.to || !input.subject || !input.body) return required('to, subject, and body');
      const result = await sendEmail(input.to, input.subject, input.body, input.in_reply_to);
      return result.ok
        ? { content: `Email sent to ${input.to}.` }
        : { content: `Email could not be sent: ${result.error ?? 'Unknown error'}`, is_error: true };
    } catch (error) {
      return { content: `Email action failed: ${(error as Error).message}`, is_error: true };
    }
  },
};

function required(fields: string): ToolResult {
  return { content: `Email action requires ${fields}.`, is_error: true };
}
