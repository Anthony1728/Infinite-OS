/**
 * Clipboard Tool
 * 
 * Read from and write to the system clipboard.
 * Provides both tool interface for agent use and IPC for renderer.
 */

import { clipboard, nativeImage } from 'electron';
import type { Tool, ToolResult } from './base.js';

interface ClipboardReadArgs {
  format?: 'text' | 'html' | 'image' | 'imagePath';
}

interface ClipboardWriteArgs {
  text?: string;
  html?: string;
  imageBase64?: string;
}

interface ClipboardImageArgs {
  imageBase64?: string;
}

/**
 * Read from system clipboard
 */
export const clipboardReadTool: Tool = {
  name: 'ClipboardRead',
  description: 'Read content from the system clipboard. Can read text, HTML, or image data.',
  inputSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['text', 'html', 'image', 'imagePath'],
        description: 'Format to read: text (default), html, image (base64), or imagePath (temp file path)',
        default: 'text',
      },
    },
  },
  permission: 'none',

  async execute(args: unknown, _ctx): Promise<ToolResult> {
    try {
      const { format = 'text' } = args as ClipboardReadArgs;

      switch (format) {
        case 'text': {
          const text = clipboard.readText();
          return { content: text || '(empty clipboard)' };
        }

        case 'html': {
          const html = clipboard.readHTML();
          return { content: html || '(no HTML in clipboard)' };
        }

        case 'image': {
          const image = clipboard.readImage();
          if (image.isEmpty()) {
            return { content: '(no image in clipboard)', is_error: false };
          }
          const base64 = image.toDataURL();
          return { content: base64 };
        }

        case 'imagePath': {
          const image = clipboard.readImage();
          if (image.isEmpty()) {
            return { content: '(no image in clipboard)', is_error: false };
          }
          // Save to temp file and return path
          const { writeFile, mkdir } = await import('node:fs/promises');
          const { tmpdir } = await import('node:os');
          const { join } = await import('node:path');
          const { randomUUID } = await import('node:crypto');
          
          const tempDir = join(tmpdir(), 'infinite-ai', 'clipboard');
          await mkdir(tempDir, { recursive: true });
          const ext = format === 'imagePath' ? '.png' : '.png';
          const tempPath = join(tempDir, `clipboard-${randomUUID()}${ext}`);
          
          const pngBuffer = image.toPNG();
          await writeFile(tempPath, pngBuffer);
          return { content: tempPath };
        }

        default:
          return { content: `Unknown format: ${format}`, is_error: true };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Clipboard read error: ${message}`, is_error: true };
    }
  },
};

/**
 * Write to system clipboard
 */
export const clipboardWriteTool: Tool = {
  name: 'ClipboardWrite',
  description: 'Write content to the system clipboard. Can write text, HTML, or image data.',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Plain text to write to clipboard',
      },
      html: {
        type: 'string',
        description: 'HTML content to write to clipboard (for rich formatting)',
      },
      imageBase64: {
        type: 'string',
        description: 'Base64-encoded image data to write to clipboard',
      },
    },
  },
  permission: 'ask',

  async execute(args: unknown, _ctx): Promise<ToolResult> {
    try {
      const { text, html, imageBase64 } = args as ClipboardWriteArgs;

      if (!text && !html && !imageBase64) {
        return { content: 'No content provided to write', is_error: true };
      }

      let written = 0;

      if (text !== undefined && text !== null) {
        clipboard.writeText(text);
        written += text.length;
      }

      if (html !== undefined && html !== null) {
        clipboard.writeHTML(html);
      }

      if (imageBase64 !== undefined && imageBase64 !== null) {
        // Handle both base64 data URL and raw base64
        let base64Data = imageBase64;
        if (base64Data.startsWith('data:')) {
          // Extract base64 from data URL
          base64Data = base64Data.split(',')[1];
        }
        
        // Decode base64 to buffer
        const buffer = Buffer.from(base64Data, 'base64');
        const image = nativeImage.createFromBuffer(buffer);
        
        if (!image.isEmpty()) {
          clipboard.writeImage(image);
          written += buffer.length;
        } else {
          return { content: 'Invalid image data', is_error: true };
        }
      }

      const parts: string[] = [];
      if (text) parts.push(`${text.length} chars`);
      if (html) parts.push('HTML');
      if (imageBase64) parts.push('image');

      return { content: `Written ${parts.join(', ')} to clipboard` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Clipboard write error: ${message}`, is_error: true };
    }
  },
};

/**
 * Get clipboard image as base64
 */
export const clipboardImageTool: Tool = {
  name: 'ClipboardImage',
  description: 'Get or set an image in the clipboard. Useful for screenshot workflows.',
  inputSchema: {
    type: 'object',
    properties: {
      imageBase64: {
        type: 'string',
        description: 'Base64-encoded PNG image to write to clipboard',
      },
      getDimensions: {
        type: 'boolean',
        description: 'If true, return image dimensions without reading data',
        default: false,
      },
    },
  },
  permission: 'ask',

  async execute(args: unknown, _ctx): Promise<ToolResult> {
    try {
      const { imageBase64, getDimensions = false } = args as ClipboardImageArgs & { getDimensions?: boolean };

      if (imageBase64 !== undefined && imageBase64 !== null) {
        // Write image to clipboard
        let base64Data = imageBase64;
        if (base64Data.startsWith('data:')) {
          base64Data = base64Data.split(',')[1];
        }
        
        const buffer = Buffer.from(base64Data, 'base64');
        const image = nativeImage.createFromBuffer(buffer);
        
        if (image.isEmpty()) {
          return { content: 'Invalid image data', is_error: true };
        }
        
        clipboard.writeImage(image);
        return { content: `Written ${buffer.length} bytes to clipboard` };
      }

      // Read image from clipboard
      const image = clipboard.readImage();
      
      if (image.isEmpty()) {
        return { content: '(no image in clipboard)', is_error: false };
      }

      if (getDimensions) {
        const size = image.getSize();
        return { content: `Image: ${size.width}x${size.height} pixels` };
      }

      const base64 = image.toDataURL();
      return { content: base64 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Clipboard image error: ${message}`, is_error: true };
    }
  },
};

/**
 * Combined clipboard tool for general use
 */
export const clipboardTool: Tool = {
  name: 'Clipboard',
  description: 'Read or write text and images to/from the system clipboard',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'write'],
        description: 'read or write',
      },
      text: {
        type: 'string',
        description: 'Text to write (for write action)',
      },
      format: {
        type: 'string',
        enum: ['text', 'html', 'image'],
        description: 'Format to read (for read action)',
        default: 'text',
      },
    },
    required: ['action'],
  },
  permission: 'none',

  async execute(args: unknown, _ctx): Promise<ToolResult> {
    const { action, text, format = 'text' } = args as {
      action: 'read' | 'write';
      text?: string;
      format?: string;
    };

    if (action === 'write') {
      if (!text) {
        return { content: 'No text provided for write action', is_error: true };
      }
      clipboard.writeText(text);
      return { content: `Wrote ${text.length} characters to clipboard` };
    }

    // Read action
    if (format === 'image') {
      const image = clipboard.readImage();
      if (image.isEmpty()) {
        return { content: '(no image in clipboard)' };
      }
      return { content: image.toDataURL() };
    }

    const content = clipboard.readText();
    return { content: content || '(empty clipboard)' };
  },
};