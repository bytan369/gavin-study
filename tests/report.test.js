const test = require('node:test');
const assert = require('node:assert');
const SC = require('../js/scoring.js');

const load = () => Promise.all([
  import('../supabase/functions/daily-report/report.mjs'),
  import('../supabase/functions/daily-report/core.mjs'),
]);

// 2026-10-26 23:30 北京时间 = 15:30 UTC
const NIGHT = Date.parse('2026-10-26T15:30:00Z');
const sess = (id, start, extra) => Object.assign({ id, subject: 'math', type: 'practice', start, end: start + 1800e3, activeMin: 30, amount: 12, focus: 80, effect: 70, note: '' }, extra);
const rowOf = (s) => ({ id: s.id, data: s });

test('按北京时间划分“当天”', async () => {
  const [R] = await load();
  const r = R.dayRange(NIGHT);
  assert.strictEqual(r.key, '2026-10-26');
  assert.strictEqual(r.label, '10月26日 周一');
  assert.strictEqual(r.start, Date.parse('2026-10-25T16:00:00Z'));
  assert.strictEqual(r.end - r.start, 86400000);
  // 北京时间 00:30（UTC 16:30）已经是第二天
  assert.strictEqual(R.dayRange(Date.parse('2026-10-26T16:30:00Z')).key, '2026-10-27');
  assert.strictEqual(R.fmtClock(Date.parse('2026-10-26T12:05:00Z')), '20:05');
});

test('科目和学习方式的名称、单位与网页端保持一致', async () => {
  const [R] = await load();
  for (const s of SC.SUBJECTS) {
    assert.deepStrictEqual(R.SUBJECT_INFO[s.id], [s.name, s.emoji], s.id);
  }
  assert.strictEqual(Object.keys(R.SUBJECT_INFO).length, SC.SUBJECTS.length);
  for (const t of SC.TYPES) {
    for (const s of SC.SUBJECTS) {
      const want = SC.unitOf(t, s);
      const got = R.typeOf(t.id, s.id);
      assert.strictEqual(got.name, t.name);
      assert.strictEqual(got.unit, want, `${t.id}/${s.id}`);
    }
  }
});

test('只保留当天开始的记录并按时间排序', async () => {
  const [R] = await load();
  const range = R.dayRange(NIGHT);
  const rows = [
    rowOf(sess('late', range.start + 20 * 3600e3)),
    rowOf(sess('early', range.start + 8 * 3600e3)),
    rowOf(sess('yesterday', range.start - 3600e3)),
    rowOf(sess('tomorrow', range.end + 3600e3)),
    { id: 'bad', data: { start: 'x' } },
    null,
  ];
  assert.deepStrictEqual(R.sessionsOfDay(rows, range).map((s) => s.id), ['early', 'late']);
});

test('统计：按有效时长加权，各科按时长排序，自定义科目能显示名字', async () => {
  const [R] = await load();
  const items = [
    sess('a', 1, { activeMin: 60, focus: 90, effect: 80, subject: 'english' }),
    sess('b', 2, { activeMin: 20, focus: 60, effect: 50, subject: 'c_1' }),
    sess('c', 3, { activeMin: 20, focus: 60, effect: 50, subject: 'english' }),
  ];
  const sum = R.summarize(items, [{ id: 'c_1', name: '奥数', emoji: '🧮' }]);
  assert.strictEqual(sum.count, 3);
  assert.strictEqual(sum.totalMin, 100);
  assert.strictEqual(sum.focus, Math.round((90 * 60 + 60 * 20 + 60 * 20) / 100));
  assert.deepStrictEqual(sum.subjects.map((s) => s.name), ['英语', '奥数']);
  assert.strictEqual(sum.subjects[0].min, 80);
});

