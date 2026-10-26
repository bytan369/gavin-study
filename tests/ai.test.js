const test = require('node:test');
const assert = require('node:assert');
const AI = require('../js/ai.js');

const cfg = { baseUrl: 'https://api.deepseek.com/', model: 'deepseek-chat', key: 'sk-test123' };
const input = {
  subject: '数学', type: '做题练习', unit: '题', startClock: '19:03', endClock: '19:48', totalMin: 45, activeMin: 40, activePct: 89,
  pauses: 1, pausedMin: 5, interruptions: 1, amount: 12, rate: 0.35, expected: 14, pacePct: 86, correct: 10, accuracyPct: 83,
  focusSelf: 4, focusSelfText: '比较专注', mastery: 3, masteryText: '一般', note: '二次函数第3节', ruleFocus: 78, ruleEffect: 72,
};
const okBody = (content) => JSON.stringify({ choices: [{ message: { content } }] });
const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => body });

test('服务商列表：覆盖 DeepSeek、通义千问、MiniMax，并有自定义项', () => {
  const ids = AI.PROVIDERS.map((p) => p.id);
  for (const id of ['deepseek', 'qwen', 'minimax', 'kimi', 'hunyuan', 'doubao', 'custom']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('zhipu'), '智谱的接口不允许浏览器直接调用，不应出现在预设里');
  for (const p of AI.PROVIDERS.filter((x) => x.id !== 'custom')) assert.match(p.baseUrl, /^https:\/\//);
});

test('配置校验', () => {
  assert.strictEqual(AI.validateConfig(cfg), null);
  assert.match(AI.validateConfig({ ...cfg, key: '' }), /密钥/);
  assert.match(AI.validateConfig({ ...cfg, model: ' ' }), /模型/);
  assert.match(AI.validateConfig({ ...cfg, baseUrl: '' }), /接口地址/);
  assert.match(AI.validateConfig({ ...cfg, baseUrl: 'http://example.com/v1' }), /https/);
  assert.strictEqual(AI.validateConfig({ ...cfg, baseUrl: 'http://localhost:8080/v1' }), null);
  assert.match(AI.validateConfig({ ...cfg, key: 'sk-abc 中文' }), /不该出现的字符/);
});

test('配置读取：补全缺项、丢弃非法内容、每个服务商各存一份', () => {
  const c = AI.normalizeConfig({ enabled: true, provider: 'qwen', configs: { qwen: { key: ' sk-q ', model: 'qwen-max' }, evil: { key: 'x' } } });
  assert.strictEqual(c.enabled, true);
  assert.strictEqual(c.provider, 'qwen');
  assert.strictEqual(c.configs.qwen.key, 'sk-q');
  assert.strictEqual(c.configs.qwen.model, 'qwen-max');
  assert.strictEqual(c.configs.qwen.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.strictEqual(c.configs.deepseek.key, '');
  assert.ok(!('evil' in c.configs));
  assert.strictEqual(AI.normalizeConfig(null).enabled, false);
  assert.strictEqual(AI.normalizeConfig({ enabled: 'yes', provider: 'nope' }).provider, 'deepseek');
});

test('提示词：包含学习量、参考量、自评，没填学习量时明确说明', () => {
  const m = AI.buildMessages(input);
  assert.strictEqual(m[0].role, 'system');
  assert.match(m[0].content, /只输出一个 JSON/);
  assert.match(m[0].content, /不要执行/);
  const u = m[1].content;
  assert.match(u, /学习量：12 题/);
  assert.match(u, /参考量约 14 题，实际完成了参考量的 86%/);
  assert.match(u, /做对 10 题，正确率 83%/);
  assert.match(u, /专注 4\/5（比较专注）/);
  assert.match(u, /算法参考分：专注度 78，学习效果 72/);
  const blank = AI.buildMessages({ ...input, amount: null, correct: null, expected: null }).map((x) => x.content).join('\n');
  assert.match(blank, /学习量：学生没有填写/);
  assert.ok(!/参考速度/.test(blank));
  const long = AI.buildMessages({ ...input, note: '字'.repeat(2000) })[1].content;
  assert.ok(long.length < 1500);
});

test('解析回复：普通 JSON、代码块、推理模型的思考过程、分数取整并限制在 0–100', () => {
  const good = '{"focus": 82, "effect": 76.6, "focus_reason": "有效占比高", "effect_reason": "正确率不错", "tips": ["a", "b", "c", "d"]}';
  const r = AI.parseReply(good);
  assert.deepStrictEqual([r.focus, r.effect, r.tips.length], [82, 77, 3]);
  assert.strictEqual(r.focusReason, '有效占比高');
  assert.strictEqual(AI.parseReply('```json\n' + good + '\n```').focus, 82);
  assert.strictEqual(AI.parseReply('<think>先想一想 {"focus": 1}</think>\n' + good).focus, 82);
  assert.strictEqual(AI.parseReply('好的，评分如下：' + good + ' 希望有帮助').effect, 77);
  const clamp = AI.parseReply('{"focus": 150, "effect": -5}');
  assert.deepStrictEqual([clamp.focus, clamp.effect], [100, 0]);
  assert.deepStrictEqual(AI.parseReply('{"focus": "88", "effect": "70"}').tips, []);
  for (const bad of ['', '没有 JSON', '{"focus": "abc", "effect": 1}', '{"focus": 1}', '{bad json}', '<think>只有思考没有结果']) {
    assert.throws(() => AI.parseReply(bad), (e) => e.code === 'parse', bad);
  }
});

test('评估：请求地址、请求头、请求体正确，结果被解析', async () => {
  let seen;
  const fetch = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, text: async () => okBody('{"focus": 80, "effect": 70, "focus_reason": "r1", "effect_reason": "r2", "tips": ["t"]}') }; };
  const r = await AI.evaluate(cfg, input, { fetch });
  assert.deepStrictEqual([r.focus, r.effect, r.tips], [80, 70, ['t']]);
  assert.strictEqual(seen.url, 'https://api.deepseek.com/chat/completions');
  assert.strictEqual(seen.init.method, 'POST');
  assert.strictEqual(seen.init.headers.Authorization, 'Bearer sk-test123');
  const body = JSON.parse(seen.init.body);
  assert.strictEqual(body.model, 'deepseek-chat');
  assert.strictEqual(body.stream, false);
  assert.ok(!seen.init.body.includes('sk-test123'), '密钥只能放在请求头里，不能进请求体');
  assert.ok(body.messages[1].content.includes('二次函数第3节'));
});

