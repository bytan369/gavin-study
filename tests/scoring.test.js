const test = require('node:test');
const assert = require('node:assert');
const SC = require('../js/scoring.js');

const math = SC.SUBJECTS.find((s) => s.id === 'math');
const english = SC.SUBJECTS.find((s) => s.id === 'english');

test('理想状态接近满分', () => {
  const r = SC.computeScores({ subject: math, type: 'practice', totalMin: 45, activeMin: 45, interruptions: 0, amount: 16, correct: 16, focusSelf: 5, mastery: 5 });
  assert.strictEqual(r.focus, 100);
  assert.strictEqual(r.effect, 100);
});

test('分数始终在 0-100 之间', () => {
  const r0 = SC.computeScores({ subject: math, type: 'practice', totalMin: 60, activeMin: 10, interruptions: 30, amount: 0, correct: 0, focusSelf: 1, mastery: 1 });
  assert.ok(r0.focus >= 0 && r0.focus <= 100);
  assert.ok(r0.effect >= 0 && r0.effect <= 100);
  const r1 = SC.computeScores({ subject: math, type: 'practice', totalMin: 30, activeMin: 30, interruptions: 0, amount: 999, correct: 999, focusSelf: 5, mastery: 5 });
  assert.ok(r1.focus <= 100 && r1.effect <= 100);
});

test('走神越多专注度越低', () => {
  const base = { subject: english, type: 'memorize', totalMin: 30, activeMin: 30, amount: 30, focusSelf: 4, mastery: 4 };
  const a = SC.computeScores({ ...base, interruptions: 0 });
  const b = SC.computeScores({ ...base, interruptions: 3 });
  assert.ok(a.focus > b.focus);
});

test('暂停占比越高专注度越低', () => {
  const base = { subject: math, type: 'reading', amount: 20, interruptions: 1, focusSelf: 3, mastery: 3 };
  const a = SC.computeScores({ ...base, totalMin: 30, activeMin: 29 });
  const b = SC.computeScores({ ...base, totalMin: 50, activeMin: 29 });
  assert.ok(a.focus > b.focus);
});

test('正确率影响学习效果', () => {
  const base = { subject: math, type: 'practice', totalMin: 40, activeMin: 40, interruptions: 0, amount: 14, focusSelf: 4, mastery: 3 };
  const good = SC.computeScores({ ...base, correct: 14 });
  const bad = SC.computeScores({ ...base, correct: 5 });
  assert.ok(good.effect > bad.effect);
  assert.ok(bad.tips.some((t) => t.includes('正确率') || t.includes('先求准')));
});

test('写作业的正确数可不填', () => {
  const r = SC.computeScores({ subject: math, type: 'homework', totalMin: 30, activeMin: 30, interruptions: 0, amount: 10, correct: null, focusSelf: 4, mastery: 4 });
  assert.strictEqual(r.metrics.accuracy, null);
  assert.ok(r.effect > 0);
});

test('英语写作单位为词', () => {
  assert.strictEqual(SC.unitOf(SC.getType('writing'), english), '词');
  assert.strictEqual(SC.unitOf(SC.getType('writing'), math), '字');
});

test('等级划分', () => {
  assert.strictEqual(SC.level(95).label, '优秀');
  assert.strictEqual(SC.level(80).label, '良好');
  assert.strictEqual(SC.level(60).label, '合格');
  assert.strictEqual(SC.level(10).label, '加油');
});

test('没填学习量：不扣分也不白送分，按其他项估算', () => {
  const base = { subject: math, type: 'practice', totalMin: 45, activeMin: 45, interruptions: 0, focusSelf: 5, mastery: 5 };
  const blank = SC.computeScores({ ...base, amount: null });
  assert.strictEqual(blank.focus, 100);
  assert.strictEqual(blank.effect, 100);
  assert.strictEqual(blank.metrics.noAmount, true);
  assert.strictEqual(blank.metrics.pace, null);
  assert.ok(!blank.tips.some((t) => t.includes('学习量偏少')));

  // 明确填 0 才会被判为没学东西
  const zero = SC.computeScores({ ...base, amount: 0, correct: null });
  assert.ok(zero.focus < blank.focus && zero.effect < blank.effect);
  assert.strictEqual(zero.metrics.noAmount, false);

  // 一般表现：估算值居中，且各项不超过满分
  const mid = SC.computeScores({ subject: math, type: 'reading', totalMin: 40, activeMin: 30, interruptions: 2, focusSelf: 3, mastery: 3, amount: '' });
  assert.ok(mid.focus > 0 && mid.focus < 100 && mid.effect > 0 && mid.effect < 100);
  for (const [k, v] of Object.entries(mid.focusParts)) assert.ok(v <= SC.FOCUS_LABELS[k].max + 0.05, k);
  for (const [k, v] of Object.entries(mid.effectParts)) assert.ok(v <= SC.EFFECT_LABELS[k].max + 0.05, k);
});

test('没填学习量时忽略做对题数', () => {
  const r = SC.computeScores({ subject: math, type: 'practice', totalMin: 30, activeMin: 30, interruptions: 0, focusSelf: 4, mastery: 3, amount: null, correct: 5 });
  assert.strictEqual(r.metrics.accuracy, null);
});
