const test = require('node:test');
const assert = require('node:assert');
const Cloud = require('../js/cloud.js');

function makeState(extra) {
  return Object.assign({
    sessions: [],
    running: null,
    settings: { name: '', goal: 120, theme: 'auto', hidden: [], custom: [] },
    sync: Cloud.emptySync(),
  }, extra);
}
const sess = (id, start, extra) => Object.assign({ id, start, end: start + 60000, subject: 'math', activeMin: 1, focus: 80, effect: 70 }, extra);

test('合并云端记录：新增、更新、删除', () => {
  const st = makeState({ sessions: [sess('a', 1), sess('b', 2)] });
  const changed = Cloud.mergeRemoteSessions(st, [
    { id: 'a', deleted: true, data: {} },
    { id: 'b', deleted: false, data: sess('b', 2, { focus: 99 }) },
    { id: 'c', deleted: false, data: sess('c', 3) },
  ]);
  assert.ok(changed);
  assert.deepStrictEqual(st.sessions.map((s) => s.id).sort(), ['b', 'c']);
  assert.strictEqual(st.sessions.find((s) => s.id === 'b').focus, 99);
});

test('本地未上传的修改和删除不会被云端覆盖', () => {
  const st = makeState({ sessions: [sess('a', 1, { focus: 10 })] });
  st.sync.dirtySessions = ['a'];
  st.sync.tombstones = ['z'];
  Cloud.mergeRemoteSessions(st, [
    { id: 'a', deleted: false, data: sess('a', 1, { focus: 99 }) },
    { id: 'z', deleted: false, data: sess('z', 5) },
  ]);
  assert.strictEqual(st.sessions.find((s) => s.id === 'a').focus, 10);
  assert.ok(!st.sessions.some((s) => s.id === 'z'));
});

test('相同数据不算变化，坏数据被忽略', () => {
  const st = makeState({ sessions: [sess('a', 1)] });
  assert.strictEqual(Cloud.mergeRemoteSessions(st, [{ id: 'a', deleted: false, data: sess('a', 1) }]), false);
  assert.strictEqual(Cloud.mergeRemoteSessions(st, [{ id: 'x', deleted: false, data: { start: 'bad' } }, null]), false);
});

test('应用云端设置和计时', () => {
  const st = makeState();
  const run = { subject: 'english', type: 'reading', start: 1000, pauses: [{ start: 2000, end: null }] };
  const changed = Cloud.applyRemoteProfile(st, { settings: { goal: 90, hidden: ['music'], evil: 1 }, running: run, updated_at: 't1' });
  assert.ok(changed);
  assert.strictEqual(st.settings.goal, 90);
  assert.deepStrictEqual(st.settings.hidden, ['music']);
  assert.ok(!('evil' in st.settings));
  assert.strictEqual(st.running.subject, 'english');
  assert.strictEqual(st.sync.profileAt, 't1');
  // 同一版本不再重复应用
  st.settings.goal = 50;
  assert.strictEqual(Cloud.applyRemoteProfile(st, { settings: { goal: 90 }, running: run, updated_at: 't1' }), false);
  assert.strictEqual(st.settings.goal, 50);
});

test('本地有未上传的改动或正在填写结束表单时保留本地', () => {
  const st = makeState({ running: { subject: 'math', type: 'practice', start: 1, pauses: [], end: 5 } });
  st.sync.dirtySettings = true;
  Cloud.applyRemoteProfile(st, { settings: { goal: 300 }, running: null, updated_at: 't2' });
  assert.strictEqual(st.settings.goal, 120);
  assert.ok(st.running && st.running.end === 5);
});

test('非法设置值被过滤', () => {
  const out = Cloud.sanitizeSettings({ goal: 99999, theme: 'neon', name: 123, custom: [{ id: 1 }, { id: 'c_1', name: '奥数' }] },
    { name: 'A', goal: 120, theme: 'auto', hidden: [], custom: [] });
  assert.strictEqual(out.goal, 120);
  assert.strictEqual(out.theme, 'auto');
  assert.strictEqual(out.name, 'A');
  assert.deepStrictEqual(out.custom.map((c) => c.id), ['c_1']);
});

test('上传计时状态时去掉结束表单的临时字段', () => {
  const run = { subject: 'math', type: 'practice', start: 1, pauses: [{ start: 2, end: 9 }], end: 9, closedAtEnd: true };
  assert.deepStrictEqual(Cloud.serializeRunning(run), { subject: 'math', type: 'practice', start: 1, pauses: [{ start: 2, end: null }] });
  assert.strictEqual(Cloud.serializeRunning(null), null);
});

test('待上传数量', () => {
  const st = makeState();
  st.sync.dirtySessions = ['a', 'b'];
  st.sync.tombstones = ['c'];
  st.sync.dirtyRunning = true;
  assert.strictEqual(Cloud.pendingCount(st), 4);
});

test('错误信息翻译', () => {
  assert.strictEqual(Cloud.translateError({ message: 'Invalid login credentials' }), '邮箱或密码错误');
  assert.strictEqual(Cloud.translateError({ message: 'Email not confirmed' }), '邮箱还没确认，请先点击邮件里的确认链接');
});
