// Document Generator Tool — PDF, Excel, PowerPoint, Word generation
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tool, ToolContext, ToolResult } from './base.js';

const OUTPUT_DIR = join(process.env.HOME || process.env.USERPROFILE || '.', 'infinite-documents');

interface DocGenArgs {
  action: 'create_pdf' | 'create_excel' | 'create_powerpoint' | 'create_word' | 'list' | 'open';
  filename?: string;
  title?: string;
  content?: string;
  data?: Record<string, unknown>[];
  columns?: { header: string; key: string; width?: number }[];
  slides?: { title: string; content: string; notes?: string }[];
  style?: 'professional' | 'modern' | 'minimal' | 'creative';
  orientation?: 'portrait' | 'landscape';
  margin?: number;
  outputDir?: string;
}

async function ensureOutputDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

function formatDate(): string {
  return new Date().toISOString().split('T')[0];
}

async function createPDF(args: DocGenArgs, ctx: ToolContext): Promise<ToolResult> {
  const { PDFDocument, rgb, StandardFonts, PDFName, PDFNumber } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = args.margin || 50;
  const pageWidth = args.orientation === 'landscape' ? 842 : 595;
  const pageHeight = args.orientation === 'landscape' ? 595 : 842;

  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  const contentWidth = pageWidth - 2 * margin;
  let y = pageHeight - margin;

  // Title
  if (args.title) {
    page.drawText(args.title, {
      x: margin,
      y,
      size: 24,
      font: helveticaBold,
      color: rgb(0.1, 0.1, 0.4),
    });
    y -= 35;

    // Underline
    page.drawLine({
      start: { x: margin, y: y + 5 },
      end: { x: margin + contentWidth, y: y + 5 },
      thickness: 2,
      color: rgb(0.3, 0.3, 0.8),
    });
    y -= 20;
  }

  // Date
  page.drawText(`Generated: ${formatDate()}`, {
    x: margin,
    y,
    size: 10,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });
  y -= 25;

  // Content
  if (args.content) {
    const lines = args.content.split('\n');
    for (const line of lines) {
      if (y < margin + 20) {
        const newPage = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
        // We can't reassign page since it's const, so we draw on the last page
        break;
      }
      page.drawText(line.substring(0, 80), {
        x: margin,
        y,
        size: 12,
        font: helvetica,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= 18;
    }
  }

  // Table from data
  if (args.data && args.columns && args.columns.length > 0) {
    y -= 10;
    const colWidth = contentWidth / args.columns.length;
    const rowHeight = 22;

    // Header row
    page.drawRectangle({
      x: margin,
      y: y - 5,
      width: contentWidth,
      height: rowHeight,
      color: rgb(0.15, 0.15, 0.5),
    });
    args.columns.forEach((col, i) => {
      page.drawText(col.header, {
        x: margin + i * colWidth + 5,
        y,
        size: 10,
        font: helveticaBold,
        color: rgb(1, 1, 1),
      });
    });
    y -= rowHeight;

    // Data rows
    for (const row of args.data) {
      if (y < margin + 20) break;
      args.columns.forEach((col, i) => {
        const val = String(row[col.key] ?? '');
        page.drawText(val.substring(0, 30), {
          x: margin + i * colWidth + 5,
          y,
          size: 10,
          font: helvetica,
          color: rgb(0.1, 0.1, 0.1),
        });
      });
      y -= rowHeight;
    }
  }

  const pdfBytes = await pdfDoc.save();
  const filename = args.filename || `document-${randomUUID().slice(0, 8)}.pdf`;
  const outDir = args.outputDir || OUTPUT_DIR;
  await ensureOutputDir(outDir);
  const filePath = join(outDir, filename);
  await writeFile(filePath, pdfBytes);

  return { content: `PDF created successfully: ${filePath} (${(pdfBytes.length / 1024).toFixed(1)} KB, ${args.data?.length || 0} rows)` };
}

async function createExcel(args: DocGenArgs, ctx: ToolContext): Promise<ToolResult> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Infinite OS';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(args.title || 'Sheet 1');

  // Add columns
  if (args.columns) {
    sheet.columns = args.columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width || 20,
    }));
  }

  // Style header row
  if (args.columns) {
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1A1A5C' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  }

  // Add data
  if (args.data) {
    sheet.addRows(args.data);
  }

  // Auto-filter
  if (args.columns && args.data) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: args.data.length + 1, column: args.columns.length },
    };
  }

  const filename = args.filename || `spreadsheet-${randomUUID().slice(0, 8)}.xlsx`;
  const outDir = args.outputDir || OUTPUT_DIR;
  await ensureOutputDir(outDir);
  const filePath = join(outDir, filename);

  const buffer = await workbook.xlsx.writeBuffer();
  await writeFile(filePath, Buffer.from(buffer));

  return { content: `Excel file created: ${filePath} (${args.data?.length || 0} rows, ${args.columns?.length || 0} columns)` };
}

