
function showToastNotification(message, type = "info", duration = 2000) {
  let container = document.getElementById("admin-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "admin-toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  const isSuccess = type === "show" || type === "success";
  const isError = type === "hide" || type === "error" || type === "warning";

  const bg = isError ? "#fef2f2" : (isSuccess ? "#ecfdf5" : "#ffffff");
  const color = isError ? "#dc2626" : (isSuccess ? "#059669" : "#0f172a");
  const border = isError ? "#fecaca" : (isSuccess ? "#a7f3d0" : "#e2e8f0");
  const icon = isError ? "⚠️" : (isSuccess ? "✅" : "ℹ️");

  toast.style.cssText = `
    background: ${bg};
    border: 1px solid ${border};
    color: ${color};
    padding: 10px 20px;
    border-radius: 30px;
    font-size: 0.88rem;
    font-weight: 600;
    box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.12);
    display: flex;
    align-items: center;
    gap: 8px;
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  `;
  toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

/**
 * TelegramDrawBot Standalone Web Admin Console
 * Full Client-Side Controller
 */

// Auth State Management
let authToken = sessionStorage.getItem('drawbot_admin_token') || localStorage.getItem('drawbot_admin_token') || '';

function checkAuthOnLoad() {
  const authModal = document.getElementById('modal-auth');
  const logoutBtn = document.getElementById('btn-logout');
  if (!authToken) {
    if (authModal) authModal.classList.remove('hidden');
    if (logoutBtn) logoutBtn.style.display = 'none';
  } else {
    if (authModal) authModal.classList.add('hidden');
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    initDrawDashboard();
  }
}

async function handleAuthLogin(event) {
  event.preventDefault();
  const input = document.getElementById('auth-password-input');
  const password = input ? input.value.trim() : '';
  if (!password) return;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (data.ok && data.token) {
      authToken = data.token;
      sessionStorage.setItem('drawbot_admin_token', authToken);
      const authModal = document.getElementById('modal-auth');
      if (authModal) authModal.classList.add('hidden');
      const logoutBtn = document.getElementById('btn-logout');
      if (logoutBtn) logoutBtn.style.display = 'inline-flex';
      initDrawDashboard();
    } else {
      alert(data.error || 'Invalid password.');
    }
  } catch (err) {
    alert('Failed to connect to server: ' + err.message);
  }
}

function handleLogout() {
  sessionStorage.removeItem('drawbot_admin_token');
  localStorage.removeItem('drawbot_admin_token');
  window.location.reload();
}

function initDrawDashboard() {
  initDrawQuill();
  loadDrawModule();
}

// Quill Editor Instance
let drawQuill = null;
function initDrawQuill() {
  if (drawQuill) return;
  const container = document.getElementById('draw-desc-editor');
  if (!container || typeof Quill === 'undefined') return;
  drawQuill = new Quill('#draw-desc-editor', {
    modules: {
      toolbar: [
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'header': [1, 2, 3, false] }],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        ['link', 'clean']
      ]
    },
    theme: 'snow',
    placeholder: 'Enter event rules, prize details, or welcome note...'
  });
}

// HTML Escaping Utility
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// === TELEGRAM DRAW BOT MODULE CLIENT LOGIC ===

// === USER SYSTEM TIMEZONE HELPERS ===
function getSystemTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (e) {
    return 'UTC';
  }
}

function getSystemTimeZoneOffsetStr() {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  const hours = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const mins = pad(Math.abs(offsetMinutes) % 60);
  return `UTC${sign}${hours}:${mins}`;
}

