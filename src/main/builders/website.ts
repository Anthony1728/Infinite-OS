/**
 * Website Builder
 *
 * Generate, manage, and deploy websites:
 * - Template-based generation
 * - Component system
 * - Page management
 * - Deployment
 * - Domain management
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface WebsiteBuilderConfig {
  dataDir: string;
  outputDir: string;
  defaultFramework: string;
}

export interface WebsiteComponent {
  id: string;
  type: 'header' | 'hero' | 'features' | 'pricing' | 'footer' | 'form' | 'gallery' | 'testimonial' | 'cta' | 'custom';
  name: string;
  props: Record<string, unknown>;
  order: number;
}

export interface WebsitePage {
  id: string;
  slug: string;
  title: string;
  components: WebsiteComponent[];
  seo: { title: string; description: string; keywords: string[] };
  createdAt: number;
  updatedAt: number;
}

export interface Website {
  id: string;
  name: string;
  description: string;
  domain?: string;
  framework: 'html' | 'react' | 'nextjs' | 'vue' | 'svelte';
  pages: WebsitePage[];
  theme: {
    primaryColor: string;
    secondaryColor: string;
    fontFamily: string;
    darkMode: boolean;
  };
  status: 'draft' | 'published' | 'deployed';
  createdAt: number;
  updatedAt: number;
  deployedAt?: number;
  deployUrl?: string;
}

export interface WebsiteTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  framework: string;
  pages: Array<{ slug: string; title: string; components: WebsiteComponent[] }>;
  theme: Website['theme'];
  preview: string;
  tags: string[];
}

export class WebsiteBuilder {
  private config: WebsiteBuilderConfig;
  private websites: Map<string, Website> = new Map();
  private templates: WebsiteTemplate[] = [];
  private dataDir: string;
  private outputDir: string;

  constructor(config?: Partial<WebsiteBuilderConfig>) {
    this.config = {
      dataDir: config?.dataDir ?? join(homedir(), '.infinite-ai', 'websites'),
      outputDir: config?.outputDir ?? join(homedir(), '.infinite-ai', 'websites', 'output'),
      defaultFramework: config?.defaultFramework ?? 'react',
    };
    this.dataDir = this.config.dataDir;
    this.outputDir = this.config.outputDir;
    this.ensureDir();
    this.loadData();
    this.initTemplates();
  }

  private ensureDir(): void {
    for (const dir of [this.dataDir, this.outputDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  private loadData(): void {
    try {
      const sitesPath = join(this.dataDir, 'websites.json');
      if (existsSync(sitesPath)) {
        const data = JSON.parse(readFileSync(sitesPath, 'utf-8'));
        this.websites = new Map(data);
      }
    } catch { /* silent */ }
  }

  private saveData(): void {
    try {
      writeFileSync(join(this.dataDir, 'websites.json'), JSON.stringify(Array.from(this.websites.entries()), null, 2));
    } catch { /* silent */ }
  }

  private initTemplates(): void {
    this.templates = [
      {
        id: 'portfolio',
        name: 'Portfolio',
        description: 'Professional portfolio website',
        category: 'personal',
        framework: 'react',
        pages: [
          {
            slug: '',
            title: 'Home',
            components: [
              { id: '1', type: 'header', name: 'Navigation', props: { links: ['Home', 'About', 'Projects', 'Contact'] }, order: 0 },
              { id: '2', type: 'hero', name: 'Hero Section', props: { title: 'Creative Developer', subtitle: 'Building beautiful digital experiences', cta: 'View My Work' }, order: 1 },
              { id: '3', type: 'features', name: 'Skills', props: { items: ['React', 'TypeScript', 'Node.js', 'UI/UX'] }, order: 2 },
              { id: '4', type: 'footer', name: 'Footer', props: { copyright: '2024' }, order: 3 },
            ],
          },
        ],
        theme: { primaryColor: '#3b82f6', secondaryColor: '#1e293b', fontFamily: 'Inter', darkMode: true },
        preview: 'portfolio-preview.png',
        tags: ['portfolio', 'personal', 'developer'],
      },
      {
        id: 'saas',
        name: 'SaaS Landing',
        description: 'Modern SaaS product landing page',
        category: 'business',
        framework: 'react',
        pages: [
          {
            slug: '',
            title: 'Landing',
            components: [
              { id: '1', type: 'header', name: 'Nav', props: { links: ['Features', 'Pricing', 'About'] }, order: 0 },
              { id: '2', type: 'hero', name: 'Hero', props: { title: 'Ship Faster', subtitle: 'The all-in-one platform', cta: 'Get Started' }, order: 1 },
              { id: '3', type: 'features', name: 'Features', props: { items: ['Fast', 'Secure', 'Scalable', 'Beautiful'] }, order: 2 },
              { id: '4', type: 'pricing', name: 'Pricing', props: { plans: [{ name: 'Free', price: 0 }, { name: 'Pro', price: 29 }] }, order: 3 },
              { id: '5', type: 'testimonial', name: 'Testimonials', props: { items: [] }, order: 4 },
              { id: '6', type: 'cta', name: 'CTA', props: { title: 'Ready to start?', button: 'Sign Up' }, order: 5 },
              { id: '7', type: 'footer', name: 'Footer', props: {}, order: 6 },
            ],
          },
        ],
        theme: { primaryColor: '#8b5cf6', secondaryColor: '#0f172a', fontFamily: 'Inter', darkMode: true },
        preview: 'saas-preview.png',
        tags: ['saas', 'landing', 'startup'],
      },
      {
        id: 'ecommerce',
        name: 'E-Commerce',
        description: 'Online store template',
        category: 'business',
        framework: 'nextjs',
        pages: [
          {
            slug: '',
            title: 'Shop',
            components: [
              { id: '1', type: 'header', name: 'Nav', props: { links: ['Shop', 'Categories', 'Cart'] }, order: 0 },
              { id: '2', type: 'hero', name: 'Banner', props: { title: 'New Arrivals', subtitle: 'Check out our latest products' }, order: 1 },
              { id: '3', type: 'gallery', name: 'Products', props: { columns: 4 }, order: 2 },
              { id: '4', type: 'footer', name: 'Footer', props: {}, order: 3 },
            ],
          },
        ],
        theme: { primaryColor: '#f59e0b', secondaryColor: '#1c1917', fontFamily: 'Inter', darkMode: false },
        preview: 'ecommerce-preview.png',
        tags: ['ecommerce', 'store', 'shop'],
      },
    ];
  }

  createWebsite(data: {
    name: string;
    description?: string;
    framework?: Website['framework'];
    templateId?: string;
  }): Website {
    let pages: WebsitePage[] = [];
    let theme = { primaryColor: '#3b82f6', secondaryColor: '#1e293b', fontFamily: 'Inter', darkMode: true };

    if (data.templateId) {
      const template = this.templates.find((t) => t.id === data.templateId);
      if (template) {
        pages = template.pages.map((p) => ({
          id: randomUUID(),
          slug: p.slug,
          title: p.title,
          components: p.components,
          seo: { title: p.title, description: '', keywords: [] },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }));
        theme = { ...template.theme };
      }
    }

    const website: Website = {
      id: randomUUID(),
      name: data.name,
      description: data.description ?? '',
      framework: data.framework ?? this.config.defaultFramework as Website['framework'],
      pages,
      theme,
      status: 'draft',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.websites.set(website.id, website);
    this.saveData();
    return website;
  }

  addPage(websiteId: string, slug: string, title: string): WebsitePage | null {
    const website = this.websites.get(websiteId);
    if (!website) return null;

    const page: WebsitePage = {
      id: randomUUID(),
      slug,
      title,
      components: [],
      seo: { title, description: '', keywords: [] },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    website.pages.push(page);
    website.updatedAt = Date.now();
    this.saveData();
    return page;
  }

  addComponent(websiteId: string, pageId: string, component: Omit<WebsiteComponent, 'id'>): WebsiteComponent | null {
    const website = this.websites.get(websiteId);
    if (!website) return null;

    const page = website.pages.find((p) => p.id === pageId);
    if (!page) return null;

    const fullComponent: WebsiteComponent = { ...component, id: randomUUID() };
    page.components.push(fullComponent);
    page.updatedAt = Date.now();
    website.updatedAt = Date.now();
    this.saveData();
    return fullComponent;
  }

  generateCode(websiteId: string): string {
    const website = this.websites.get(websiteId);
    if (!website) return '';

    if (website.framework === 'html') {
      return this.generateHTML(website);
    } else if (website.framework === 'react' || website.framework === 'nextjs') {
      return this.generateReact(website);
    }
    return this.generateHTML(website);
  }

  private generateHTML(website: Website): string {
    const { primaryColor, secondaryColor, fontFamily, darkMode } = website.theme;
    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${website.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: ${fontFamily}, sans-serif; background: ${darkMode ? '#0f172a' : '#ffffff'}; color: ${darkMode ? '#e2e8f0' : '#1e293b'}; }
    .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
    .btn { display: inline-block; padding: 12px 24px; background: ${primaryColor}; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; text-decoration: none; }
    .btn:hover { opacity: 0.9; }
    .btn-secondary { background: ${secondaryColor}; }
    nav { display: flex; justify-content: space-between; align-items: center; padding: 20px 0; border-bottom: 1px solid ${darkMode ? '#334155' : '#e2e8f0'}; }
    nav .logo { font-size: 24px; font-weight: 700; color: ${primaryColor}; }
    nav ul { display: flex; gap: 24px; list-style: none; }
    nav ul a { text-decoration: none; color: inherit; }
    section { padding: 80px 0; }
    .hero { text-align: center; padding: 120px 0; }
    .hero h1 { font-size: 48px; margin-bottom: 16px; background: linear-gradient(135deg, ${primaryColor}, ${secondaryColor}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero p { font-size: 20px; color: ${darkMode ? '#94a3b8' : '#64748b'}; margin-bottom: 32px; max-width: 600px; margin-left: auto; margin-right: auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; }
    .card { padding: 32px; background: ${darkMode ? '#1e293b' : '#f8fafc'}; border-radius: 12px; border: 1px solid ${darkMode ? '#334155' : '#e2e8f0'}; }
    .card h3 { margin-bottom: 12px; color: ${primaryColor}; }
    footer { padding: 40px 0; text-align: center; border-top: 1px solid ${darkMode ? '#334155' : '#e2e8f0'}; }
  </style>
</head>
<body>
  <div class="container">
    <nav>
      <div class="logo">${website.name}</div>
      <ul>
        <li><a href="#features">Features</a></li>
        <li><a href="#about">About</a></li>
        <li><a href="#contact">Contact</a></li>
      </ul>
    </nav>
`;

    for (const page of website.pages) {
      for (const comp of page.components.sort((a, b) => a.order - b.order)) {
        html += this.generateComponentHTML(comp, website.theme);
      }
    }

    html += `
    <footer>
      <p>&copy; ${new Date().getFullYear()} ${website.name}. All rights reserved.</p>
    </footer>
  </div>
</body>
</html>`;

    return html;
  }

  private generateComponentHTML(comp: WebsiteComponent, theme: Website['theme']): string {
    const props = comp.props;
    switch (comp.type) {
      case 'hero':
        return `
    <section class="hero" id="hero">
      <h1>${(props.title as string) || 'Welcome'}</h1>
      <p>${(props.subtitle as string) || 'Build something amazing'}</p>
      <a href="${(props.ctaLink as string) || '#'}" class="btn">${(props.ctaText as string) || 'Get Started'}</a>
    </section>`;
      case 'features': {
        const features = (props.items as Array<{ title: string; description: string }>) || [];
        return `
    <section id="features">
      <h2 style="text-align:center;margin-bottom:40px;font-size:36px;">Features</h2>
      <div class="grid">
        ${features.map(f => `<div class="card"><h3>${f.title}</h3><p>${f.description}</p></div>`).join('\n        ')}
      </div>
    </section>`;
      }
      case 'pricing': {
        const plans = (props.plans as Array<{ name: string; price: string; features: string[] }>) || [];
        return `
    <section id="pricing">
      <h2 style="text-align:center;margin-bottom:40px;font-size:36px;">Pricing</h2>
      <div class="grid">
        ${plans.map(p => `<div class="card"><h3>${p.name}</h3><div style="font-size:32px;font-weight:700;margin:16px 0;">${p.price}</div><ul style="list-style:none;margin-bottom:24px;">${p.features.map(f => `<li style="padding:8px 0;border-bottom:1px solid ${theme.darkMode ? '#334155' : '#e2e8f0'};">✓ ${f}</li>`).join('')}</ul><a href="#" class="btn" style="width:100%;text-align:center;">Choose Plan</a></div>`).join('\n        ')}
      </div>
    </section>`;
      }
      case 'cta':
        return `
    <section style="text-align:center;padding:80px 0;background:linear-gradient(135deg,${theme.primaryColor}22,${theme.secondaryColor}22);border-radius:16px;margin:40px 0;">
      <h2 style="font-size:36px;margin-bottom:16px;">${(props.title as string) || 'Ready to get started?'}</h2>
      <p style="margin-bottom:32px;color:${theme.darkMode ? '#94a3b8' : '#64748b'};">${(props.subtitle as string) || ''}</p>
      <a href="${(props.ctaLink as string) || '#'}" class="btn">${(props.ctaText as string) || 'Get Started'}</a>
    </section>`;
      case 'testimonial':
        return `
    <section style="padding:60px 0;">
      <div class="card" style="max-width:600px;margin:0 auto;text-align:center;">
        <p style="font-size:18px;font-style:italic;margin-bottom:16px;">"${(props.quote as string) || ''}"</p>
        <p style="font-weight:600;">${(props.author as string) || ''}</p>
      </div>
    </section>`;
      case 'footer':
        return `
    <footer style="padding:40px 0;text-align:center;border-top:1px solid ${theme.darkMode ? '#334155' : '#e2e8f0'};">
      <p>&copy; ${new Date().getFullYear()} ${(props.companyName as string) || ''}. All rights reserved.</p>
    </footer>`;
      default:
        return `\n    <!-- ${comp.name} (${comp.type}) -->\n`;
    }
  }

  private generateReact(website: Website): string {
    const { primaryColor, secondaryColor, fontFamily, darkMode } = website.theme;
    let code = `import React from 'react';

// Theme constants
const theme = {
  primaryColor: '${primaryColor}',
  secondaryColor: '${secondaryColor}',
  fontFamily: '${fontFamily}',
  darkMode: ${darkMode},
};

`;

    for (const page of website.pages) {
      const componentName = page.slug === '/' ? 'Home' : page.slug.charAt(0).toUpperCase() + page.slug.slice(1);
      code += `export function ${componentName}Page() {\n  return (\n    <div className="min-h-screen ${darkMode ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-900'}">\n`;

      for (const comp of page.components.sort((a, b) => a.order - b.order)) {
        code += this.generateComponentReact(comp);
      }

      code += `    </div>\n  );\n}\n\n`;
    }

    return code;
  }

  private generateComponentReact(comp: WebsiteComponent): string {
    const props = comp.props;
    switch (comp.type) {
      case 'hero':
        return `      <section className="py-20 text-center">
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent">
          ${(props.title as string) || 'Welcome'}
        </h1>
        <p className="text-xl text-slate-400 mb-8 max-w-xl mx-auto">
          ${(props.subtitle as string) || 'Build something amazing'}
        </p>
        <a href="${(props.ctaLink as string) || '#'}" className="inline-block px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition">
          ${(props.ctaText as string) || 'Get Started'}
        </a>
      </section>\n`;
      case 'features': {
        const features = (props.items as Array<{ title: string; description: string }>) || [];
        return `      <section className="py-16 px-6">
        <h2 className="text-3xl font-bold text-center mb-12">Features</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          ${features.map(f => `<div className="p-6 bg-slate-800 rounded-xl border border-slate-700">
            <h3 className="text-lg font-semibold text-indigo-400 mb-3">${f.title}</h3>
            <p className="text-slate-400">${f.description}</p>
          </div>`).join('\n          ')}
        </div>
      </section>\n`;
      }
      default:
        return `      {/* ${comp.name} (${comp.type}) */}\n`;
    }
  }

  generateFiles(websiteId: string, outputDir?: string): string[] {
    const website = this.websites.get(websiteId);
    if (!website) return [];

    const dir = outputDir || join(this.outputDir, website.name.toLowerCase().replace(/\s+/g, '-'));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const files: string[] = [];

    if (website.framework === 'html') {
      const html = this.generateHTML(website);
      const filePath = join(dir, 'index.html');
      writeFileSync(filePath, html, 'utf-8');
      files.push(filePath);
    } else {
      const code = this.generateReact(website);
      for (const page of website.pages) {
        const componentName = page.slug === '/' ? 'Home' : page.slug.charAt(0).toUpperCase() + page.slug.slice(1);
        const filePath = join(dir, `${componentName}Page.tsx`);
        writeFileSync(filePath, code, 'utf-8');
        files.push(filePath);
      }
    }

    return files;
  }

  publish(websiteId: string): boolean {
    const website = this.websites.get(websiteId);
    if (!website) return false;
    website.status = 'published';
    website.updatedAt = Date.now();
    this.saveData();
    return true;
  }

  deploy(websiteId: string): { url: string } | null {
    const website = this.websites.get(websiteId);
    if (!website) return null;

    website.status = 'deployed';
    website.deployedAt = Date.now();
    website.deployUrl = `https://${website.name.toLowerCase().replace(/\s+/g, '-')}.infiniteai.app`;
    website.updatedAt = Date.now();
    this.saveData();
    return { url: website.deployUrl };
  }

  getWebsite(websiteId: string): Website | undefined {
    return this.websites.get(websiteId);
  }

  listWebsites(): Website[] {
    return Array.from(this.websites.values());
  }

  getTemplates(): WebsiteTemplate[] {
    return this.templates;
  }

  deleteWebsite(websiteId: string): boolean {
    const result = this.websites.delete(websiteId);
    this.saveData();
    return result;
  }

  getStats(): {
    totalWebsites: number;
    published: number;
    deployed: number;
    draft: number;
  } {
    const sites = Array.from(this.websites.values());
    return {
      totalWebsites: sites.length,
      published: sites.filter((s) => s.status === 'published').length,
      deployed: sites.filter((s) => s.status === 'deployed').length,
      draft: sites.filter((s) => s.status === 'draft').length,
    };
  }
}