test('邮件内容：有记录', async () => {
  const [R] = await load();
  const range = R.dayRange(NIGHT);
  const items = [
    sess('a', range.start + 3600e3 * 10, { note: '复习二次函数\n错题没整理', amount: 12 }),
    sess('b', range.start + 3600e3 * 12, { subject: 'english', type: 'writing', amount: 80, activeMin: 20, focus: 70, effect: 60 }),
    sess('c', range.start + 3600e3 * 14, { amount: null, type: 'reading' }),
  ];
  const m = R.renderEmail({ name: 'Gavin', range, items, goalMin: 120 });
  assert.match(m.subject, /Gavin 10月26日学习日报：共1小时20分/);
  assert.match(m.text, /总学习时间：1小时20分（3 次），目标完成 67%/);
  assert.match(m.text, /80词/); // 英语写作按“词”计
  assert.match(m.text, /内容：复习二次函数 \/ 错题没整理/);
  assert.match(m.html, /Gavin 的学习日报/);
  assert.ok(!/undefined|NaN|null/.test(m.text + m.html), '不应出现 undefined/NaN/null');
  // 没填学习量的记录不显示数量
  assert.ok(!/，null|，undefined/.test(m.text));
});

test('邮件内容：当天没有记录；用户输入会被转义', async () => {
  const [R] = await load();
  const range = R.dayRange(NIGHT);
  const empty = R.renderEmail({ name: '', range, items: [], goalMin: 120 });
  assert.match(empty.subject, /同学 10月26日学习日报：今天没有学习记录/);
  assert.match(empty.text, /今天没有学习记录/);

  const evil = R.renderEmail({ name: '<b>x</b>', range, items: [sess('a', range.start + 1, { note: '<script>alert(1)</script>"&', subject: 'c_9' })], custom: [{ id: 'c_9', name: '<i>科</i>', emoji: '🧪' }] });
  assert.ok(!evil.html.includes('<script>'));
  assert.ok(!evil.html.includes('<b>x</b>'));
  assert.ok(!evil.html.includes('<i>科</i>'));
  assert.match(evil.html, /&lt;script&gt;/);

  const long = R.renderEmail({ range, items: [sess('a', range.start + 1, { note: '字'.repeat(1000) })] });
  assert.ok(long.text.length < 1000);
});

test('邮箱打码', async () => {
  const [R] = await load();
  assert.strictEqual(R.maskEmail('285734139@qq.com'), '28***39@qq.com');
  assert.strictEqual(R.maskEmail('ab@x.com'), 'a***@x.com');
  assert.strictEqual(R.maskEmail('bad'), '');
});

// ---------------- 业务流程（假数据库 + 假邮件） ----------------
function makeDeps(opts = {}) {
  const range = { start: Date.parse('2026-10-25T16:00:00Z') };
  const sent = [];
  const logs = [];
  const users = Object.assign({
    u1: { email: 'a@qq.com', confirmed: true },
    u2: { email: 'b@qq.com', confirmed: true },
    u3: { email: 'c@qq.com', confirmed: false },
  }, opts.users);
  const sessions = Object.assign({
    u1: [rowOf(sess('s1', range.start + 10 * 3600e3, { note: 'hi' }))],
    u2: [],
    u3: [],
  }, opts.sessions);
  const profiles = opts.profiles || [
    { user_id: 'u1', settings: { name: '小明', reportEnabled: true } },
    { user_id: 'u2', settings: { reportEnabled: true } },
    { user_id: 'u3', settings: { reportEnabled: true } },
  ];
  return {
    sent, logs,
    now: () => NIGHT,
    cc: opts.cc || [],
    mailer: { async send(m) { if (opts.failFor && opts.failFor === m.to) throw Object.assign(new Error('x'), { code: opts.failCode || 'EAUTH' }); sent.push(m); } },
    db: {
      getSecret: async () => 'topsecret',
      listEnabledProfiles: async () => profiles,
      getProfile: async (id) => profiles.find((p) => p.user_id === id) || null,
      listSessions: async (id) => sessions[id] || [],
      getUser: async (id) => users[id] || null,
      wasSent: async (id, key) => logs.some((l) => l.user_id === id && l.report_date === key && l.kind === 'daily' && l.ok),
      countTests: async (id, key) => logs.filter((l) => l.user_id === id && l.report_date === key && l.kind === 'test').length,
      log: async (r) => { logs.push(r); },
      verifyUser: async (t) => (t === 'good-token' ? { id: 'u1' } : null),
    },
  };
}

test('定时发送：没有密钥或密钥错误一律拒绝', async () => {
  const [, C] = await load();
  const d = makeDeps();
  for (const secret of ['', 'wrong', undefined]) {
    const r = await C.processRequest({ secret, body: { mode: 'daily' } }, d);
    assert.strictEqual(r.status, 401);
  }
  assert.strictEqual(d.sent.length, 0);
  // 用户令牌不能触发定时发送
  assert.strictEqual((await C.processRequest({ bearer: 'good-token', body: { mode: 'daily' } }, d)).status, 401);
});

