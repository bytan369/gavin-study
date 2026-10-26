/*
 * 云同步（Supabase）。
 * 本地 localStorage 仍是主存储，登录后把改动上传到 Supabase，并定期拉取其他设备的改动。
 * 合并相关的纯函数可在 Node 中测试。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Cloud = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.min.js';
  const PAGE = 1000;
  const OVERLAP_MS = 10000;

  // ---------------- 纯函数 ----------------
  function emptySync() {
    return { owner: null, lastPull: null, profileAt: null, dirtySessions: [], tombstones: [], dirtySettings: false, dirtyRunning: false };
  }

  function ensureSync(state) {
    state.sync = Object.assign(emptySync(), state.sync);
    return state.sync;
  }

  function validRunning(r) {
    return !!r && typeof r === 'object' && typeof r.subject === 'string' && typeof r.type === 'string' &&
      Number.isFinite(r.start) && Array.isArray(r.pauses);
  }

  // 上传计时状态时去掉「结束表单」的临时字段，其他设备仍看到计时进行中
  function serializeRunning(run) {
    if (!validRunning(run)) return null;
    const pauses = run.pauses.map((p) => ({ start: p.start, end: p.end || null }));
    if (run.closedAtEnd && pauses.length) pauses[pauses.length - 1].end = null;
    return { subject: run.subject, type: run.type, start: run.start, pauses };
  }

  function sanitizeSettings(remote, local) {
    const out = Object.assign({}, local);
    if (!remote || typeof remote !== 'object') return out;
    if (typeof remote.name === 'string') out.name = remote.name.slice(0, 12);
    if (Number.isFinite(remote.goal) && remote.goal >= 10 && remote.goal <= 900) out.goal = remote.goal;
    if (['auto', 'light', 'dark'].includes(remote.theme)) out.theme = remote.theme;
    if (Array.isArray(remote.hidden)) out.hidden = remote.hidden.filter((x) => typeof x === 'string');
    if (Array.isArray(remote.custom)) {
      out.custom = remote.custom.filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string');
    }
    return out;
  }

  // 合并云端的学习记录；本地尚未上传的修改优先，云端的删除优先
  function mergeRemoteSessions(state, rows) {
    const sync = ensureSync(state);
    let changed = false;
    for (const row of rows) {
      if (!row || typeof row.id !== 'string') continue;
      const idx = state.sessions.findIndex((s) => s.id === row.id);
      if (row.deleted) {
        if (idx >= 0) {
          state.sessions.splice(idx, 1);
          changed = true;
        }
        sync.dirtySessions = sync.dirtySessions.filter((id) => id !== row.id);
        continue;
      }
      if (sync.dirtySessions.includes(row.id) || sync.tombstones.includes(row.id)) continue;
      if (!row.data || typeof row.data !== 'object' || !Number.isFinite(row.data.start)) continue;
      const data = Object.assign({}, row.data, { id: row.id });
      if (idx < 0) {
        state.sessions.push(data);
        changed = true;
      } else if (JSON.stringify(state.sessions[idx]) !== JSON.stringify(data)) {
        state.sessions[idx] = data;
        changed = true;
      }
    }
    return changed;
  }

  // 应用云端的设置和计时状态；本地有未上传的修改或正在填写结束表单时保留本地
  function applyRemoteProfile(state, row) {
    const sync = ensureSync(state);
    if (!row || row.updated_at === sync.profileAt) return false;
    let changed = false;
    if (!sync.dirtySettings && row.settings && Object.keys(row.settings).length) {
      const next = sanitizeSettings(row.settings, state.settings);
      if (JSON.stringify(next) !== JSON.stringify(state.settings)) {
        state.settings = next;
        changed = true;
      }
    }
    const formOpen = !!(state.running && state.running.end);
    if (!sync.dirtyRunning && !formOpen) {
      const next = validRunning(row.running) ? serializeRunning(row.running) : null;
      if (JSON.stringify(next) !== JSON.stringify(serializeRunning(state.running))) {
        state.running = next;
        changed = true;
      }
    }
    sync.profileAt = row.updated_at;
    return changed;
  }

  function pendingCount(state) {
    const s = ensureSync(state);
    return s.dirtySessions.length + s.tombstones.length + (s.dirtySettings ? 1 : 0) + (s.dirtyRunning ? 1 : 0);
  }

  function translateError(e) {
    const msg = (e && (e.message || e.error_description || e.msg)) || String(e);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return '网络未连接';
    if (/Invalid login credentials/i.test(msg)) return '邮箱或密码错误';
    if (/Email not confirmed/i.test(msg)) return '邮箱还没确认，请先点击邮件里的确认链接';
    if (/already registered|already exists/i.test(msg)) return '这个邮箱已经注册过了，请直接登录';
    if (/Password should be at least/i.test(msg)) return '密码至少需要 6 位';
    if (/valid email|invalid format|Unable to validate email/i.test(msg)) return '邮箱格式不正确';
    if (/rate limit|too many/i.test(msg)) return '操作太频繁，请稍后再试';
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return '无法连接云端，请检查网络';
    if (/relation .* does not exist|Could not find the table/i.test(msg)) return '云端数据表不存在，请先运行 supabase/schema.sql';
    if (/JWT|token/i.test(msg)) return '登录已过期，请重新登录';
    return msg;
  }

  // ---------------- 同步控制 ----------------
  let opts = null;
  let client = null;
  let user = null;
  let busy = false;
  let again = false;
  let timer = null;
  let status = { kind: 'off', msg: '', at: null };

  function setStatus(kind, msg) {
    status = { kind, msg: msg || '', at: kind === 'ok' ? Date.now() : status.at };
    if (opts && opts.onStatus) opts.onStatus(status);
  }

  function isConfigured() {
    const c = (typeof window !== 'undefined' && window.STUDY_CONFIG) || {};
    return !!(c.supabaseUrl && c.supabaseAnonKey);
  }

  function loadSdk() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK_URL;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('sdk'));
      document.head.appendChild(s);
    });
  }

  /**
   * opts: getState() 当前状态；persist() 保存到本地（不触发同步）；
   *       onData() 云端数据合并后刷新界面；onStatus(status)；
   *       resetLocal() 清空本地账号数据；onRecovery() 通过重置密码邮件进入时调用
   */
  function init(options) {
    opts = options;
    if (!isConfigured()) {
      setStatus('unconfigured');
      return;
    }
    setStatus('loading');
    loadSdk().then(() => {
      const c = window.STUDY_CONFIG;
      client = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      // 回调里不能直接再调用 supabase 的方法，放到下一轮事件循环
      client.auth.onAuthStateChange((event, session) => setTimeout(() => onAuth(event, session), 0));
      setInterval(() => { if (user && !document.hidden) sync(); }, 30000);
      window.addEventListener('online', () => schedule(0));
      document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); });
    }).catch(() => setStatus('unavailable', '云同步服务加载失败，请检查网络后刷新'));
  }

  function onAuth(event, session) {
    if (event === 'PASSWORD_RECOVERY' && opts.onRecovery) opts.onRecovery();
    const u = session && session.user;
    if (u && (!user || user.id !== u.id)) {
      user = u;
      claim(u.id);
      setStatus('idle');
      sync();
    } else if (u) {
      user = u;
    } else {
      user = null;
      setStatus('out');
    }
  }

  // 本地数据归属当前账号；第一次登录时把本地已有的记录全部上传
  function claim(uid) {
    let sync = ensureSync(opts.getState());
    if (sync.owner && sync.owner !== uid) {
      opts.resetLocal();
      sync = ensureSync(opts.getState());
    }
    if (!sync.owner) {
      const st = opts.getState();
      sync.owner = uid;
      sync.dirtySessions = st.sessions.map((s) => s.id);
      sync.tombstones = [];
      sync.dirtyRunning = !!st.running;
      sync.dirtySettings = false; // 云端已有设置时以云端为准；没有时 pullProfile 会上传本地设置
      sync.lastPull = null;
      sync.profileAt = null;
    }
    opts.persist();
  }

  function schedule(ms) {
    if (!client || !user) return;
    clearTimeout(timer);
    timer = setTimeout(sync, ms == null ? 800 : ms);
  }

  async function sync() {
    if (!client || !user) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    setStatus('syncing');
    try {
      let changed = await pullProfile();
      await push();
      changed = (await pullSessions()) || changed;
      setStatus('ok');
      if (changed) opts.onData();
    } catch (e) {
      setStatus('error', translateError(e));
    } finally {
      busy = false;
      if (again) {
        again = false;
        schedule(300);
      }
    }
  }

  async function pullProfile() {
    const { data, error } = await client.from('study_profile')
      .select('settings,running,updated_at').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    const st = opts.getState();
    if (!data) {
      // 云端还没有资料：上传本地设置
      ensureSync(st).dirtySettings = true;
      opts.persist();
      return false;
    }
    const changed = applyRemoteProfile(st, data);
    opts.persist();
    return changed;
  }

  async function push() {
    const st = opts.getState();
    const sync = ensureSync(st);
    const ids = sync.dirtySessions.slice();
    const tombs = sync.tombstones.slice();
    const rows = [];
    for (const id of ids) {
      const s = st.sessions.find((x) => x.id === id);
      if (s) rows.push({ user_id: user.id, id, data: s, deleted: false });
    }
    for (const id of tombs) rows.push({ user_id: user.id, id, data: {}, deleted: true });
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await client.from('study_sessions').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,id' });
      if (error) throw error;
    }

    const profile = {};
    const settingsSnap = sync.dirtySettings ? JSON.stringify(st.settings) : null;
    const runningSnap = sync.dirtyRunning ? JSON.stringify(serializeRunning(st.running)) : null;
    if (settingsSnap) profile.settings = JSON.parse(settingsSnap);
    if (runningSnap) profile.running = JSON.parse(runningSnap);
    let profileAt = null;
    if (settingsSnap || runningSnap) {
      profile.user_id = user.id;
      const { data, error } = await client.from('study_profile')
        .upsert(profile, { onConflict: 'user_id' }).select('updated_at').single();
      if (error) throw error;
      profileAt = data.updated_at;
    }

    // 只清除已上传的标记；上传期间产生的新修改留到下一轮
    const cur = ensureSync(opts.getState());
    const now = opts.getState();
    cur.dirtySessions = cur.dirtySessions.filter((id) => !ids.includes(id));
    cur.tombstones = cur.tombstones.filter((id) => !tombs.includes(id));
    if (settingsSnap && JSON.stringify(now.settings) === settingsSnap) cur.dirtySettings = false;
    if (runningSnap && JSON.stringify(serializeRunning(now.running)) === runningSnap) cur.dirtyRunning = false;
    if (profileAt) cur.profileAt = profileAt;
    opts.persist();
  }

  async function pullSessions() {
    const since = ensureSync(opts.getState()).lastPull;
    // 往前多取一小段时间，避免并发写入时漏掉记录（合并是幂等的）
    const after = since ? new Date(new Date(since).getTime() - OVERLAP_MS).toISOString() : null;
    let rows = [];
    for (let from = 0; ; from += PAGE) {
      let q = client.from('study_sessions').select('id,data,deleted,updated_at');
      if (after) q = q.gt('updated_at', after);
      const { data, error } = await q.order('updated_at', { ascending: true }).order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      rows = rows.concat(data || []);
      if (!data || data.length < PAGE) break;
    }
    const st = opts.getState();
    const changed = mergeRemoteSessions(st, rows);
    if (rows.length) {
      const latest = rows[rows.length - 1].updated_at;
      if (!since || new Date(latest) > new Date(since)) ensureSync(st).lastPull = latest;
    }
    opts.persist();
    return changed;
  }

  // ---------------- 账号 ----------------
  function redirectUrl() {
    return location.origin + location.pathname;
  }

  async function signIn(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(translateError(error));
  }

  async function signUp(email, password) {
    const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl() } });
    if (error) throw new Error(translateError(error));
    return { needConfirm: !data.session };
  }

  async function resetPassword(email) {
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
    if (error) throw new Error(translateError(error));
  }

  async function updatePassword(password) {
    const { error } = await client.auth.updateUser({ password });
    if (error) throw new Error(translateError(error));
  }

  // 退出前先尽量同步；返回 false 表示用户取消
  async function signOut(confirmLoss) {
    await sync();
    const n = pendingCount(opts.getState());
    if (n && !confirmLoss(n)) return false;
    await client.auth.signOut();
    user = null;
    opts.resetLocal();
    setStatus('out');
    return true;
  }

  return {
    // 纯函数（供测试）
    emptySync, ensureSync, serializeRunning, sanitizeSettings, mergeRemoteSessions, applyRemoteProfile, pendingCount, translateError,
    // 浏览器端
    init, schedule, syncNow: sync, signIn, signUp, resetPassword, updatePassword, signOut, isConfigured,
    getUser: () => user,
    getStatus: () => status,
  };
});