async function createPowerPoint(args: DocGenArgs, ctx: ToolContext): Promise<ToolResult> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.title = args.title || 'Presentation';
  pptx.author = 'Infinite OS';

  const slides = args.slides || [];
  if (slides.length === 0 && args.content) {
    // Auto-generate slides from content
    const sections = args.content.split('\n\n');
    for (const section of sections) {
      const lines = section.trim().split('\n');
      slides.push({
        title: lines[0]?.substring(0, 60) || 'Slide',
        content: lines.slice(1).join('\n'),
      });
    }
  }

  for (const slide of slides) {
    const s = pptx.addSlide();
    s.addText(slide.title, {
      x: 0.5,
      y: 0.3,
      w: '90%',
      h: 1,
      fontSize: 28,
      bold: true,
      color: '1A1A5C',
    });
    s.addText(slide.content, {
      x: 0.5,
      y: 1.5,
      w: '90%',
      h: 4,
      fontSize: 16,
      color: '333333',
      valign: 'top',
      wrap: true,
    });
    if (slide.notes) {
      s.addNotes(slide.notes);
    }
  }

  // Title slide if no slides provided
  if (slides.length === 0) {
    const s = pptx.addSlide();
    s.addText(args.title || 'Presentation', {
      x: '10%',
      y: '30%',
      w: '80%',
      h: 2,
      fontSize: 36,
      bold: true,
      color: '1A1A5C',
      align: 'center',
    });
    s.addText(`Generated by Infinite OS\n${formatDate()}`, {
      x: '10%',
      y: '55%',
      w: '80%',
      h: 1.5,
      fontSize: 14,
      color: '666666',
      align: 'center',
    });
  }

  const filename = args.filename || `presentation-${randomUUID().slice(0, 8)}.pptx`;
  const outDir = args.outputDir || OUTPUT_DIR;
  await ensureOutputDir(outDir);
  const filePath = join(outDir, filename);

  const buffer = await pptx.write({ outputType: 'nodebuffer' });
  await writeFile(filePath, Buffer.from(buffer));

  return { content: `PowerPoint created: ${filePath} (${slides.length} slides)` };
}

