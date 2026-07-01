/**
 * Notification System Tool
 * 
 * Show system notifications to the user.
 * Used for alerting, task completion, and background task updates.
 */

import { Notification } from 'electron';
import type { Tool, ToolResult } from './base.js';

interface NotificationArgs {
  title: string;
  body: string;
  icon?: string;
  silent?: boolean;
  urgency?: 'low' | 'normal' | 'critical';
  timeoutType?: 'default' | 'never';
  actions?: Array<{ type: string; text: string }>;
  closeButtonText?: string;
}

interface NotificationProgressArgs {
  title: string;
  body?: string;
  progress?: number;
  isIndeterminate?: boolean;
}

// Active notifications for tracking
const activeNotifications = new Map<string, Notification>();

/**
 * Show a system notification
 */
export const notificationTool: Tool = {
  name: 'Notification',
  description: 'Show a system notification to the user. Use for important alerts, task completion, or background updates.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Notification title',
        maxLength: 100,
      },
      body: {
        type: 'string',
        description: 'Notification body text',
        maxLength: 500,
      },
      icon: {
        type: 'string',
        description: 'Icon name or path (optional)',
      },
      silent: {
        type: 'boolean',
        description: 'Whether to play a sound',
        default: false,
      },
      urgency: {
        type: 'string',
        enum: ['low', 'normal', 'critical'],
        description: 'Urgency level',
        default: 'normal',
      },
      timeoutType: {
        type: 'string',
        enum: ['default', 'never'],
        description: 'Whether to auto-dismiss',
        default: 'default',
      },
    },
    required: ['title', 'body'],
  },
  permission: 'ask',

  async execute(args: unknown, _ctx): Promise<ToolResult> {
    try {
      if (!Notification.isSupported()) {
        return { content: 'Notifications are not supported on this platform', is_error: true };
      }

const {
    title,
    body,
    icon,
    silent = false,
  } = args as NotificationArgs;

      // Validate input
      if (!title || title.trim().length === 0) {
        return { content: 'Notification title is required', is_error: true };
      }

      const notificationOptions: Electron.NotificationConstructorOptions = {
        title: title.trim(),
        body: body?.trim() || '',
        silent,
      };

      // Set icon if provided
      if (icon) {
        try {
          // Check if it's a built-in icon name or a file path
          if (icon.startsWith('/') || icon.startsWith('.') || icon.startsWith('C:')) {
            notificationOptions.icon = icon;
          } else {
            // Try to use a system icon or built-in
            notificationOptions.icon = icon;
          }
        } catch {
          // Ignore icon errors
        }
      }

      const notification = new Notification(notificationOptions);
      const notificationId = `notif-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      return new Promise<ToolResult>((resolve) => {
        notification.on('click', () => {
          activeNotifications.delete(notificationId);
          resolve({ content: `Notification clicked: ${title}` });
        });

        notification.on('close', () => {
          activeNotifications.delete(notificationId);
        });

        notification.on('failed', (_event, error) => {
          activeNotifications.delete(notificationId);
          resolve({ content: `Notification failed: ${error}`, is_error: true });
        });

        notification.show();
        activeNotifications.set(notificationId, notification);

        resolve({ content: `Notification shown: ${title}` });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Notification error: ${message}`, is_error: true };
    }
  },
};

/**
 * Show a progress notification (for long-running tasks)
 */
export const notificationProgressTool: Tool = {
  name: 'NotificationProgress',
  description: 'Show a progress notification for long-running tasks. Updates the progress bar in real-time.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Notification title',
      },
      body: {
        type: 'string',
        description: 'Progress description',
      },
      progress: {
        type: 'number',
        description: 'Progress percentage (0-100)',
        minimum: 0,
        maximum: 100,
      },
      isIndeterminate: {
        type: 'boolean',
        description: 'Show indeterminate progress bar',
        default: false,
      },
    },
    required: ['title'],
  },
  permission: 'ask',

  async execute(args: unknown, _ctx): Promise<ToolResult> {
    try {
      if (!Notification.isSupported()) {
        return { content: 'Notifications are not supported on this platform', is_error: true };
      }

      const { title, body, progress, isIndeterminate = false } = args as NotificationProgressArgs;

      // Note: Electron notification progress is Windows/macOS only
      const notification = new Notification({
        title,
        body: body || (isIndeterminate ? 'Processing...' : `Progress: ${progress ?? 0}%`),
        silent: false,
      });

      notification.show();

      // Update notification (if the platform supports it)
      const updateInterval = setInterval(() => {
        if (progress !== undefined && progress >= 100) {
          clearInterval(updateInterval);
          new Notification({
            title: `${title} Complete`,
            body: body || 'Task finished',
          }).show();
        }
      }, 1000);

      return {
        content: progress !== undefined
          ? `Progress: ${progress}%`
          : 'Indeterminate progress started',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Progress notification error: ${message}`, is_error: true };
    }
  },
};

/**
 * Show a notification with action buttons
 */
export const notificationActionTool: Tool = {
  name: 'NotificationAction',
  description: 'Show a notification with interactive action buttons. User response is returned.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Notification title',
      },
      body: {
        type: 'string',
        description: 'Notification body',
      },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            text: { type: 'string' },
          },
        },
        description: 'Action buttons to show',
      },
      closeButtonText: {
        type: 'string',
        description: 'Text for the close button',
      },
    },
    required: ['title', 'body'],
  },
  permission: 'ask',

  async execute(args: unknown, _ctx): Promise<ToolResult> {
    try {
      if (!Notification.isSupported()) {
        return { content: 'Notifications are not supported on this platform', is_error: true };
      }

      const { title, body, actions } = args as NotificationArgs;

      const notification = new Notification({
        title,
        body,
        actions: actions?.map((a) => ({ type: 'button' as const, text: a.text })),
      });

      return new Promise<ToolResult>((resolve) => {
notification.on('click', () => {
          resolve({ content: 'Notification clicked' });
        });

        notification.on('close', () => {
          resolve({ content: 'Notification dismissed' });
        });

        notification.show();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Notification action error: ${message}`, is_error: true };
    }
  },
};

/**
 * Check if notifications are supported
 */
export const notificationStatusTool: Tool = {
  name: 'NotificationStatus',
  description: 'Check if system notifications are supported and get current settings',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  permission: 'none',

  async execute(_args: unknown, _ctx): Promise<ToolResult> {
    const supported = Notification.isSupported();
    
    if (!supported) {
      return { content: 'Notifications are not supported on this platform' };
    }

    // Try to get Do Not Disturb status
    let dndStatus = 'unknown';
    try {
      // This is platform-specific and may not always work
      dndStatus = 'available';
    } catch {
      // Ignore
    }

    return {
      content: JSON.stringify({
        supported: true,
        doNotDisturb: dndStatus,
        activeCount: activeNotifications.size,
      }),
    };
  },
};

/**
 * Clear all active notifications
 */
export const notificationClearTool: Tool = {
  name: 'NotificationClear',
  description: 'Clear all active notifications',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  permission: 'none',

  async execute(_args: unknown, _ctx): Promise<ToolResult> {
    const count = activeNotifications.size;
    for (const [id, notification] of activeNotifications) {
      try {
        notification.close();
      } catch {
        // Ignore
      }
      activeNotifications.delete(id);
    }
    return { content: `Cleared ${count} notifications` };
  },
};