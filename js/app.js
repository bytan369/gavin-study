(function () {
  'use strict';

  const SC = window.Scoring;
  const Cloud = window.Cloud;
  const Capture = window.Capture;
  const AI = window.AI;
  const NOTE_MAX = 2000;
  const KEY = 'gavin-study-v1';
  const AI_KEY = 'gavin-study-ai-v1'; // AI 设置（含密钥）单独存放，不进入云同步和备份文件
  const DAY = 86400000;
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const FOCUS_RATE = [['😵', '很分心'], ['😕', '有点分心'], ['😐', '一般'], ['🙂', '比较专注'], ['😎', '非常专注']];
  const MASTERY_RATE = [['😣', '没学懂'], ['🤔', '有点懵'], ['😐', '一般'], ['🙂', '基本会了'], ['🤩', '完全掌握']];

  let state = load();
  let ai = loadAi();
  const aiPending = new Set();
  const aiErrors = new Map();
  let resultView = null;
  let currentTab = 'study';
  let statsRange = 7;
  let historyFilter = 'all';
  let historyScope = 'all';
  const expanded = new Set();
  let form = null;
  let cap = { listening: false, busy: false, interim: '', progress: '', msg: '', tone: '' };
  let authDraft = { email: '', password: '' };
  let lastUid = null;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  // ---------------- 存储 ----------------
  function defaults() {
    return {
      version: 1,
      sessions: [],
      running: null,
      settings: { name: '', goal: 120, theme: 'auto', hidden: [], custom: [], reportEnabled: false },
      last: { subject: 'math', type: 'practice' },
    };
  }

  function load() {
    const d = defaults();
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (raw && Array.isArray(raw.sessions)) {
        return Object.assign(d, raw, {
          settings: Object.assign(d.settings, raw.settings),
          last: Object.assign(d.last, raw.last),
        });
      }
    } catch (e) { /* 读取失败时使用默认数据 */ }
    return d;
  }

  function loadAi() {
    try {
      return AI.normalizeConfig(JSON.parse(localStorage.getItem(AI_KEY)));
    } catch (e) {
      return AI.emptyConfig();
    }
  }

  function saveAi() {
    try {
      localStorage.setItem(AI_KEY, JSON.stringify(ai));
    } catch (e) {
      toast('保存失败：浏览器存储不可用或已满');
    }
  }

  const aiCurrent = () => Object.assign({ provider: ai.provider }, ai.configs[ai.provider]);
  const aiReady = () => ai.enabled && !AI.validateConfig(aiCurrent());

  // 只写本地
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      toast('保存失败：浏览器存储不可用或已满');
    }
  }

  // 写本地，并在登录时安排一次云同步
  function save() {
    persist();
    Cloud.schedule();
  }

  // 记录哪些数据需要上传到云端
  function markSession(id) {
    const s = Cloud.ensureSync(state);
    if (s.owner && !s.dirtySessions.includes(id)) s.dirtySessions.push(id);
  }
  function markDeleted(id) {
    const s = Cloud.ensureSync(state);
    s.dirtySessions = s.dirtySessions.filter((x) => x !== id);
    if (s.owner && !s.tombstones.includes(id)) s.tombstones.push(id);
  }
  function markSettings() {
    Cloud.ensureSync(state).dirtySettings = true;
  }
  function markRunning() {
    Cloud.ensureSync(state).dirtyRunning = true;
  }

  // ---------------- 工具函数 ----------------
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const round1 = (v) => Math.round(v * 10) / 10;

  function fmtClock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  }
  function fmtHM(ts) {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fmtHMS(ts) {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function fmtMin(min) {
    const m = Math.round(min);
    if (m < 1) return min > 0 ? '不足1分钟' : '0分钟';
    if (m < 60) return `${m}分钟`;
    return `${Math.floor(m / 60)}小时${m % 60 ? (m % 60) + '分' : ''}`;
  }
  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function keyToDate(k) {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function dayLabel(k) {
    const d = keyToDate(k);
    const today = dayKey(Date.now());
    const yest = dayKey(Date.now() - DAY);
    const base = `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
    if (k === today) return `今天 · ${base}`;
    if (k === yest) return `昨天 · ${base}`;
    return base;
  }
  function lastDays(n) {
    const out = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      out.push(dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i).getTime()));
    }
    return out;
  }
  function greet() {
    const h = new Date().getHours();
    if (h < 5) return '夜深了';
    if (h < 11) return '早上好';
    if (h < 13) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }

  // ---------------- 科目 ----------------
  function allSubjects() {
    const base = SC.SUBJECTS.filter((s) => s.id !== 'other');
    const other = SC.SUBJECTS.find((s) => s.id === 'other');
    return base.concat(state.settings.custom, [other]);
  }
  function visibleSubjects() {
    return allSubjects().filter((s) => !state.settings.hidden.includes(s.id));
  }
  function getSubject(id) {
    return allSubjects().find((s) => s.id === id) || { id, name: '已删除科目', emoji: '📝', color: '#868e96', quiz: 0.5 };
  }

  // 加权平均（按有效学习时长）
  function weightedAvg(list, field) {
    const w = list.reduce((a, s) => a + Math.max(s.activeMin, 1), 0);
    if (!w) return null;
    return Math.round(list.reduce((a, s) => a + s[field] * Math.max(s.activeMin, 1), 0) / w);
  }
  function sessionsByDay() {
    const map = {};
    for (const s of state.sessions) (map[dayKey(s.start)] = map[dayKey(s.start)] || []).push(s);
    return map;
  }
  function streakDays() {
    const map = sessionsByDay();
    let d = new Date();
    if (!map[dayKey(d.getTime())]) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    let n = 0;
    while (map[dayKey(d.getTime())]) {
      n++;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    }
    return n;
  }

  // 学习量没填（null）时不显示数量；兼容旧记录
  // 课内 / 课外：旧记录没有这个标记，统计里单独显示为“未标记”，可以在记录详情里改
  const scopeOf = (s) => (s && (s.scope === 'in' || s.scope === 'out') ? s.scope : null);
  const scopeName = (v) => (v === 'in' ? '课内' : v === 'out' ? '课外' : '未标记');
  const scopeChip = (v) => `<span class="scope-chip ${v || 'none'}">${scopeName(v)}</span>`;
  function splitStats(list) {
    const out = { in: [], out: [], none: [] };
    for (const s of list) out[scopeOf(s) || 'none'].push(s);
    const sum = (a) => a.reduce((t, x) => t + (+x.activeMin || 0), 0);
    return {
      lists: out,
      min: { in: sum(out.in), out: sum(out.out), none: sum(out.none) },
      total: sum(list),
    };
  }

  const hasAmount = (s) => s.amount !== null && s.amount !== undefined;
  const amountSuffix = (s, unit) => (hasAmount(s) ? ` · ${s.amount} ${esc(unit)}` : '');

  function badge(score, label) {
    return `<span class="badge ${SC.level(score).key}">${label} ${score}</span>`;
  }

  // ---------------- 计时 ----------------
  function runTimes(run, end) {
    const stop = end || run.end || Date.now();
    const totalMs = Math.max(0, stop - run.start);
    let pausedMs = 0;
    for (const p of run.pauses) pausedMs += Math.max(0, Math.min(p.end || stop, stop) - p.start);
    return { totalMs, pausedMs, activeMs: Math.max(0, totalMs - pausedMs) };
  }
  function isPaused(run) {
    const p = run.pauses[run.pauses.length - 1];
    return !!p && !p.end;
  }

  function startStudy(scope) {
    state.running = {
      subject: state.last.subject,
      type: state.last.type,
      scope: scope === 'out' ? 'out' : 'in',
      start: Date.now(),
      pauses: [],
    };
    markRunning();
    save();
    renderStudy();
    toast(`${scopeName(state.running.scope)}开始学习 ${fmtHMS(state.running.start)}，加油！`);
  }

  function togglePause() {
    const run = state.running;
    if (!run) return;
    if (isPaused(run)) run.pauses[run.pauses.length - 1].end = Date.now();
    else run.pauses.push({ start: Date.now(), end: null });
    markRunning();
    save();
    renderStudy();
  }

  function endStudy() {
    const run = state.running;
    if (!run) return;
    run.end = Date.now();
    if (isPaused(run)) {
      run.pauses[run.pauses.length - 1].end = run.end;
      run.closedAtEnd = true;
    }
    save();
    openFinishForm();
  }

  function resumeFromForm() {
    const run = state.running;
    if (!run) return;
    if (run.closedAtEnd) run.pauses[run.pauses.length - 1].end = null;
    delete run.end;
    delete run.closedAtEnd;
    form = null;
    markRunning();
    save();
    closeModal();
    renderStudy();
  }

  function discardStudy() {
    if (!confirm('确定放弃本次学习吗？本次计时不会被记录。')) return;
    state.running = null;
    form = null;
    markRunning();
    save();
    closeModal();
    renderStudy();
    toast('已放弃本次记录');
  }

  function updateClock() {
    const run = state.running;
    const clock = $('#clock');
    if (!run || run.end || !clock) {
      if (!run) document.title = '学习小站';
      return;
    }
    const t = runTimes(run);
    clock.textContent = fmtClock(t.activeMs);
    const meta = $('#timer-meta');
    if (meta) {
      meta.textContent = `开始于 ${fmtHMS(run.start)} · 暂停 ${run.pauses.length} 次` +
        (t.pausedMs >= 60000 ? `（共 ${fmtMin(t.pausedMs / 60000)}）` : '');
    }
    document.title = `${isPaused(run) ? '⏸' : '⏱'} ${fmtClock(t.activeMs)} · 学习小站`;
  }

  // ---------------- 学习页 ----------------
  function renderStudy() {
    const el = $('#tab-study');
    el.innerHTML = state.running ? (state.running.end ? pendingView() : timerView()) : idleView();
    updateClock();
  }

  // “课内 X · 课外 Y”一行小字
  function scopeLine(list) {
    const sp = splitStats(list);
    const parts = [['in', '课内'], ['out', '课外'], ['none', '未标记']].filter(([k]) => sp.lists[k].length).map(([k, n]) => `<span class="scope-dot ${k}"></span>${n} ${fmtMin(sp.min[k])}（${sp.lists[k].length} 次）`);
    return `<div class="scope-line small">${parts.join('<span class="sep">·</span>')}</div>`;
  }

  function idleView() {
    const today = (sessionsByDay()[dayKey(Date.now())] || []).sort((a, b) => b.start - a.start);
    const mins = today.reduce((a, s) => a + s.activeMin, 0);
    const goal = state.settings.goal;
    const pct = Math.min(100, Math.round((mins / goal) * 100));
    const streak = streakDays();
    const name = state.settings.name || '同学';
    const now = new Date();
    const sub = state.last.subject;
    const type = SC.getType(state.last.type);
    const subjObj = getSubject(sub);

    const subjects = visibleSubjects();
    if (!subjects.some((s) => s.id === sub)) subjects.unshift(subjObj);

    return `
    <div class="card today-strip">
      <div class="hello">
        <div class="hello-text"><b>${greet()}，${esc(name)} 👋</b><span>${now.getMonth() + 1}月${now.getDate()}日 ${WEEK[now.getDay()]}</span></div>
        ${streak ? `<div class="badge a">🔥 连续 ${streak} 天</div>` : ''}
      </div>
      <div class="goal">
        <div class="goal-text"><span>今日目标 ${fmtMin(goal)}</span><span>${pct >= 100 ? '🎉 已完成' : `已完成 ${pct}%`}</span></div>
        <div class="goal-bar"><div class="goal-fill" style="width:${pct}%"></div></div>
      </div>
    </div>

    <div class="card pick">
      <div class="pick-label">选择科目 <small>可在设置中增减</small></div>
      <div class="subject-grid">
        ${subjects.map((s) => `
          <button class="subject-btn ${s.id === sub ? 'selected' : ''}" style="--c:${esc(s.color)}" data-act="subject" data-id="${esc(s.id)}">
            <span class="emo">${esc(s.emoji)}</span>${esc(s.name)}
          </button>`).join('')}
      </div>
      <div class="pick-label">学习方式</div>
      <div class="type-list">
        ${SC.TYPES.map((t) => `<button class="chip ${t.id === type.id ? 'selected' : ''}" data-act="type" data-id="${t.id}">${t.icon} ${t.name}</button>`).join('')}
      </div>
      <div class="type-hint">结束时需要填写：${type.hint}（单位：${SC.unitOf(type, subjObj)}）</div>
    </div>

    <div class="start-bar">
      <div class="start-sel">
        <b>${esc(subjObj.emoji)} ${esc(subjObj.name)}</b>
        <span>${type.icon} ${type.name}</span>
      </div>
      <div class="start-btns">
        <button class="btn btn-primary btn-lg" data-act="start" data-scope="in">▶ 课内开始</button>
        <button class="btn btn-out btn-lg" data-act="start" data-scope="out">▶ 课外开始</button>
      </div>
    </div>

    ${Cloud.isConfigured() && !Cloud.getUser() && Cloud.getStatus().kind === 'out' ? `
    <div class="card row small">☁️ 登录后，学习记录可以在手机和电脑之间自动同步<span class="spacer"></span><button class="btn small" data-act="goto-sync">去登录</button></div>` : ''}

    <div class="card">
      <h3 class="card-title">今天的学习</h3>
      <div class="kpis today-kpis">
        <div class="kpi"><div class="kpi-label">今日学习</div><div class="kpi-value">${Math.round(mins)}<small>分钟</small></div></div>
        <div class="kpi"><div class="kpi-label">学习次数</div><div class="kpi-value">${today.length}<small>次</small></div></div>
        <div class="kpi"><div class="kpi-label">专注度</div><div class="kpi-value">${today.length ? weightedAvg(today, 'focus') : '–'}</div></div>
        <div class="kpi"><div class="kpi-label">学习效果</div><div class="kpi-value">${today.length ? weightedAvg(today, 'effect') : '–'}</div></div>
      </div>
      ${today.length ? scopeLine(today) : ''}
      ${today.length ? today.map(recordItem).join('') : `<div class="empty"><div class="big">🌱</div>今天还没有学习记录，开始第一段学习吧！</div>`}
    </div>`;
  }

  // 学习已经结束、但还没保存时（比如在填写表单时点了“返回主页”），主页上显示的卡片
  function pendingView() {
    const run = state.running;
    const s = getSubject(run.subject);
    const t = SC.getType(run.type);
    const tm = runTimes(run);
    return `
    <div class="card timer-card" style="--c:${esc(s.color)}">
      <div class="timer-subject">${esc(s.emoji)} ${esc(s.name)} ${scopeChip(form ? form.scope : run.scope || 'in')} <span class="type">· ${t.icon} ${t.name}</span></div>
      <div class="timer-status off"><span class="dot"></span>学习已结束，还没保存</div>
      <div class="timer-meta" style="margin-top:12px">${fmtHMS(run.start)} → ${fmtHMS(run.end)} · 有效学习 ${fmtMin(tm.activeMs / 60000)}</div>
      <div class="timer-actions">
        <button class="btn btn-lg btn-primary" data-act="open-form">✍️ 填写并保存</button>
        <button class="btn btn-lg" data-act="back">↩ 继续计时</button>
      </div>
      <div style="margin-top:14px"><button class="btn btn-ghost small" data-act="discard">放弃本次记录</button></div>
    </div>`;
  }

  function timerView() {
    const run = state.running;
    const s = getSubject(run.subject);
    const t = SC.getType(run.type);
    const paused = isPaused(run);
    return `
    <div class="card timer-card" style="--c:${esc(s.color)}">
      <div class="timer-subject">${esc(s.emoji)} ${esc(s.name)} ${scopeChip(run.scope || 'in')} <span class="type">· ${t.icon} ${t.name}</span></div>
      <div class="timer-status ${paused ? 'off' : 'on'}"><span class="dot"></span>${paused ? '已暂停' : '专注学习中'}</div>
      <div class="timer-clock" id="clock">00:00:00</div>
      <div class="timer-meta" id="timer-meta"></div>
      <div class="timer-actions">
        <button class="btn btn-lg ${paused ? 'btn-good' : 'btn-warn'}" data-act="pause">${paused ? '▶ 继续' : '⏸ 暂停'}</button>
        <button class="btn btn-lg btn-primary" data-act="end">⏹ 结束学习</button>
      </div>
      <div style="margin-top:14px"><button class="btn btn-ghost small" data-act="discard">放弃本次记录</button></div>
    </div>
    <div class="card small muted">
      💡 计时显示的是<b>有效学习时间</b>（不含暂停）。每次暂停会算作一次中断，结束后会根据有效时长、中断次数和学习量自动评分。
      本次需要记录：${t.hint}。
    </div>`;
  }

  // ---------------- 结束表单 ----------------
  function openFinishForm() {
    const run = state.running;
    if (!run || !run.end) return;
    if (!form) {
      form = {
        amount: '', correct: '', interruptions: run.pauses.length, focusSelf: 4, mastery: 3, note: '', error: '', scope: run.scope === 'out' ? 'out' : 'in',
        voiceLang: Capture.voiceLangFor(run.subject),
      };
      cap = { listening: false, busy: false, interim: '', progress: '', msg: '', tone: '' };
    }
    renderFinishForm();
  }

  function rateButtons(field, items) {
    return `<div class="rate">${items.map((it, i) => `
      <button type="button" class="${form[field] === i + 1 ? 'selected' : ''}" data-act="rate" data-field="${field}" data-v="${i + 1}">
        <span class="emo">${it[0]}</span>${it[1]}
      </button>`).join('')}</div>`;
  }

  function renderFinishForm() {
    const run = state.running;
    const s = getSubject(run.subject);
    const t = SC.getType(run.type);
    const unit = SC.unitOf(t, s);
    const tm = runTimes(run);
    const short = tm.activeMs < 60000;
    openModal(`
      <div class="modal-head"><button type="button" class="modal-back" data-act="hide-form">← 返回主页</button></div>
      <h3>${esc(s.emoji)} ${esc(s.name)} · ${t.name}</h3>
      <div class="muted small">学习结束，记录一下这次的成果吧。现在不想填，点左上角「返回主页」，稍后回来继续。</div>
      <div class="time-box">
        <div>🕐 开始 <b>${fmtHMS(run.start)}</b> → 结束 <b>${fmtHMS(run.end)}</b></div>
        <div>⏱️ 有效学习 <b>${fmtMin(tm.activeMs / 60000)}</b>${tm.pausedMs > 0 ? `，暂停 ${fmtMin(tm.pausedMs / 60000)}` : ''}</div>
        ${short ? '<div class="err">本次有效学习不足 1 分钟，评分参考意义不大</div>' : ''}
      </div>
      <form id="finish-form" novalidate>
        <div class="field">
          <div class="label">学习类别</div>
          <div class="seg scope-seg" role="group" aria-label="学习类别">
            <button type="button" class="${form.scope === 'in' ? 'active' : ''}" data-act="form-scope" data-v="in">课内</button>
            <button type="button" class="${form.scope === 'out' ? 'active' : ''}" data-act="form-scope" data-v="out">课外</button>
          </div>
        </div>
        <div class="field">
          <label for="f-amount">学习量 <span class="muted small">（选填）</span></label>
          <div class="input-unit"><input class="input" id="f-amount" name="amount" type="number" inputmode="numeric" min="0" step="1" placeholder="不填也可以" value="${esc(form.amount)}"><span>${esc(unit)}</span></div>
          <div class="help">${t.hint}。不填的话，学习效率和学习量按其他项估算，评分没那么准。</div>
        </div>
        ${t.correct ? `
        <div class="field">
          <label for="f-correct">做对的题数${t.correct === 'optional' ? '<span class="muted small">（选填）</span>' : ''}</label>
          <div class="input-unit"><input class="input" id="f-correct" name="correct" type="number" inputmode="numeric" min="0" step="1" placeholder="${t.correct === 'optional' ? '不知道可不填' : '0'}" value="${esc(form.correct)}"><span>题</span></div>
        </div>` : ''}
        <div class="field">
          <div class="label">走神 / 被打断次数</div>
          <div class="stepper">
            <button type="button" data-act="step" data-d="-1">−</button>
            <output id="f-int">${form.interruptions}</output>
            <button type="button" data-act="step" data-d="1">＋</button>
          </div>
          <div class="help">已自动填入暂停次数（${run.pauses.length} 次），可以按实际走神情况修改</div>
        </div>
        <div class="field"><div class="label">这次专注程度</div>${rateButtons('focusSelf', FOCUS_RATE)}</div>
        <div class="field"><div class="label">内容掌握程度</div>${rateButtons('mastery', MASTERY_RATE)}</div>
        <div class="field">
          <label for="f-note">学习内容 / 心得 <span class="muted small">（选填）</span></label>
          <div class="capture-bar">
            <button type="button" class="btn small" id="btn-voice" data-act="voice">🎤 语音输入</button>
            <select class="input" id="voice-lang" aria-label="语音语言">
              ${[['zh-CN', '普通话'], ['en-US', 'English'], ['zh-HK', '粤语']].map(([v, n]) => `<option value="${v}" ${form.voiceLang === v ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
            <button type="button" class="btn small" id="btn-photo" data-act="photo">📷 拍照识别</button>
            <input type="file" id="photo-input" accept="image/*" hidden>
          </div>
          <div class="capture-status" id="capture-status" role="status" aria-live="polite"></div>
          <textarea class="input" id="f-note" name="note" maxlength="${NOTE_MAX}" placeholder="例如：二次函数第3节练习，顶点式还不太熟">${esc(form.note)}</textarea>
          <div class="help">可以说话，也可以拍下课本、作业或笔记，文字会自动填进来，识别不准的地方请手动修改。照片只在本机识别，不会上传。</div>
        </div>
        ${form.error ? `<div class="err">${esc(form.error)}</div>` : ''}
        <div style="text-align:center;margin-top:4px"><button type="button" class="btn btn-ghost small" data-act="discard">放弃本次记录</button></div>
        <div class="sticky-actions">
          <div class="form-actions">
            <button type="button" class="btn" data-act="back">↩ 继续计时</button>
            <button type="submit" class="btn btn-primary">保存并评分</button>
          </div>
        </div>
      </form>`);
    renderCaptureUI();
  }

  // ---------------- 语音 / 拍照录入学习内容 ----------------
  function setCap(msg, tone) {
    cap.msg = msg || '';
    cap.tone = tone || '';
    renderCaptureUI();
  }

  function renderCaptureUI() {
    const status = $('#capture-status');
    const vBtn = $('#btn-voice');
    const pBtn = $('#btn-photo');
    if (!status || !vBtn || !pBtn) return;
    vBtn.textContent = cap.listening ? '⏹ 停止' : '🎤 语音输入';
    vBtn.classList.toggle('btn-danger', cap.listening);
    vBtn.disabled = cap.busy;
    pBtn.disabled = cap.busy || cap.listening;
    pBtn.textContent = cap.busy ? '⏳ 识别中…' : '📷 拍照识别';
    let text = cap.msg;
    let tone = cap.tone;
    if (cap.listening) {
      text = `🎤 正在听，请说话…${cap.interim ? ` ${cap.interim}` : ''}`;
      tone = 'live';
    } else if (cap.busy) {
      text = `⏳ ${cap.progress}`;
      tone = 'live';
    }
    status.textContent = text;
    status.className = `capture-status ${tone}`;
  }

  // 把识别结果加到备注里；先读取输入框，避免覆盖用户手动输入的内容
  function addNote(text, kind, myForm) {
    if (form !== myForm) return;
    readFormInputs();
    const next = kind === 'speech' ? Capture.appendSpeech(form.note, text, form.voiceLang) : Capture.appendBlock(form.note, text);
    const fit = Capture.fitText(next, NOTE_MAX);
    form.note = fit.text;
    const ta = $('#f-note');
    if (ta) ta.value = fit.text;
    if (fit.truncated) setCap(`内容太长，已保留前 ${NOTE_MAX} 个字。`, 'err');
    return fit.truncated;
  }

  function stopCapture() {
    if (Capture.voice.isListening()) Capture.voice.stop();
    cap.listening = false;
    cap.interim = '';
    renderCaptureUI();
  }

  function toggleVoice() {
    if (cap.listening) return Capture.voice.stop();
    if (!Capture.voice.supported()) return setCap(Capture.describeVoiceError('unsupported'), 'err');
    readFormInputs();
    const myForm = form;
    cap.msg = '';
    Capture.voice.start({
      lang: form.voiceLang,
      onState: (on) => { cap.listening = on; if (!on) cap.interim = ''; renderCaptureUI(); },
      onInterim: (t) => { cap.interim = t; renderCaptureUI(); },
      onText: (t) => addNote(t, 'speech', myForm),
      onError: (code) => setCap(Capture.describeVoiceError(code), 'err'),
    });
  }

  async function recognizePhoto(file) {
    if (!file || cap.busy) return;
    readFormInputs();
    const myForm = form;
    cap.busy = true;
    cap.msg = '';
    cap.progress = '正在处理照片…';
    renderCaptureUI();
    try {
      const { text } = await Capture.ocr.recognize(file, (p) => {
        if (form !== myForm) return;
        cap.progress = p.text;
        renderCaptureUI();
      });
      if (form !== myForm) return;
      const clean = Capture.cleanOcrText(text);
      if (!clean) {
        setCap('没有识别到文字。请把文字拍清楚：光线充足、正对着拍、不要拍太远，再试一次。', 'err');
        return;
      }
      const truncated = addNote(clean, 'block', myForm);
      if (!truncated) setCap(`已识别 ${clean.length} 个字并填入下方，请检查、修改不准的地方。`, 'ok');
    } catch (e) {
      if (form === myForm) setCap(Capture.describeOcrError(e), 'err');
    } finally {
      cap.busy = false;
      renderCaptureUI();
    }
  }

  function readFormInputs() {
    const f = $('#finish-form');
    if (!f) return;
    form.amount = f.amount.value;
    if (f.correct) form.correct = f.correct.value;
    form.note = f.note.value;
  }

  function submitFinish() {
    readFormInputs();
    const run = state.running;
    const t = SC.getType(run.type);
    // 学习量选填：没填 = null，不按学习量评分
    const amount = form.amount === '' ? null : Number(form.amount);
    const correct = form.correct === '' ? null : Number(form.correct);
    let error = '';
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) error = '学习量要填 0 或更大的数字，不想填可以留空';
    else if (amount === null && correct !== null) error = '填了做对的题数，请同时填写完成的题数；都不想填就都留空';
    else if (t.correct === 'required' && amount > 0 && correct === null) error = '请填写做对的题数（不想填学习量的话，两项都留空）';
    else if (correct !== null && (!Number.isFinite(correct) || correct < 0 || correct > amount)) error = '做对的题数应在 0 到总题数之间';
    if (error) {
      form.error = error;
      renderFinishForm();
      return;
    }

    const subject = getSubject(run.subject);
    const tm = runTimes(run);
    const totalMin = round1(tm.totalMs / 60000);
    const activeMin = round1(tm.activeMs / 60000);
    const result = SC.computeScores({
      subject, type: run.type, totalMin, activeMin,
      interruptions: form.interruptions, amount, correct: t.correct ? correct : null,
      focusSelf: form.focusSelf, mastery: form.mastery,
    });
    const session = {
      id: `s${run.start}${Math.random().toString(36).slice(2, 6)}`,
      subject: run.subject,
      type: run.type,
      scope: form.scope === 'out' ? 'out' : 'in',
      start: run.start,
      end: run.end,
      pauses: run.pauses.length,
      totalMin,
      activeMin,
      pausedMin: round1(tm.pausedMs / 60000),
      amount,
      correct: t.correct ? correct : null,
      interruptions: form.interruptions,
      focusSelf: form.focusSelf,
      mastery: form.mastery,
      note: form.note.trim(),
      focus: result.focus,
      effect: result.effect,
      focusParts: result.focusParts,
      effectParts: result.effectParts,
      metrics: result.metrics,
      tips: result.tips,
    };
    stopCapture();
    state.sessions.push(session);
    state.running = null;
    form = null;
    markSession(session.id);
    markRunning();
    save();
    renderStudy();
    if (aiReady()) runAi(session.id);
    showResult(session, true);
  }

  // ---------------- 评分结果 ----------------
  function ring(score, label, color) {
    const r = 54;
    const c = 2 * Math.PI * r;
    const lv = SC.level(score);
    return `<div class="ring">
      <svg viewBox="0 0 132 132" aria-hidden="true">
        <circle class="track" cx="66" cy="66" r="${r}" fill="none" stroke-width="12"/>
        <circle class="val" cx="66" cy="66" r="${r}" fill="none" stroke-width="12" stroke="${color}"
          stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${c.toFixed(2)}" data-off="${(c * (1 - score / 100)).toFixed(2)}"/>
      </svg>
      <div class="ring-num"><b>${score}</b><span>满分 100</span></div>
      <div class="ring-label">${label} · ${lv.emoji} ${lv.label}</div>
    </div>`;
  }

  function partsList(parts, labels, color) {
    return `<div class="parts">${Object.keys(labels).map((k) => {
      const v = parts[k] || 0;
      const m = labels[k].max;
      return `<div class="part-row"><span>${labels[k].name}</span>
        <div class="part-bar" style="--c:${color}"><i style="width:${Math.round((v / m) * 100)}%"></i></div>
        <span class="v">${Math.round(v)}/${m}</span></div>`;
    }).join('')}</div>`;
  }

  // ---------------- AI 评估 ----------------
  function buildAiInput(s) {
    const subj = getSubject(s.subject);
    const t = SC.getType(s.type);
    const rule = s.rule || s;
    const m = rule.metrics || {};
    const total = Number(s.totalMin) || 0;
    const amount = hasAmount(s) ? s.amount : null;
    return {
      subject: subj.name,
      type: t.name,
      scopeText: scopeOf(s) === 'in' ? '课内（学校课程的内容）' : scopeOf(s) === 'out' ? '课外（课外拓展、兴趣或额外练习）' : '',
      unit: SC.unitOf(t, subj),
      startClock: fmtHM(s.start),
      endClock: fmtHM(s.end),
      totalMin: round1(total),
      activeMin: round1(Number(s.activeMin) || 0),
      activePct: Math.round(m.activeRatio != null ? m.activeRatio : total ? ((Number(s.activeMin) || 0) / total) * 100 : 0),
      pauses: s.pauses || 0,
      pausedMin: round1(s.pausedMin != null ? s.pausedMin : Math.max(0, total - (Number(s.activeMin) || 0))),
      interruptions: s.interruptions || 0,
      amount,
      rate: Math.round(t.rate(subj) * 100) / 100,
      expected: amount === null || m.expected == null ? null : Math.round(m.expected * 10) / 10,
      pacePct: amount === null || m.pace == null ? null : Math.round(m.pace),
      correct: amount === null || s.correct == null ? null : s.correct,
      accuracyPct: amount === null || s.correct == null || m.accuracy == null ? null : Math.round(m.accuracy),
      focusSelf: s.focusSelf,
      focusSelfText: (FOCUS_RATE[s.focusSelf - 1] || [])[1] || '',
      mastery: s.mastery,
      masteryText: (MASTERY_RATE[s.mastery - 1] || [])[1] || '',
      note: s.note || '',
      ruleFocus: rule.focus,
      ruleEffect: rule.effect,
    };
  }

  async function runAi(id) {
    const s = state.sessions.find((x) => x.id === id);
    if (!s || aiPending.has(id) || !aiReady()) return;
    const cfg = aiCurrent();
    aiPending.add(id);
    aiErrors.delete(id);
    refreshAiViews(id);
    try {
      const r = await AI.evaluate(cfg, buildAiInput(s));
      const cur = state.sessions.find((x) => x.id === id);
      if (!cur) return; // 评估期间记录被删除了
      if (!cur.rule) cur.rule = { focus: cur.focus, effect: cur.effect, focusParts: cur.focusParts, effectParts: cur.effectParts, metrics: cur.metrics, tips: cur.tips };
      cur.focus = r.focus;
      cur.effect = r.effect;
      if (r.tips.length) cur.tips = r.tips;
      cur.ai = { provider: cfg.provider, model: cfg.model, focusReason: r.focusReason, effectReason: r.effectReason, at: Date.now() };
      markSession(id);
      save();
    } catch (e) {
      aiErrors.set(id, e.message || 'AI 评估失败');
    } finally {
      aiPending.delete(id);
      refreshAiViews(id);
    }
  }

  // AI 评估状态变化后，刷新正在显示的结果弹窗和列表
  function refreshAiViews(id) {
    const m = $('#modal');
    if (resultView && resultView.id === id && !m.hidden) {
      const s = state.sessions.find((x) => x.id === id);
      if (s) showResult(s, resultView.fresh, true);
    }
    if (['study', 'history', 'stats'].includes(currentTab)) renderCurrent();
  }

  function aiBlock(s) {
    if (aiPending.has(s.id)) return '<div class="ai-status live">🤖 AI 正在评估…（先显示算法评分，一般几秒钟）</div>';
    if (s.ai) {
      const pn = AI.getProvider(s.ai.provider).name.replace(/（.*）/, '');
      return `<div class="ai-box">
        <div class="ai-head">🤖 AI 点评 <small>${esc(pn)} · ${esc(s.ai.model)}</small></div>
        ${s.ai.focusReason ? `<p><b>专注度：</b>${esc(s.ai.focusReason)}</p>` : ''}
        ${s.ai.effectReason ? `<p><b>学习效果：</b>${esc(s.ai.effectReason)}</p>` : ''}
        ${aiReady() ? `<button class="btn small btn-ghost" data-act="ai-eval" data-id="${esc(s.id)}">🔄 重新评估</button>` : ''}
      </div>`;
    }
    if (aiErrors.has(s.id)) {
      return `<div class="ai-status err">🤖 AI 评估失败：${esc(aiErrors.get(s.id))}。已使用算法评分。 <button class="btn small" data-act="ai-eval" data-id="${esc(s.id)}">重试</button></div>`;
    }
    if (aiReady()) return `<div class="ai-status"><button class="btn small" data-act="ai-eval" data-id="${esc(s.id)}">🤖 用 AI 评估这次学习</button></div>`;
    return '';
  }

  function showResult(s, fresh, reshow) {
    const subj = getSubject(s.subject);
    const t = SC.getType(s.type);
    const unit = SC.unitOf(t, subj);
    const base = s.rule || s; // AI 评估过的记录，算法评分明细在 rule 里
    const m = base.metrics || {};
    const sheet = $('.modal-sheet');
    const scroll = reshow && sheet ? sheet.scrollTop : 0;
    const parts = `
      <h4 style="margin:8px 0">专注度构成</h4>
      ${partsList(base.focusParts, SC.FOCUS_LABELS, 'var(--series-1)')}
      <h4 style="margin:14px 0 8px">学习效果构成</h4>
      ${partsList(base.effectParts, SC.EFFECT_LABELS, 'var(--series-2)')}
      <div class="muted small" style="margin-top:10px">
        有效时长占比 ${m.activeRatio}% · 每30分钟中断 ${m.interruptRate} 次${m.pace != null ? ` · 学习效率 ${m.pace}%（参考量 ${m.expected} ${esc(unit)}）` : ' · 没填学习量：学习效率、学习量达成两项按其他项估算'}${m.accuracy != null ? ` · 正确率 ${m.accuracy}%` : ''}
      </div>`;
    resultView = { id: s.id, fresh };
    openModal(`
      <div class="modal-head"><button type="button" class="modal-back" data-act="close">← 返回主页</button></div>
      <h3>${fresh ? '🎉 学习完成！' : '评分详情'}</h3>
      <div class="muted small">${esc(subj.emoji)} ${esc(subj.name)} · ${t.name} · ${fmtHM(s.start)}–${fmtHM(s.end)} · 有效 ${fmtMin(s.activeMin)}${amountSuffix(s, unit)}</div>
      <div class="score-rings">
        ${ring(s.focus, '专注度', 'var(--series-1)')}
        ${ring(s.effect, '学习效果', 'var(--series-2)')}
      </div>
      <div class="muted small" style="text-align:center">评分来源：${s.ai ? 'AI 评估' : '算法'}</div>
      ${aiBlock(s)}
      ${s.ai ? `<details class="rule-detail"><summary>算法评分明细（参考：专注 ${base.focus} · 效果 ${base.effect}）</summary>${parts}</details>` : parts}
      <h4 style="margin:14px 0 8px">小建议</h4>
      <ul class="tips">${(s.tips || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="sticky-actions"><div class="form-actions"><button class="btn btn-primary" data-act="close">好的</button></div></div>`);
    const nsheet = $('.modal-sheet');
    if (reshow && nsheet) nsheet.scrollTop = scroll;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $$('.ring .val').forEach((c) => {
        if (reshow) c.style.transition = 'none';
        c.style.strokeDashoffset = c.dataset.off;
      });
    }));
  }

  // ---------------- 记录页 ----------------
  function recordItem(s) {
    const subj = getSubject(s.subject);
    const t = SC.getType(s.type);
    const unit = SC.unitOf(t, subj);
    const open = expanded.has(s.id);
    return `<div class="rec">
      <button class="rec-main" data-act="toggle" data-id="${esc(s.id)}" aria-expanded="${open}">
        <div class="rec-icon" style="--c:${esc(subj.color)}">${esc(subj.emoji)}</div>
        <div class="rec-body">
          <div class="rec-title">${esc(subj.name)} ${scopeChip(scopeOf(s))}<span class="type">${t.icon} ${t.name}</span></div>
          <div class="rec-sub">${fmtHM(s.start)}–${fmtHM(s.end)} · ${fmtMin(s.activeMin)}${amountSuffix(s, unit)}</div>
        </div>
        <div class="rec-scores">${badge(s.focus, '专注')}${badge(s.effect, '效果')}</div>
      </button>
      ${open ? `<div class="rec-detail">
        <div class="facts">
          <span>🕐 ${fmtHMS(s.start)} – ${fmtHMS(s.end)}</span>
          <span>⏱️ 总时长 ${fmtMin(s.totalMin)}</span>
          <span>✅ 有效学习 ${fmtMin(s.activeMin)}</span>
          <span>⏸ 暂停 ${s.pauses} 次</span>
          <span>📦 学习量 ${hasAmount(s) ? `${s.amount} ${esc(unit)}` : '没填'}</span>
          ${s.correct != null && hasAmount(s) ? `<span>🎯 正确率 ${s.amount ? Math.round((s.correct / s.amount) * 100) : 0}%（${s.correct}/${s.amount}）</span>` : ''}
          <span>💭 走神/中断 ${s.interruptions} 次</span>
          <span>🙂 自评专注 ${s.focusSelf}/5</span>
          <span>📘 掌握程度 ${s.mastery}/5</span>
        </div>
        ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}
        <div class="row" style="margin-bottom:8px">
          <span class="small muted">类别</span>
          <div class="seg">
            <button class="${scopeOf(s) === 'in' ? 'active' : ''}" data-act="set-scope" data-id="${esc(s.id)}" data-v="in">课内</button>
            <button class="${scopeOf(s) === 'out' ? 'active' : ''}" data-act="set-scope" data-id="${esc(s.id)}" data-v="out">课外</button>
          </div>
        </div>
        <div class="row">
          <button class="btn small" data-act="detail" data-id="${esc(s.id)}">📊 评分详情</button>
          <span class="spacer"></span>
          <button class="btn btn-danger small" data-act="delete" data-id="${esc(s.id)}">删除</button>
        </div>
      </div>` : ''}
    </div>`;
  }

  function renderHistory() {
    const el = $('#tab-history');
    const used = Array.from(new Set(state.sessions.map((s) => s.subject)));
    if (historyFilter !== 'all' && !used.includes(historyFilter)) historyFilter = 'all';
    const list = state.sessions
      .filter((s) => historyFilter === 'all' || s.subject === historyFilter)
      .filter((s) => historyScope === 'all' || (scopeOf(s) || 'none') === historyScope)
      .sort((a, b) => b.start - a.start);
    const groups = [];
    for (const s of list) {
      const k = dayKey(s.start);
      if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, items: [] });
      groups[groups.length - 1].items.push(s);
    }
    el.innerHTML = `
      <div class="card row">
        <b>学习记录</b><span class="muted small">共 ${list.length} 条</span>
        <span class="spacer"></span>
        <select class="input" style="width:auto" id="history-scope" aria-label="按课内课外筛选">
          <option value="all" ${historyScope === 'all' ? 'selected' : ''}>课内+课外</option>
          <option value="in" ${historyScope === 'in' ? 'selected' : ''}>只看课内</option>
          <option value="out" ${historyScope === 'out' ? 'selected' : ''}>只看课外</option>
          ${state.sessions.some((x) => !scopeOf(x)) ? `<option value="none" ${historyScope === 'none' ? 'selected' : ''}>未标记</option>` : ''}
        </select>
        <select class="input" style="width:auto" id="history-filter" aria-label="按科目筛选">
          <option value="all">全部科目</option>
          ${used.map((id) => { const s = getSubject(id); return `<option value="${esc(id)}" ${id === historyFilter ? 'selected' : ''}>${esc(s.emoji)} ${esc(s.name)}</option>`; }).join('')}
        </select>
      </div>
      ${groups.length ? groups.map((g) => {
        const mins = g.items.reduce((a, s) => a + s.activeMin, 0);
        return `<div class="day-group">
          <div class="day-head"><span>${dayLabel(g.k)}</span><small>${fmtMin(mins)} · ${g.items.length} 次 · 专注 ${weightedAvg(g.items, 'focus')} · 效果 ${weightedAvg(g.items, 'effect')}</small></div>
          ${g.items.map(recordItem).join('')}
        </div>`;
      }).join('') : `<div class="card empty"><div class="big">🗒️</div>还没有学习记录</div>`}`;
  }

  function setScope(id, v) {
    const s = state.sessions.find((x) => x.id === id);
    if (!s || (v !== 'in' && v !== 'out') || scopeOf(s) === v) return;
    s.scope = v;
    markSession(id);
    save();
    renderCurrent();
    toast(`已改为${scopeName(v)}`);
  }

  function deleteSession(id) {
    const s = state.sessions.find((x) => x.id === id);
    if (!s) return;
    if (!confirm(`删除 ${dayLabel(dayKey(s.start))} ${fmtHM(s.start)} 的${getSubject(s.subject).name}记录？`)) return;
    state.sessions = state.sessions.filter((x) => x.id !== id);
    expanded.delete(id);
    markDeleted(id);
    save();
    renderCurrent();
    toast('已删除');
  }

  // ---------------- 统计页 ----------------
  function niceMax(v) {
    const steps = [30, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 900];
    for (const s of steps) if (s >= v) return s;
    return Math.ceil(v / 120) * 120;
  }

  function barPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function xLabel(k, n, i) {
    const d = keyToDate(k);
    if (n <= 7) return WEEK[d.getDay()];
    return (n - 1 - i) % 5 === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : '';
  }

  function minutesChart(days, W) {
    const H = 220, L = 34, R = 8, T = 14, B = 24;
    const iw = W - L - R, ih = H - T - B;
    const goal = state.settings.goal;
    const max = niceMax(Math.max(goal, ...days.map((d) => d.min)) * 1.05);
    const band = iw / days.length;
    const bw = Math.max(4, Math.min(34, band * 0.62));
    const y = (v) => T + ih - (v / max) * ih;
    let g = '<g class="grid axis">';
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`;
    }
    g += '</g>';
    let bars = '';
    let labels = '<g class="axis">';
    days.forEach((d, i) => {
      const cx = L + band * i + band / 2;
      // 课内在下、课外在上、未标记在最上；段与段之间留 2px 空隙，最上面一段是圆角
      const segs = ['in', 'out', 'none'].filter((k) => d[k] > 0);
      let base = T + ih;
      segs.forEach((k, j) => {
        const h = Math.max(2, (d[k] / max) * ih);
        const top = j === segs.length - 1;
        const x = cx - bw / 2;
        const yy = base - h;
        bars += top
          ? `<path class="bar seg-${k}" d="${barPath(x, yy, bw, h, 4)}"/>`
          : `<rect class="bar seg-${k}" x="${x}" y="${yy + 1}" width="${bw}" height="${Math.max(1, h - 1)}"/>`;
        base = yy;
      });
      const parts = [['in', '课内'], ['out', '课外'], ['none', '未标记']].filter(([k]) => d[k] > 0).map(([k, n]) => `${n} ${fmtMin(d[k])}`);
      const tip = d.count ? `${dayLabel(d.k)}：${parts.join(' · ')} · 共 ${fmtMin(d.min)} · ${d.count} 次` : `${dayLabel(d.k)}：没有记录`;
      bars += `<rect x="${L + band * i}" y="${T}" width="${band}" height="${ih}" fill="transparent" data-tip="${esc(tip)}" data-cx="${cx}"/>`;
      labels += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${xLabel(d.k, days.length, i)}</text>`;
    });
    labels += '</g>';
    const goalLine = goal <= max
      ? `<line class="goal-line" x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}"/><text class="goal-text" x="${W - R}" y="${y(goal) - 5}" text-anchor="end">目标 ${goal} 分钟</text>`
      : '';
    const hasNone = days.some((d) => d.none > 0);
    return `<div class="legend"><span><i class="sw seg-in"></i>课内</span><span><i class="sw seg-out"></i>课外</span>${hasNone ? '<span><i class="sw seg-none"></i>未标记</span>' : ''}</div>
      <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每日学习时长（分钟），按课内课外分色">${g}${goalLine}${bars}${labels}</svg><div class="tooltip"></div></div>`;
  }

  function scoreChart(days, W) {
    const H = 220, L = 34, R = 28, T = 14, B = 24;
    const iw = W - L - R, ih = H - T - B;
    const band = iw / days.length;
    const y = (v) => T + ih - (v / 100) * ih;
    const x = (i) => L + band * i + band / 2;
    let g = '<g class="grid axis">';
    for (const v of [0, 25, 50, 75, 100]) {
      g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }
    g += '</g>';
    const series = [['focus', 's1'], ['effect', 's2']];
    const lasts = {};
    let paths = '';
    let dots = '';
    let direct = '';
    for (const [field, cls] of series) {
      let dStr = '';
      let prev = false;
      let last = null;
      days.forEach((d, i) => {
        const v = d[field];
        if (v == null) { prev = false; return; }
        dStr += `${prev ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        prev = true;
        last = { i, v };
        dots += `<circle class="dot ${cls}" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4"/>`;
      });
      if (dStr) paths += `<path class="line ${cls}" d="${dStr}"/>`;
      lasts[field] = last;
    }
    // 只在最后一个点标注数值；较高的标在上方，较低的标在下方，避免重叠
    for (const [field, other] of [['focus', 'effect'], ['effect', 'focus']]) {
      const last = lasts[field];
      if (!last) continue;
      const o = lasts[other];
      const above = !o || o.i !== last.i || last.v > o.v || (last.v === o.v && field === 'focus');
      direct += `<text class="lbl" x="${x(last.i) + 8}" y="${y(last.v) + (above ? -6 : 14)}">${last.v}</text>`;
    }
    let hits = '<line class="hover-line" x1="0" x2="0" y1="' + T + '" y2="' + (T + ih) + '" visibility="hidden"/>';
    let labels = '<g class="axis">';
    days.forEach((d, i) => {
      const tip = d.focus == null ? `${dayLabel(d.k)}：没有记录` : `${dayLabel(d.k)}：专注 ${d.focus} · 效果 ${d.effect}`;
      hits += `<rect x="${L + band * i}" y="${T}" width="${band}" height="${ih}" fill="transparent" data-tip="${esc(tip)}" data-cx="${x(i)}"/>`;
      labels += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${xLabel(d.k, days.length, i)}</text>`;
    });
    labels += '</g>';
    return `<div class="legend"><span><i style="background:var(--series-1)"></i>专注度</span><span><i style="background:var(--series-2)"></i>学习效果</span></div>
      <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每日平均专注度与学习效果">${g}${paths}${dots}${direct}${hits}${labels}</svg><div class="tooltip"></div></div>`;
  }

  // 课内 / 课外对比：占比条 + 两张小卡片（时间、次数、平均专注和效果）
  function scopeSplitCard(list, title, hint) {
    if (!list.length) return '';
    const sp = splitStats(list);
    const keys = ['in', 'out'].concat(sp.lists.none.length ? ['none'] : []);
    const pct = (k) => (sp.total ? Math.round((sp.min[k] / sp.total) * 100) : 0);
    return `<div class="card">
      <h3 class="card-title">${title} <small>${hint}</small></h3>
      <div class="split-bar" role="img" aria-label="课内课外时间占比">${keys.filter((k) => sp.min[k] > 0).map((k) => `<i class="seg-${k}" style="flex:${sp.min[k]}"></i>`).join('')}</div>
      <div class="scope-tiles">${keys.map((k) => {
        const l = sp.lists[k];
        return `<div class="scope-tile">
          <div class="scope-tile-name"><span class="scope-dot ${k}"></span>${scopeName(k)}</div>
          <div class="scope-tile-val">${fmtMin(sp.min[k])}</div>
          <div class="scope-tile-sub">占 ${pct(k)}% · ${l.length} 次</div>
          <div class="scope-tile-sub">专注 ${l.length ? weightedAvg(l, 'focus') : '–'} · 效果 ${l.length ? weightedAvg(l, 'effect') : '–'}</div>
        </div>`;
      }).join('')}</div>
    </div>`;
  }

  // 全部记录的累计统计
  function overviewCards() {
    const all = state.sessions;
    if (!all.length) return '';
    const days = new Set(all.map((x) => dayKey(x.start))).size;
    const total = all.reduce((a, x) => a + (+x.activeMin || 0), 0);
    return `<div class="card">
      <h3 class="card-title">累计总览 <small>全部记录</small></h3>
      <div class="kpis" style="margin-top:0">
        <div class="kpi"><div class="kpi-label">总学习时长</div><div class="kpi-value">${(total / 60).toFixed(1)}<small>小时</small></div></div>
        <div class="kpi"><div class="kpi-label">学习天数</div><div class="kpi-value">${days}<small>天</small></div></div>
        <div class="kpi"><div class="kpi-label">学习次数</div><div class="kpi-value">${all.length}<small>次</small></div></div>
        <div class="kpi"><div class="kpi-label">平均专注 / 效果</div><div class="kpi-value">${weightedAvg(all, 'focus')}<small>/</small>${weightedAvg(all, 'effect')}</div></div>
      </div>
    </div>${scopeSplitCard(all, '课内 / 课外', '累计')}`;
  }

  function renderStats() {
    const el = $('#tab-stats');
    const keys = lastDays(statsRange);
    const byDay = sessionsByDay();
    const days = keys.map((k) => {
      const list = byDay[k] || [];
      const sp = splitStats(list);
      return {
        k,
        list,
        count: list.length,
        in: Math.round(sp.min.in),
        out: Math.round(sp.min.out),
        none: Math.round(sp.min.none),
        min: Math.round(sp.total),
        focus: list.length ? weightedAvg(list, 'focus') : null,
        effect: list.length ? weightedAvg(list, 'effect') : null,
      };
    });
    const all = days.flatMap((d) => d.list);
    const totalMin = all.reduce((a, s) => a + s.activeMin, 0);
    const activeDays = days.filter((d) => d.count).length;

    const bySubj = {};
    for (const s of all) (bySubj[s.subject] = bySubj[s.subject] || []).push(s);
    const subjRows = Object.entries(bySubj)
      .map(([id, list]) => ({ id, list, sp: splitStats(list), min: list.reduce((a, s) => a + s.activeMin, 0), effect: weightedAvg(list, 'effect'), focus: weightedAvg(list, 'focus') }))
      .sort((a, b) => b.min - a.min);
    const maxSubj = subjRows.length ? subjRows[0].min : 1;

    const insights = [];
    const rated = subjRows.filter((r) => r.list.length >= 2);
    if (rated.length >= 2) {
      const best = rated.reduce((a, b) => (b.effect > a.effect ? b : a));
      const worst = rated.reduce((a, b) => (b.effect < a.effect ? b : a));
      if (best.id !== worst.id) {
        insights.push(`🏆 学习效果最好的是 <b>${esc(getSubject(best.id).name)}</b>（${best.effect} 分）；<b>${esc(getSubject(worst.id).name)}</b> 相对薄弱（${worst.effect} 分），可以多做错题整理和复习。`);
      }
    }
    const scored = days.filter((d) => d.focus != null);
    if (scored.length >= 4) {
      const half = Math.floor(scored.length / 2);
      const avg = (arr) => arr.reduce((a, d) => a + d.focus, 0) / arr.length;
      const diff = Math.round(avg(scored.slice(half)) - avg(scored.slice(0, half)));
      if (diff >= 3) insights.push(`📈 最近专注度比前段时间提高了 ${diff} 分，继续保持！`);
      else if (diff <= -3) insights.push(`📉 最近专注度下降了 ${-diff} 分，注意休息，学习时把手机放远一点。`);
      else insights.push('➖ 专注度保持平稳。');
    }
    if (subjRows.length && subjRows[0].min / Math.max(totalMin, 1) > 0.6 && subjRows.length < 3) {
      insights.push(`⚖️ 这段时间大部分时间都花在 ${esc(getSubject(subjRows[0].id).name)} 上，记得兼顾其他科目哦。`);
    }
    const rangeSp = splitStats(all);
    if (all.length >= 3 && rangeSp.total > 0 && rangeSp.min.out / rangeSp.total < 0.1 && rangeSp.min.in > 0) {
      insights.push('📚 这段时间几乎都是课内学习，有余力的话可以安排一点课外拓展。');
    }

    const hasNone = subjRows.some((r) => r.sp.min.none > 0);
    const segW = (r, k) => (r.sp.min[k] > 0 ? Math.max(1, (r.sp.min[k] / maxSubj) * 100) : 0);
    el.innerHTML = `
      ${overviewCards()}
      <div class="card row">
        <b>阶段统计</b><span class="spacer"></span>
        <div class="seg" role="group" aria-label="统计范围">
          <button class="${statsRange === 7 ? 'active' : ''}" data-act="range" data-v="7">近 7 天</button>
          <button class="${statsRange === 30 ? 'active' : ''}" data-act="range" data-v="30">近 30 天</button>
        </div>
      </div>
      <div class="card">
        <div class="kpis" style="margin-top:0">
          <div class="kpi"><div class="kpi-label">总学习时长</div><div class="kpi-value">${(totalMin / 60).toFixed(1)}<small>小时</small></div></div>
          <div class="kpi"><div class="kpi-label">学习天数 / 次数</div><div class="kpi-value">${activeDays}<small>天</small> ${all.length}<small>次</small></div></div>
          <div class="kpi"><div class="kpi-label">平均专注度</div><div class="kpi-value">${all.length ? weightedAvg(all, 'focus') : '–'}</div></div>
          <div class="kpi"><div class="kpi-label">平均学习效果</div><div class="kpi-value">${all.length ? weightedAvg(all, 'effect') : '–'}</div></div>
        </div>
        ${insights.length ? insights.map((x) => `<div class="insight">${x}</div>`).join('') : ''}
      </div>
      ${scopeSplitCard(all, `近 ${statsRange} 天 课内 / 课外`, '阶段')}
      ${all.length ? `
      <div class="grid-2">
        <div class="card"><h3 class="card-title">每日学习时长 <small>分钟</small></h3><div class="chart-slot" data-chart="minutes"></div></div>
        <div class="card"><h3 class="card-title">专注度与学习效果 <small>每日平均分</small></h3><div class="chart-slot" data-chart="score"></div></div>
      </div>
      <div class="card">
        <h3 class="card-title">各科学习时长 <small>课内 / 课外</small></h3>
        <div class="legend"><span><i class="sw seg-in"></i>课内</span><span><i class="sw seg-out"></i>课外</span>${hasNone ? '<span><i class="sw seg-none"></i>未标记</span>' : ''}</div>
        <div class="hbar-list">${subjRows.map((r) => {
          const s = getSubject(r.id);
          const split = [['in', '课内'], ['out', '课外'], ['none', '未标记']].filter(([k]) => r.sp.min[k] > 0).map(([k, n]) => `${n} ${fmtMin(r.sp.min[k])}`).join(' · ');
          return `<div class="hbar">
            <div class="hbar-top"><span class="hbar-name">${esc(s.emoji)} ${esc(s.name)}</span><span class="hbar-val">${fmtMin(r.min)} · ${r.list.length}次 · 效果 ${r.effect}</span></div>
            <div class="hbar-track">${['in', 'out', 'none'].map((k) => (segW(r, k) ? `<i class="seg-${k}" style="width:${segW(r, k)}%"></i>` : '')).join('')}</div>
            <div class="hbar-split">${split}</div>
          </div>`;
        }).join('')}</div>
        <details class="table-view"><summary>查看每日数据表</summary>
          <table class="data"><thead><tr><th>日期</th><th>课内(分)</th><th>课外(分)</th><th>合计</th><th>次数</th><th>专注</th><th>效果</th></tr></thead>
          <tbody>${days.slice().reverse().map((d) => `<tr><td>${dayLabel(d.k)}</td><td>${d.in}</td><td>${d.out}</td><td>${d.min}</td><td>${d.count}</td><td>${d.focus ?? '–'}</td><td>${d.effect ?? '–'}</td></tr>`).join('')}</tbody></table>
        </details>
      </div>` : `<div class="card empty"><div class="big">📊</div>这段时间还没有学习记录，学习后这里会显示图表</div>`}`;
    // 按容器实际宽度绘制，保证文字大小不随缩放变化
    $$('.chart-slot', el).forEach((slot) => {
      const w = Math.max(280, Math.floor(slot.clientWidth));
      slot.innerHTML = slot.dataset.chart === 'minutes' ? minutesChart(days, w) : scoreChart(days, w);
    });
  }

  function onChartHover(e) {
    if (!(e.target instanceof Element)) return;
    const chart = e.target.closest('.chart');
    if (!chart) return;
    const tip = $('.tooltip', chart);
    const line = $('.hover-line', chart);
    const hit = e.target.closest('[data-tip]');
    if (!hit || e.type === 'pointerleave') {
      tip.classList.remove('show');
      if (line) line.setAttribute('visibility', 'hidden');
      return;
    }
    const r = chart.getBoundingClientRect();
    tip.textContent = hit.dataset.tip;
    const x = Math.min(Math.max(e.clientX - r.left, 70), r.width - 70);
    tip.style.left = `${x}px`;
    tip.style.top = `${e.clientY - r.top}px`;
    tip.classList.add('show');
    if (line) {
      line.setAttribute('x1', hit.dataset.cx);
      line.setAttribute('x2', hit.dataset.cx);
      line.setAttribute('visibility', 'visible');
    }
  }

  // ---------------- 设置页 ----------------
  function renderSettings() {
    const el = $('#tab-settings');
    const st = state.settings;
    el.innerHTML = `
      <div class="card" id="sync-card"></div>
      <div class="card" id="report-card"></div>
      <div class="card" id="ai-card"></div>
      <div class="card">
        <h3 class="card-title">基本设置</h3>
        <div class="set-row"><label for="s-name">昵称</label><input class="input" id="s-name" maxlength="12" placeholder="同学" value="${esc(st.name)}"></div>
        <div class="set-row"><label for="s-goal">每日学习目标（分钟）</label><input class="input" id="s-goal" type="number" min="10" max="900" step="10" value="${st.goal}"></div>
        <div class="set-row"><label for="s-theme">外观</label>
          <select class="input" id="s-theme">
            <option value="auto" ${st.theme === 'auto' ? 'selected' : ''}>跟随系统</option>
            <option value="light" ${st.theme === 'light' ? 'selected' : ''}>浅色</option>
            <option value="dark" ${st.theme === 'dark' ? 'selected' : ''}>深色</option>
          </select>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">科目管理 <small>勾选的科目会显示在学习页</small></h3>
        <div class="toggle-grid">
          ${allSubjects().map((s) => `
            <label class="toggle-item">
              <input type="checkbox" data-subj="${esc(s.id)}" ${st.hidden.includes(s.id) ? '' : 'checked'}>
              <span>${esc(s.emoji)} ${esc(s.name)}</span>
              ${s.id.startsWith('c_') ? `<button class="del" data-act="del-subj" data-id="${esc(s.id)}" title="删除科目" aria-label="删除 ${esc(s.name)}">✕</button>` : ''}
            </label>`).join('')}
        </div>
        <div class="row" style="margin-top:12px">
          <input class="input" id="new-emoji" style="width:64px;text-align:center" maxlength="2" value="📝" aria-label="科目图标">
          <input class="input" id="new-subj" style="flex:1;min-width:140px" maxlength="8" placeholder="添加科目，如：奥数、编程">
          <button class="btn btn-primary" data-act="add-subj">添加</button>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">数据管理 <small>备份为文件，或从备份文件恢复</small></h3>
        <div class="row">
          <button class="btn" data-act="export">⬇️ 导出备份</button>
          <button class="btn" data-act="import">⬆️ 导入备份</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
          <span class="spacer"></span>
          <button class="btn btn-danger" data-act="clear">清空全部记录</button>
        </div>
      </div>

      <div class="card rules">
        <h3 class="card-title">评分规则说明</h3>
        <p>每次学习结束后，系统根据<b>有效学习时长</b>、<b>暂停/走神次数</b>和<b>学习量</b>自动计算两个分数（满分均为 100）。
        「学习效率」= 学习量 ÷ 参考量，参考量 = 有效分钟数 × 该科目该学习方式的参考速度（例如数学做题约 0.35 题/分钟，英语做题约 0.8 题/分钟，阅读约 0.8 页/分钟），达到参考量的 90% 即得满分。学习量是选填的：没填时，「学习效率」和「学习量达成」这两项会按其他项的得分比例估算，不会因为没填而被扣分。</p>
        <h4>专注度</h4>
        <ul>
          <li>有效时长占比（35 分）：有效学习时间 ÷ 总时间，≥95% 满分，≤50% 不得分</li>
          <li>少走神/少中断（25 分）：每 30 分钟 0 次满分，每多 1 次扣约 6 分</li>
          <li>学习效率（25 分）：见上方说明</li>
          <li>自我评价（15 分）：结束时自评的专注程度</li>
        </ul>
        <h4>学习效果</h4>
        <ul>
          <li>学习量达成（30 分）：与学习效率相同的计算方式</li>
          <li>正确率/掌握度（35 分）：做题类以正确率为主（≥95% 满分，≤40% 不得分），并参考自评掌握程度；其他学习方式按自评掌握程度</li>
          <li>有效学习时长（15 分）：单次有效学习 40 分钟及以上满分，时间越短得分越低</li>
          <li>专注度加成（20 分）：专注度 × 20%</li>
        </ul>
        <h4>等级</h4>
        <ul><li>🌟 优秀 ≥ 90　👍 良好 ≥ 75　🙂 合格 ≥ 60　💪 加油 &lt; 60</li></ul>
      </div>`;
  }

  // ---------------- 云同步界面 ----------------
  function syncStatusText(st) {
    if (st.kind === 'syncing') return '⏳ 正在同步…';
    if (st.kind === 'ok') {
      const n = Cloud.pendingCount(state);
      return `✅ 已同步 · ${fmtHMS(st.at)}${n ? `（还有 ${n} 项待上传）` : ''}`;
    }
    if (st.kind === 'error') return `⚠️ 同步失败：${st.msg}（会自动重试）`;
    return '准备同步…';
  }

  function renderSyncCard() {
    const el = $('#sync-card');
    if (!el) return;
    const st = Cloud.getStatus();
    const u = Cloud.getUser();
    let body;
    if (st.kind === 'unconfigured') {
      body = '<p class="muted small" style="margin:0">还没有配置 Supabase，记录暂时只保存在这台设备上。配置方法见项目 README 的「云同步」一节。</p>';
    } else if (st.kind === 'unavailable') {
      body = `<p class="err" style="margin:0">${esc(st.msg)}</p>`;
    } else if (st.kind === 'loading' || st.kind === 'off') {
      body = '<p class="muted small" style="margin:0">正在连接云端…</p>';
    } else if (!u) {
      body = `
        <form id="auth-form" class="auth-form" novalidate>
          <input class="input" name="email" type="email" autocomplete="email" placeholder="邮箱" value="${esc(authDraft.email)}" aria-label="邮箱">
          <input class="input" name="password" type="password" autocomplete="current-password" placeholder="密码（至少 6 位）" value="${esc(authDraft.password)}" aria-label="密码">
          <div class="row">
            <button class="btn btn-primary" type="submit">登录</button>
            <button class="btn" type="button" data-act="signup">注册新账号</button>
            <span class="spacer"></span>
            <button class="btn btn-ghost small" type="button" data-act="forgot">忘记密码</button>
          </div>
          <div class="auth-msg" id="auth-msg" role="status"></div>
          <p class="muted small" style="margin:0">登录后，这台设备上的记录会自动上传并与其他设备合并；手机、电脑用同一个账号登录即可同步。</p>
        </form>`;
    } else {
      body = `
        <div class="row">
          <div>
            <div>已登录：<b>${esc(u.email || '')}</b></div>
            <div class="small ${st.kind === 'error' ? 'err' : 'muted'}">${esc(syncStatusText(st))}</div>
          </div>
          <span class="spacer"></span>
          <button class="btn" data-act="sync-now" ${st.kind === 'syncing' ? 'disabled' : ''}>🔄 立即同步</button>
          <button class="btn btn-ghost" data-act="signout">退出登录</button>
        </div>`;
    }
    el.innerHTML = `<h3 class="card-title">☁️ 云同步 <small>多台设备共用学习记录</small></h3>${body}`;
    renderReportCard();
  }

  // ---------------- AI 评估设置 ----------------
  let aiMsg = { text: '', tone: '' };
  let aiModels = [];

  function aiStatusLine() {
    if (!ai.enabled) return '';
    const bad = AI.validateConfig(aiCurrent());
    return bad ? `⚠️ 还没配置完整：${bad}。配置好之前会用默认算法评分。` : '✅ 已就绪：每次学习结束后会自动用 AI 评分。';
  }

  function renderAiCard() {
    const el = $('#ai-card');
    if (!el) return;
    const p = AI.getProvider(ai.provider);
    const c = ai.configs[ai.provider];
    const models = Array.from(new Set(p.models.concat(aiModels)));
    el.innerHTML = `
      <h3 class="card-title">🤖 AI 评估 <small>用大模型评估专注度和学习效果</small></h3>
      <label class="switch-row">
        <input type="checkbox" id="ai-enabled" ${ai.enabled ? 'checked' : ''}>
        <span>每次学习结束后，让 AI 根据学习量、时长、走神情况、正确率等评分并点评（没开启或评估失败时，用默认算法评分）</span>
      </label>
      <div class="ai-status-line small" id="ai-status-line">${esc(aiStatusLine())}</div>
      <div class="field" style="margin-top:12px">
        <label for="ai-provider">大模型服务商</label>
        <select class="input" id="ai-provider">${AI.PROVIDERS.map((x) => `<option value="${x.id}" ${x.id === ai.provider ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label for="ai-base">接口地址</label>
        <input class="input" id="ai-base" value="${esc(c.baseUrl)}" placeholder="https://…/v1" autocomplete="off" spellcheck="false">
      </div>
      <div class="field">
        <label for="ai-model">模型名称</label>
        <div class="row" style="flex-wrap:nowrap">
          <input class="input" id="ai-model" list="ai-models" value="${esc(c.model)}" placeholder="${esc(p.models[0] || '模型名称')}" autocomplete="off" spellcheck="false" style="flex:1;min-width:0">
          <button class="btn small" type="button" data-act="ai-models">获取列表</button>
        </div>
        <datalist id="ai-models">${models.map((m) => `<option value="${esc(m)}"></option>`).join('')}</datalist>
        ${p.modelHint ? `<div class="help">${esc(p.modelHint)}</div>` : ''}
      </div>
      <div class="field">
        <label for="ai-key">API 密钥</label>
        <div class="row" style="flex-wrap:nowrap">
          <input class="input" id="ai-key" type="password" value="${esc(c.key)}" placeholder="sk-…" autocomplete="off" spellcheck="false" style="flex:1;min-width:0">
          <button class="btn small" type="button" data-act="ai-showkey">显示</button>
        </div>
        <div class="help">${p.keyUrl ? `在 <a href="${esc(p.keyUrl)}" target="_blank" rel="noopener noreferrer">服务商控制台</a> 创建密钥。` : ''}密钥只保存在这台设备的浏览器里，不会上传云端、也不在备份文件里；退出登录时会清除。</div>
      </div>
      <div class="row">
        <button class="btn btn-primary" type="button" data-act="ai-test">测试连接</button>
        <button class="btn btn-ghost" type="button" data-act="ai-clearkey">清除密钥</button>
        <span class="small report-msg ${aiMsg.tone}" id="ai-msg" role="status">${esc(aiMsg.text)}</span>
      </div>
      <p class="muted small" style="margin:10px 0 0">隐私提示：开启后，每次学习结束时，这次学习的科目、时长、学习量、自评分和你填写的学习内容会发送给所选的大模型服务商用于评分，可能产生少量接口费用。</p>`;
  }

  function setAiMsg(text, tone) {
    aiMsg = { text, tone: tone || '' };
    const m = $('#ai-msg');
    if (m) {
      m.textContent = text;
      m.className = `small report-msg ${tone || ''}`;
    }
  }

  function aiFieldChanged(id, value) {
    const c = ai.configs[ai.provider];
    if (id === 'ai-base') c.baseUrl = value.trim();
    else if (id === 'ai-model') c.model = value.trim();
    else c.key = value.trim();
    saveAi();
    const line = $('#ai-status-line');
    if (line) line.textContent = aiStatusLine();
  }

  async function testAi(btn) {
    if (btn) btn.disabled = true;
    setAiMsg('正在测试…', 'live');
    try {
      const r = await AI.testConnection(aiCurrent());
      setAiMsg(`✅ 连接成功（${(r.ms / 1000).toFixed(1)} 秒），模型回复：${r.reply || '（空）'}`, 'ok');
    } catch (e) {
      setAiMsg(e.message || '连接失败', 'err');
    } finally {
      if (btn && btn.isConnected) btn.disabled = false;
    }
  }

  async function loadAiModels(btn) {
    const bad = AI.validateConfig(aiCurrent());
    if (bad) return setAiMsg(`请先填好：${bad}`, 'err');
    if (btn) btn.disabled = true;
    setAiMsg('正在获取模型列表…', 'live');
    try {
      aiModels = await AI.listModels(aiCurrent());
      renderAiCard();
      setAiMsg(`获取到 ${aiModels.length} 个模型，点一下模型名称输入框就能选择。`, 'ok');
    } catch (e) {
      setAiMsg(`没能获取模型列表（${e.message}）。直接手动填写模型名称也可以。`, 'err');
      if (btn && btn.isConnected) btn.disabled = false;
    }
  }

  // ---------------- 每晚学习日报 ----------------
  let reportMsg = { text: '', tone: '' };

  function renderReportCard() {
    const el = $('#report-card');
    if (!el) return;
    // 云端函数和定时任务部署好之后，在 js/config.js 里把 dailyReport 设为 true 才会显示这张卡片
    el.hidden = !(window.STUDY_CONFIG && window.STUDY_CONFIG.dailyReport);
    if (el.hidden) return;
    const u = Cloud.getUser();
    let body;
    if (!Cloud.isConfigured()) {
      body = '<p class="muted small" style="margin:0">需要先配置云同步才能使用。</p>';
    } else if (!u) {
      body = '<p class="muted small" style="margin:0">登录上面的云同步账号后，就可以每晚自动收到当天的学习日报。</p>';
    } else {
      body = `
        <label class="switch-row">
          <input type="checkbox" id="s-report" ${state.settings.reportEnabled ? 'checked' : ''}>
          <span>每晚 23:30（北京时间）把当天的学习记录发到 <b>${esc(u.email || '')}</b></span>
        </label>
        <div class="row" style="margin-top:10px">
          <button class="btn" data-act="report-test">✉️ 发送一封测试邮件</button>
          <span class="small report-msg ${reportMsg.tone}" id="report-msg" role="status">${esc(reportMsg.text)}</span>
        </div>
        <p class="muted small" style="margin:10px 0 0">内容包括：总学习时间、各科时长、平均专注度和学习效果、每次学习的明细和你填的学习内容。当天没有学习也会发一封“今天没有学习记录”。邮件由云端发送，不用开着网页。</p>`;
    }
    el.innerHTML = `<h3 class="card-title">📧 每晚学习日报 <small>自动发到邮箱</small></h3>${body}`;
  }

  function setReportMsg(text, tone) {
    reportMsg = { text, tone: tone || '' };
    const m = $('#report-msg');
    if (m) {
      m.textContent = text;
      m.className = `small report-msg ${tone || ''}`;
    }
  }

  async function sendTestReport(btn) {
    if (btn) btn.disabled = true;
    try {
      setReportMsg('正在把最新记录同步到云端…', 'live');
      await Cloud.syncNow();
      const st = Cloud.getStatus();
      if (st.kind === 'error') throw new Error(`记录还没能同步到云端：${st.msg}`);
      setReportMsg('正在发送…', 'live');
      const r = await Cloud.sendTestReport();
      setReportMsg(`已发送到 ${r.to}（今天共 ${r.count} 条学习记录），请查收；没看到的话再看看垃圾邮件。`, 'ok');
    } catch (e) {
      setReportMsg(e.message || '发送失败', 'err');
    } finally {
      if (btn && btn.isConnected) btn.disabled = false;
    }
  }

  function renderSyncChip() {
    const chip = $('#sync-chip');
    const st = Cloud.getStatus();
    const u = Cloud.getUser();
    let text = '';
    let cls = '';
    if (['unconfigured', 'off', 'loading'].includes(st.kind)) text = '';
    else if (st.kind === 'unavailable') { text = '⚠️ 同步不可用'; cls = 'bad'; }
    else if (!u) { text = '☁️ 未登录'; cls = 'muted'; }
    else if (st.kind === 'error') { text = '⚠️ 同步失败'; cls = 'bad'; }
    else if (st.kind === 'ok') { text = '☁️ 已同步'; cls = 'good'; }
    else text = '☁️ 同步中';
    chip.hidden = !text;
    chip.textContent = text;
    chip.className = `sync-chip ${cls}`;
  }

  function authMsg(text, ok) {
    const m = $('#auth-msg');
    if (!m) return toast(text);
    m.textContent = text;
    m.className = `auth-msg ${ok ? 'ok' : 'err'}`;
  }

  function readAuthForm() {
    const f = $('#auth-form');
    if (f) authDraft = { email: f.email.value.trim(), password: f.password.value };
    return authDraft;
  }

  async function authAction(kind, btn) {
    const { email, password } = readAuthForm();
    if (!email) return authMsg('请填写邮箱');
    if (kind !== 'forgot' && password.length < 6) return authMsg('密码至少需要 6 位');
    if (btn) btn.disabled = true;
    try {
      if (kind === 'in') {
        await Cloud.signIn(email, password);
        authDraft = { email: '', password: '' };
        toast('登录成功，正在同步');
      } else if (kind === 'up') {
        const r = await Cloud.signUp(email, password);
        if (r.needConfirm) authMsg('注册成功！请到邮箱点击确认链接，然后回到这里登录。', true);
        else { authDraft = { email: '', password: '' }; toast('注册成功，已登录'); }
      } else {
        await Cloud.resetPassword(email);
        authMsg('重置密码的邮件已发送，请查收邮箱。', true);
      }
    } catch (e) {
      authMsg(e.message);
    } finally {
      if (btn && btn.isConnected) btn.disabled = false;
    }
  }

  async function signOut() {
    const ok = await Cloud.signOut((n) => confirm(`还有 ${n} 项改动没能同步到云端，退出后这些改动会丢失。确定退出吗？`));
    if (ok) toast('已退出登录，本机记录已清除');
  }

  function openRecovery() {
    openModal(`
      <h3>设置新密码</h3>
      <form id="recovery-form" novalidate>
        <div class="field"><input class="input" name="password" type="password" autocomplete="new-password" placeholder="新密码（至少 6 位）" aria-label="新密码"></div>
        <div class="err" id="recovery-err"></div>
        <div class="form-actions"><button type="button" class="btn" data-act="close">取消</button><button type="submit" class="btn btn-primary">保存</button></div>
      </form>`);
  }

  async function submitRecovery(f) {
    const pw = f.password.value;
    if (pw.length < 6) { $('#recovery-err').textContent = '密码至少需要 6 位'; return; }
    try {
      await Cloud.updatePassword(pw);
      closeModal();
      toast('新密码已保存');
    } catch (e) {
      $('#recovery-err').textContent = e.message;
    }
  }

  function onCloudStatus() {
    renderSyncChip();
    if (currentTab === 'settings') {
      const a = document.activeElement;
      if (!(a && a.closest && a.closest('#auth-form'))) renderSyncCard();
    }
    const u = Cloud.getUser();
    const uid = u ? u.id : null;
    if (uid !== lastUid) {
      lastUid = uid;
      if (currentTab === 'settings') renderSyncCard();
      if (currentTab === 'study' && !state.running) renderStudy();
    }
  }

  function onCloudData() {
    applyTheme();
    const a = document.activeElement;
    // 正在输入时不刷新页面，避免打断
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.closest('#tab-settings, #modal')) return;
    renderCurrent();
    if (state.running && !state.running.end && currentTab === 'study') updateClock();
  }

  function resetLocal() {
    const keep = { theme: state.settings.theme, last: state.last };
    state = defaults();
    state.settings.theme = keep.theme;
    state.last = keep.last;
    form = null;
    expanded.clear();
    ai = AI.emptyConfig(); // 退出登录时一并清除 AI 密钥，方便在公用设备上使用
    saveAi();
    if (!$('#modal').hidden) closeModal();
    persist();
    applyTheme();
    renderCurrent();
  }

  function applyTheme() {
    const t = state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }

  function addSubject() {
    const name = $('#new-subj').value.trim();
    const emoji = $('#new-emoji').value.trim() || '📝';
    if (!name) return toast('请输入科目名称');
    if (allSubjects().some((s) => s.name === name)) return toast('这个科目已经有了');
    const palette = ['#1c7ed6', '#e8590c', '#0ca678', '#7048e8', '#d6336c', '#f08c00', '#1098ad', '#5c940d'];
    state.settings.custom.push({
      id: `c_${Date.now().toString(36)}`, name, emoji, color: palette[state.settings.custom.length % palette.length], quiz: 0.5,
    });
    markSettings();
    save();
    renderSettings();
    toast(`已添加科目：${name}`);
  }

  function deleteSubject(id) {
    const s = getSubject(id);
    const used = state.sessions.some((x) => x.subject === id) || (state.running && state.running.subject === id);
    if (!confirm(`删除科目「${s.name}」？${used ? '\n已有的学习记录会保留，但会显示为「已删除科目」。' : ''}`)) return;
    state.settings.custom = state.settings.custom.filter((x) => x.id !== id);
    state.settings.hidden = state.settings.hidden.filter((x) => x !== id);
    if (state.last.subject === id) state.last.subject = 'math';
    markSettings();
    save();
    renderSettings();
  }

  function exportData() {
    const data = JSON.stringify({ app: 'gavin-study', exportedAt: new Date().toISOString(), sessions: state.sessions, settings: state.settings }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `学习记录备份-${dayKey(Date.now())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function validSession(s) {
    return s && typeof s.id === 'string' && typeof s.subject === 'string' && Number.isFinite(s.start) && Number.isFinite(s.end) &&
      Number.isFinite(s.activeMin) && Number.isFinite(s.focus) && Number.isFinite(s.effect);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const list = (data.sessions || []).filter(validSession);
        const have = new Set(state.sessions.map((s) => s.id));
        const add = list.filter((s) => !have.has(s.id));
        state.sessions = state.sessions.concat(add);
        add.forEach((x) => markSession(x.id));
        if (data.settings && Array.isArray(data.settings.custom)) {
          const ids = new Set(state.settings.custom.map((c) => c.id));
          for (const c of data.settings.custom) {
            if (c && typeof c.id === 'string' && typeof c.name === 'string' && !ids.has(c.id)) {
              state.settings.custom.push(c);
              markSettings();
            }
          }
        }
        save();
        renderCurrent();
        toast(`导入完成：新增 ${add.length} 条记录`);
      } catch (e) {
        toast('导入失败：文件格式不正确');
      }
    };
    reader.readAsText(file);
  }

  function clearAll() {
    const cloud = Cloud.getUser() ? '（云端的记录也会一起删除）' : '';
    if (!confirm(`确定清空全部学习记录吗？${cloud}此操作无法撤销，建议先导出备份。`)) return;
    state.sessions.forEach((x) => markDeleted(x.id));
    state.sessions = [];
    save();
    renderCurrent();
    toast('已清空');
  }

  // ---------------- 弹窗 / 提示 ----------------
  // 手机浏览器的 100vh 包含了地址栏、工具栏和键盘占的位置，弹窗按“实际可见区域”来定位和定高
  function fitModal() {
    const m = $('#modal');
    if (!m || m.hidden) return;
    const vv = window.visualViewport;
    m.style.top = `${vv ? vv.offsetTop : 0}px`;
    m.style.height = `${vv ? vv.height : window.innerHeight}px`;
  }

  function openModal(html) {
    const m = $('#modal');
    $('.modal-sheet', m).innerHTML = html;
    m.hidden = false;
    fitModal();
    document.body.style.overflow = 'hidden';
  }

  // 填写结束表单时点“返回主页”：内容先留着，回到主页，随时可以回来继续
  function hideForm() {
    readFormInputs();
    closeModal();
    renderStudy();
    toast('已回到主页。这次学习还没保存，点「填写并保存」继续');
  }

  function dismissModal() {
    if ($('#finish-form')) hideForm();
    else closeModal();
  }
  function closeModal() {
    stopCapture();
    resultView = null;
    $('#modal').hidden = true;
    document.body.style.overflow = '';
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------------- 页面切换 ----------------
  function renderCurrent() {
    if (currentTab === 'study') renderStudy();
    else if (currentTab === 'history') renderHistory();
    else if (currentTab === 'stats') renderStats();
    else { renderSettings(); renderSyncCard(); renderAiCard(); }
  }
  function switchTab(tab) {
    currentTab = tab;
    $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
    renderCurrent();
    window.scrollTo(0, 0);
  }

  // ---------------- 事件 ----------------
  document.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.tab');
    if (tabBtn) return switchTab(tabBtn.dataset.tab);
    if (e.target.classList.contains('modal-backdrop')) return dismissModal();
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    switch (act) {
      case 'subject': state.last.subject = id; save(); renderStudy(); break;
      case 'type': state.last.type = id; save(); renderStudy(); break;
      case 'start': startStudy(btn.dataset.scope); break;
      case 'form-scope': readFormInputs(); form.scope = btn.dataset.v === 'out' ? 'out' : 'in'; renderFinishForm(); break;
      case 'set-scope': setScope(id, btn.dataset.v); break;
      case 'pause': togglePause(); break;
      case 'end': endStudy(); break;
      case 'discard': discardStudy(); break;
      case 'back': resumeFromForm(); break;
      case 'hide-form': hideForm(); break;
      case 'open-form': openFinishForm(); break;
      case 'voice': toggleVoice(); break;
      case 'photo': if (!cap.busy) $('#photo-input').click(); break;
      case 'rate': readFormInputs(); form[btn.dataset.field] = Number(btn.dataset.v); renderFinishForm(); break;
      case 'step': {
        readFormInputs();
        form.interruptions = Math.max(0, Math.min(99, form.interruptions + Number(btn.dataset.d)));
        $('#f-int').textContent = form.interruptions;
        break;
      }
      case 'close': closeModal(); break;
      case 'toggle': expanded.has(id) ? expanded.delete(id) : expanded.add(id); renderCurrent(); break;
      case 'detail': { const s = state.sessions.find((x) => x.id === id); if (s) showResult(s, false); break; }
      case 'delete': deleteSession(id); break;
      case 'range': statsRange = Number(btn.dataset.v); renderStats(); break;
      case 'add-subj': e.preventDefault(); addSubject(); break;
      case 'del-subj': e.preventDefault(); deleteSubject(id); break;
      case 'export': exportData(); break;
      case 'import': $('#import-file').click(); break;
      case 'clear': clearAll(); break;
      case 'signup': authAction('up', btn); break;
      case 'forgot': authAction('forgot', btn); break;
      case 'signout': signOut(); break;
      case 'sync-now': Cloud.syncNow(); break;
      case 'report-test': sendTestReport(btn); break;
      case 'ai-test': testAi(btn); break;
      case 'ai-models': loadAiModels(btn); break;
      case 'ai-showkey': { const k = $('#ai-key'); const show = k.type === 'password'; k.type = show ? 'text' : 'password'; btn.textContent = show ? '隐藏' : '显示'; break; }
      case 'ai-clearkey': ai.configs[ai.provider].key = ''; saveAi(); aiMsg = { text: '', tone: '' }; renderAiCard(); toast('已清除这个服务商的密钥'); break;
      case 'ai-eval': runAi(id); break;
      case 'goto-sync': switchTab('settings'); $('#sync-card').scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
      default: break;
    }
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'finish-form') {
      e.preventDefault();
      submitFinish();
    } else if (e.target.id === 'auth-form') {
      e.preventDefault();
      authAction('in', $('button[type=submit]', e.target));
    } else if (e.target.id === 'recovery-form') {
      e.preventDefault();
      submitRecovery(e.target);
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'photo-input') { const f = t.files[0]; t.value = ''; recognizePhoto(f); return; }
    if (t.id === 'voice-lang') { form.voiceLang = t.value; if (cap.listening) Capture.voice.stop(); return; }
    if (t.id === 'history-scope') { historyScope = t.value; renderHistory(); return; }
    if (t.id === 'history-filter') { historyFilter = t.value; renderHistory(); return; }
    if (t.id === 'import-file' && t.files[0]) { importData(t.files[0]); t.value = ''; return; }
    if (t.id === 's-name') { state.settings.name = t.value.trim(); markSettings(); save(); toast('昵称已保存'); return; }
    if (t.id === 's-goal') {
      const v = Math.round(Number(t.value));
      if (Number.isFinite(v) && v >= 10 && v <= 900) { state.settings.goal = v; markSettings(); save(); toast('每日目标已保存'); }
      else { t.value = state.settings.goal; toast('目标需在 10–900 分钟之间'); }
      return;
    }
    if (t.id === 'ai-enabled') {
      ai.enabled = t.checked;
      saveAi();
      const line = $('#ai-status-line');
      if (line) line.textContent = aiStatusLine();
      toast(t.checked ? '已开启 AI 评估' : '已关闭 AI 评估，改用默认算法评分');
      return;
    }
    if (t.id === 'ai-provider') {
      ai.provider = t.value;
      aiModels = [];
      aiMsg = { text: '', tone: '' };
      saveAi();
      renderAiCard();
      return;
    }
    if (t.id === 's-report') {
      state.settings.reportEnabled = t.checked;
      markSettings();
      save();
      toast(t.checked ? '已开启：每晚 23:30 发送学习日报' : '已关闭学习日报');
      return;
    }
    if (t.id === 's-theme') { state.settings.theme = t.value; markSettings(); save(); applyTheme(); return; }
    if (t.dataset.subj) {
      const sid = t.dataset.subj;
      const hidden = state.settings.hidden.filter((x) => x !== sid);
      if (!t.checked) hidden.push(sid);
      state.settings.hidden = hidden;
      markSettings();
      save();
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.closest('#auth-form')) readAuthForm();
    if (['ai-base', 'ai-model', 'ai-key'].includes(e.target.id)) aiFieldChanged(e.target.id, e.target.value);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'new-subj') addSubject();
    if (e.key === 'Escape' && !$('#modal').hidden) dismissModal();
  });

  // 键盘弹出、地址栏伸缩时，弹窗跟着可见区域变化；输入框获得焦点时滚到可见位置
  window.addEventListener('resize', fitModal);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitModal);
    window.visualViewport.addEventListener('scroll', fitModal);
  }
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName) && t.closest && t.closest('.modal-sheet')) {
      setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
    }
  });

  document.addEventListener('pointermove', onChartHover);
  document.addEventListener('pointerleave', onChartHover, true);
  document.addEventListener('visibilitychange', updateClock);
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (currentTab === 'stats') renderStats(); }, 200);
  });

  // 其他标签页修改数据时同步
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    state = load();
    applyTheme();
    renderCurrent();
  });

  // ---------------- 启动 ----------------
  applyTheme();
  renderStudy();
  if (state.running && state.running.end) openFinishForm();
  setInterval(updateClock, 250);
  Cloud.init({ getState: () => state, persist, onData: onCloudData, onStatus: onCloudStatus, resetLocal, onRecovery: openRecovery });
})();