// Formats date/timestamp for display in user's system timezone (YYYY-MM-DD HH:mm:ss)
function formatLocalDisplay(dateInput) {
  if (!dateInput) return '-';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Converts Date / ISO string to <input type="datetime-local"> value (YYYY-MM-DDTHH:mm) in system local time
function toLocalInputString(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Converts datetime-local string to ISO string with user's system local timezone offset
function toLocalIsoString(dtLocalVal) {
  if (!dtLocalVal || !dtLocalVal.trim()) return undefined;
  // If already formatted with timezone offset or UTC, return as-is
  if (dtLocalVal.includes('+') || dtLocalVal.endsWith('Z')) return dtLocalVal;
  const d = new Date(dtLocalVal);
  if (isNaN(d.getTime())) return dtLocalVal;
  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  const hours = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const mins = pad(Math.abs(offsetMinutes) % 60);
  const offsetStr = `${sign}${hours}:${mins}`;
  const baseTime = dtLocalVal.length === 16 ? `${dtLocalVal}:00` : dtLocalVal;
  return `${baseTime}${offsetStr}`;
}

// Backward-compatible alias helpers
const formatBjtDisplay = formatLocalDisplay;
const toBjtIsoString = toLocalIsoString;
const toBjtInputString = toLocalInputString;

const drawState = {
  engineEnabled: false,
  isToggling: false,
  cachedLotteries: [],
  currentFilter: 'ALL',
  searchQuery: '',
  botConfig: null
};

// Helper for authenticated requests to /api/draw
async function fetchDrawApi(endpoint, options = {}) {
  const token = authToken || sessionStorage.getItem("drawbot_admin_token") || localStorage.getItem("drawbot_admin_token") || "";
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const res = await fetch(`/api/draw${endpoint}`, {
    ...options,
    headers
  });

  if (res.status === 401 || res.status === 403) {
    authToken = "";
    sessionStorage.removeItem("drawbot_admin_token");
    localStorage.removeItem("drawbot_admin_token");
    const authModal = document.getElementById("modal-auth");
    if (authModal) authModal.classList.remove("hidden");
    const logoutBtn = document.getElementById("btn-logout");
    if (logoutBtn) logoutBtn.style.display = "none";
    throw new Error("Authentication required or session expired.");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP error ${res.status}`);
  }
  return data;
}


// Update Top Draw Engine Master Switch UI
function updateDrawEngineUI(enabled) {
  drawState.engineEnabled = true;
  const drawMod = document.getElementById('module-draw');
  if (drawMod) drawMod.classList.remove('draw-dormant-mode');
}

// Toggle Draw Engine Master Switch
async function toggleDrawEngineMasterSwitch(desiredState) {
  const toggleSwitch = document.getElementById('draw-engine-toggle-switch');
  const toggleLabel = document.getElementById('draw-engine-toggle-label');

  // Anti-shake / concurrency mutex protection: reject rapid duplicate clicks
  if (drawState.isToggling) return;
  drawState.isToggling = true;
  if (toggleSwitch) toggleSwitch.disabled = true;

  // If argument is boolean, use it; otherwise invert current drawState.engineEnabled
  const targetState = (typeof desiredState === 'boolean') ? desiredState : !drawState.engineEnabled;

  // Optimistic UI update: slider instantly glides to green/gray
  if (toggleSwitch) toggleSwitch.checked = targetState;
  if (toggleLabel) {
    toggleLabel.textContent = targetState ? '运行中' : '休眠';
    toggleLabel.style.color = targetState ? '#10b981' : '#94a3b8';
  }
  updateDrawEngineUI(targetState);

  try {
    const res = await fetchDrawApi('/status/toggle', {
      method: 'POST',
      body: JSON.stringify({ enabled: targetState })
    });
    drawState.engineEnabled = !!res.enabled;
    updateDrawEngineUI(res.enabled);
    if (res.enabled) {
      showToastNotification('⚡ 抽奖引擎已成功唤醒！自动开奖调度器已启动。', 'show');
      loadDrawModule();
    } else {
      showToastNotification('💤 抽奖引擎已进入休眠模式：0 内存占用。', 'info');
      updateDrawBotStatusUI(null);
    }
  } catch (err) {
    // Rollback switch state on error
    if (toggleSwitch) toggleSwitch.checked = !targetState;
    if (toggleLabel) {
      toggleLabel.textContent = !targetState ? '运行中' : '休眠';
      toggleLabel.style.color = !targetState ? '#10b981' : '#94a3b8';
    }
    updateDrawEngineUI(!targetState);
    showToastNotification('切换抽奖引擎状态失败: ' + err.message, 'hide');
  } finally {
    if (toggleSwitch) toggleSwitch.disabled = false;
    setTimeout(() => {
      drawState.isToggling = false;
    }, 250);
  }
}
window.toggleDrawEngineMasterSwitch = toggleDrawEngineMasterSwitch;
window.updateDrawEngineUI = updateDrawEngineUI;

// Load entire Draw Module
async function loadDrawModule() {
  try {
    // 0. Fetch Engine Status
    const statusData = await fetchDrawApi('/status').catch(() => ({ enabled: false }));
    drawState.engineEnabled = !!statusData.enabled;
    updateDrawEngineUI(statusData.enabled);
    const sw = document.getElementById("draw-engine-toggle-switch");
    if (sw) sw.disabled = false;

    // 1. Fetch Bot Config
    const configData = await fetchDrawApi('/config');
    drawState.botConfig = configData.connectedBot;
    updateDrawBotStatusUI(configData.connectedBot);

    // 2. Fetch Lotteries
    const lotteries = await fetchDrawApi('/lotteries');
    drawState.cachedLotteries = Array.isArray(lotteries) ? lotteries : [];

    // 3. Update KPI Metrics
    updateDrawKpiStats();

    // 4. Render Campaign Cards
    renderDrawCampaigns();
  } catch (err) {
    console.error('[DrawBot] Failed to load module:', err);
    const grid = document.getElementById('draw-campaigns-grid');
    if (grid) {
      grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--danger-color);">⚠️ Failed to load events: ${escapeHtml(err.message)}</div>`;
    }
  }
}

// Update Top Bot Connection Status Banner
function updateDrawBotStatusUI(bot) {
  const pill = document.getElementById('draw-bot-status-pill');
  const userDisplay = document.getElementById('draw-bot-username-display');
  const modalStatus = document.getElementById('draw-settings-bot-status');

  if (bot && bot.username) {
    if (pill) {
      pill.className = 'status-pill online';
      pill.title = 'Connected: @' + bot.username;
    }
    if (userDisplay) userDisplay.textContent = '@' + bot.username;
    if (modalStatus) {
      modalStatus.className = 'status-pill online';
      modalStatus.textContent = 'Connected: @' + bot.username;
    }
  } else {
    if (pill) {
      pill.className = 'status-pill offline';
      pill.title = 'No Bot Connected';
    }
    if (userDisplay) userDisplay.textContent = 'Disconnected';
    if (modalStatus) {
      modalStatus.className = 'status-pill offline';
      modalStatus.textContent = 'Disconnected';
    }
  }
}

// Save & Connect Bot Token
async function connectDrawSessionBot() {
  const tokenInput = document.getElementById('draw-session-token-input');
  const token = tokenInput ? tokenInput.value.trim() : '';
  if (!token) {
    alert('Please enter a valid Telegram Bot Token.');
    return;
  }

  const btn = document.getElementById('btn-draw-connect-token');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  try {
    const res = await fetchDrawApi('/bot/connect', {
      method: 'POST',
      body: JSON.stringify({ token })
    });
    if (res.ok && res.bot) {
      drawState.botConfig = res.bot;
      updateDrawBotStatusUI(res.bot);
      alert(`🎉 Bot connected successfully as @${res.bot.username}!`);
    }
  } catch (err) {
    alert(`Failed to connect bot: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  }
}

// Disconnect Bot
async function disconnectDrawSessionBot() {
  if (!confirm('Are you sure you want to disconnect the running bot session?')) return;
  try {
    await fetchDrawApi('/bot/disconnect', { method: 'POST' });
    drawState.botConfig = null;
    updateDrawBotStatusUI(null);
    alert('Bot session disconnected.');
  } catch (err) {
    alert(`Failed to disconnect: ${err.message}`);
  }
}

// Update KPI Stats Cards
function updateDrawKpiStats() {
  const total = drawState.cachedLotteries.length;
  const active = drawState.cachedLotteries.filter(l => l.status === 'ACTIVE').length;
  const draft = drawState.cachedLotteries.filter(l => l.status === 'DRAFT').length;
  
  let totalWinners = 0;
  drawState.cachedLotteries.forEach(l => {
    if (l.winners && Array.isArray(l.winners)) {
      totalWinners += l.winners.length;
    }
  });

  const elTotal = document.getElementById('draw-stat-total');
  const elActive = document.getElementById('draw-stat-active');
  const elDraft = document.getElementById('draw-stat-draft');
  const elWinners = document.getElementById('draw-stat-winners');

  if (elTotal) elTotal.textContent = total;
  if (elActive) elActive.textContent = active;
  if (elDraft) elDraft.textContent = draft;
  if (elWinners) elWinners.textContent = totalWinners;
}

// Filter and Search Helpers
function filterDrawCampaigns(status, btn) {
  drawState.currentFilter = status;
  const allFilterBtns = document.querySelectorAll('.btn-draw-filter');
  allFilterBtns.forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderDrawCampaigns();
}

function onSearchDrawCampaigns() {
  const searchInput = document.getElementById('draw-search-input');
  drawState.searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
  renderDrawCampaigns();
}

// Render Campaign Cards
function renderDrawCampaigns() {
  const grid = document.getElementById('draw-campaigns-grid');
  if (!grid) return;

  let list = [...drawState.cachedLotteries];

  // Filter by status
  if (drawState.currentFilter !== 'ALL') {
    list = list.filter(l => l.status === drawState.currentFilter);
  }

  // Filter by search query
  if (drawState.searchQuery) {
    list = list.filter(l => 
      (l.internalName && l.internalName.toLowerCase().includes(drawState.searchQuery)) ||
      (l.targetChatId && l.targetChatId.toLowerCase().includes(drawState.searchQuery)) ||
      (l.description && l.description.toLowerCase().includes(drawState.searchQuery))
    );
  }

  if (list.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; background: var(--bg-surface); border: 1px dashed var(--border-subtle); border-radius: 14px;">
        <p style="margin: 0 0 12px 0; color: var(--text-secondary); font-size: 0.95rem;">No giveaway events found matching criteria.</p>
        <button type="button" class="btn btn-primary btn-sm" onclick="openCreateDrawModal()">➕ New Draw</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = list.map(l => {
    const isDraft = l.status === 'DRAFT';
    const isActive = l.status === 'ACTIVE';
    const isDrawing = l.status === 'DRAWING';
    const isEnded = l.status === 'ENDED';

    let badgeClass = 'badge-draft';
    if (isActive) badgeClass = 'badge-active';
    else if (isDrawing) badgeClass = 'badge-drawing';
    else if (isEnded) badgeClass = 'badge-ended';

    const partCount = (l.participants && l.participants.length) || 0;
    const winnerCount = (l.winners && l.winners.length) || 0;

    let prizeSummary = 'No prizes specified';
    if (l.prizes && l.prizes.length > 0) {
      prizeSummary = l.prizes.map(p => `${p.count}x ${escapeHtml(p.name)}`).join(', ');
    }

    const autoTimeDisplay = l.autoDrawTime ? formatLocalDisplay(l.autoDrawTime) : (l.endTime ? formatLocalDisplay(l.endTime) : 'Manual');

    return `
      <div class="draw-card">
        <div style="height: ${l.imageUrl ? '130px' : '42px'}; position: relative; overflow: hidden; background: linear-gradient(135deg, rgba(56, 189, 248, 0.12) 0%, rgba(99, 102, 241, 0.12) 100%); display: flex; align-items: center; justify-content: flex-end; padding: 0 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
          ${l.imageUrl ? `
            <img src="${escapeHtml(l.imageUrl)}" alt="cover" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.parentElement.style.height='42px';" />
          ` : ''}
          <div style="position: relative; z-index: 2;">
            <span class="badge ${badgeClass}" style="padding: 3px 9px; border-radius: 6px; font-weight: 700; font-size: 11px; text-transform: uppercase; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${l.status}</span>
          </div>
        </div>

        <div style="padding: 18px; display: flex; flex-direction: column; flex: 1; gap: 12px;">
          <!-- Top Content Row: Title + Description on left, Copy as Template Button on top-right -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
            <div style="flex: 1; min-width: 0;">
              <h4 style="margin: 0 0 6px 0; font-size: 1.15rem; font-weight: 700; color: var(--text-primary); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(l.internalName)}">
                ${escapeHtml(l.internalName)}
              </h4>
              <p style="margin: 0; font-size: 0.84rem; color: var(--text-secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.45;">
                ${escapeHtml((l.description || 'No description provided.').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())}
              </p>
            </div>
            <button type="button" class="btn btn-secondary btn-xs" onclick="copyDrawCampaignAsTemplate('${l.id}')" title="复制此活动为新模板 (Copy as Template)" style="padding: 5px 9px; font-size: 0.78rem; font-weight: 600; white-space: nowrap; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.15); background: var(--bg-surface); color: var(--text-secondary); display: inline-flex; align-items: center; gap: 4px; cursor: pointer; flex-shrink: 0; transition: all 0.2s ease;">
              📋 复制
            </button>
          </div>

          <div style="background: var(--bg-subtle); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; font-size: 0.82rem; display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: var(--text-muted);">Target Chat:</span>
              <span style="color: var(--primary-color); font-family: var(--font-mono); font-weight: 600;">${escapeHtml(l.targetChatId)}${l.targetTopicId ? ` (T:${escapeHtml(l.targetTopicId)})` : ''}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: var(--text-muted);">Prizes:</span>
              <span style="color: #b45309; font-weight: 600; text-align: right; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">🎁 ${prizeSummary}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: var(--text-muted);">Participants:</span>
              <span style="color: var(--text-primary); font-weight: 600;">👥 ${partCount} joined</span>
            </div>
            ${l.drawMode === 'AUTO' || l.autoDrawTime ? `
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-muted);">Auto Draw:</span>
                <span style="color: var(--text-secondary); font-family: var(--font-mono); font-size: 0.78rem;">⏰ ${escapeHtml(autoTimeDisplay)}</span>
              </div>
            ` : ''}
            ${l.designatedWinners && l.designatedWinners.length > 0 ? `
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-muted);">Designated:</span>
                <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; background: var(--warning-bg); border: 1px solid var(--warning-border); color: #b45309; font-weight: 600; font-size: 0.76rem;">🎯 已预设 ${l.designatedWinners.length} 位中奖者</span>
              </div>
            ` : ''}
          </div>

          <!-- Action Buttons -->
          <div style="display: flex; gap: 8px; margin-top: auto; padding-top: 6px; flex-wrap: wrap;">
            ${isDraft ? `
              <button type="button" class="btn btn-secondary btn-sm" onclick="openEditDrawModal('${l.id}')" style="flex: 1; padding: 7px 12px; font-weight: 600;">
                ✏️ Edit
              </button>
              <button type="button" class="btn btn-primary btn-sm" onclick="publishDrawCampaign('${l.id}')" style="flex: 1.5; padding: 7px 12px; font-weight: 700;">
                🚀 Publish
              </button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="deleteDrawCampaign('${l.id}')" style="padding: 7px 10px; color: #f87171;" title="Delete">
                🗑️
              </button>
            ` : ''}

            ${isActive ? `
              <button type="button" class="btn btn-primary btn-sm" onclick="triggerDrawCampaign('${l.id}')" style="flex: 2; padding: 7px 14px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); font-weight: 700;">
                🎲 Draw Winners Now
              </button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="deleteDrawCampaign('${l.id}')" style="padding: 7px 10px; color: #f87171;" title="Delete">
                🗑️
              </button>
            ` : ''}

            ${isEnded ? `
              <button type="button" class="btn btn-secondary btn-sm" onclick="openDrawWinnersModal('${l.id}')" style="flex: 1.5; padding: 7px 12px; font-weight: 600;">
                🏆 Winners (${winnerCount})
              </button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="reannounceDrawWinners('${l.id}')" style="flex: 1.5; padding: 7px 10px; color: #38bdf8; font-weight: 600;" title="Re-broadcast announcement to Telegram">
                📢 Broadcast
              </button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="deleteDrawCampaign('${l.id}')" style="padding: 7px 10px; color: #f87171;" title="Delete">
                🗑️
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Campaign Modal Logic (Create & Edit)
function openCreateDrawModal() {
  const modal = document.getElementById('modal-draw-campaign');
  const title = document.getElementById('modal-draw-campaign-title');
  const editIdInput = document.getElementById('draw-edit-id');
  const form = document.getElementById('form-draw-campaign');

  if (form) form.reset();
  if (editIdInput) editIdInput.value = '';
  if (title) title.textContent = 'New Event Draft';

  // Setup default 1 prize tier
  const prizeContainer = document.getElementById('draw-prize-rows-container');
  if (prizeContainer) {
    prizeContainer.innerHTML = '';
    addPrizeTierRow('100 USDT', 1);
  }

  toggleDrawModeFields();
  if (modal) modal.classList.remove('hidden');
  initDrawQuill();
  if (drawQuill) drawQuill.setText('');
}

function openEditDrawModal(id) {
  const lottery = drawState.cachedLotteries.find(l => l.id === id);
  if (!lottery) return;

  if (lottery.status !== 'DRAFT' || lottery.telegramMessageId) {
    alert('Only unpublished draft events can be edited.');
    return;
  }

  const modal = document.getElementById('modal-draw-campaign');
  const title = document.getElementById('modal-draw-campaign-title');
  const editIdInput = document.getElementById('draw-edit-id');

  if (title) title.textContent = 'Edit Event Draft';
  if (editIdInput) editIdInput.value = lottery.id;

  const fName = document.getElementById('draw-form-name');
  const fTargetChat = document.getElementById('draw-form-target-chat');
  const fTargetTopic = document.getElementById('draw-form-target-topic');
  const fDesc = document.getElementById('draw-form-desc');
  const fBtnText = document.getElementById('draw-form-button-text');
  const fImgUrl = document.getElementById('draw-form-image-url');
  const fMode = document.getElementById('draw-form-mode');
  const fAutoTime = document.getElementById('draw-form-autotime');
  const fReqChannel = document.getElementById('draw-form-req-channel');
  const fReqGroup = document.getElementById('draw-form-req-group');
  const fAllowedIds = document.getElementById('draw-form-allowed-ids');
  const fAnnouncement = document.getElementById('draw-form-announcement');

  if (fName) fName.value = lottery.internalName || '';
  if (fTargetChat) fTargetChat.value = lottery.targetChatId || '';
  if (fTargetTopic) fTargetTopic.value = lottery.targetTopicId || '';
  if (fDesc) fDesc.value = lottery.description || '';
  if (fBtnText) fBtnText.value = lottery.buttonText || '🎉 Join Lucky Draw';
  if (fImgUrl) fImgUrl.value = lottery.imageUrl || '';
  if (fMode) fMode.value = lottery.drawMode || 'MANUAL';
  if (fAutoTime) fAutoTime.value = lottery.autoDrawTime ? toLocalInputString(lottery.autoDrawTime) : '';
  if (fReqChannel) fReqChannel.value = lottery.requiredChannelId || '';
  if (fReqGroup) fReqGroup.value = lottery.requiredGroupId || '';
  if (fAllowedIds) fAllowedIds.value = (lottery.allowedChatIds || []).join(', ');
  if (fAnnouncement) fAnnouncement.value = lottery.announcementTemplate || '';

  // Render prizes
  const prizeContainer = document.getElementById('draw-prize-rows-container');
  if (prizeContainer) {
    prizeContainer.innerHTML = '';
    if (lottery.prizes && lottery.prizes.length > 0) {
      lottery.prizes.forEach(p => addPrizeTierRow(p.name, p.count));
    } else {
      addPrizeTierRow('100 USDT', 1);
    }
  }

  toggleDrawModeFields();
  if (modal) modal.classList.remove('hidden');
  initDrawQuill();
  if (drawQuill) {
    if (lottery.description) {
      drawQuill.root.innerHTML = lottery.description;
    } else {
      drawQuill.setText('');
    }
  }
}

// Copy existing campaign as a new draft template
function copyDrawCampaignAsTemplate(id) {
  const lottery = drawState.cachedLotteries.find(l => l.id === id);
  if (!lottery) return;

  const modal = document.getElementById('modal-draw-campaign');
  const title = document.getElementById('modal-draw-campaign-title');
  const editIdInput = document.getElementById('draw-edit-id');
  const form = document.getElementById('form-draw-campaign');

  if (form) form.reset();
  if (editIdInput) editIdInput.value = ''; // Empty ID ensures saving creates a brand new event draft
  if (title) title.textContent = `New Event Draft (Copied from ${lottery.internalName})`;

  const fName = document.getElementById('draw-form-name');
  const fTargetChat = document.getElementById('draw-form-target-chat');
  const fTargetTopic = document.getElementById('draw-form-target-topic');
  const fDesc = document.getElementById('draw-form-desc');
  const fBtnText = document.getElementById('draw-form-button-text');
  const fImgUrl = document.getElementById('draw-form-image-url');
  const fMode = document.getElementById('draw-form-mode');
  const fAutoTime = document.getElementById('draw-form-autotime');
  const fReqChannel = document.getElementById('draw-form-req-channel');
  const fReqGroup = document.getElementById('draw-form-req-group');
  const fAllowedIds = document.getElementById('draw-form-allowed-ids');
  const fAnnouncement = document.getElementById('draw-form-announcement');

  if (fName) fName.value = `${lottery.internalName} (Copy)`;
  if (fTargetChat) fTargetChat.value = lottery.targetChatId || '';
  if (fTargetTopic) fTargetTopic.value = lottery.targetTopicId || '';
  if (fBtnText) fBtnText.value = lottery.buttonText || '🎉 Join Lucky Draw';
  if (fImgUrl) fImgUrl.value = lottery.imageUrl || '';
  if (fMode) fMode.value = lottery.drawMode || 'MANUAL';
  if (fAutoTime) fAutoTime.value = ''; // Reset schedule time for copied template
  if (fReqChannel) fReqChannel.value = lottery.requiredChannelId || '';
  if (fReqGroup) fReqGroup.value = lottery.requiredGroupId || '';
  if (fAllowedIds) fAllowedIds.value = (lottery.allowedChatIds || []).join(', ');
  if (fAnnouncement) fAnnouncement.value = lottery.announcementTemplate || '';

  // Initialize Quill editor and prefill description
  initDrawQuill();
  if (drawQuill) {
    if (lottery.description) {
      drawQuill.root.innerHTML = lottery.description;
    } else {
      drawQuill.setText('');
    }
  }
  if (fDesc) fDesc.value = lottery.description || '';

  // Render cloned prizes
  const prizeContainer = document.getElementById('draw-prize-rows-container');
  if (prizeContainer) {
    prizeContainer.innerHTML = '';
    if (lottery.prizes && lottery.prizes.length > 0) {
      lottery.prizes.forEach(p => addPrizeTierRow(p.name, p.count));
    } else {
      addPrizeTierRow('100 USDT', 1);
    }
  }

  toggleDrawModeFields();
  if (modal) modal.classList.remove('hidden');
}
window.copyDrawCampaignAsTemplate = copyDrawCampaignAsTemplate;

function closeDrawCampaignModal() {
  const modal = document.getElementById('modal-draw-campaign');
  if (modal) modal.classList.add('hidden');
}

function toggleDrawModeFields() {
  const modeSelect = document.getElementById('draw-form-mode');
  const autoWrap = document.getElementById('draw-form-autotime-wrap');
  if (modeSelect && autoWrap) {
    if (modeSelect.value === 'AUTO') {
      autoWrap.classList.remove('hidden');
      updateDrawFormClock();
    } else {
      autoWrap.classList.add('hidden');
    }
  }
}

function updateDrawFormClock() {
  const clockEl = document.getElementById('draw-form-clock') || document.getElementById('draw-form-bjt-clock');
  if (clockEl) {
    clockEl.textContent = `系统本地时间: ${formatLocalDisplay(new Date())} (${getSystemTimeZone()})`;
  }
}

function addPrizeTierRow(name = '', count = 1) {
  const container = document.getElementById('draw-prize-rows-container');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'draw-prize-row';
  row.style.cssText = 'display: flex; gap: 8px; align-items: center;';
  row.innerHTML = `
    <input type="text" placeholder="Prize Name (e.g. VIP Subscription)" value="${escapeHtml(name)}" class="draw-prize-name form-input" style="flex: 2; font-size: 0.86rem;" required />
    <input type="number" min="1" placeholder="Count" value="${count}" class="draw-prize-count form-input" style="width: 84px; font-size: 0.86rem; text-align: center;" required />
    <button type="button" class="btn btn-secondary btn-xs" onclick="removePrizeTierRow(this)" style="padding: 7px 10px; color: var(--danger-color); font-size: 1rem;" title="Remove Tier">&times;</button>
  `;
  container.appendChild(row);
}

function removePrizeTierRow(btn) {
  const container = document.getElementById('draw-prize-rows-container');
  if (container && container.children.length > 1) {
    btn.parentElement.remove();
  } else {
    alert('At least one prize tier is required.');
  }
}

// Save Campaign Draft
async function handleSaveDrawCampaign(event) {
  event.preventDefault();

  const editId = document.getElementById('draw-edit-id')?.value || '';
  const internalName = document.getElementById('draw-form-name')?.value.trim();
  const targetChatId = document.getElementById('draw-form-target-chat')?.value.trim();
  const targetTopicId = document.getElementById('draw-form-target-topic')?.value.trim() || undefined;
  let description = '';
  if (drawQuill) {
    const textOnly = drawQuill.getText().trim();
    if (textOnly) {
      description = drawQuill.root.innerHTML.trim();
    }
  } else {
    description = document.getElementById('draw-form-desc')?.value.trim() || '';
  }
  const buttonText = document.getElementById('draw-form-button-text')?.value.trim() || '🎉 Join Lucky Draw';
  const imageUrl = document.getElementById('draw-form-image-url')?.value.trim() || undefined;
  const drawMode = document.getElementById('draw-form-mode')?.value || 'MANUAL';
  const rawAutoTime = document.getElementById('draw-form-autotime')?.value;
  const autoDrawTime = rawAutoTime ? toLocalIsoString(rawAutoTime) : undefined;
  const cleanLinkOrId = (val) => {
    if (!val || !val.trim()) return undefined;
    let clean = val.trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^t\.me\//i, '').trim();
    if (!clean.startsWith('@') && !clean.startsWith('-') && !/^-?\d+$/.test(clean)) {
      clean = '@' + clean;
    }
    return clean;
  };
  const requiredChannelId = cleanLinkOrId(document.getElementById('draw-form-req-channel')?.value);
  const requiredGroupId = cleanLinkOrId(document.getElementById('draw-form-req-group')?.value);
  const announcementTemplate = document.getElementById('draw-form-announcement')?.value.trim() || undefined;

  const allowedStr = document.getElementById('draw-form-allowed-ids')?.value || '';
  const allowedChatIds = allowedStr.split(',').map(s => s.trim()).filter(Boolean);

  // Collect prizes
  const prizeRows = document.querySelectorAll('.draw-prize-row');
  const prizes = [];
  prizeRows.forEach((row, idx) => {
    const pName = row.querySelector('.draw-prize-name')?.value.trim();
    const pCount = parseInt(row.querySelector('.draw-prize-count')?.value || '1', 10);
    if (pName) {
      prizes.push({ id: String(idx + 1), name: pName, count: pCount });
    }
  });

  if (prizes.length === 0) {
    alert('Please specify at least one prize tier.');
    return;
  }

  if (drawMode === 'AUTO') {
    if (!autoDrawTime) {
      alert('⚠️ 请设置自动开奖时间（系统本地时区）！');
      return;
    }
    const autoDrawMs = new Date(autoDrawTime).getTime();
    if (isNaN(autoDrawMs)) {
      alert('⚠️ 自动开奖时间格式无效，请重新选择！');
      return;
    }
    if (autoDrawMs <= Date.now()) {
      const tzName = getSystemTimeZone();
      alert(`⚠️ 自动开奖时间不能早于当前时间！\n\n当前系统时间: ${formatLocalDisplay(new Date())} (${tzName})\n所选开奖时间: ${formatLocalDisplay(autoDrawTime)}\n\n请设置未来的开奖时间。`);
      return;
    }
  }

  const payload = {
    id: editId || undefined,
    internalName,
    targetChatId,
    targetTopicId,
    description,
    buttonText,
    imageUrl,
    drawMode,
    autoDrawTime: drawMode === 'AUTO' ? autoDrawTime : undefined,
    requiredChannelId,
    requiredGroupId,
    allowedChatIds,
    announcementTemplate,
    prizes,
    status: 'DRAFT'
  };

  const btn = document.getElementById('btn-save-draw-campaign');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  try {
    const res = await fetchDrawApi('/lotteries', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      closeDrawCampaignModal();
      await loadDrawModule();
      alert('Event draft saved successfully!');
    }
  } catch (err) {
    alert(`Failed to save draft: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 Save Event Draft';
    }
  }
}

// Publish Campaign
async function publishDrawCampaign(id) {
  if (!confirm('Are you sure you want to publish this event to Telegram?')) return;

  // Interlock check: Is draw engine currently dormant?
  if (!drawState.engineEnabled) {
    const autoWake = confirm('⚠️ 抽奖引擎当前处于休眠状态（后台自动开奖调度器已停用）。\n\n发布活动后需要引擎处于运行状态才能自动结算与推送。\n\n是否立即一键唤醒抽奖引擎并发布活动？');
    if (!autoWake) return;
    try {
      const wakeRes = await fetchDrawApi('/status/toggle', {
        method: 'POST',
        body: JSON.stringify({ enabled: true })
      });
      drawState.engineEnabled = !!wakeRes.enabled;
      updateDrawEngineUI(wakeRes.enabled);
      showToastNotification('⚡ 抽奖引擎已自动唤醒！', 'show');
    } catch (e) {
      alert('唤醒抽奖引擎失败: ' + e.message);
      return;
    }
  }

  try {
    const res = await fetchDrawApi(`/lotteries/${id}/publish`, { method: 'POST' });
    if (res.ok) {
      await loadDrawModule();
      showToastNotification('🚀 Event published successfully to Telegram!', 'show');
    }
  } catch (err) {
    alert(`Publish failed: ${err.message}`);
  }
}

// Trigger Manual Draw

// ==================== DRAW CONFIRM & DESIGNATED WINNERS LOGIC ====================
let currentConfirmDrawLottery = null;
let currentConfirmDrawParticipants = [];

async function triggerDrawCampaign(id) {
  openDrawConfirmModal(id);
}

async function openDrawConfirmModal(id) {
  const lottery = drawState.cachedLotteries.find(l => l.id === id);
  if (!lottery) return;

  currentConfirmDrawLottery = lottery;

  // Interlock check: Ensure engine is awake
  if (!drawState.engineEnabled) {
    const autoWake = confirm('⚠️ 抽奖引擎当前处于休眠状态。\n\n执行开奖并宣布中奖者需要引擎处于运行状态。\n\n是否立即唤醒引擎并进入开奖确认？');
    if (!autoWake) return;
    try {
      const wakeRes = await fetchDrawApi('/status/toggle', {
        method: 'POST',
        body: JSON.stringify({ enabled: true })
      });
      drawState.engineEnabled = !!wakeRes.enabled;
      updateDrawEngineUI(wakeRes.enabled);
      showToastNotification('⚡ 抽奖引擎已自动唤醒！', 'show');
    } catch (e) {
      alert('唤醒抽奖引擎失败: ' + e.message);
      return;
    }
  }

  // Populate Event Summary
  const nameEl = document.getElementById('draw-confirm-event-name');
  const chatEl = document.getElementById('draw-confirm-target-chat');
  const prizesEl = document.getElementById('draw-confirm-prizes');
  const partEl = document.getElementById('draw-confirm-participants');

  if (nameEl) nameEl.textContent = lottery.internalName;
  if (chatEl) chatEl.textContent = `${lottery.targetChatId}${lottery.targetTopicId ? ` (T:${lottery.targetTopicId})` : ''}`;
  
  const totalPrizeCount = (lottery.prizes || []).reduce((sum, p) => sum + p.count, 0);
  const prizeSummary = (lottery.prizes || []).map(p => `${p.count}x ${p.name}`).join(', ');
  if (prizesEl) prizesEl.textContent = `${prizeSummary} (共 ${totalPrizeCount} 份)`;
  
  const partCount = (lottery.participants && lottery.participants.length) || 0;
  if (partEl) partEl.textContent = `${partCount} 人已报名`;

  // Populate Auto Draw Time and Designated Status
  const autoEl = document.getElementById('draw-confirm-autotime');
  const desigEl = document.getElementById('draw-confirm-designated-status');
  const desigRow = document.getElementById('draw-confirm-designated-row');

  if (autoEl) {
    if (lottery.autoDrawTime) {
      autoEl.textContent = `${formatLocalDisplay(lottery.autoDrawTime)} (自动开奖)`;
    } else if (lottery.endTime) {
      autoEl.textContent = `${formatLocalDisplay(lottery.endTime)} (活动结束)`;
    } else {
      autoEl.textContent = '手动开奖 (Manual)';
    }
  }

  if (desigRow && desigEl) {
    if (lottery.designatedWinners && lottery.designatedWinners.length > 0) {
      desigRow.classList.remove('hidden');
      desigEl.textContent = `${lottery.designatedWinners.length} 位中奖者已预设`;
    } else {
      desigRow.classList.add('hidden');
      desigEl.textContent = '--';
    }
  }

  // Fetch full participant list in background to ensure fresh data
  try {
    const res = await fetchDrawApi(`/lotteries/${id}/participants?limit=1000`);
    if (res && res.participants) {
      currentConfirmDrawParticipants = res.participants;
      if (partEl) partEl.textContent = `${res.total || res.participants.length} 人已报名`;
    } else {
      currentConfirmDrawParticipants = lottery.participants || [];
    }
  } catch (err) {
    currentConfirmDrawParticipants = lottery.participants || [];
  }

  // Reset view to Step 1
  switchBackToDrawStep1();

  const modal = document.getElementById('modal-draw-confirm');
  if (modal) modal.classList.remove('hidden');
}

function closeDrawConfirmModal() {
  const modal = document.getElementById('modal-draw-confirm');
  if (modal) modal.classList.add('hidden');
  currentConfirmDrawLottery = null;
  currentConfirmDrawParticipants = [];
}

function switchBackToDrawStep1() {
  const step1 = document.getElementById('draw-confirm-step-1');
  const step2 = document.getElementById('draw-confirm-step-2');
  if (step1) step1.classList.remove('hidden');
  if (step2) step2.classList.add('hidden');
}

async function executeRandomDraw(id) {
  const lotteryId = id || (currentConfirmDrawLottery && currentConfirmDrawLottery.id);
  if (!lotteryId) return;

  const btn = document.getElementById('btn-draw-confirm-random');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ 正在随机开奖并推送...</span>';
  }

  try {
    const res = await fetchDrawApi(`/lotteries/${lotteryId}/draw`, {
      method: 'POST',
      body: JSON.stringify({ designatedWinners: [] })
    });
    if (res.ok) {
      closeDrawConfirmModal();
      await loadDrawModule();
      const count = (res.winners && res.winners.length) || 0;
      showToastNotification(`🎉 开奖成功！共抽取 ${count} 位中奖者并已推送到社群。`, 'show');
    }
  } catch (err) {
    alert(`开奖失败: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.3rem;">⚡</span>
          <div style="text-align: left;">
            <div>立刻开奖 (全随机)</div>
            <div style="font-size: 0.76rem; font-weight: normal; opacity: 0.9;">所有奖品全随机自动抽取并公布</div>
          </div>
        </div>
        <span style="font-size: 1.1rem; opacity: 0.8;">&rarr;</span>
      `;
    }
  }
}

function switchToDesignatedDrawView() {
  if (!currentConfirmDrawLottery) return;
  if (!currentConfirmDrawParticipants || currentConfirmDrawParticipants.length === 0) {
    alert('当前暂无用户参与本次抽奖，无法指定中奖者！');
    return;
  }

  const step1 = document.getElementById('draw-confirm-step-1');
  const step2 = document.getElementById('draw-confirm-step-2');
  if (step1) step1.classList.add('hidden');
  if (step2) step2.classList.remove('hidden');

  // Clear previous rows
  const container = document.getElementById('draw-designated-rows-container');
  if (container) {
    container.innerHTML = '';
  }

  // Configure Schedule Box display
  const scheduleBadge = document.getElementById('draw-desig-current-autotime-badge');
  const timeInputWrap = document.getElementById('draw-desig-time-input-wrap');
  const newAutoTimeInput = document.getElementById('draw-desig-new-autotime');
  const scheduleBtn = document.getElementById('btn-save-schedule-designated');

  if (currentConfirmDrawLottery.autoDrawTime) {
    if (scheduleBadge) scheduleBadge.textContent = formatLocalDisplay(currentConfirmDrawLottery.autoDrawTime);
    if (timeInputWrap) timeInputWrap.classList.add('hidden');
    if (scheduleBtn) scheduleBtn.textContent = '⏰ 按照 Auto Draw 时间开奖';
  } else {
    if (scheduleBadge) scheduleBadge.textContent = '未预设定时时间';
    if (timeInputWrap) timeInputWrap.classList.remove('hidden');
    if (newAutoTimeInput) newAutoTimeInput.value = '';
    if (scheduleBtn) scheduleBtn.textContent = '⏰ 设置时间并按定时开奖';
  }

  // Pre-fill existing designated winners if any
  if (currentConfirmDrawLottery.designatedWinners && currentConfirmDrawLottery.designatedWinners.length > 0) {
    currentConfirmDrawLottery.designatedWinners.forEach(dw => {
      addDesignatedWinnerRow(dw.participantId, dw.prizeName);
    });
  } else {
    addDesignatedWinnerRow();
  }
  updateDesignatedCounters();
}

function addDesignatedWinnerRow(preSelectPartId, preSelectPrizeName) {
  if (!currentConfirmDrawLottery) return;
  const container = document.getElementById('draw-designated-rows-container');
  if (!container) return;

  const totalPrizeCount = (currentConfirmDrawLottery.prizes || []).reduce((sum, p) => sum + p.count, 0);
  const currentRowsCount = container.querySelectorAll('.draw-designated-row').length;
  if (currentRowsCount >= totalPrizeCount) {
    return;
  }

  // Build participants options
  const partOptions = currentConfirmDrawParticipants.map(p => {
    let label = '';
    if (p.username && !p.username.startsWith('User')) {
      label = `@${p.username}`;
      if (p.firstName || p.lastName) {
        label += ` (${[p.firstName, p.lastName].filter(Boolean).join(' ')})`;
      }
    } else {
      label = [p.firstName, p.lastName].filter(Boolean).join(' ') || `User#${String(p.chatId).slice(-4)}`;
    }
    label += ` [ID: ${p.chatId}]`;
    const isSelected = preSelectPartId && (String(p.id) === String(preSelectPartId) || String(p.chatId) === String(preSelectPartId));
    return `<option value="${escapeHtml(p.id || p.chatId)}" ${isSelected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');

  // Build prizes options
  const prizeOptions = (currentConfirmDrawLottery.prizes || []).map(p => {
    const isSelected = preSelectPrizeName && String(p.name) === String(preSelectPrizeName);
    return `<option value="${escapeHtml(p.name)}" ${isSelected ? 'selected' : ''}>${escapeHtml(p.name)} (${p.count}份)</option>`;
  }).join('');

  const row = document.createElement('div');
  row.className = 'draw-designated-row';
  row.style.cssText = 'display: flex; gap: 8px; align-items: center; background: var(--bg-subtle); border: 1px solid var(--border-color); border-radius: 8px; padding: 8px 10px;';
  row.innerHTML = `
    <select class="draw-desig-part-select form-input" style="flex: 2; font-size: 0.84rem;" onchange="updateDesignatedCounters()">
      ${partOptions}
    </select>
    <select class="draw-desig-prize-select form-input" style="flex: 1.5; font-size: 0.84rem; font-weight: 600; color: #b45309;" onchange="updateDesignatedCounters()">
      ${prizeOptions}
    </select>
    <button type="button" class="btn btn-secondary btn-xs" onclick="removeDesignatedWinnerRow(this)" style="padding: 6px 10px; color: var(--danger-color);" title="Remove">
      &times;
    </button>
  `;
  container.appendChild(row);
  updateDesignatedCounters();
}

function removeDesignatedWinnerRow(btn) {
  const row = btn.closest('.draw-designated-row');
  if (row) {
    row.remove();
    updateDesignatedCounters();
  }
}

function clearAllDesignatedRows() {
  const container = document.getElementById('draw-designated-rows-container');
  if (container) {
    container.innerHTML = '';
    updateDesignatedCounters();
  }
}

function updateDesignatedCounters() {
  if (!currentConfirmDrawLottery) return;
  const container = document.getElementById('draw-designated-rows-container');
  const rows = container ? container.querySelectorAll('.draw-designated-row') : [];
  const assignedCount = rows.length;
  const totalPrizeCount = (currentConfirmDrawLottery.prizes || []).reduce((sum, p) => sum + p.count, 0);
  const remainingCount = Math.max(0, totalPrizeCount - assignedCount);

  const totalEl = document.getElementById('draw-desig-total-prizes');
  const assignedEl = document.getElementById('draw-desig-assigned-count');
  const remainingEl = document.getElementById('draw-desig-remaining-count');
  const addBtn = document.getElementById('btn-add-designated-row');
  const limitTip = document.getElementById('draw-desig-limit-tip');

  if (totalEl) totalEl.textContent = totalPrizeCount;
  if (assignedEl) assignedEl.textContent = assignedCount;
  if (remainingEl) remainingEl.textContent = remainingCount;

  if (assignedCount >= totalPrizeCount) {
    if (addBtn) addBtn.disabled = true;
    if (limitTip) limitTip.classList.remove('hidden');
  } else {
    if (addBtn) addBtn.disabled = false;
    if (limitTip) limitTip.classList.add('hidden');
  }
}

async function saveAndScheduleDesignatedDraw() {
  if (!currentConfirmDrawLottery) return;
  const lotteryId = currentConfirmDrawLottery.id;

  const container = document.getElementById('draw-designated-rows-container');
  const rows = container ? container.querySelectorAll('.draw-designated-row') : [];

  const designatedWinners = [];
  const selectedPartIds = new Set();
  const prizeCounts = {};
  (currentConfirmDrawLottery.prizes || []).forEach(p => {
    prizeCounts[p.name] = p.count;
  });

  const currentPrizeAssigned = {};

  for (const row of rows) {
    const partSelect = row.querySelector('.draw-desig-part-select');
    const prizeSelect = row.querySelector('.draw-desig-prize-select');
    const partId = partSelect ? partSelect.value : '';
    const prizeName = prizeSelect ? prizeSelect.value : '';

    if (!partId || !prizeName) continue;

    if (selectedPartIds.has(partId)) {
      alert('⚠️ 参与者已被重复指定，每位用户在同一场抽奖中只能中奖一次！');
      return;
    }
    selectedPartIds.add(partId);

    currentPrizeAssigned[prizeName] = (currentPrizeAssigned[prizeName] || 0) + 1;
    if (currentPrizeAssigned[prizeName] > (prizeCounts[prizeName] || 0)) {
      alert(`⚠️ 奖品【${prizeName}】总数仅有 ${prizeCounts[prizeName]} 份，当前指定了 ${currentPrizeAssigned[prizeName]} 人，已超出奖品数量上限！`);
      return;
    }

    designatedWinners.push({ participantId: partId, prizeName });
  }

  let autoDrawTime = currentConfirmDrawLottery.autoDrawTime;
  const newTimeInput = document.getElementById('draw-desig-new-autotime');
  if ((!autoDrawTime || !autoDrawTime.trim()) && newTimeInput && newTimeInput.value) {
    autoDrawTime = toLocalIsoString(newTimeInput.value);
  }

  if (!autoDrawTime || !autoDrawTime.trim()) {
    alert('⚠️ 按照定时开奖需要设置自动开奖时间，请在上方选择开奖时间！');
    const wrap = document.getElementById('draw-desig-time-input-wrap');
    if (wrap) wrap.classList.remove('hidden');
    if (newTimeInput) newTimeInput.focus();
    return;
  }

  const btn = document.getElementById('btn-save-schedule-designated');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '保存中...';
  }

  try {
    const res = await fetchDrawApi(`/lotteries/${lotteryId}/pre-assign-winners`, {
      method: 'POST',
      body: JSON.stringify({ designatedWinners, autoDrawTime })
    });
    if (res.ok) {
      closeDrawConfirmModal();
      await loadDrawModule();
      const timeFormatted = formatLocalDisplay(autoDrawTime);
      if (designatedWinners.length > 0) {
        showToastNotification(`✅ 已成功保存指定获奖者（共 ${designatedWinners.length} 人）！将在自动开奖时间（${timeFormatted}）自动开奖并公布，无需再次人工操作。`, 'show');
      } else {
        showToastNotification(`✅ 已保存纯随机开奖配置！将在自动开奖时间（${timeFormatted}）自动全随机开奖并公布。`, 'show');
      }
    }
  } catch (err) {
    alert(`保存失败: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⏰ 按照 Auto Draw 时间开奖';
    }
  }
}

async function executeDesignatedDraw() {
  if (!currentConfirmDrawLottery) return;
  const lotteryId = currentConfirmDrawLottery.id;

  const container = document.getElementById('draw-designated-rows-container');
  const rows = container ? container.querySelectorAll('.draw-designated-row') : [];

  const designatedWinners = [];
  const selectedPartIds = new Set();
  const prizeCounts = {};
  (currentConfirmDrawLottery.prizes || []).forEach(p => {
    prizeCounts[p.name] = p.count;
  });

  const currentPrizeAssigned = {};

  for (const row of rows) {
    const partSelect = row.querySelector('.draw-desig-part-select');
    const prizeSelect = row.querySelector('.draw-desig-prize-select');
    const partId = partSelect ? partSelect.value : '';
    const prizeName = prizeSelect ? prizeSelect.value : '';

    if (!partId || !prizeName) continue;

    if (selectedPartIds.has(partId)) {
      alert(`⚠️ 参与者已被重复指定，每位用户在同一场抽奖中只能中奖一次！`);
      return;
    }
    selectedPartIds.add(partId);

    currentPrizeAssigned[prizeName] = (currentPrizeAssigned[prizeName] || 0) + 1;
    if (currentPrizeAssigned[prizeName] > (prizeCounts[prizeName] || 0)) {
      alert(`⚠️ 奖品【${prizeName}】总数仅有 ${prizeCounts[prizeName]} 份，当前指定了 ${currentPrizeAssigned[prizeName]} 人，已超出奖品数量上限！`);
      return;
    }

    designatedWinners.push({ participantId: partId, prizeName });
  }

  const btn = document.getElementById('btn-execute-designated-draw');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '正在开奖...';
  }

  try {
    const res = await fetchDrawApi(`/lotteries/${lotteryId}/draw`, {
      method: 'POST',
      body: JSON.stringify({ designatedWinners })
    });
    if (res.ok) {
      closeDrawConfirmModal();
      await loadDrawModule();
      const count = (res.winners && res.winners.length) || 0;
      showToastNotification(`🎉 开奖成功！指定 ${designatedWinners.length} 人，随机抽取 ${count - designatedWinners.length} 人，已推送到社群。`, 'show');
    }
  } catch (err) {
    alert(`开奖失败: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚡ 立刻开奖';
    }
  }
}
window.openDrawConfirmModal = openDrawConfirmModal;
window.closeDrawConfirmModal = closeDrawConfirmModal;
window.switchBackToDrawStep1 = switchBackToDrawStep1;
window.executeRandomDraw = executeRandomDraw;
window.switchToDesignatedDrawView = switchToDesignatedDrawView;
window.addDesignatedWinnerRow = addDesignatedWinnerRow;
window.removeDesignatedWinnerRow = removeDesignatedWinnerRow;
window.clearAllDesignatedRows = clearAllDesignatedRows;
window.updateDesignatedCounters = updateDesignatedCounters;
window.saveAndScheduleDesignatedDraw = saveAndScheduleDesignatedDraw;
window.executeDesignatedDraw = executeDesignatedDraw;


// Delete Campaign
async function deleteDrawCampaign(id) {
  if (!confirm('Are you sure you want to permanently delete this event?')) return;

  try {
    await fetchDrawApi(`/lotteries/${id}`, { method: 'DELETE' });
    await loadDrawModule();
  } catch (err) {
    alert(`Delete failed: ${err.message}`);
  }
}


// Re-broadcast Winner Announcement
async function reannounceDrawWinners(id) {
  if (!confirm('Re-broadcast winner announcement to Telegram channel/group now?')) return;
  try {
    const res = await fetchDrawApi(`/lotteries/${id}/reannounce`, { method: 'POST' });
    if (res.ok) {
      showToastNotification('📢 Results successfully re-broadcast to Telegram!', 'show');
    }
  } catch (err) {
    alert(`Re-broadcast failed: ${err.message}`);
  }
}
window.reannounceDrawWinners = reannounceDrawWinners;

// Modal 2: Winners Management Logic
function openDrawWinnersModal(selectedCampaignId = 'ALL') {
  const modal = document.getElementById('modal-draw-winners');
  const campaignSelect = document.getElementById('draw-winners-filter-campaign');

  if (campaignSelect) {
    campaignSelect.innerHTML = '<option value="ALL">All Events (All Winners)</option>';
    drawState.cachedLotteries.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = `${l.internalName} (${(l.winners && l.winners.length) || 0} winners)`;
      campaignSelect.appendChild(opt);
    });
    campaignSelect.value = selectedCampaignId;
  }

  renderDrawWinnersTable();
  if (modal) modal.classList.remove('hidden');
}

function closeDrawWinnersModal() {
  const modal = document.getElementById('modal-draw-winners');
  if (modal) modal.classList.add('hidden');
}

function renderDrawWinnersTable() {
  const tbody = document.getElementById('draw-winners-tbody');
  const filterSelect = document.getElementById('draw-winners-filter-campaign');
  const searchInput = document.getElementById('draw-winners-search');

  if (!tbody) return;

  const campaignFilter = filterSelect ? filterSelect.value : 'ALL';
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  let allWinners = [];
  drawState.cachedLotteries.forEach(l => {
    if (campaignFilter !== 'ALL' && l.id !== campaignFilter) return;

    if (l.winners && Array.isArray(l.winners)) {
      l.winners.forEach(w => {
        allWinners.push({
          ...w,
          lotteryId: l.id,
          campaignName: l.internalName
        });
      });
    }
  });

  if (query) {
    allWinners = allWinners.filter(w => 
      (w.username && w.username.toLowerCase().includes(query)) ||
      (w.firstName && w.firstName.toLowerCase().includes(query)) ||
      (w.chatId && String(w.chatId).includes(query)) ||
      (w.prizeName && w.prizeName.toLowerCase().includes(query))
    );
  }

  if (allWinners.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="padding: 30px; text-align: center; color: var(--text-muted);">
          No winners found.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = allWinners.map(w => {
    const isClaimed = w.claimStatus === 'CLAIMED';
    const statusPill = isClaimed
      ? '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 3px 8px; border-radius: 6px; font-weight: 600;">CLAIMED</span>'
      : '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); padding: 3px 8px; border-radius: 6px; font-weight: 600;">PENDING</span>';

    const userHandle = w.username ? `@${escapeHtml(w.username)}` : escapeHtml(w.firstName || 'User');

    return `
      <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
        <td style="padding: 12px 14px; color: #f8fafc; font-weight: 600;">${escapeHtml(w.campaignName)}</td>
        <td style="padding: 12px 14px; color: #38bdf8;">${userHandle}</td>
        <td style="padding: 12px 14px; font-family: var(--font-mono); color: var(--text-muted); font-size: 0.82rem;">${escapeHtml(String(w.chatId))}</td>
        <td style="padding: 12px 14px; color: #fbbf24; font-weight: 600;">🎁 ${escapeHtml(w.prizeName)}</td>
        <td style="padding: 12px 14px;">${statusPill}</td>
        <td style="padding: 12px 14px; text-align: right;">
          <button type="button" class="btn btn-secondary btn-xs" onclick="toggleDrawWinnerClaimStatus('${w.lotteryId}', '${w.chatId}', '${w.claimStatus}')" style="padding: 5px 10px; font-size: 0.78rem;">
            ${isClaimed ? 'Mark Pending' : 'Mark Claimed'}
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function toggleDrawWinnerClaimStatus(lotteryId, participantId, currentStatus) {
  const newStatus = currentStatus === 'CLAIMED' ? 'PENDING' : 'CLAIMED';
  try {
    await fetchDrawApi(`/lotteries/${lotteryId}/winners/claim-status`, {
      method: 'POST',
      body: JSON.stringify({ participantId, claimStatus: newStatus })
    });

    // Update locally
    const lottery = drawState.cachedLotteries.find(l => l.id === lotteryId);
    if (lottery && lottery.winners) {
      const winner = lottery.winners.find(w => String(w.chatId) === String(participantId) || String(w.id) === String(participantId));
      if (winner) winner.claimStatus = newStatus;
    }

    renderDrawWinnersTable();
  } catch (err) {
    alert(`Failed to update claim status: ${err.message}`);
  }
}

function exportDrawWinnersCsv() {
  const filterSelect = document.getElementById('draw-winners-filter-campaign');
  const campaignFilter = filterSelect ? filterSelect.value : 'ALL';

  let allWinners = [];
  drawState.cachedLotteries.forEach(l => {
    if (campaignFilter !== 'ALL' && l.id !== campaignFilter) return;
    if (l.winners && Array.isArray(l.winners)) {
      l.winners.forEach(w => {
        allWinners.push({
          campaign: l.internalName,
          username: w.username || '',
          firstName: w.firstName || '',
          chatId: w.chatId,
          prize: w.prizeName,
          claimStatus: w.claimStatus || 'PENDING'
        });
      });
    }
  });

  if (allWinners.length === 0) {
    alert('No winners to export.');
    return;
  }

  
  let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
  csvContent += 'EventID,DrawTimestamp,Event,Campaign,Username,FirstName,TelegramChatID,Prize,ClaimStatus\n';

  allWinners.forEach(w => {
    const row = [
      `"${w.lotteryId || ''}"`,
      `"${formatLocalDisplay(Date.now())}"`,
      `"${w.campaign.replace(/"/g, '""')}"`,
      `"${w.campaign.replace(/"/g, '""')}"`,
      `"${w.username.replace(/"/g, '""')}"`,
      `"${w.firstName.replace(/"/g, '""')}"`,
      `"${w.chatId}"`,
      `"${w.prize.replace(/"/g, '""')}"`,
      `"${w.claimStatus}"`
    ];
    csvContent += row.join(',') + '\n';
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `drawbot_winners_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Modal 3: Bot Settings Logic
async function openDrawSettingsModal() {
  const modal = document.getElementById('modal-draw-settings');
  if (!modal) return;

  modal.classList.remove('hidden');

  try {
    const messages = await fetchDrawApi('/bot-messages');
    if (messages) {
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && val !== undefined) el.value = val;
      };

      setVal('draw-msg-success-join', messages.msg_success_join);
      setVal('draw-msg-already-joined', messages.msg_already_joined);
      setVal('draw-msg-not-started', messages.msg_not_started);
      setVal('draw-msg-ended', messages.msg_ended);
      setVal('draw-msg-entries-closed', messages.msg_entries_closed);
      setVal('draw-msg-og-only', messages.msg_og_only);
      setVal('draw-msg-must-join', messages.msg_must_join_group_channel);
      setVal('draw-msg-rate-limit', messages.msg_rate_limit);
      setVal('draw-msg-join-failed', messages.msg_join_failed);
    }
  } catch (err) {
    console.error('Failed to load bot messages:', err);
  }
}

function closeDrawSettingsModal() {
  const modal = document.getElementById('modal-draw-settings');
  if (modal) modal.classList.add('hidden');
}

async function testDrawBotPing() {
  const token = document.getElementById('draw-settings-token')?.value.trim() || undefined;
  let chatId = document.getElementById('draw-settings-test-chat')?.value.trim();
  const topicId = document.getElementById('draw-settings-test-topic')?.value.trim() || undefined;

  if (!chatId) {
    alert('Please enter a Target Group/Channel ID (Target Chat ID).');
    return;
  }

  // Client-side auto cleanup for @ and t.me
  chatId = chatId.replace(/^https?:\/\/t\.me\//i, '').replace(/^t\.me\//i, '').trim();
  if (!chatId.startsWith('@') && !chatId.startsWith('-') && !/^-?\d+$/.test(chatId)) {
    chatId = '@' + chatId;
    const chatInput = document.getElementById('draw-settings-test-chat');
    if (chatInput) chatInput.value = chatId;
  }

  try {
    const res = await fetchDrawApi('/test-connection', {
      method: 'POST',
      body: JSON.stringify({ token, chatId, topicId })
    });
    if (res.ok) {
      alert('🔔 Test connection ping sent successfully! Please check Telegram group.');
    }
  } catch (err) {
    let msg = err.message;
    if (msg === 'Failed to fetch') {
      msg = '后台服务连接失败 (Failed to fetch)。请确认 Node.js 后台服务正在运行，且端口 3200 正常监听。';
    }
    alert(`Ping failed: ${msg}`);
  }
}

async function handleSaveDrawBotMessages(event) {
  event.preventDefault();

  const getVal = (id) => document.getElementById(id)?.value || '';

  const messages = {
    msg_success_join: getVal('draw-msg-success-join'),
    msg_already_joined: getVal('draw-msg-already-joined'),
    msg_not_started: getVal('draw-msg-not-started'),
    msg_ended: getVal('draw-msg-ended'),
    msg_entries_closed: getVal('draw-msg-entries-closed'),
    msg_og_only: getVal('draw-msg-og-only'),
    msg_must_join_group_channel: getVal('draw-msg-must-join'),
    msg_rate_limit: getVal('draw-msg-rate-limit'),
    msg_join_failed: getVal('draw-msg-join-failed')
  };

  try {
    const res = await fetchDrawApi('/bot-messages', {
      method: 'POST',
      body: JSON.stringify({ messages })
    });
    if (res.ok) {
      alert('💾 Message templates saved successfully!');
      closeDrawSettingsModal();
    }
  } catch (err) {
    alert(`Failed to save templates: ${err.message}`);
  }
}

// Periodic 60-minute background refresh for entrant counters
setInterval(() => {
  const drawMod = document.getElementById('module-draw');
  if (drawMod && !drawMod.classList.contains('hidden') && drawState.engineEnabled) {
    loadDrawModule();
  }
}, 3600000);

// Document Ready Listener
document.addEventListener('DOMContentLoaded', () => {
  checkAuthOnLoad();
});