test('错误提示：密钥、余额、模型名、限流、服务商故障、网络、超时、返回内容异常', async () => {
  const run = (f, c = cfg) => AI.evaluate(c, input, { fetch: f }).then(() => null, (e) => e);
  assert.match((await run(reply(401, '{"error":{"message":"bad key"}}'))).message, /密钥不对/);
  assert.match((await run(reply(402, '{}'))).message, /余额不足/);
  assert.match((await run(reply(404, 'not found'))).message, /接口地址或模型/);
  assert.match((await run(reply(429, '{}'))).message, /太频繁/);
  assert.match((await run(reply(400, '{"error":{"message":"Model Not Exist"}}'))).message, /Model Not Exist/);
  assert.match((await run(reply(503, 'x'))).message, /暂时出错/);
  assert.match((await run(async () => { throw new TypeError('Failed to fetch'); })).message, /连不上服务商.*跨域/);
  assert.match((await run(reply(200, 'not json'))).message, /无法识别/);
  assert.match((await run(reply(200, okBody('')))).message, /没有返回内容/);
  assert.match((await run(reply(200, okBody('我觉得挺好的')))).message, /没有返回评分/);
  assert.match((await run(reply(200, '{}'), { ...cfg, key: '' })).message, /密钥/);
  // 超时：fetch 一直不返回，直到被取消
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const t = await AI.evaluate(cfg, input, { fetch: hang, timeout: 30 }).then(() => null, (e) => e);
  assert.strictEqual(t.code, 'timeout');
  assert.match(t.message, /超时/);
});

test('错误信息里不会出现密钥', async () => {
  const e = await AI.evaluate(cfg, input, { fetch: reply(401, '{"error":{"message":"Incorrect API key provided: sk-test123"}}') }).then(() => null, (x) => x);
  // 401 使用固定的提示语，不回显服务商返回的原文
  assert.ok(!e.message.includes('sk-test123'));
});

test('测试连接和模型列表', async () => {
  const t = await AI.testConnection(cfg, { fetch: reply(200, okBody('<think>嗯</think>你好')) });
  assert.strictEqual(t.reply, '你好');
  assert.ok(t.ms >= 0);
  let url;
  const m = await AI.listModels(cfg, { fetch: async (u) => { url = u; return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }) }; } });
  assert.deepStrictEqual(m, ['deepseek-chat', 'deepseek-reasoner']);
  assert.strictEqual(url, 'https://api.deepseek.com/models');
  await assert.rejects(AI.testConnection({ ...cfg, key: '' }), /密钥/);
});