test('定时发送：发给已开启的账号，未验证邮箱的记失败，重复运行不重复发', async () => {
  const [, C] = await load();
  const d = makeDeps();
  const r1 = await C.processRequest({ secret: 'topsecret', body: { mode: 'daily' } }, d);
  assert.deepStrictEqual(r1.json, { date: '2026-10-26', sent: 2, skipped: 0, failed: 1 });
  assert.deepStrictEqual(d.sent.map((m) => m.to).sort(), ['a@qq.com', 'b@qq.com']);
  assert.match(d.sent.find((m) => m.to === 'a@qq.com').subject, /小明/);
  assert.ok(d.logs.some((l) => l.user_id === 'u3' && !l.ok && /验证/.test(l.error)));

  // 23:45 补发：已成功的跳过，失败的再试一次
  const r2 = await C.processRequest({ secret: 'topsecret', body: { mode: 'daily' } }, d);
  assert.deepStrictEqual(r2.json, { date: '2026-10-26', sent: 0, skipped: 2, failed: 1 });
  assert.strictEqual(d.sent.length, 2);
});

test('定时发送：一个人发送失败不影响其他人；抄送不会重复发给本人', async () => {
  const [, C] = await load();
  const d = makeDeps({ failFor: 'a@qq.com', cc: ['parent@qq.com', 'B@qq.com'] });
  const r = await C.processRequest({ secret: 'topsecret', body: { mode: 'daily' } }, d);
  assert.strictEqual(r.json.sent, 1);
  assert.strictEqual(r.json.failed, 2); // a 发送失败 + c 邮箱未验证
  const m = d.sent[0];
  assert.strictEqual(m.to, 'b@qq.com');
  assert.deepStrictEqual(m.cc, ['parent@qq.com']); // 与收件人相同的地址（不区分大小写）被去掉
  assert.ok(d.logs.some((l) => l.user_id === 'u1' && !l.ok && l.error === 'EAUTH'));
});

test('测试邮件：必须登录；成功只返回打码邮箱；每天限次', async () => {
  const [, C] = await load();
  const d = makeDeps();
  assert.strictEqual((await C.processRequest({ bearer: 'nope', body: { mode: 'test' } }, d)).status, 401);
  assert.strictEqual((await C.processRequest({ body: { mode: 'test' } }, d)).status, 401);
  const ok = await C.processRequest({ bearer: 'good-token', body: { mode: 'test' } }, d);
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(ok.json, { ok: true, to: 'a***@qq.com', count: 1 });
  assert.ok(!JSON.stringify(ok.json).includes('a@qq.com'));
  for (let i = 0; i < 4; i++) await C.processRequest({ bearer: 'good-token', body: { mode: 'test' } }, d);
  const limited = await C.processRequest({ bearer: 'good-token', body: { mode: 'test' } }, d);
  assert.strictEqual(limited.status, 429);
  assert.strictEqual(d.sent.length, 5);
});

test('测试邮件：邮件服务出错时给出能看懂的提示', async () => {
  const [, C] = await load();
  let d = makeDeps({ failFor: 'a@qq.com', failCode: 'EAUTH' });
  let r = await C.processRequest({ bearer: 'good-token', body: { mode: 'test' } }, d);
  assert.strictEqual(r.status, 502);
  assert.match(r.json.error, /授权码/);
  d = makeDeps({ failFor: 'a@qq.com', failCode: 'NO_SMTP' });
  r = await C.processRequest({ bearer: 'good-token', body: { mode: 'test' } }, d);
  assert.match(r.json.error, /还没配置好/);
});

test('未知模式返回 400；密钥比较是常量时间的', async () => {
  const [, C] = await load();
  assert.strictEqual((await C.processRequest({ body: { mode: 'x' } }, makeDeps())).status, 400);
  assert.strictEqual((await C.processRequest({ body: undefined }, makeDeps())).status, 400);
  assert.ok(C.safeEqual('abc', 'abc'));
  assert.ok(!C.safeEqual('abc', 'abd'));
  assert.ok(!C.safeEqual('abc', 'abcd'));
});
