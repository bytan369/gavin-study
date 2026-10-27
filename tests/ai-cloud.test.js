const test = require('node:test');
const assert = require('node:assert');
const AI = require('../js/ai.js');
const fs = require('node:fs');
const path = require('node:path');

const load = () => import('../supabase/functions/ai-evaluate/core.mjs');
const input = {
  subject: '数学', type: '做题练习', unit: '题', startClock: '19:03', endClock: '19:48', totalMin: 45, activeMin: 40, activePct: 89,
  pauses: 1, pausedMin: 5, interruptions: 1, amount: 12, rate: 0.35, expected: 14, pacePct: 86, correct: 10, accuracyPct: 83,
  focusSelf: 4, focusSelfText: '比较专注', mastery: 3, masteryText: '一般', note: '二次函数', ruleFocus: 78, ruleEffect: 72, scopeText: '课内',
};
const okFetch = (content) => async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) });

function deps(opts = {}) {
  const logs = [];
  const calls = [];
  const realFetch = global.fetch;
  return {
    logs, calls,
    AI: {
      evaluate: (cfg, inp) => { calls.push({ cfg, inp }); return AI.evaluate(cfg, inp, { fetch: opts.fetch || okFetch('{"focus":81,"effect":66,"focus_reason":"a","effect_reason":"b","tips":["t"]}') }); },
      testConnection: (cfg) => { calls.push({ cfg }); return AI.testConnection(cfg, { fetch: opts.fetch || okFetch('你好') }); },
    },
    env: Object.assign({ apiKey: 'sk-server', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-8B', provider: 'siliconflow', dailyLimit: 3 }, opts.env),
    now: () => Date.parse('2026-10-26T15:30:00Z'),
    verifyUser: async (jwt) => (jwt === 'good' ? { id: 'u1' } : null),
    countSince: async (id, iso) => logs.filter((l) => l.id === id && l.at >= iso).length,
    log: async (id, kind) => { logs.push({ id, kind, at: '2026-10-26T15:30:00.000Z' }); },
    realFetch,
  };
}

test('网页和云端用的是同一份 ai.js', () => {
  const link = path.join(__dirname, '../supabase/functions/ai-evaluate/ai.js');
  assert.strictEqual(fs.readFileSync(link, 'utf8'), fs.readFileSync(path.join(__dirname, '../js/ai.js'), 'utf8'));
});

test('“今天”按北京时间算', async () => {
  const C = await load();
  assert.strictEqual(C.todayStartIso(Date.parse('2026-10-26T15:30:00Z')), '2026-10-25T16:00:00.000Z');
  assert.strictEqual(C.todayStartIso(Date.parse('2026-10-26T16:30:00Z')), '2026-10-26T16:00:00.000Z');
});

test('status 不用登录，只说是否配置好，不泄露密钥', async () => {
  const C = await load();
  const r = await C.handle({ body: { mode: 'status' } }, deps());
  assert.deepStrictEqual(r, { status: 200, json: { configured: true, model: 'Qwen/Qwen3-8B' } });
  assert.ok(!JSON.stringify(r).includes('sk-server'));
  const n = await C.handle({ body: { mode: 'status' } }, deps({ env: { apiKey: '' } }));
  assert.strictEqual(n.json.configured, false);
});

test('评估：必须登录；用云端的密钥和模型；结果解析好再返回', async () => {
  const C = await load();
  const d = deps();
  assert.strictEqual((await C.handle({ body: { mode: 'evaluate', input } }, d)).status, 401);
  assert.strictEqual((await C.handle({ bearer: 'bad', body: { mode: 'evaluate', input } }, d)).status, 401);
  const r = await C.handle({ bearer: 'good', body: { mode: 'evaluate', input } }, d);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual([r.json.result.focus, r.json.result.effect, r.json.model], [81, 66, 'Qwen/Qwen3-8B']);
  assert.deepStrictEqual(d.calls[0].cfg, { provider: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-8B', key: 'sk-server' });
  assert.ok(!JSON.stringify(r).includes('sk-server'));
});

test('只接受结构化的学习数据，不能当成通用聊天接口', async () => {
  const C = await load();
  const d = deps();
  assert.strictEqual((await C.handle({ bearer: 'good', body: { mode: 'chat', messages: [{ role: 'user', content: '写作文' }] } }, d)).status, 400);
  assert.strictEqual((await C.handle({ bearer: 'good', body: { mode: 'evaluate' } }, d)).status, 400);
  assert.strictEqual((await C.handle({ bearer: 'good', body: { mode: 'evaluate', input: { note: '没有科目' } } }, d)).status, 400);
  // 多余字段被丢掉，超长内容被截断，数字被限制在范围内
  const s = C.sanitizeInput({ ...input, note: '字'.repeat(5000), subject: '数'.repeat(100), activePct: 999, evil: 'x', messages: [] });
  assert.strictEqual(s.note.length, 500);
  assert.strictEqual(s.subject.length, 20);
  assert.strictEqual(s.activePct, 100);
  assert.ok(!('evil' in s) && !('messages' in s));
  assert.strictEqual(C.sanitizeInput({ ...input, amount: null }).expected, null);
});

test('每人每天限次，测试连接也算次数', async () => {
  const C = await load();
  const d = deps();
  await C.handle({ bearer: 'good', body: { mode: 'ping' } }, d);
  await C.handle({ bearer: 'good', body: { mode: 'evaluate', input } }, d);
  await C.handle({ bearer: 'good', body: { mode: 'evaluate', input } }, d);
  const r = await C.handle({ bearer: 'good', body: { mode: 'evaluate', input } }, d);
  assert.strictEqual(r.status, 429);
  assert.match(r.json.error, /3 次/);
  assert.strictEqual(d.calls.length, 3, '超过次数不再调用大模型');
});

test('云端还没配置密钥、密钥错误、服务商限流时给出能看懂的提示', async () => {
  const C = await load();
  let r = await C.handle({ bearer: 'good', body: { mode: 'evaluate', input } }, deps({ env: { apiKey: '' } }));
  assert.strictEqual(r.status, 503);
  assert.match(r.json.error, /AI_API_KEY/);
  const http = (status) => async () => ({ ok: false, status, text: async () => '{"message":"x"}' });
  r = await C.handle({ bearer: 'good', body: { mode: 'evaluate', input } }, deps({ fetch: http(401) }));
  assert.match(r.json.error, /密钥不对/);
  r = await C.handle({ bearer: 'good', body: { mode: 'evaluate', input } }, deps({ fetch: http(429) }));
  assert.match(r.json.error, /太忙|额度/);
  r = await C.handle({ bearer: 'good', body: { mode: 'evaluate', input } }, deps({ fetch: okFetch('我不会评分') }));
  assert.strictEqual(r.status, 502);
  assert.match(r.json.error, /没有返回评分/);
});

test('测试连接', async () => {
  const C = await load();
  const r = await C.handle({ bearer: 'good', body: { mode: 'ping' } }, deps());
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.reply, '你好');
});
