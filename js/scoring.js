/*
 * 学习评分模型：根据学习时长、暂停/走神情况和学习量，
 * 计算「专注度」和「学习效果」两个 0-100 分。
 * 纯函数，无 DOM 依赖，可在浏览器和 Node 中使用。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Scoring = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // quiz：做题的参考速度（题/分钟）；write：写作参考速度（字或词/分钟）
  const SUBJECTS = [
    { id: 'chinese', name: '语文', emoji: '📖', color: '#e8590c', quiz: 0.5, write: 15 },
    { id: 'math', name: '数学', emoji: '📐', color: '#1c7ed6', quiz: 0.35 },
    { id: 'english', name: '英语', emoji: '🔤', color: '#7048e8', quiz: 0.8, write: 6, writeUnit: '词' },
    { id: 'physics', name: '物理', emoji: '🧲', color: '#1098ad', quiz: 0.35 },
    { id: 'chemistry', name: '化学', emoji: '⚗️', color: '#0ca678', quiz: 0.4 },
    { id: 'biology', name: '生物', emoji: '🧬', color: '#37b24d', quiz: 0.6 },
    { id: 'history', name: '历史', emoji: '🏛️', color: '#a0522d', quiz: 0.8 },
    { id: 'geography', name: '地理', emoji: '🌏', color: '#1971c2', quiz: 0.7 },
    { id: 'politics', name: '道法/政治', emoji: '⚖️', color: '#e03131', quiz: 0.8 },
    { id: 'science', name: '科学', emoji: '🔬', color: '#099268', quiz: 0.5 },
    { id: 'it', name: '信息技术', emoji: '💻', color: '#4c6ef5', quiz: 0.6 },
    { id: 'tech', name: '通用技术', emoji: '🛠️', color: '#495057', quiz: 0.6 },
    { id: 'music', name: '音乐', emoji: '🎵', color: '#d6336c', quiz: 0.6 },
    { id: 'art', name: '美术', emoji: '🎨', color: '#f08c00', quiz: 0.6 },
    { id: 'pe', name: '体育与健康', emoji: '⚽', color: '#5c940d', quiz: 0.6 },
    { id: 'calligraphy', name: '书法', emoji: '🖌️', color: '#795548', quiz: 0.5 },
    { id: 'language2', name: '第二外语', emoji: '🌐', color: '#9c36b5', quiz: 0.8, write: 6, writeUnit: '词' },
    { id: 'project', name: '综合实践', emoji: '🧩', color: '#0b7285', quiz: 0.5 },
    { id: 'other', name: '其他', emoji: '📝', color: '#868e96', quiz: 0.5 },
  ];

  // rate：该学习方式的参考速度（单位/分钟），用来把「学习量」换算成效率
  const TYPES = [
    { id: 'practice', name: '做题练习', icon: '✏️', unit: '题', correct: 'required', rate: (s) => s.quiz || 0.5, hint: '完成的题目数' },
    { id: 'homework', name: '写作业', icon: '📒', unit: '题', correct: 'optional', rate: (s) => (s.quiz || 0.5) * 0.9, hint: '完成的作业题数，正确数知道就填' },
    { id: 'reading', name: '阅读/预习', icon: '📚', unit: '页', rate: () => 0.8, hint: '读完的课本或书籍页数' },
    { id: 'memorize', name: '背诵/记忆', icon: '🧠', unit: '个', rate: () => 1, hint: '记住的单词、公式、古诗句或知识点个数' },
    { id: 'review', name: '复习/整理', icon: '🗂️', unit: '个', rate: () => 0.4, hint: '复习或整理好的知识点个数（含错题整理）' },
    { id: 'writing', name: '写作/练笔', icon: '🖊️', unit: (s) => s.writeUnit || '字', rate: (s) => s.write || 12, hint: '写下的字数（外语按词数）' },
    { id: 'listening', name: '听力/口语', icon: '🎧', unit: '篇', rate: () => 0.15, hint: '完成的听力或口语材料篇数' },
    { id: 'skill', name: '技能练习', icon: '🎯', unit: '组', rate: () => 0.2, hint: '完成的练习组数或遍数（乐器、绘画、运动等）' },
  ];

  function getType(id) {
    return TYPES.find((t) => t.id === id) || TYPES[0];
  }

  function unitOf(type, subject) {
    return typeof type.unit === 'function' ? type.unit(subject || {}) : type.unit;
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function sum(obj) {
    return Object.values(obj).reduce((a, b) => a + b, 0);
  }

  function level(score) {
    if (score >= 90) return { label: '优秀', emoji: '🌟', key: 'a' };
    if (score >= 75) return { label: '良好', emoji: '👍', key: 'b' };
    if (score >= 60) return { label: '合格', emoji: '🙂', key: 'c' };
    return { label: '加油', emoji: '💪', key: 'd' };
  }

  /**
   * @param {object} inp
   *   subject      科目对象（来自 SUBJECTS 或自定义）
   *   type         学习方式 id
   *   totalMin     开始到结束的总分钟数
   *   activeMin    扣除暂停后的有效学习分钟数
   *   interruptions 走神/被打断次数
   *   amount       学习量；null / 空 = 没填（不按学习量评分，相关两项按其他项估算）
   *   correct      做对题数（可为 null）
   *   focusSelf    自评专注 1-5
   *   mastery      自评掌握 1-5
   */
  function computeScores(inp) {
    const subject = inp.subject || {};
    const type = getType(inp.type);
    const totalMin = Math.max(+inp.totalMin || 0, 0);
    const activeMin = clamp(+inp.activeMin || 0, 0, totalMin);
    const noAmount = inp.amount === null || inp.amount === undefined || inp.amount === '';
    const amount = noAmount ? 0 : Math.max(+inp.amount || 0, 0);
    const interruptions = Math.max(Math.round(+inp.interruptions || 0), 0);
    const focusSelf = clamp(Math.round(+inp.focusSelf || 3), 1, 5);
    const mastery = clamp(Math.round(+inp.mastery || 3), 1, 5);
    const hasCorrect = !!type.correct && amount > 0 && inp.correct !== null && inp.correct !== undefined && inp.correct !== '';
    const accuracy = hasCorrect ? clamp(+inp.correct || 0, 0, amount) / amount : null;

    // 学习量 ÷ 按参考速度应完成的量 —— 1 表示达到参考速度
    const expected = activeMin * type.rate(subject);
    const pace = expected > 0 ? amount / expected : 0;
    const activeRatio = totalMin > 0 ? activeMin / totalMin : 0;
    // 每 30 分钟的中断次数；不足 10 分钟按 10 分钟算，避免短时学习被放大
    const interruptRate = (interruptions / Math.max(activeMin, 10)) * 30;
    const masteryScore = (mastery - 1) / 4;

    const focusParts = {
      active: 35 * clamp((activeRatio - 0.5) / 0.45, 0, 1),
      calm: 25 * clamp(1 - interruptRate / 4, 0, 1),
      pace: 0,
      self: 15 * ((focusSelf - 1) / 4),
    };
    // 没填学习量时，学习效率这一项按其他三项的得分比例估算，不扣分也不白送分
    const paceScore = noAmount
      ? (focusParts.active + focusParts.calm + focusParts.self) / 75
      : clamp(pace / 0.9, 0, 1);
    focusParts.pace = 25 * paceScore;
    const focus = Math.round(sum(focusParts));

    const quality = accuracy === null
      ? masteryScore
      : 0.75 * clamp((accuracy - 0.4) / 0.55, 0, 1) + 0.25 * masteryScore;
    const effectParts = {
      amount: 0,
      quality: 35 * quality,
      duration: 15 * Math.sqrt(clamp(activeMin / 40, 0, 1)),
      focus: 20 * (focus / 100),
    };
    effectParts.amount = 30 * (noAmount ? (effectParts.quality + effectParts.duration + effectParts.focus) / 70 : paceScore);
    const effect = Math.round(sum(effectParts));

    const tips = [];
    if (activeRatio < 0.8 && totalMin >= 5) tips.push('暂停时间占比偏高，尽量一口气学完一段，再集中休息。');
    if (interruptRate >= 2) tips.push('走神/被打断较多，试试把手机放远一点，用番茄钟：专注 25 分钟 + 休息 5 分钟。');
    if (!noAmount && pace < 0.6) tips.push('这次学习量偏少，开始前给自己定个小目标，比如「30 分钟完成 12 道题」。');
    if (accuracy !== null && accuracy < 0.7) {
      tips.push(pace > 1.4 ? '速度很快但正确率不高，放慢一点，先求准再求快。' : '正确率偏低，把错题抄到错题本，弄懂每道错题再往下做。');
    }
    if (mastery <= 2) tips.push('感觉还没掌握牢，明天花 10 分钟再回顾一遍，及时复习最有效。');
    if (activeMin < 15) tips.push('这次时间比较短，单次专注 20–45 分钟效果更好。');
    if (activeMin > 90 && interruptions === 0) tips.push('连续学习超过 90 分钟啦，记得每 45 分钟起来活动一下、看看远处。');
    if (!tips.length) tips.push(focus >= 85 && effect >= 85 ? '状态超棒，继续保持！' : '表现不错，下次争取再进步一点！');

    const r1 = (v) => Math.round(v * 10) / 10;
    return {
      focus,
      effect,
      focusParts: mapValues(focusParts, r1),
      effectParts: mapValues(effectParts, r1),
      metrics: {
        activeRatio: r1(activeRatio * 100),
        interruptRate: r1(interruptRate),
        noAmount,
        pace: noAmount ? null : r1(pace * 100),
        accuracy: accuracy === null ? null : r1(accuracy * 100),
        expected: noAmount ? null : r1(expected),
      },
      tips: tips.slice(0, 3),
    };
  }

  function mapValues(obj, fn) {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = fn(obj[k]);
    return out;
  }

  const FOCUS_LABELS = {
    active: { name: '有效时长占比', max: 35 },
    calm: { name: '少走神/少中断', max: 25 },
    pace: { name: '学习效率', max: 25 },
    self: { name: '自我评价', max: 15 },
  };
  const EFFECT_LABELS = {
    amount: { name: '学习量达成', max: 30 },
    quality: { name: '正确率/掌握度', max: 35 },
    duration: { name: '有效学习时长', max: 15 },
    focus: { name: '专注度加成', max: 20 },
  };

  return { SUBJECTS, TYPES, getType, unitOf, computeScores, level, clamp, FOCUS_LABELS, EFFECT_LABELS };
});
