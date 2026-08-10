// Infinite OS Bridge v3.0 — Fast popup UI with real-time updates.

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
      ? 'Missing token in config.js -- re-run the installer.'
      : 'Not connected. Start Infinite OS or run the bridge server.';
    err.classList.remove('hidden');
  } else if (s.hasToken === false) {
    err.textContent = 'Missing token in config.js -- re-run the installer.';
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
};

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

  // Auto-refresh status every 3 seconds
  statusPollTimer = setInterval(async () => {
    try {
      const res = await sendToBackground({ type: 'get-status' });
      renderStatus(res);
    } catch {}
  }, 3000);
});

// Listen for status updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'bridge-status') renderStatus(msg.status);
});

// Cleanup
window.addEventListener('unload', () => {
  if (statusPollTimer) clearInterval(statusPollTimer);
});
