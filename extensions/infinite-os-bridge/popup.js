// Infinite AI Bridge v4.0 — Popup UI with real-time updates and auto-connect.

const $ = (id) => document.getElementById(id);

let statusPollTimer = null;
let currentTabs = [];

// ── Status rendering ──────────────────────────────────────────────────────────
function renderStatus(s) {
  if (!s) {
    $('connText').textContent = 'unknown';
    $('dot').className = 'dot off';
    $('latencyBadge').classList.add('hidden');
    return;
  }

  $('connText').textContent = s.connected ? 'Connected' : 'Disconnected';
  $('connText').style.color = s.connected ? 'var(--green)' : 'var(--red)';
  $('dot').className = 'dot ' + (s.connected ? 'on' : 'off');
  $('portText').textContent = String(s.port ?? '--');
  $('verText').textContent = s.version || '--';
  $('commandsText').textContent = String(s.commandsServed ?? 0);
  $('cacheText').textContent = String(s.cacheHits ?? 0);
  $('portCode').textContent = '127.0.0.1:' + (s.port ?? 8765);

  // Uptime — time since the service worker recorded the connection
  const startedAt = Number(s.connectedAt) || 0;
  const uptime = s.connected && startedAt > 0 ? Math.floor(Math.max(0, Date.now() - startedAt) / 1000) : -1;
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = uptime % 60;
  if (uptime < 0) {
    $('uptimeText').textContent = '--';
  } else if (hours > 0) {
    $('uptimeText').textContent = `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    $('uptimeText').textContent = `${minutes}m ${seconds}s`;
  } else {
    $('uptimeText').textContent = `${seconds}s`;
  }

  // Latency badge
  const latencyBadge = $('latencyBadge');
  const latencyText = $('latencyText');
  if (s.connected && s.latencyMs != null && s.latencyMs >= 0) {
    latencyText.textContent = s.latencyMs + 'ms';
    latencyBadge.classList.remove('hidden');
    latencyBadge.className = 'latency' + (s.latencyMs > 200 ? ' high' : '');
  } else {
    latencyBadge.classList.add('hidden');
  }

  // Error box
  const err = $('errBox');
  if (!s.connected && s.lastError) {
    err.textContent = s.hasToken === false
      ? 'Missing token in config.js — re-run the installer.'
      : 'Not connected. Start Infinite OS or run the bridge server.';
    err.classList.remove('hidden');
  } else if (s.hasToken === false) {
    err.textContent = 'Missing token in config.js — re-run the installer.';
    err.classList.remove('hidden');
  } else {
    err.classList.add('hidden');
  }
}

// ── Background communication ──────────────────────────────────────────────────
async function sendToBackground(message) {
  return chrome.runtime.sendMessage(message);
}

function showResult(text, isError) {
  const result = $('result');
  result.textContent = text;
  result.style.color = isError ? 'var(--red)' : '';
  $('resultCard').classList.remove('hidden');
}

// ── Tab list ──────────────────────────────────────────────────────────────────
async function loadTabs() {
  const tabList = $('tabList');
  tabList.innerHTML = '<div class="tab-loading">Loading tabs...</div>';

  try {
    const res = await sendToBackground({ type: 'exec', command: 'list_tabs', params: {} });
    if (!res?.ok) {
      tabList.innerHTML = '<div class="tab-empty">Failed to load tabs</div>';
      return;
    }

    const tabs = res.data?.tabs || [];
    currentTabs = tabs;

    if (tabs.length === 0) {
      tabList.innerHTML = '<div class="tab-empty">No tabs found</div>';
      return;
    }

    tabList.innerHTML = '';
    for (const tab of tabs.slice(0, 30)) {
      const item = document.createElement('div');
      item.className = 'tab-item' + (tab.active ? ' active' : '');
      item.innerHTML = `
        <img class="tab-favicon" alt="" onerror="this.style.display='none'">
        <div class="tab-info">
          <div class="tab-title">${escapeHtml(tab.title || 'Untitled')}</div>
          <div class="tab-url">${escapeHtml(truncateUrl(tab.url || ''))}</div>
        </div>
        <button class="tab-close" data-tab-id="${tab.id}" title="Close tab">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      `;
      const favicon = item.querySelector('.tab-favicon');
      const safeUrl = tab.favIconUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect width=%2216%22 height=%2216%22 fill=%22%23333%22/></svg>';
      if (safeUrl.startsWith('http://') || safeUrl.startsWith('https://') || safeUrl.startsWith('data:')) {
        favicon.setAttribute('src', safeUrl);
      } else {
        favicon.setAttribute('src', '');
      }

      // Click to activate tab
      item.addEventListener('click', async (e) => {
        if (e.target.closest('.tab-close')) return;
        try {
          await sendToBackground({ type: 'exec', command: 'activate_tab', params: { tabId: tab.id } });
          await loadTabs();
        } catch (err) {
          showResult('Failed to activate tab: ' + (err?.message || err), true);
        }
      });

      // Close tab button
      const closeBtn = item.querySelector('.tab-close');
      closeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await sendToBackground({ type: 'exec', command: 'close_tab', params: { tabId: tab.id } });
          await loadTabs();
        } catch (err) {
          showResult('Failed to close tab: ' + (err?.message || err), true);
        }
      });

      tabList.appendChild(item);
    }
  } catch (err) {
    tabList.innerHTML = '<div class="tab-empty">Error loading tabs</div>';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname.length > 30 ? u.pathname.slice(0, 30) + '...' : u.pathname);
  } catch {
    return url?.slice(0, 60) || '';
  }
}

// ── Action handlers ───────────────────────────────────────────────────────────
const actionHandlers = {
  ping: async () => {
    return await sendToBackground({ type: 'exec', command: 'ping', params: {} });
  },
  tabs: async () => {
    await loadTabs();
    return { ok: true, data: { message: 'Tabs loaded' } };
  },
  inspect: async () => {
    return await sendToBackground({ type: 'exec', command: 'inspect', params: {} });
  },
  screenshot: async () => {
    return await sendToBackground({ type: 'exec', command: 'screenshot', params: {} });
  },
  reload: async () => {
    return await sendToBackground({ type: 'exec', command: 'reload', params: {} });
  },
  extract: async () => {
    return await sendToBackground({ type: 'exec', command: 'get_page_text', params: {} });
  },
  links: async () => {
    return await sendToBackground({ type: 'exec', command: 'get_page_links', params: {} });
  },
  forms: async () => {
    return await sendToBackground({ type: 'exec', command: 'get_form_fields', params: {} });
  },
  back: async () => {
    return await sendToBackground({ type: 'exec', command: 'back', params: {} });
  },
  forward: async () => {
    return await sendToBackground({ type: 'exec', command: 'forward', params: {} });
  },
  newtab: async () => {
    return await sendToBackground({ type: 'exec', command: 'new_tab', params: { url: 'about:blank' } });
  },
  clipboard: async () => {
    return await sendToBackground({ type: 'exec', command: 'clipboard_read', params: {} });
  },
  performance: async () => {
    return await sendToBackground({ type: 'exec', command: 'get_page_performance', params: {} });
  },
  cookies: async () => {
    return await sendToBackground({ type: 'exec', command: 'cookie_get', params: {} });
  },
  storage: async () => {
    return await sendToBackground({ type: 'exec', command: 'storage_get', params: { keys: [] } });
  },
  history: async () => {
    return await sendToBackground({ type: 'exec', command: 'get_history', params: {} });
  },
  downloads: async () => {
    return await sendToBackground({ type: 'exec', command: 'get_downloads', params: {} });
  },
};

// ── Command execution ─────────────────────────────────────────────────────────
async function executeCommand(commandStr) {
  const parts = commandStr.trim().split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);

  // Parse common commands
  switch (command) {
    case 'navigate':
    case 'nav':
      return await sendToBackground({ type: 'exec', command: 'navigate', params: { url: args[0] || 'about:blank' } });
    case 'click':
      return await sendToBackground({ type: 'exec', command: 'click', params: { text: args.join(' ') } });
    case 'type':
      return await sendToBackground({ type: 'exec', command: 'type', params: { selector: 'input:focus, textarea:focus', text: args.join(' ') } });
    case 'fill':
      return await sendToBackground({ type: 'exec', command: 'fill', params: { fields: { 'input:focus': args.join(' ') } } });
    case 'scroll':
      return await sendToBackground({ type: 'exec', command: 'scroll', params: { direction: args[0] || 'down' } });
    case 'select':
      return await sendToBackground({ type: 'exec', command: 'select', params: { selector: args[0], value: args[1] } });
    case 'hover':
      return await sendToBackground({ type: 'exec', command: 'hover', params: { text: args.join(' ') } });
    case 'focus':
      return await sendToBackground({ type: 'exec', command: 'focus', params: { selector: args[0] } });
    case 'clear':
      return await sendToBackground({ type: 'exec', command: 'clear', params: { selector: args[0] } });
    case 'press':
    case 'press_key':
      return await sendToBackground({ type: 'exec', command: 'press_key', params: { key: args[0] || 'Enter' } });
    case 'newtab':
    case 'new':
      return await sendToBackground({ type: 'exec', command: 'new_tab', params: { url: args[0] || 'about:blank' } });
    case 'close':
      return await sendToBackground({ type: 'exec', command: 'close_tab', params: { tabId: parseInt(args[0]) || undefined } });
    case 'activate':
    case 'switch':
      return await sendToBackground({ type: 'exec', command: 'activate_tab', params: { url: args[0] } });
    case 'reload':
      return await sendToBackground({ type: 'exec', command: 'reload', params: {} });
    case 'back':
      return await sendToBackground({ type: 'exec', command: 'back', params: {} });
    case 'forward':
      return await sendToBackground({ type: 'exec', command: 'forward', params: {} });
    case 'execute':
    case 'exec':
    case 'js':
      return await sendToBackground({ type: 'exec', command: 'execute_js', params: { script: args.join(' ') } });
    case 'screenshot':
    case 'ss':
      return await sendToBackground({ type: 'exec', command: 'screenshot', params: {} });
    case 'extract':
    case 'text':
      return await sendToBackground({ type: 'exec', command: 'get_page_text', params: {} });
    case 'html':
      return await sendToBackground({ type: 'exec', command: 'get_page_html', params: {} });
    case 'links':
      return await sendToBackground({ type: 'exec', command: 'get_page_links', params: {} });
    case 'forms':
      return await sendToBackground({ type: 'exec', command: 'get_form_fields', params: {} });
    case 'cookie':
      return await sendToBackground({ type: 'exec', command: 'cookie_get', params: { url: args[0] } });
    case 'storage':
      return await sendToBackground({ type: 'exec', command: 'storage_get', params: { keys: args } });
    case 'ping':
      return await sendToBackground({ type: 'exec', command: 'ping', params: {} });
    case 'status':
      return await sendToBackground({ type: 'get-status' });
    default:
      // Try as generic command
      try {
        const params = {};
        if (args.length > 0) {
          try {
            params.value = JSON.parse(args.join(' '));
          } catch {
            params.value = args.join(' ');
          }
        }
        return await sendToBackground({ type: 'exec', command, params });
      } catch (e) {
        return { ok: false, error: 'Unknown command: ' + command };
      }
  }
}

// ── Initialization ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Load initial status
  const stored = await chrome.storage.local.get('bridgeStatus');
  renderStatus(stored.bridgeStatus);
  sendToBackground({ type: 'get-status' }).then(renderStatus).catch(() => {});

  // Load tabs
  await loadTabs();

  // Action buttons
  document.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      const handler = actionHandlers[act];
      if (!handler) return;

      btn.disabled = true;
      const originalContent = btn.innerHTML;
      btn.innerHTML = '<span class="loading"></span>';

      try {
        const res = await handler();
        if (act === 'ping' || act === 'extract' || act === 'links' || act === 'forms' || act === 'inspect' || act === 'performance') {
          const data = res?.data || res;
          showResult(typeof data === 'string' ? data : JSON.stringify(data, null, 2), !res?.ok);
        } else if (act === 'screenshot') {
          if (res?.data?.base64) {
            showResult('Screenshot captured (' + Math.round(res.data.base64.length * 0.75 / 1024) + ' KB)', false);
          } else {
            showResult(JSON.stringify(res, null, 2), !res?.ok);
          }
        } else if (act === 'clipboard') {
          const data = res?.data || res;
          showResult(data?.text || 'Clipboard empty', false);
        } else if (act === 'tabs') {
          // Tabs already loaded in the tab list
        } else if (act === 'cookies') {
          const data = res?.data || res;
          showResult(JSON.stringify(data?.cookies || data, null, 2), !res?.ok);
        } else if (act === 'storage') {
          const data = res?.data || res;
          showResult(JSON.stringify(data?.data || data, null, 2), !res?.ok);
        } else if (act === 'history') {
          const data = res?.data || res;
          showResult(JSON.stringify(data?.history || data, null, 2), !res?.ok);
        } else if (act === 'downloads') {
          const data = res?.data || res;
          showResult(JSON.stringify(data?.downloads || data, null, 2), !res?.ok);
        } else {
          showResult(JSON.stringify(res, null, 2), !res?.ok);
        }
      } catch (e) {
        showResult('Error: ' + (e?.message || String(e)), true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
      }
    });
  });

  // Refresh status button
  $('refreshStatus').addEventListener('click', async () => {
    try {
      const res = await sendToBackground({ type: 'get-status' });
      renderStatus(res);
    } catch {}
  });

  // Refresh tabs button
  $('refreshTabs').addEventListener('click', loadTabs);

  // Close result
  $('closeResult').addEventListener('click', () => $('resultCard').classList.add('hidden'));

  // Command input
  const commandInput = $('commandInput');
  const runCommandBtn = $('runCommand');

  runCommandBtn.addEventListener('click', async () => {
    const cmd = commandInput.value.trim();
    if (!cmd) return;

    runCommandBtn.disabled = true;
    runCommandBtn.textContent = 'Running...';

    try {
      const res = await executeCommand(cmd);
      showResult(JSON.stringify(res?.data || res, null, 2), !res?.ok);
      commandInput.value = '';
    } catch (e) {
      showResult('Error: ' + (e?.message || String(e)), true);
    } finally {
      runCommandBtn.disabled = false;
      runCommandBtn.textContent = 'Run';
    }
  });

  commandInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runCommandBtn.click();
    }
  });

  // Auto-refresh status every 3 seconds
  statusPollTimer = setInterval(async () => {
    try {
      const res = await sendToBackground({ type: 'get-status' });
      renderStatus(res);
    } catch {}
  }, 3000);

  // Auto-connect: Immediately try to connect if not connected
  setTimeout(async () => {
    try {
      const res = await sendToBackground({ type: 'get-status' });
      if (!res?.connected) {
        // Request background to reconnect
        await sendToBackground({ type: 'reconnect' });
      }
    } catch {}
  }, 1000);
});

// Listen for status updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'bridge-status') renderStatus(msg.status);
});

// Cleanup
window.addEventListener('unload', () => {
  if (statusPollTimer) clearInterval(statusPollTimer);
});