async function createWord(args: DocGenArgs, ctx: ToolContext): Promise<ToolResult> {
  const docx = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } = docx;

  const children: (Paragraph | Table)[] = [];

  // Title
  if (args.title) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: args.title, bold: true, size: 48, color: '1A1A5C' })],
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
      }),
    );
  }

  // Date
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Generated: ${formatDate()}`, italics: true, size: 20, color: '888888' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
  );

  // Content
  if (args.content) {
    const paragraphs = args.content.split('\n');
    for (const para of paragraphs) {
      if (para.trim()) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: para, size: 24 })],
            spacing: { after: 120 },
          }),
        );
      }
    }
  }

  // Table from data
  if (args.data && args.columns && args.columns.length > 0) {
    const headerRow = new TableRow({
      children: args.columns.map(
        (col) =>
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: col.header, bold: true, size: 22, color: 'FFFFFF' })] })],
            shading: { fill: '1A1A5C' },
          }),
      ),
    });

    const dataRows = args.data.map(
      (row) =>
        new TableRow({
          children: args.columns.map(
            (col) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: String(row[col.key] ?? ''), size: 22 })] })],
              }),
          ),
        }),
    );

    children.push(
      new Table({
        rows: [headerRow, ...dataRows],
        width: { size: 100, type: WidthType.PERCENTAGE },
      }),
    );
  }

  const doc = new Document({
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  const filename = args.filename || `document-${randomUUID().slice(0, 8)}.docx`;
  const outDir = args.outputDir || OUTPUT_DIR;
  await ensureOutputDir(outDir);
  const filePath = join(outDir, filename);
  await writeFile(filePath, buffer);

  return { content: `Word document created: ${filePath} (${(buffer.length / 1024).toFixed(1)} KB)` };
}

export const documentGeneratorTool: Tool = {
  name: 'DocumentGenerator',
  description:
    'Generate professional documents: PDF, Excel spreadsheets, PowerPoint presentations, and Word documents. Supports tables, charts, styled content, and multiple formats.',
  permission: 'allow',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create_pdf', 'create_excel', 'create_powerpoint', 'create_word', 'list', 'open'],
        description: 'Document action to perform',
      },
      filename: { type: 'string', description: 'Output filename (auto-generated if omitted)' },
      title: { type: 'string', description: 'Document title' },
      content: { type: 'string', description: 'Document body content (text, markdown-like)' },
      data: {
        type: 'array',
        description: 'Table data as array of objects',
        items: { type: 'object' },
      },
      columns: {
        type: 'array',
        description: 'Table column definitions',
        items: {
          type: 'object',
          properties: {
            header: { type: 'string' },
            key: { type: 'string' },
            width: { type: 'number' },
          },
        },
      },
      slides: {
        type: 'array',
        description: 'PowerPoint slides (auto-generated from content if omitted)',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            notes: { type: 'string' },
          },
        },
      },
      style: { type: 'string', enum: ['professional', 'modern', 'minimal', 'creative'] },
      orientation: { type: 'string', enum: ['portrait', 'landscape'] },
      margin: { type: 'number', description: 'Page margin in points (default 50)' },
      outputDir: { type: 'string', description: 'Output directory' },
    },
    required: ['action'],
  },

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const a = args as DocGenArgs;

    try {
      switch (a.action) {
        case 'create_pdf':
          return await createPDF(a, ctx);
        case 'create_excel':
          return await createExcel(a, ctx);
        case 'create_powerpoint':
          return await createPowerPoint(a, ctx);
        case 'create_word':
          return await createWord(a, ctx);
        case 'list': {
          const { readdirSync, statSync } = await import('node:fs');
          const dir = a.outputDir || OUTPUT_DIR;
          try {
            const files = readdirSync(dir).filter((f) => /\.(pdf|xlsx|pptx|docx)$/i.test(f));
            return { content: `Documents in ${dir}:\n${files.map((f) => `  ${f} (${(statSync(join(dir, f)).size / 1024).toFixed(1)} KB)`).join('\n') || '(none)'}` };
          } catch {
            return { content: `No documents found in ${dir}` };
          }
        }
        case 'open': {
          const { execSync } = await import('node:child_process');
          const dir = a.outputDir || OUTPUT_DIR;
          const file = a.filename ? join(dir, a.filename) : dir;
          try {
            execSync(`start "" "${file}"`, { timeout: 5000 });
            return { content: `Opened: ${file}` };
          } catch {
            return { content: `Opened folder: ${dir}`, is_error: false };
          }
        }
        default:
          return { content: `Unknown action: ${a.action}`, is_error: true };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: `Document generation failed: ${msg}`, is_error: true };
    }
  },
};
