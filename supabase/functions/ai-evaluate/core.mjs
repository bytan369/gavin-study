// 云端 AI 评估：密钥只存在 Supabase 云端，登录用户共用，网页上不用再填密钥。
// 只接受结构化的学习数据，提示词在云端拼好，不能被当成通用聊天接口使用。
// 依赖（AI 模块、数据库、配置）通过 deps 注入，方便在 Node 里测试；真实接线见 index.ts。

export const DEFAULT_DAILY_LIMIT = 60;
const TZ_OFFSET_MIN = 480; // 按北京时间算“每天”

// 当天（北京时间）零点的 ISO 时间
export function todayStartIso(now) {
  const d = new Date(now + TZ_OFFSET_MIN * 60000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - TZ_OFFSET_MIN * 60000).toISOString();
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

// 只保留提示词需要的字段，限制长度和范围
export function sanitizeInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const subject = str(raw.subject, 20);
  if (!subject) return null;
  const amount = raw.amount === null || raw.amount === undefined || raw.amount === '' ? null : num(raw.amount, 0, 100000);
  return {
    subject,
    type: str(raw.type, 20),
    scopeText: str(raw.scopeText, 40),
    unit: str(raw.unit, 10),
    startClock: str(raw.startClock, 5),
    endClock: str(raw.endClock, 5),
    totalMin: num(raw.totalMin, 0, 1440) ?? 0,
    activeMin: num(raw.activeMin, 0, 1440) ?? 0,
    activePct: num(raw.activePct, 0, 100) ?? 0,
    pauses: num(raw.pauses, 0, 999) ?? 0,
    pausedMin: num(raw.pausedMin, 0, 1440) ?? 0,
    interruptions: num(raw.interruptions, 0, 999) ?? 0,
    amount,
    rate: num(raw.rate, 0, 1000),
    expected: amount === null ? null : num(raw.expected, 0, 100000),
    pacePct: amount === null ? null : num(raw.pacePct, 0, 100000),
    correct: amount === null ? null : num(raw.correct, 0, 100000),
    accuracyPct: amount === null ? null : num(raw.accuracyPct, 0, 100),
    focusSelf: num(raw.focusSelf, 1, 5) ?? 3,
    focusSelfText: str(raw.focusSelfText, 10),
    mastery: num(raw.mastery, 1, 5) ?? 3,
    masteryText: str(raw.masteryText, 10),
    note: str(raw.note, 500),
    ruleFocus: num(raw.ruleFocus, 0, 100) ?? 0,
    ruleEffect: num(raw.ruleEffect, 0, 100) ?? 0,
  };
}

function describe(e) {
  const s = e && e.status;
  if (s === 401 || s === 403) return { status: 502, error: '云端 AI 的密钥不对或已失效，请家长到 Supabase 里检查 AI_API_KEY' };
  if (s === 402) return { status: 502, error: '云端 AI 的账户余额不足' };
  if (s === 429) return { status: 503, error: '云端 AI 太忙或免费额度暂时用完了，稍后再试' };
  if (e && e.code === 'timeout') return { status: 504, error: '云端 AI 等太久了，稍后再试' };
  return { status: 502, error: (e && e.message) || '云端 AI 暂时出错了，稍后再试' };
}

/**
 * req: { bearer: 用户登录令牌, body: { mode: 'status' | 'ping' | 'evaluate', input } }
 * deps: { AI, now(), env: { apiKey, baseUrl, model, provider, dailyLimit }, verifyUser(jwt), countSince(userId, iso), log(userId, kind) }
 */
export async function handle(req, deps) {
  const body = (req && req.body) || {};
  const mode = body.mode || 'evaluate';
  const env = deps.env;
  const cfg = { provider: env.provider, baseUrl: env.baseUrl, model: env.model, key: env.apiKey || '' };

  if (mode === 'status') return { status: 200, json: { configured: !!env.apiKey, model: env.model } };
  if (mode !== 'ping' && mode !== 'evaluate') return { status: 400, json: { error: 'bad request' } };

  const user = req.bearer ? await deps.verifyUser(req.bearer) : null;
  if (!user) return { status: 401, json: { error: '请先登录云同步账号' } };
  if (!env.apiKey) return { status: 503, json: { error: '云端 AI 还没配置好（家长还没有在 Supabase 里填入 AI_API_KEY）' } };

  let input = null;
  if (mode === 'evaluate') {
    input = sanitizeInput(body.input);
    if (!input) return { status: 400, json: { error: '学习数据不完整' } };
  }
  const limit = env.dailyLimit || DEFAULT_DAILY_LIMIT;
  if ((await deps.countSince(user.id, todayStartIso(deps.now()))) >= limit) {
    return { status: 429, json: { error: `今天已经用了 ${limit} 次云端 AI 评估，明天再试（这次先用算法评分）` } };
  }
  await deps.log(user.id, mode);

  try {
    if (mode === 'ping') {
      const r = await deps.AI.testConnection(cfg);
      return { status: 200, json: { ok: true, model: env.model, reply: r.reply, ms: r.ms } };
    }
    const result = await deps.AI.evaluate(cfg, input);
    return { status: 200, json: { ok: true, model: env.model, result } };
  } catch (e) {
    const d = describe(e);
    return { status: d.status, json: { error: d.error } };
  }
}
