(() => {
  const POLL_MS = 1500;
  const IDLE_MS = 3000;
  const WINDOW_KEY = 'context-monitor:window-limit';
  const WINDOW_MIGRATE_KEY = 'context-monitor:window-limit-v2';
  const LANG_KEY = 'context-monitor:language';
  const $ = (id) => document.getElementById(id);

  const I18N = {
    en: {
      loadingCaption: 'Loading session context & usage…',
      liveTitle: 'Auto-refreshes every 1.5s',
      windowTitle: 'Antigravity context / auto-compaction limit (Auto defaults to 256K)',
      windowLabel: 'Window',
      stripSpeedTitle: 'User turns, total steps, and end-to-end Avg / Last output speed',
      stripTtftTitle: 'Average and latest Time To First Token (TTFT)',
      stripCacheTitle: 'Total tokens processed and Prompt Cache hit rate',
      stripCtxTitle: 'Current context window occupancy',
      hudAnchorTitle: 'Floating capsule anchor position',
      hudAnchorLabel: 'Position',
      optAnchorTopRight: 'Top Right',
      optAnchorBottomCenter: 'Bottom Center',
      optAnchorBottomRight: 'Bottom Right',
      hudStyleTitle: 'Floating capsule density',
      hudStyleLabel: 'Style',
      optStyleCompact: 'Compact',
      optStyleFull: 'Full Bar',
      optStyleMinimal: 'Minimal',
      hudModeTitle: 'Where to display the HUD monitor',
      hudModeLabel: 'Display',
      optModeBoth: 'Window + Menu',
      optModeWindow: 'Window Only',
      optModeMenubar: 'Menu Bar Only',
      hudReset: 'Reset',
      hudResetTitle: 'Restore and snap capsule back to default anchor',
      tabOverview: 'Overview',
      tabHistory: 'History',
      tabSteps: 'Steps',
      tabTools: 'Tools',
      tabRaw: 'Raw',
      ctxEyebrow: 'Current Context Window',
      legBase: 'Base',
      legBaseTitle: 'Prompt tokens of the 1st model call (system prompt, rules, skills, tools, initial message)',
      legGrowth: 'Growth',
      legGrowthTitle: 'Context accumulated over turns and tool outputs',
      legOut: 'Last Out',
      legOutTitle: 'Most recent model output tokens',
      compactAlert: 'Context occupancy is high. Consider running <code>/compact</code> at a task boundary to preserve cache efficiency.',
      sparkTitle: 'Context Growth Trajectory',
      statTotalLabel: 'Total Tokens (All Steps)',
      statCacheLabel: 'Prompt Cache Hit Rate',
      statSpeedLabel: 'Output Speed (Avg / Last)',
      statTtftLabel: 'First Token Latency (TTFT · Avg / Last)',
      statCostLabel: 'Est. API Cost',
      statIoLabel: 'Uncached Input / Output',
      statActivityLabel: 'Session Activity',
      turnsHeading: 'Consumption By Turn',
      srcAll: 'All (Desktop+CLI)',
      refreshBtn: 'Refresh',
      hist7dLabel: 'Last 7 Days',
      histMonthLabel: 'This Month',
      histAllLabel: 'All Time & Cache Savings',
      heatmapTitle: '12-Week Activity Heatmap',
      heatLess: 'Less',
      heatMore: 'More',
      recentDaysTitle: 'Recent Daily Usage & Est. Cost',
      topSessionsTitle: 'Top 12 Sessions by Tokens',
      toolsBanner: 'Estimated tool overhead: distributes the prompt token delta from each tool batch evenly across the tools invoked in that batch.',
      copyJson: 'Copy JSON',
      emptyTitle: 'Waiting for Transcript',
      emptyBody: 'Send your first message to inspect live context occupancy, cache hit rate, and step usage.',
      emptyHint: 'Watching active session',
      searchPlaceholder: 'Filter tool name or step…',
    },
    zh: {
      loadingCaption: '正在读取当前会话的 Context 与用量…',
      liveTitle: '每 1.5 秒自动刷新',
      windowTitle: '当前上下文 / Antigravity 自动压缩上限（自动模式默认 256K）',
      windowLabel: '窗口',
      stripSpeedTitle: '用户轮次、总步骤数与端到端平均 / 末步输出速率',
      stripTtftTitle: '会话平均与末步首字延迟 (Time To First Token)',
      stripCacheTitle: '会话累计总 Token 与 Prompt Cache 命中率',
      stripCtxTitle: '当前上下文窗口占用百分比',
      hudAnchorTitle: '控制悬浮胶囊在窗口中的挂载位置',
      hudAnchorLabel: '位置',
      optAnchorTopRight: '顶栏右上',
      optAnchorBottomCenter: '底部居中',
      optAnchorBottomRight: '窗口右下',
      hudStyleTitle: '控制悬浮胶囊的紧凑度',
      hudStyleLabel: '样式',
      optStyleCompact: '紧凑',
      optStyleFull: '完整',
      optStyleMinimal: '极简',
      hudModeTitle: '控制悬浮胶囊与 macOS 顶部菜单栏显示',
      hudModeLabel: '载体',
      optModeBoth: '窗口+顶栏',
      optModeWindow: '仅窗口',
      optModeMenubar: '仅顶栏',
      hudReset: '复位',
      hudResetTitle: '如找不到悬浮胶囊，点此立即显示并复位到默认位置',
      tabOverview: '概览',
      tabHistory: '全局看板',
      tabSteps: '步骤',
      tabTools: '工具',
      tabRaw: 'Raw',
      ctxEyebrow: '当前上下文窗口 (Context Window)',
      legBase: '初始基线',
      legBaseTitle: '第 1 次模型调用的输入 Token（含系统提示词、Rules、Skills、工具定义与首条输入）',
      legGrowth: '对话增量',
      legGrowthTitle: '随对话与工具调用增长的上下文',
      legOut: '末次输出',
      legOutTitle: '最近一次模型输出 Token',
      compactAlert: '上下文占用已较高，可在任务阶段切换处输入 <code>/compact</code> 主动压缩以维持缓存效率。',
      sparkTitle: 'Context 增长轨迹',
      statTotalLabel: '累计总消耗 (All Steps)',
      statCacheLabel: 'Prompt Cache 命中率',
      statSpeedLabel: '生成速率 (平均 / 末步)',
      statTtftLabel: '首字延迟 TTFT (平均 / 末步)',
      statCostLabel: 'API 参考折算',
      statIoLabel: '新增输入 / 模型输出',
      statActivityLabel: '会话活跃度',
      turnsHeading: '各轮对话消耗 (By Turn)',
      srcAll: '全部 (Desktop+CLI)',
      refreshBtn: '刷新',
      hist7dLabel: '近 7 天累计',
      histMonthLabel: '本月累计',
      histAllLabel: '历史总计与 Cache 节省',
      heatmapTitle: '近 12 周活跃热力图',
      heatLess: '少',
      heatMore: '多',
      recentDaysTitle: '近期每日消耗与 API 折算',
      topSessionsTitle: '高消耗会话 Top 12',
      toolsBanner: '工具增量估算：将每次工具批次执行后下一次模型调用增加的 Prompt Tokens 均分到该批次工具中，用于定位拉高上下文的高开销操作。',
      copyJson: '复制 JSON',
      emptyTitle: '等待会话记录',
      emptyBody: '发送第一条消息后，这里将实时显示当前会话的 Context 占用、Cache 命中率与步骤用量。',
      emptyHint: '监听活跃会话中',
      searchPlaceholder: '过滤工具名或步骤…',
    },
  };

  if (!localStorage.getItem(WINDOW_MIGRATE_KEY)) {
    const legacyStored = localStorage.getItem(WINDOW_KEY);
    if (legacyStored == null || Number(legacyStored) === 1000000) {
      localStorage.setItem(WINDOW_KEY, '0');
    }
    localStorage.setItem(WINDOW_MIGRATE_KEY, '1');
  }
  const parsedWindowPref = Number(localStorage.getItem(WINDOW_KEY));
  const initialWindowPref = Number.isFinite(parsedWindowPref) && parsedWindowPref >= 0
    ? Math.round(parsedWindowPref)
    : 0;

  const savedLang = localStorage.getItem(LANG_KEY);
  const state = {
    conv: null,
    etag: '',
    data: null,
    history: null,
    historySource: 'all',
    lastHistoryAt: 0,
    lastPrefsAt: 0,
    tab: 'overview',
    newestFirst: true,
    windowLimitPref: initialWindowPref,
    effectiveWindowLimit: initialWindowPref > 0 ? initialWindowPref : 256000,
    lang: savedLang === 'zh' ? 'zh' : 'en',
    lastOk: 0,
  };

  function fmtLimitLabel(limit) {
    const n = Number(limit) || 0;
    if (n === 80000) return '80K';
    if (n === 128000) return '128K';
    if (n === 160000) return '160K';
    if (n === 200000) return '200K';
    if (n === 256000) return '256K';
    if (n === 512000) return '512K';
    if (n === 840000) return '840K';
    if (n === 1000000) return '1M';
    if (n === 2000000) return '2M';
    return fmtTokens(n);
  }

  function activeWindowLimit() {
    return state.windowLimitPref > 0 ? state.windowLimitPref : (state.effectiveWindowLimit || 256000);
  }

  function updateWindowPickerUI() {
    const sel = $('window-limit');
    if (!sel) return;
    const autoOpt = sel.querySelector('option[value="0"]');
    if (autoOpt) {
      const resolved = state.windowLimitPref === 0
        ? activeWindowLimit()
        : (state.data?.windowLimitInfo?.limit || state.effectiveWindowLimit || 256000);
      autoOpt.textContent = tr(`Auto (${fmtLimitLabel(resolved)})`, `自动 (${fmtLimitLabel(resolved)})`);
    }
    const targetVal = String(state.windowLimitPref);
    if ([...sel.options].some((o) => o.value === targetVal)) {
      sel.value = targetVal;
    }
  }

  const isZh = () => state.lang === 'zh';
  const tr = (en, zh) => (isZh() ? zh : en);

  const params = new URLSearchParams(location.search);
  const currentConv = () => window.sidecar?.conversationId || params.get('conversationId') || '';

  async function getJson(path) {
    const f = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
    const res = await f(path, { method: 'GET' });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }

  async function postJson(path, body) {
    const f = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
    const res = await f(path, { method: 'POST', body: JSON.stringify(body || {}) });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }

  function syncScheme() {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background, #f7f7f8)';
    document.documentElement.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    const nums = (c.match(/[\d.]+/g) || []).map(Number);
    if (nums.length < 3) return;
    const scale = c.startsWith('color(') ? 1 : 255;
    const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const theme = lum < 0.5 ? 'dark' : 'light';
    if (document.documentElement.dataset.theme !== theme) {
      document.documentElement.dataset.theme = theme;
    }
  }
  syncScheme();
  new MutationObserver(syncScheme).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  function fmtTokens(n) {
    const v = Number(n) || 0;
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
    if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(2)}K`;
    return `${sign}${abs.toLocaleString()}`;
  }

  function fmtSignedTokens(n) {
    const v = Number(n) || 0;
    return v > 0 ? `+${fmtTokens(v)}` : fmtTokens(v);
  }

  function fmtPct(ratio) {
    return `${(Math.max(0, ratio) * 100).toFixed(1)}%`;
  }

  function fmtUsd(usd) {
    const v = Number(usd) || 0;
    return `$${v >= 100 ? v.toFixed(1) : v.toFixed(2)}`;
  }

  function fmtCny(cny) {
    const v = Number(cny) || 0;
    return `¥${v >= 100 ? v.toFixed(1) : v.toFixed(2)}`;
  }

  function fmtDurationMs(ms) {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function formatTtftPair(avgMs, lastMs) {
    if (avgMs != null && lastMs != null) {
      const a = fmtDurationMs(avgMs);
      const l = fmtDurationMs(lastMs);
      return {
        main: a === l ? a : `${a} / ${l}`,
        sub: tr(`Avg ${a} · Last ${l}`, `平均 ${a} · 末步 ${l}`),
      };
    }
    const only = avgMs ?? lastMs;
    if (only != null) {
      return {
        main: fmtDurationMs(only),
        sub: avgMs != null ? tr('Session avg', '会话平均') : tr('Last step', '末步首字'),
      };
    }
    return {
      main: '—',
      sub: tr('Waiting for first-token timing', '等待首字计时'),
    };
  }

  function fmtClock(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function applyLang() {
    const dict = I18N[state.lang] || I18N.en;
    document.documentElement.lang = isZh() ? 'zh-CN' : 'en';

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const k = el.dataset.i18n;
      if (k && dict[k] != null) el.textContent = dict[k];
    });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const k = el.dataset.i18nHtml;
      if (k && dict[k] != null) el.innerHTML = dict[k];
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const k = el.dataset.i18nTitle;
      if (k && dict[k] != null) el.title = dict[k];
    });

    $('step-search').placeholder = dict.searchPlaceholder;
    $('step-order').textContent = state.newestFirst ? tr('Newest First', '最新在前') : tr('Oldest First', '最早在前');
    $('lang-toggle').textContent = isZh() ? 'EN' : '中文';
    $('hm-weekdays').innerHTML = isZh()
      ? '<span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span>日</span>'
      : '<span>M</span><span></span><span>W</span><span></span><span>F</span><span></span><span>S</span>';

    setLive(Date.now() - state.lastOk <= POLL_MS * 4);
    updateWindowPickerUI();
    if (state.data) renderAll(state.data);
    if (state.history) renderHistory(state.history);
  }

  function showView(kind) {
    $('loading').classList.toggle('hidden', kind !== 'loading');
    $('app').classList.toggle('hidden', kind !== 'app');
    $('empty').classList.toggle('hidden', kind !== 'empty');
  }

  function setLive(ok) {
    $('live').classList.toggle('stale', !ok);
    $('live-label').textContent = ok ? tr('Live', 'Live') : tr('Reconnecting', '重连中');
  }

  function selectTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach((btn) => {
      const on = btn.dataset.tab === tab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('.tab-body').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tab-${tab}`);
    });
  }

  function renderSparkline(timeline, limit) {
    const svg = $('sparkline');
    if (!timeline.length) {
      svg.innerHTML = '';
      $('spark-meta').textContent = '';
      return;
    }
    const vals = timeline.map((s) => s.promptTokens);
    const maxVal = Math.max(...vals, 1);
    const minVal = Math.min(...vals);
    const W = 320;
    const H = 64;
    const padY = 6;
    const innerH = H - padY * 2;
    const coords = vals.map((v, i) => {
      const x = vals.length === 1 ? W : (i / (vals.length - 1)) * W;
      const y = padY + innerH - (v / maxVal) * innerH;
      return [x, y, timeline[i]];
    });
    const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${W},${H} L0,${H} Z`;
    const last = coords[coords.length - 1];
    const compactDots = coords
      .filter(([, , item]) => item.compacted)
      .map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="var(--cm-success)"></circle>`)
      .join('');

    svg.innerHTML = `
      <defs>
        <linearGradient id="cm-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--cm-primary)" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="var(--cm-primary)" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#cm-grad)"></path>
      <path d="${linePath}" fill="none" stroke="var(--cm-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      ${compactDots}
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5" fill="var(--cm-primary)"></circle>
    `;
    $('spark-meta').textContent = tr(
      `${timeline.length} calls · Peak ${fmtTokens(maxVal)} (${((maxVal / limit) * 100).toFixed(1)}%) · Start ${fmtTokens(minVal)}`,
      `${timeline.length} 次调用 · 峰值 ${fmtTokens(maxVal)} (${((maxVal / limit) * 100).toFixed(1)}%) · 起点 ${fmtTokens(minVal)}`,
    );
  }

  function formatSpeedStripText(avg, last) {
    if (avg != null && last != null) {
      if (avg === last) return ` · ${avg} tok/s`;
      return tr(` · Avg ${avg} / Last ${last} tok/s`, ` · 均 ${avg} / 末 ${last} tok/s`);
    }
    const single = avg ?? last;
    return single != null ? ` · ${single} tok/s` : '';
  }

  function renderCompactStrip(m) {
    const limit = activeWindowLimit();
    const used = m.current.estimatedNextContextTokens;
    const ratio = limit > 0 ? used / limit : 0;
    const totals = m.totals;

    const speedPart = formatSpeedStripText(totals.avgTokPerSec, totals.lastTokPerSec);
    $('ds-turns-speed').textContent = `${totals.userTurns} turns ${totals.stepsCount} steps${speedPart}`;
    const ttftWrap = $('ds-ttft-wrap');
    if (totals.avgTtftMs != null || totals.lastTtftMs != null) {
      const pair = formatTtftPair(totals.avgTtftMs, totals.lastTtftMs);
      $('ds-ttft').textContent = `${tr('TTFT', '首字')} ${pair.main}`;
      ttftWrap.classList.remove('hidden');
    } else {
      ttftWrap.classList.add('hidden');
    }
    $('ds-tokens-cache').textContent = `${fmtTokens(totals.allTokens)} tok · Cache hit ${fmtPct(totals.overallCacheHitRate)}`;
    $('ds-ctx-pct').textContent = `${Math.round(Math.min(999, Math.max(0, ratio * 100)))}%`;

    const circ = 32.67;
    const clamped = Math.min(1, Math.max(0, ratio));
    const fg = $('ds-ring-fg');
    fg.style.strokeDashoffset = (circ * (1 - clamped)).toFixed(2);
    fg.classList.toggle('warn', ratio >= 0.7 && ratio < 0.85);
    fg.classList.toggle('danger', ratio >= 0.85);
  }

  function renderOverview(payload) {
    const m = payload.metrics;
    const limit = activeWindowLimit();
    const cur = m.current;
    const totals = m.totals;
    const used = cur.estimatedNextContextTokens;
    const ratio = limit > 0 ? used / limit : 0;

    $('ctx-used').textContent = fmtTokens(used);
    $('ctx-limit').textContent = fmtTokens(limit);
    const pctEl = $('ctx-pct');
    pctEl.textContent = fmtPct(ratio);
    pctEl.className = 'pct-badge' + (ratio >= 0.85 ? ' danger' : ratio >= 0.7 ? ' warn' : '');

    const free = Math.max(0, limit - used);
    $('ctx-free').textContent = tr(`~${fmtTokens(free)} free`, `剩余约 ${fmtTokens(free)}`);
    $('ctx-next').textContent = tr(`Latest prompt ${fmtTokens(cur.promptTokens)}`, `最新输入 ${fmtTokens(cur.promptTokens)}`);

    const meter = $('ctx-meter');
    meter.setAttribute('aria-valuenow', String(Math.min(100, Math.round(ratio * 100))));

    const basePct = Math.min(100, (cur.initialBaselineTokens / limit) * 100);
    const growthPct = Math.min(Math.max(0, 100 - basePct), (cur.growthTokens / limit) * 100);
    const outPct = Math.min(Math.max(0, 100 - basePct - growthPct), (cur.lastOutputTokens / limit) * 100);

    $('seg-base').style.width = `${basePct.toFixed(2)}%`;
    $('seg-growth').style.width = `${growthPct.toFixed(2)}%`;
    $('seg-out').style.width = `${outPct.toFixed(2)}%`;

    $('leg-base').textContent = fmtTokens(cur.initialBaselineTokens);
    $('leg-growth').textContent = fmtTokens(cur.growthTokens);
    $('leg-out').textContent = fmtTokens(cur.lastOutputTokens);

    $('compact-alert').classList.toggle('hidden', ratio < 0.72);

    renderSparkline(m.timeline, limit);

    $('stat-total').textContent = fmtTokens(totals.allTokens);
    const costNote = payload.cost ? tr(` · Est. ${fmtUsd(payload.cost.totalCostUsd)}`, ` · 参考 ${fmtUsd(payload.cost.totalCostUsd)}`) : '';
    $('stat-total-sub').textContent = tr(
      `Input ${fmtTokens(totals.promptTokens)} · Out ${fmtTokens(totals.outputTokens)}${costNote}`,
      `总输入 ${fmtTokens(totals.promptTokens)} · 输出 ${fmtTokens(totals.outputTokens)}${costNote}`,
    );

    $('stat-cache').textContent = fmtPct(totals.overallCacheHitRate);
    const savedNote = payload.cost ? tr(` · Saved ${fmtUsd(payload.cost.savedByCacheUsd)}`, ` · 省 ${fmtUsd(payload.cost.savedByCacheUsd)}`) : '';
    $('stat-cache-sub').textContent = tr(
      `Hit ${fmtTokens(totals.cacheReadTokens)} · Last ${fmtPct(cur.cacheHitRate)}${savedNote}`,
      `命中 ${fmtTokens(totals.cacheReadTokens)} · 末步 ${fmtPct(cur.cacheHitRate)}${savedNote}`,
    );

    const avgTps = totals.avgTokPerSec;
    const lastTps = totals.lastTokPerSec;
    if (avgTps != null && lastTps != null) {
      $('stat-speed').textContent = avgTps === lastTps ? `${avgTps} tok/s` : `${avgTps} / ${lastTps} tok/s`;
      $('stat-speed-sub').textContent = tr(
        `Avg ${avgTps} · Last ${lastTps} (end-to-end)`,
        `平均 ${avgTps} · 末步 ${lastTps} (含思考)`,
      );
    } else if (avgTps != null || lastTps != null) {
      const onlyTps = avgTps ?? lastTps;
      $('stat-speed').textContent = `${onlyTps} tok/s`;
      $('stat-speed-sub').textContent = avgTps != null
        ? tr('Session avg (end-to-end)', '会话平均 (含思考)')
        : tr('Last step (end-to-end)', '末步速率 (含思考)');
    } else {
      $('stat-speed').textContent = '—';
      $('stat-speed-sub').textContent = tr('Waiting for step timing', '等待步骤计时数据');
    }

    if (payload.cost) {
      $('stat-cost').textContent = fmtUsd(payload.cost.totalCostUsd);
      $('stat-cost-sub').textContent = tr(
        `≈ ${fmtCny(payload.cost.totalCostCny)} · Saved ${fmtUsd(payload.cost.savedByCacheUsd)}`,
        `≈ ${fmtCny(payload.cost.totalCostCny)} · 省 ${fmtUsd(payload.cost.savedByCacheUsd)}`,
      );
    } else {
      $('stat-cost').textContent = '$0.00';
      $('stat-cost-sub').textContent = tr('Reference API benchmark', '按 API 参考单价估算');
    }

    $('stat-io').textContent = `${fmtTokens(totals.inputTokens)} / ${fmtTokens(totals.outputTokens)}`;
    const avgOut = totals.modelCalls ? fmtTokens(Math.round(totals.outputTokens / totals.modelCalls)) : '0';
    $('stat-io-sub').textContent = tr(`Avg output/call ${avgOut}`, `平均每步输出 ${avgOut}`);

    $('stat-activity').textContent = tr(
      `${totals.userTurns} turns · ${totals.modelCalls} calls`,
      `${totals.userTurns} 轮 · ${totals.modelCalls} 次调用`,
    );
    const errText = totals.errorSteps ? tr(` · ${totals.errorSteps} errors`, ` · ${totals.errorSteps} 错误`) : '';
    const cpText = totals.checkpoints ? tr(` · ${totals.checkpoints} checkpoints`, ` · ${totals.checkpoints} 检查点`) : '';
    $('stat-activity-sub').textContent = tr(
      `${totals.toolCalls} tool calls${cpText}${errText}`,
      `${totals.toolCalls} 次工具调用${cpText}${errText}`,
    );

    const ttftPair = formatTtftPair(totals.avgTtftMs, totals.lastTtftMs);
    $('stat-ttft').textContent = ttftPair.main;
    $('stat-ttft-sub').textContent = ttftPair.sub;
    $('stat-ttft-count').textContent = totals.ttftSampleCount
      ? tr(`${totals.ttftSampleCount} timed steps`, `${totals.ttftSampleCount} 次计时`)
      : '';

    $('turns-count').textContent = tr(`${m.turns.length} turns`, `${m.turns.length} 轮`);
    const turnsHtml = [...m.turns].reverse().map((t) => `
      <div class="turn-row">
        <div class="turn-top">
          <span class="turn-title">#${t.index} ${esc(t.preview || tr('(Session turn)', '(会话轮次)'))}</span>
          <span class="turn-delta ${t.contextDelta < -1024 ? 'compacted' : ''}">${fmtSignedTokens(t.contextDelta)}</span>
        </div>
        <div class="turn-meta">
          ${tr(
            `${t.modelCalls} calls · ${t.toolCalls} tools · New ${fmtTokens(t.inputTokens)} · Cache ${fmtTokens(t.cacheReadTokens)} · Out ${fmtTokens(t.outputTokens)}`,
            `${t.modelCalls} 次模型 · ${t.toolCalls} 次工具 · 新增 ${fmtTokens(t.inputTokens)} · 缓存 ${fmtTokens(t.cacheReadTokens)} · 输出 ${fmtTokens(t.outputTokens)}`,
          )}
        </div>
      </div>
    `).join('');
    $('turns-list').innerHTML = turnsHtml || `<div class="muted-sm">${tr('No turns recorded yet', '暂无轮次记录')}</div>`;
  }

  function renderTimeline(m) {
    const query = ($('step-search').value || '').trim().toLowerCase();
    const list = state.newestFirst ? [...m.timeline].reverse() : m.timeline;
    const filtered = query
      ? list.filter((s) =>
          `#${s.stepIndex}`.includes(query) ||
          s.tools.some((t) => t.toLowerCase().includes(query)) ||
          s.toolNames.some((t) => t.toLowerCase().includes(query)))
      : list;

    $('timeline-list').innerHTML = filtered.map((s) => {
      const deltaClass = s.compacted ? 'down' : s.deltaFromPrev > 0 ? 'up' : '';
      const deltaLabel = s.compacted
        ? tr(`Compacted ${fmtSignedTokens(s.deltaFromPrev)}`, `压缩 ${fmtSignedTokens(s.deltaFromPrev)}`)
        : fmtSignedTokens(s.deltaFromPrev);
      const chips = s.tools.length
        ? `<div class="chips">${s.tools.map((t) => `<span class="chip" title="${esc(t)}">${esc(t)}</span>`).join('')}</div>`
        : `<div class="chips"><span class="chip">${tr('No tool calls (direct reply)', '无工具调用（直接回复）')}</span></div>`;
      return `
        <div class="step-card">
          <div class="step-top">
            <span class="step-id">Step #${s.stepIndex} <span class="step-time">${esc(fmtClock(s.createdAt))}</span></span>
            <span class="step-right">
              <span class="step-ctx">${fmtTokens(s.promptTokens)}</span>
              <span class="delta-pill ${deltaClass}">${deltaLabel}</span>
            </span>
          </div>
          <div class="step-sub">
            ${tr(
              `Input ${fmtTokens(s.inputTokens)} · Cache ${fmtTokens(s.cacheReadTokens)} (${fmtPct(s.cacheHitRate)}) · Out ${fmtTokens(s.outputTokens)}`,
              `新输入 ${fmtTokens(s.inputTokens)} · 缓存 ${fmtTokens(s.cacheReadTokens)} (${fmtPct(s.cacheHitRate)}) · 输出 ${fmtTokens(s.outputTokens)}`,
            )}${s.tokPerSec != null ? ` · ${s.tokPerSec} tok/s` : ''}${s.ttftMs != null ? ` · ${tr('TTFT', '首字')} ${fmtDurationMs(s.ttftMs)}` : ''}
          </div>
          ${chips}
        </div>
      `;
    }).join('') || `<div class="muted-sm">${tr('No matching steps', '没有匹配的步骤')}</div>`;
  }

  function renderTools(m) {
    const maxCalls = Math.max(1, ...m.tools.map((t) => t.calls));
    $('tools-list').innerHTML = m.tools.map((t) => `
      <div class="tool-row">
        <div class="tool-top">
          <span class="tool-name">${esc(t.name)}</span>
          <span class="tool-counts">
            ${tr(
              `${t.calls} calls${t.errors ? ` · ${t.errors} failed` : ''} · ~+${fmtTokens(t.estimatedContextAdded)}`,
              `${t.calls} 次${t.errors ? ` · ${t.errors} 失败` : ''} · 约 +${fmtTokens(t.estimatedContextAdded)}`,
            )}
          </span>
        </div>
        <div class="tool-bar-track">
          <div class="tool-bar-fill" style="width: ${((t.calls / maxCalls) * 100).toFixed(1)}%"></div>
        </div>
      </div>
    `).join('') || `<div class="muted-sm">${tr('No tool calls recorded yet', '当前会话尚未调用工具')}</div>`;
  }

  function renderRaw(payload) {
    $('raw-meta').textContent = tr(
      `Session ${payload.conversationId || '-'} · Updated ${fmtClock(payload.metrics?.updatedAt) || '-'}`,
      `会话 ${payload.conversationId || '-'} · 更新于 ${fmtClock(payload.metrics?.updatedAt) || '-'}`,
    );
    $('raw-pre').textContent = JSON.stringify(payload, null, 2);
  }

  function heatmapGridCol(daysAgo, lastWeekday, totalCols = 13) {
    const lastRow = (lastWeekday + 6) % 7;
    const weeksAgo = daysAgo <= lastRow ? 0 : 1 + Math.floor((daysAgo - lastRow - 1) / 7);
    const col = (totalCols - 1) - weeksAgo;
    return col >= 0 && col < totalCols ? col : -1;
  }

  function renderHistory(h) {
    if (!h) return;
    state.history = h;

    $('hist-today-label').textContent = tr(`Today (${h.todayKey || '-'})`, `今日消耗 (${h.todayKey || '-'})`);
    $('hist-today-val').textContent = fmtTokens(h.today?.allTokens);
    $('hist-today-sub').textContent = tr(
      `Est. ${fmtUsd(h.today?.cost?.totalCostUsd)} · ${h.today?.sessions || 0} sess · ${h.today?.steps || 0} steps`,
      `参考 ${fmtUsd(h.today?.cost?.totalCostUsd)} · ${h.today?.sessions || 0} 会话 · ${h.today?.steps || 0} 步`,
    );

    $('hist-7d-val').textContent = fmtTokens(h.last7Days?.allTokens);
    $('hist-7d-sub').textContent = tr(
      `Est. ${fmtUsd(h.last7Days?.cost?.totalCostUsd)} · Cache ${fmtPct(h.last7Days?.cacheHitRate || 0)}`,
      `参考 ${fmtUsd(h.last7Days?.cost?.totalCostUsd)} · Cache ${fmtPct(h.last7Days?.cacheHitRate || 0)}`,
    );

    $('hist-month-val').textContent = fmtTokens(h.thisMonth?.allTokens);
    $('hist-month-sub').textContent = tr(
      `Est. ${fmtUsd(h.thisMonth?.cost?.totalCostUsd)} · ${h.thisMonth?.steps || 0} steps`,
      `参考 ${fmtUsd(h.thisMonth?.cost?.totalCostUsd)} · ${h.thisMonth?.steps || 0} 步`,
    );

    $('hist-all-val').textContent = fmtTokens(h.allTime?.allTokens);
    $('hist-all-sub').textContent = tr(
      `${fmtUsd(h.allTime?.cost?.totalCostUsd)} (${fmtCny(h.allTime?.cost?.totalCostCny)}) · Saved ${fmtUsd(h.allTime?.cost?.savedByCacheUsd)}`,
      `${fmtUsd(h.allTime?.cost?.totalCostUsd)} (${fmtCny(h.allTime?.cost?.totalCostCny)}) · Cache 省 ${fmtUsd(h.allTime?.cost?.savedByCacheUsd)}`,
    );

    const cells = Array.isArray(h.heatmap) ? h.heatmap : [];
    const grid = $('hist-heatmap');
    if (cells.length) {
      const last = cells[cells.length - 1];
      const total = cells.length;
      grid.innerHTML = cells.map((c, idx) => {
        const col = heatmapGridCol((total - 1) - idx, last.weekday, 13);
        if (col < 0) return '';
        const row = (c.weekday + 6) % 7;
        const isToday = c.date === h.todayKey;
        const tip = tr(
          `${c.date}: ${fmtTokens(c.allTokens)} tok (${fmtUsd(c.costUsd)}) · ${c.steps} steps`,
          `${c.date}: ${fmtTokens(c.allTokens)} tok (${fmtUsd(c.costUsd)}) · ${c.steps} 步`,
        );
        return `<span class="hm-cell${isToday ? ' today' : ''}" data-level="${c.level || 0}" title="${esc(tip)}" style="grid-column:${col + 1};grid-row:${row + 1}"></span>`;
      }).join('');
    } else {
      grid.innerHTML = '';
    }

    const dSrc = h.bySource?.desktop || { sessions: 0, allTokens: 0, cost: { totalCostUsd: 0 } };
    const cSrc = h.bySource?.cli || { sessions: 0, allTokens: 0, cost: { totalCostUsd: 0 } };
    $('hist-source-meta').textContent = tr(
      `Desktop ${dSrc.sessions} sess (${fmtTokens(dSrc.allTokens)} / ${fmtUsd(dSrc.cost?.totalCostUsd)}) · CLI ${cSrc.sessions} sess (${fmtTokens(cSrc.allTokens)} / ${fmtUsd(cSrc.cost?.totalCostUsd)})`,
      `Desktop ${dSrc.sessions} 会话 (${fmtTokens(dSrc.allTokens)} / ${fmtUsd(dSrc.cost?.totalCostUsd)}) · CLI ${cSrc.sessions} 会话 (${fmtTokens(cSrc.allTokens)} / ${fmtUsd(cSrc.cost?.totalCostUsd)})`,
    );

    const days = Array.isArray(h.recentDays) ? h.recentDays : [];
    $('hist-days-list').innerHTML = days.map((d) => `
      <div class="hist-row">
        <div class="hist-top">
          <span class="hist-title">${esc(d.date)} <span class="muted-2xs">${tr(`${d.sessions} sess · ${d.steps} steps`, `${d.sessions} 会话 · ${d.steps} 步`)}</span></span>
          <span class="hist-val">${fmtTokens(d.allTokens)} · ${fmtUsd(d.cost?.totalCostUsd)}</span>
        </div>
        <div class="hist-sub">
          ${tr(
            `Input ${fmtTokens(d.inputTokens)} · Cache ${fmtTokens(d.cacheReadTokens)} (${fmtPct(d.cacheHitRate)}) · Out ${fmtTokens(d.outputTokens)} · Saved ${fmtUsd(d.cost?.savedByCacheUsd)}`,
            `新输入 ${fmtTokens(d.inputTokens)} · Cache ${fmtTokens(d.cacheReadTokens)} (${fmtPct(d.cacheHitRate)}) · 输出 ${fmtTokens(d.outputTokens)} · Cache 省 ${fmtUsd(d.cost?.savedByCacheUsd)}`,
          )}
        </div>
      </div>
    `).join('') || `<div class="muted-sm">${tr('No daily usage data yet', '暂无每日统计记录')}</div>`;

    const top = Array.isArray(h.topSessions) ? h.topSessions : [];
    $('hist-sessions-count').textContent = `Top ${top.length}`;
    $('hist-sessions-list').innerHTML = top.map((s) => {
      const shortId = s.conversationId ? s.conversationId.slice(0, 8) : '-';
      const label = s.title || `Session ${shortId}`;
      const badgeCls = s.source === 'cli' ? 'src-badge cli' : 'src-badge';
      return `
        <div class="hist-row">
          <div class="hist-top">
            <span class="hist-title"><span class="${badgeCls}">${esc(s.source || 'desktop')}</span>${esc(label)}</span>
            <span class="hist-val">${fmtTokens(s.allTokens)} · ${fmtUsd(s.cost?.totalCostUsd)}</span>
          </div>
          <div class="hist-sub">
            ${tr(
              `${s.userTurns} turns · ${s.stepsCount} steps · Cache ${fmtPct(s.cacheHitRate)} · Out ${fmtTokens(s.outputTokens)}`,
              `${s.userTurns} 轮 · ${s.stepsCount} 步 · Cache ${fmtPct(s.cacheHitRate)} · 输出 ${fmtTokens(s.outputTokens)}`,
            )}
          </div>
        </div>
      `;
    }).join('') || `<div class="muted-sm">${tr('No session records yet', '暂无会话记录')}</div>`;
  }

  async function pollHistory(force = false) {
    try {
      const q = new URLSearchParams({ source: state.historySource });
      if (force) q.set('force', '1');
      const h = await getJson(`/api/history?${q}`);
      state.lastHistoryAt = Date.now();
      renderHistory(h);
    } catch {
      // Ignore transient backend restart.
    }
  }

  function renderAll(payload) {
    state.data = payload;
    if (payload?.windowLimitInfo?.limit > 0) {
      state.effectiveWindowLimit = Number(payload.windowLimitInfo.limit);
    }
    updateWindowPickerUI();
    const m = payload.metrics;
    const shortId = payload.conversationId ? `${payload.conversationId.slice(0, 8)}…` : '';
    $('conv-label').textContent = payload.title ? `${payload.title}` : `Session ${shortId}`;
    $('conv-label').title = payload.conversationId || '';

    const pill = $('status-pill');
    pill.classList.remove('hidden', 'working');
    if (m.isRunning) {
      pill.textContent = tr('Running', '运行中');
      pill.classList.add('working');
    } else {
      pill.textContent = tr('Idle', '空闲');
    }

    $('count-timeline').textContent = String(m.timeline.length);
    $('count-tools').textContent = String(m.tools.length);

    renderCompactStrip(m);
    renderOverview(payload);
    renderTimeline(m);
    renderTools(m);
    renderRaw(payload);
  }

  async function poll() {
    let delay = POLL_MS;
    try {
      const conv = currentConv();
      if (conv !== state.conv) {
        state.conv = conv;
        state.etag = '';
        state.data = null;
      }
      const q = new URLSearchParams();
      if (state.etag) q.set('etag', state.etag);
      if (conv) q.set('conversationId', conv);

      const res = await getJson(`/api/usage?${q}`);
      state.lastOk = Date.now();

      if (!res.found || !res.hasTranscript || (!res.unchanged && !res.metrics?.hasData)) {
        showView('empty');
        delay = IDLE_MS;
        return;
      }

      if (!res.unchanged && res.metrics) {
        state.etag = res.etag;
        renderAll(res);
        if (state.tab === 'history' || Date.now() - state.lastHistoryAt > 15_000) {
          pollHistory(false);
        }
      } else if (state.tab === 'history' && Date.now() - state.lastHistoryAt > 12_000) {
        pollHistory(false);
      }
      if (Date.now() - state.lastPrefsAt > 4000) {
        syncHudPrefs();
      }
      showView('app');
    } catch (err) {
      console.warn('[context_monitor]', err);
      delay = IDLE_MS;
    } finally {
      setLive(Date.now() - state.lastOk <= POLL_MS * 4);
      setTimeout(poll, delay);
    }
  }

  // Controls
  const limitSelect = $('window-limit');
  const hudAnchorSelect = $('hud-anchor');
  const hudStyleSelect = $('hud-style');
  const hudModeSelect = $('hud-mode');
  const hudResetBtn = $('hud-reset');
  const langToggleBtn = $('lang-toggle');

  updateWindowPickerUI();

  async function syncHudPrefs() {
    try {
      state.lastPrefsAt = Date.now();
      const prefs = await getJson('/api/hud/prefs');
      const hudControls = $('hud-controls');
      if (hudControls) {
        hudControls.classList.toggle('hidden', prefs?.hudSupported === false);
      }
      if (prefs?.language && (prefs.language === 'en' || prefs.language === 'zh') && prefs.language !== state.lang) {
        state.lang = prefs.language;
        localStorage.setItem(LANG_KEY, state.lang);
        applyLang();
      }
      if (prefs?.anchorPosition && [...hudAnchorSelect.options].some((o) => o.value === prefs.anchorPosition)) {
        hudAnchorSelect.value = prefs.anchorPosition;
      }
      if (prefs?.capsuleStyle && [...hudStyleSelect.options].some((o) => o.value === prefs.capsuleStyle)) {
        hudStyleSelect.value = prefs.capsuleStyle;
      }
      if (prefs?.displayMode && [...hudModeSelect.options].some((o) => o.value === prefs.displayMode)) {
        hudModeSelect.value = prefs.displayMode;
      }
      if (prefs && 'windowLimit' in prefs) {
        const rawLim = Number(prefs.windowLimit);
        const nextPref = Number.isFinite(rawLim) && rawLim >= 0 ? Math.round(rawLim) : 0;
        if (nextPref !== state.windowLimitPref && [...limitSelect.options].some((o) => Number(o.value) === nextPref)) {
          state.windowLimitPref = nextPref;
          localStorage.setItem(WINDOW_KEY, String(state.windowLimitPref));
          localStorage.setItem(WINDOW_MIGRATE_KEY, '1');
          updateWindowPickerUI();
          if (state.data?.metrics) {
            renderCompactStrip(state.data.metrics);
            renderOverview(state.data);
          }
        }
      }
    } catch {
      // Ignore if backend is restarting.
    }
  }

  langToggleBtn.addEventListener('click', () => {
    state.lang = isZh() ? 'en' : 'zh';
    localStorage.setItem(LANG_KEY, state.lang);
    applyLang();
    postJson('/api/hud/prefs', { language: state.lang }).catch(() => {});
  });

  limitSelect.addEventListener('change', () => {
    const rawLim = Number(limitSelect.value);
    state.windowLimitPref = Number.isFinite(rawLim) && rawLim >= 0 ? Math.round(rawLim) : 0;
    localStorage.setItem(WINDOW_KEY, String(state.windowLimitPref));
    localStorage.setItem(WINDOW_MIGRATE_KEY, '1');
    updateWindowPickerUI();
    if (state.data?.metrics) {
      renderCompactStrip(state.data.metrics);
      renderOverview(state.data);
    }
    postJson('/api/hud/prefs', { windowLimit: state.windowLimitPref }).catch(() => {});
  });

  hudAnchorSelect.addEventListener('change', async () => {
    const nextMode = hudModeSelect.value === 'menubar' ? 'both' : hudModeSelect.value;
    try {
      const res = await postJson('/api/hud/prefs', {
        anchorPosition: hudAnchorSelect.value,
        displayMode: nextMode,
        resetPosition: true,
      });
      if (res?.prefs?.displayMode) hudModeSelect.value = res.prefs.displayMode;
    } catch {
      // Ignore transient error.
    }
  });

  hudStyleSelect.addEventListener('change', () => {
    postJson('/api/hud/prefs', { capsuleStyle: hudStyleSelect.value }).catch(() => {});
  });

  hudModeSelect.addEventListener('change', () => {
    postJson('/api/hud/prefs', { displayMode: hudModeSelect.value }).catch(() => {});
  });

  hudResetBtn.addEventListener('click', async () => {
    try {
      const nextMode = hudModeSelect.value === 'menubar' ? 'both' : hudModeSelect.value;
      const res = await postJson('/api/hud/prefs', { displayMode: nextMode, resetPosition: true });
      if (res?.prefs?.displayMode) hudModeSelect.value = res.prefs.displayMode;
      hudResetBtn.textContent = tr('Done', '已复位');
    } catch {
      hudResetBtn.textContent = tr('Error', '失败');
    }
    setTimeout(() => { hudResetBtn.textContent = tr('Reset', '复位'); }, 1200);
  });

  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectTab(btn.dataset.tab);
      if (btn.dataset.tab === 'history') {
        pollHistory(false);
      }
    });
  });

  document.querySelectorAll('#hist-source-tabs .seg-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const src = btn.dataset.source || 'all';
      state.historySource = src;
      document.querySelectorAll('#hist-source-tabs .seg-pill').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      pollHistory(false);
    });
  });

  $('hist-refresh').addEventListener('click', () => {
    pollHistory(true);
  });

  $('step-search').addEventListener('input', () => {
    if (state.data?.metrics) renderTimeline(state.data.metrics);
  });

  $('step-order').addEventListener('click', () => {
    state.newestFirst = !state.newestFirst;
    $('step-order').textContent = state.newestFirst ? tr('Newest First', '最新在前') : tr('Oldest First', '最早在前');
    if (state.data?.metrics) renderTimeline(state.data.metrics);
  });

  $('raw-copy').addEventListener('click', async () => {
    const btn = $('raw-copy');
    try {
      await navigator.clipboard.writeText($('raw-pre').textContent);
      btn.textContent = tr('Copied', '已复制');
    } catch {
      btn.textContent = tr('Failed', '复制失败');
    }
    setTimeout(() => { btn.textContent = tr('Copy JSON', '复制 JSON'); }, 1200);
  });

  applyLang();
  syncHudPrefs();
  pollHistory(false);
  poll();
})();
