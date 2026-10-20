// Infinite AI Bridge v4.0 — Content script.
// Injected into every page for fast DOM operations without script injection overhead.
// Communicates with background.js via chrome.runtime messages.

(() => {
  'use strict';

  const BRIDGE_NS = '__infinite_bridge__';
  if (window[BRIDGE_NS]) return;
  window[BRIDGE_NS] = true;

  const INTERACTIVE = 'a, button, input, textarea, select, summary, [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="tab"], [role="option"], [onclick], label[for], details summary';
  const TEXT_ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'name', 'value'];

  // Incremental DOM snapshot cache
  const snapshotCache = {
    elements: new Map(),
    lastSnapshot: null,
    lastSnapshotTime: 0,
    selectorIndex: new Map(),
  };

  function norm(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let sel = node.tagName.toLowerCase();
      if (node.id) {
        sel = '#' + CSS.escape(node.id);
        parts.unshift(sel);
        break;
      }
      if (node.classList?.length) {
        sel += '.' + Array.from(node.classList).slice(0, 3).map(c => CSS.escape(c)).join('.');
      }
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (same.length > 1) sel += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(sel);
      node = parent;
    }
    return parts.join(' > ');
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0;
  }

  function describe(el) {
    if (!el) return null;
    const role = el.getAttribute('role') || (el.tagName === 'A' ? 'link' : el.tagName === 'BUTTON' ? 'button' : el.tagName.toLowerCase());
    return {
      tag: el.tagName.toLowerCase(),
      role,
      text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      aria: el.getAttribute('aria-label') || '',
      title: el.getAttribute('title') || '',
      placeholder: el.getAttribute('placeholder') || '',
      name: el.getAttribute('name') || '',
      value: (el.value != null ? String(el.value) : '') || (el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text || '' : ''),
      href: el.getAttribute('href') || '',
      selector: cssPath(el),
      visible: visible(el),
      rect: (() => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
      })(),
    };
  }

  function findCandidate(selector, text) {
    let el = null;
    if (selector) {
      try { el = document.querySelector(selector); } catch {}
    }
    if (!el && text) {
      const q = norm(text);
      const candidates = Array.from(document.querySelectorAll(INTERACTIVE));
      const scored = [];
      for (const c of candidates) {
        if (!visible(c)) continue;
        let label = norm((c.innerText || c.textContent || '').slice(0, 200));
        if (!label) {
          for (const attr of TEXT_ATTRS) {
            const v = c.getAttribute(attr);
            if (v) { label = norm(v); break; }
          }
        }
        if (!label) continue;
        let score = -1;
        if (label === q) score = 100;
        else if (label.startsWith(q)) score = 60;
        else if (label.includes(q)) score = 40;
        if (score > 0) scored.push({ el: c, score });
      }
      scored.sort((a, b) => b.score - a.score);
      el = scored.length ? scored[0].el : null;
    }
    return el;
  }

  function dispatch(el, type, detail) {
    const evt = new Event(type, { bubbles: true, cancelable: true });
    if (detail) Object.assign(evt, detail);
    el.dispatchEvent(evt);
  }

  function setNativeValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
  }

  // Incremental DOM snapshot helper
  function buildSelectorIndex(elements) {
    const index = new Map();
    for (const el of elements) {
      if (el.id) {
        index.set('#' + CSS.escape(el.id), el);
      }
      if (el.classList?.length) {
        for (const cls of el.classList) {
          const key = '.' + CSS.escape(cls);
          if (!index.has(key)) index.set(key, el);
        }
      }
    }
    return index;
  }

  function getIncrementalSnapshot(forceFull = false) {
    const now = Date.now();
    const cache = snapshotCache;

    // If we have a recent snapshot (< 2s) and not forced, return diff
    if (!forceFull && cache.lastSnapshot && (now - cache.lastSnapshotTime < 2000)) {
      const currentElements = Array.from(document.querySelectorAll(INTERACTIVE));
      const currentSelectors = new Set();
      const changes = { added: [], updated: [], removed: [] };

      // Build current selector index
      const newIndex = buildSelectorIndex(currentElements);

      // Find added/updated
      for (const el of currentElements) {
        if (!visible(el)) continue;
        const selector = cssPath(el);
        currentSelectors.add(selector);

        const cached = cache.elements.get(selector);
        const described = describe(el);
        if (!cached) {
          changes.added.push(described);
        } else {
          // Quick comparison: rect + text + attributes
          const rectChanged = JSON.stringify(cached.rect) !== JSON.stringify(described.rect);
          const textChanged = cached.text !== described.text;
          const attrChanged = cached.aria !== described.aria || cached.title !== described.title ||
                              cached.placeholder !== described.placeholder || cached.value !== described.value;
          if (rectChanged || textChanged || attrChanged) {
            changes.updated.push(described);
          }
        }
        cache.elements.set(selector, described);
      }

      // Find removed
      for (const [selector, cached] of cache.elements) {
        if (!currentSelectors.has(selector)) {
          changes.removed.push({ selector, tag: cached.tag });
          cache.elements.delete(selector);
        }
      }

      // Update selector index
      cache.selectorIndex = newIndex;

      return { incremental: true, changes, timestamp: now };
    }

    // Full snapshot
    const snapshot = [];
    const seen = new Set();
    const all = Array.from(document.querySelectorAll(INTERACTIVE));
    cache.elements.clear();

    for (const el of all) {
      if (!visible(el) || snapshot.length >= 300) continue;
      const d = describe(el);
      if (seen.has(d.selector)) continue;
      seen.add(d.selector);
      snapshot.push(d);
      cache.elements.set(d.selector, d);
    }

    cache.selectorIndex = buildSelectorIndex(all);
    cache.lastSnapshot = { snapshot, timestamp: now };
    cache.lastSnapshotTime = now;

    return { incremental: false, snapshot, timestamp: now };
  }

  // ── Fast operations (no script injection needed) ──────────────────────────────
  const fastOps = {
    getState(params) {
      const forceFull = params?.forceFull === true;
      const snapResult = getIncrementalSnapshot(forceFull);

      const forms = Array.from(document.forms).map(f => ({
        action: f.action || '', method: f.method || '',
        fields: Array.from(f.elements).filter(e => ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.tagName)).slice(0, 40).map(e => describe(e)),
      }));
      const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
        text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 150), href: a.href,
      })).slice(0, 300);

      if (snapResult.incremental) {
        return {
          url: location.href, title: document.title, readyState: document.readyState,
          text: (document.body?.innerText || '').slice(0, 60000),
          incremental: true,
          changes: snapResult.changes,
          forms, links,
          performance: {
            loadTime: performance.timing?.loadEventEnd - performance.timing?.navigationStart || 0,
            domReady: performance.timing?.domContentLoadedEventEnd - performance.timing?.navigationStart || 0,
            resources: performance.getEntriesByType?.('resource')?.length || 0,
          },
        };
      }

      return {
        url: location.href, title: document.title, readyState: document.readyState,
        text: (document.body?.innerText || '').slice(0, 60000), snapshot: snapResult.snapshot, forms, links,
        performance: {
          loadTime: performance.timing?.loadEventEnd - performance.timing?.navigationStart || 0,
          domReady: performance.timing?.domContentLoadedEventEnd - performance.timing?.navigationStart || 0,
          resources: performance.getEntriesByType?.('resource')?.length || 0,
        },
      };
    },

    getHtml() {
      return { html: document.documentElement.outerHTML };
    },

    getLinks() {
      return {
        links: Array.from(document.querySelectorAll('a[href]')).map(a => ({
          text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 150),
          href: a.href,
          title: a.title || '',
          target: a.target || '',
        })).slice(0, 300),
      };
    },

    getFormFields() {
      return {
        fields: Array.from(document.forms).flatMap(f =>
          Array.from(f.elements).filter(e => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName)).map(e => describe(e))
        ),
      };
    },

    getElement(params) {
      // Fast path: try selector index first
      if (params.selector) {
        const cached = snapshotCache.selectorIndex.get(params.selector);
        if (cached && visible(cached)) return describe(cached);
        // Try direct querySelector as fallback
        try {
          const el = document.querySelector(params.selector);
          if (el && visible(el)) return describe(el);
        } catch {}
      }
      // Fallback to text-based search
      const el = findCandidate(params.selector, params.text);
      return el ? describe(el) : null;
    },

    getElements(params) {
      if (params.selector) {
        // Use selector index if it's a simple class or ID selector
        const index = snapshotCache.selectorIndex;
        if (params.selector.startsWith('#') || params.selector.startsWith('.')) {
          const el = index.get(params.selector);
          return { elements: el ? [describe(el)] : [] };
        }
      }
      const els = params.selector ? Array.from(document.querySelectorAll(params.selector)).slice(0, 100) : [];
      return { elements: els.map(describe) };
    },

    click(params) {
      const el = findCandidate(params.selector, params.text);
      if (!el) return { error: 'No clickable element found' };
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) || el;
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
      target.click();
      if (el.tagName === 'SUMMARY' && el.parentElement) {
        const details = el.parentElement.closest('details');
        if (details) details.open = !details.open;
      }
      return { clicked: true, selector: cssPath(target), text: (target.innerText || '').slice(0, 120) };
    },

    type(params) {
      const el = findCandidate(params.selector);
      if (!el) return { error: 'No element found for selector "' + params.selector + '"' };
      el.focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) {
        if (el.isContentEditable) { el.textContent = params.text; dispatch(el, 'input'); }
        else { setNativeValue(el, params.text); dispatch(el, 'input'); dispatch(el, 'change'); }
      }
      return { typed: params.text.length, selector: cssPath(el) };
    },

    fill(params) {
      const results = [];
      for (const [sel, value] of Object.entries(params.fields || {})) {
        const el = findCandidate(sel);
        if (!el) { results.push({ selector: sel, ok: false, error: 'not found' }); continue; }
        el.focus();
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) {
          if (el.isContentEditable) { el.textContent = String(value); dispatch(el, 'input'); }
          else { setNativeValue(el, String(value)); dispatch(el, 'input'); dispatch(el, 'change'); }
        } else if (el instanceof HTMLSelectElement) {
          const opt = Array.from(el.options).find(o => o.value === String(value) || o.text === String(value));
          if (opt) { el.value = opt.value; dispatch(el, 'change'); }
        }
        results.push({ selector: sel, ok: true });
      }
      return { filled: results.filter(r => r.ok).length, results };
    },

    select(params) {
      const el = findCandidate(params.selector);
      if (!el || !(el instanceof HTMLSelectElement)) return { error: 'No <select> found' };
      const value = String(params.value);
      const opt = Array.from(el.options).find(o => o.value === value || norm(o.text) === norm(value));
      if (!opt) return { error: 'Option "' + value + '" not found' };
      el.value = opt.value;
      dispatch(el, 'change');
      return { selected: opt.value, text: opt.text };
    },

    scroll(params) {
      const dir = params.direction || 'down';
      const delta = Number(params.delta || params.pixels || 0);
      let x = 0, y = 0;
      if (dir === 'down') y = delta || window.innerHeight * 0.8;
      else if (dir === 'up') y = -(delta || window.innerHeight * 0.8);
      else if (dir === 'left') x = -(delta || window.innerWidth * 0.8);
      else if (dir === 'right') x = delta || window.innerWidth * 0.8;
      else if (dir === 'top') y = -document.body.scrollHeight;
      else if (dir === 'bottom') y = document.body.scrollHeight;
      window.scrollBy({ top: y, left: x, behavior: 'instant' });
      return { direction: dir, x: window.scrollX, y: window.scrollY };
    },

    pressKey(params) {
      const key = params.key || 'Enter';
      const el = document.activeElement || document.body;
      const codes = { Enter: 13, Tab: 9, Escape: 27, ' ': 32, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Backspace: 8, Delete: 46, Home: 36, End: 35, PageDown: 34, PageUp: 33 };
      const keyCode = codes[key] ?? 0;
      el.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, keyCode, bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, keyCode, bubbles: true, cancelable: true }));
      return { key };
    },

    highlight(params) {
      const el = findCandidate(params.selector, params.text);
      if (!el) return { error: 'highlight: element not found' };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const oldOutline = el.style.outline;
      const oldBg = el.style.backgroundColor;
      el.style.outline = '3px solid #22c55e';
      el.style.backgroundColor = 'rgba(34,197,94,0.25)';
      setTimeout(() => { el.style.outline = oldOutline; el.style.backgroundColor = oldBg; }, 2200);
      return { highlighted: cssPath(el) };
    },

    hover(params) {
      const el = findCandidate(params.selector, params.text);
      if (!el) return { error: 'hover: element not found' };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
      return { hovered: cssPath(el) };
    },

    focus(params) {
      const el = findCandidate(params.selector);
      if (!el) return { error: 'focus: element not found' };
      el.focus();
      return { focused: cssPath(el) };
    },

    clear(params) {
      const el = findCandidate(params.selector);
      if (!el) return { error: 'clear: element not found' };
      el.focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        setNativeValue(el, '');
        dispatch(el, 'input');
        dispatch(el, 'change');
      }
      return { cleared: cssPath(el) };
    },

    setValue(params) {
      const el = findCandidate(params.selector);
      if (!el) return { error: 'setValue: element not found' };
      el.focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) {
        if (el.isContentEditable) { el.textContent = params.value; dispatch(el, 'input'); }
        else { setNativeValue(el, params.value); dispatch(el, 'input'); dispatch(el, 'change'); }
      }
      return { setValue: true, selector: cssPath(el) };
    },

    getValue(params) {
      const el = findCandidate(params.selector);
      if (!el) return { error: 'getValue: element not found' };
      return { value: el.value || el.textContent || '' };
    },

    drag(params) {
      const from = findCandidate(params.from);
      const to = findCandidate(params.to);
      if (!from || !to) return { error: 'drag: source or target not found' };
      const fromRect = from.getBoundingClientRect();
      const toRect = to.getBoundingClientRect();
      const fromX = fromRect.x + fromRect.width / 2;
      const fromY = fromRect.y + fromRect.height / 2;
      const toX = toRect.x + toRect.width / 2;
      const toY = toRect.y + toRect.height / 2;
      from.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: fromX, clientY: fromY }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: toX, clientY: toY }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: toX, clientY: toY }));
      return { dragged: true };
    },

    rightClick(params) {
      const el = findCandidate(params.selector, params.text);
      if (!el) return { error: 'rightClick: element not found' };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
        button: 2,
      }));
      return { rightClicked: cssPath(el) };
    },

    getScreenshot() {
      // Can't capture from content script, but can signal background
      return { needsBackground: true, op: 'screenshot' };
    },

    batch(params) {
      const ops = params.ops || [];
      const results = [];
      for (const item of ops) {
        if (item && typeof item.op === 'string' && fastOps[item.op]) {
          try { results.push({ op: item.op, ...fastOps[item.op](item.params || {}) }); }
          catch (e) { results.push({ op: item.op, error: String(e?.message || e) }); }
        }
      }
      return { results };
    },

    // ── NEW OPERATIONS (v4.0) ──────────────────────────────────────────────────

    getFormData() {
      const forms = Array.from(document.forms).map(f => {
        const data = {};
        const elements = Array.from(f.elements);
        for (const el of elements) {
          if (el.name || el.id) {
            const key = el.name || el.id;
            if (el.type === 'checkbox' || el.type === 'radio') {
              data[key] = el.checked;
            } else if (el.tagName === 'SELECT') {
              data[key] = el.value;
            } else {
              data[key] = el.value;
            }
          }
        }
        return {
          action: f.action,
          method: f.method,
          id: f.id,
          name: f.name,
          data,
          fields: elements.filter(e => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName)).map(describe),
        };
      });
      return { forms };
    },

    submitForm(params) {
      const el = findCandidate(params.selector);
      if (!el) return { error: 'submitForm: element not found' };
      const form = el instanceof HTMLFormElement ? el : el.closest('form');
      if (!form) return { error: 'submitForm: no form found' };
      form.submit();
      return { submitted: true };
    },

    getTableData(params) {
      const tables = Array.from(document.querySelectorAll(params.selector || 'table'));
      const data = tables.map(table => {
        const rows = Array.from(table.querySelectorAll('tr'));
        const headers = Array.from(rows[0]?.querySelectorAll('th') || []).map(th => th.textContent?.trim() || '');
        const body = rows.slice(1).map(row => {
          const cells = Array.from(row.querySelectorAll('td'));
          if (headers.length) {
            const obj = {};
            cells.forEach((cell, i) => { obj[headers[i] || 'col' + i] = cell.textContent?.trim() || ''; });
            return obj;
          }
          return cells.map(cell => cell.textContent?.trim() || '');
        });
        return { headers, rows: body, rowCount: rows.length - 1 };
      });
      return { tables: data };
    },

    getPageMeta() {
      const meta = {};
      document.querySelectorAll('meta').forEach(m => {
        const name = m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv');
        const content = m.getAttribute('content');
        if (name && content) meta[name] = content;
      });
      return {
        title: document.title,
        meta,
        canonical: document.querySelector('link[rel="canonical"]')?.href || '',
        description: meta.description || meta['og:description'] || '',
        keywords: meta.keywords || '',
        author: meta.author || '',
        ogTitle: meta['og:title'] || '',
        ogImage: meta['og:image'] || '',
        ogUrl: meta['og:url'] || '',
        twitterCard: meta['twitter:card'] || '',
        viewport: meta.viewport || '',
      };
    },

    getStructuredContent() {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
        level: parseInt(h.tagName[1]),
        text: h.textContent?.trim() || '',
        id: h.id || '',
      }));
      const images = Array.from(document.querySelectorAll('img')).slice(0, 50).map(img => ({
        src: img.src,
        alt: img.alt || '',
        title: img.title || '',
        width: img.naturalWidth,
        height: img.naturalHeight,
      }));
      const videos = Array.from(document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]')).slice(0, 20).map(v => ({
        tag: v.tagName.toLowerCase(),
        src: v.src || '',
        title: v.title || '',
      }));
      const lists = Array.from(document.querySelectorAll('ul, ol')).slice(0, 20).map(list => ({
        type: list.tagName.toLowerCase(),
        items: Array.from(list.querySelectorAll(':scope > li')).slice(0, 50).map(li => li.textContent?.trim() || ''),
      }));
      return { headings, images, videos, lists };
    },

    getAccessibilityTree() {
      function traverse(el, depth = 0) {
        if (!el || depth > 10) return null;
        const role = el.getAttribute('role');
        const name = el.getAttribute('aria-label') || el.getAttribute('title') || '';
        const state = {
          disabled: el.hasAttribute('disabled'),
          focused: document.activeElement === el,
          selected: el.getAttribute('aria-selected') === 'true',
          checked: el.getAttribute('aria-checked') === 'true',
          expanded: el.getAttribute('aria-expanded') === 'true',
        };
        const node = {
          role: role || el.tagName.toLowerCase(),
          name,
          description: el.getAttribute('aria-describedby') || '',
          states: state,
          children: [],
        };
        for (const child of el.children) {
          const childNode = traverse(child, depth + 1);
          if (childNode) node.children.push(childNode);
        }
        return node;
      }
      return { tree: traverse(document.body) };
    },

    getElementAtPoint(params) {
      const x = params.x || 0;
      const y = params.y || 0;
      const el = document.elementFromPoint(x, y);
      if (!el) return { error: 'No element at point' };
      return describe(el);
    },

    getVisibleElements() {
      const elements = Array.from(document.querySelectorAll(INTERACTIVE));
      const visible = elements.filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 &&
               r.x >= 0 && r.y >= 0 &&
               r.x < window.innerWidth && r.y < window.innerHeight;
      }).slice(0, 100);
      return { elements: visible.map(describe) };
    },

    getElementByText(params) {
      if (!params.text) return { error: 'getTextElement requires text' };
      const q = norm(params.text);
      const all = Array.from(document.querySelectorAll('*'));
      const matches = [];
      for (const el of all) {
        if (!visible(el)) continue;
        const text = norm(el.textContent || '');
        if (text.includes(q)) {
          matches.push(describe(el));
          if (matches.length >= 10) break;
        }
      }
      return { elements: matches };
    },

    getPageStructure() {
      const structure = {
        title: document.title,
        url: location.href,
        domain: location.hostname,
        protocol: location.protocol,
        charset: document.characterSet,
        doctype: document.doctype ? document.doctype.name : null,
        language: document.documentElement.lang || '',
        meta: {},
        headings: [],
        links: { internal: 0, external: 0, total: 0 },
        images: { total: 0, withAlt: 0, withoutAlt: 0 },
        forms: document.forms.length,
        scripts: document.scripts.length,
        stylesheets: document.styleSheets.length,
        iframes: document.querySelectorAll('iframe').length,
      };

      // Meta tags
      document.querySelectorAll('meta').forEach(m => {
        const name = m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv');
        if (name) structure.meta[name] = m.getAttribute('content') || '';
      });

      // Headings
      document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
        structure.headings.push({ level: parseInt(h.tagName[1]), text: h.textContent?.trim() || '' });
      });

      // Links
      document.querySelectorAll('a[href]').forEach(a => {
        structure.links.total++;
        try {
          const url = new URL(a.href, location.href);
          if (url.hostname === location.hostname) structure.links.internal++;
          else structure.links.external++;
        } catch { structure.links.external++; }
      });

      // Images
      document.querySelectorAll('img').forEach(img => {
        structure.images.total++;
        if (img.alt) structure.images.withAlt++;
        else structure.images.withoutAlt++;
      });

      return structure;
    },

    searchPage(params) {
      if (!params.query) return { error: 'searchPage requires query' };
      const q = params.query.toLowerCase();
      const results = [];

      // Search in text content
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = node.textContent || '';
        if (text.toLowerCase().includes(q)) {
          const parent = node.parentElement;
          if (parent && visible(parent)) {
            results.push({
              type: 'text',
              text: text.slice(0, 200),
              selector: cssPath(parent),
              context: text.slice(Math.max(0, text.toLowerCase().indexOf(q) - 50), text.toLowerCase().indexOf(q) + q.length + 50),
            });
            if (results.length >= 20) break;
          }
        }
      }

      // Search in attributes
      const attrElements = document.querySelectorAll('[aria-label], [title], [placeholder], [alt]');
      for (const el of attrElements) {
        if (!visible(el)) continue;
        for (const attr of ['aria-label', 'title', 'placeholder', 'alt']) {
          const val = el.getAttribute(attr) || '';
          if (val.toLowerCase().includes(q)) {
            results.push({
              type: 'attribute',
              attribute: attr,
              value: val,
              selector: cssPath(el),
            });
            if (results.length >= 20) break;
          }
        }
        if (results.length >= 20) break;
      }

      return { results, totalFound: results.length };
    },

    findInPage(params) {
      const query = String(params?.text || '');
      if (!query) return { error: 'findInPage requires text' };
      const requested = Number(params?.index ?? 0);
      // Collect visible text nodes and their offsets in a '\n'-joined haystack.
      const nodes = [];
      let total = 0;
      const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
      let current;
      while ((current = walker.nextNode())) {
        const value = current.nodeValue || '';
        const parent = current.parentElement;
        if (!value.trim() || !parent || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(parent.tagName)) continue;
        const cs = getComputedStyle(parent);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        nodes.push({ node: current, start: total });
        total += value.length + 1; // +1 accounts for the '\n' join below
      }
      if (!nodes.length) return { count: 0, index: -1 };
      const haystack = nodes.map(n => n.node.nodeValue).join('\n');
      const lower = haystack.toLowerCase();
      const needle = query.toLowerCase();
      const positions = [];
      let pos = lower.indexOf(needle);
      while (pos !== -1 && positions.length < 5000) {
        positions.push(pos);
        pos = lower.indexOf(needle, pos + Math.max(needle.length, 1));
      }
      const count = positions.length;
      if (!count) return { count: 0, index: -1 };
      const index = ((requested % count) + count) % count; // wrap like Ctrl+G
      const at = positions[index];
      const entry = nodes.find(n => at >= n.start && at < n.start + n.node.nodeValue.length + 1);
      if (!entry) return { count, index };
      try {
        const localStart = at - entry.start;
        const range = document.createRange();
        range.setStart(entry.node, localStart);
        range.setEnd(entry.node, Math.min(localStart + query.length, entry.node.nodeValue.length));
        const rect = range.getBoundingClientRect();
        window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - window.innerHeight / 3), left: 0, behavior: 'instant' });
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const r2 = range.getBoundingClientRect();
        const marker = document.createElement('div');
        marker.style.cssText = 'position:absolute;left:' + (r2.left + window.scrollX - 2) + 'px;top:' + (r2.top + window.scrollY - 2) + 'px;width:' + (r2.width + 4) + 'px;height:' + (r2.height + 4) + 'px;pointer-events:none;z-index:2147483647;background:rgba(255,220,0,0.35);outline:2px solid rgba(255,160,0,0.9);border-radius:2px;';
        (document.body || document.documentElement).appendChild(marker);
        setTimeout(() => { try { marker.remove(); sel.removeAllRanges(); } catch {} }, 1500);
      } catch {}
      return { count, index };
    },
  };

  // ── Message listener ─────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender?.id && sender.id !== chrome.runtime.id) return false;
    if (msg?.type === 'bridge-content-op') {
      const { op, params } = msg;
      const fn = fastOps[op];
      if (fn) {
        try {
          const result = fn(params || {});
          // The error string has to travel with the failure: the worker decides
          // whether to surface it or fall back to script injection based on this
          // field, and a bare ok:false made every real failure look like
          // "content script missing".
          if (result && result.error) sendResponse({ ok: false, error: String(result.error) });
          else sendResponse({ ok: true, data: result });
        } catch (e) {
          sendResponse({ ok: false, error: String(e?.message || e) });
        }
      } else {
        sendResponse({ ok: false, error: 'Unknown content op: ' + op });
      }
      return true;
    }
    return false;
  });

  // Signal readiness
  chrome.runtime.sendMessage({ type: 'content-script-ready', url: location.href }).catch(() => {});
})();
