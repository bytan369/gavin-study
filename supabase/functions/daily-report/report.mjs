// 学习日报的纯函数：日期（北京时间）、统计、邮件内容。不依赖任何运行环境，Node 和 Deno 都能直接用。

export const TZ_OFFSET_MIN = 480; // 北京时间 UTC+8
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const DAY_MS = 86400000;

// 与 js/scoring.js 保持一致（tests/report.test.js 会检查是否同步）
export const SUBJECT_INFO = {
  chinese: ['语文', '📖'], math: ['数学', '📐'], english: ['英语', '🔤'], physics: ['物理', '🧲'],
  chemistry: ['化学', '⚗️'], biology: ['生物', '🧬'], history: ['历史', '🏛️'], geography: ['地理', '🌏'],
  politics: ['道法/政治', '⚖️'], science: ['科学', '🔬'], it: ['信息技术', '💻'], tech: ['通用技术', '🛠️'],
  music: ['音乐', '🎵'], art: ['美术', '🎨'], pe: ['体育与健康', '⚽'], calligraphy: ['书法', '🖌️'],
  language2: ['第二外语', '🌐'], project: ['综合实践', '🧩'], other: ['其他', '📝'],
};
export const TYPE_INFO = {
  practice: ['做题练习', '题'], homework: ['写作业', '题'], reading: ['阅读/预习', '页'], memorize: ['背诵/记忆', '个'],
  review: ['复习/整理', '个'], writing: ['写作/练笔', '字'], listening: ['听力/口语', '篇'], skill: ['技能练习', '组'],
};
const WORD_UNIT_SUBJECTS = ['english', 'language2'];

const pad = (n) => String(n).padStart(2, '0');

export function localParts(ts, offsetMin = TZ_OFFSET_MIN) {
  const d = new Date(ts + offsetMin * 60000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}

// 某个时刻所在的那一天（北京时间）：[start, end) 毫秒时间戳和 'YYYY-MM-DD'
export function dayRange(ts, offsetMin = TZ_OFFSET_MIN) {
  const p = localParts(ts, offsetMin);
  const start = Date.UTC(p.y, p.m - 1, p.d) - offsetMin * 60000;
  return { start, end: start + DAY_MS, key: `${p.y}-${pad(p.m)}-${pad(p.d)}`, label: `${p.m}月${p.d}日 ${WEEK[p.wd]}` };
}

export const fmtClock = (ts, offsetMin = TZ_OFFSET_MIN) => {
  const p = localParts(ts, offsetMin);
  return `${pad(p.hh)}:${pad(p.mm)}`;
};

export function fmtMin(min) {
  const m = Math.round(min);
  if (m < 1) return min > 0 ? '不足1分钟' : '0分钟';
  if (m < 60) return `${m}分钟`;
  return `${Math.floor(m / 60)}小时${m % 60 ? `${m % 60}分` : ''}`;
}

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function subjectOf(id, custom = []) {
  const c = (custom || []).find((x) => x && x.id === id);
  if (c) return { name: String(c.name || id), emoji: String(c.emoji || '📝') };
  const b = SUBJECT_INFO[id];
  return b ? { name: b[0], emoji: b[1] } : { name: '其他', emoji: '📝' };
}

export function typeOf(id, subjectId) {
  const t = TYPE_INFO[id] || ['学习', '个'];
  const unit = id === 'writing' && WORD_UNIT_SUBJECTS.includes(subjectId) ? '词' : t[1];
  return { name: t[0], unit };
}

// 只保留开始时间落在当天的记录，按时间排序
export function sessionsOfDay(rows, range) {
  return (rows || [])
    .map((r) => (r && r.data ? Object.assign({}, r.data, { id: r.id }) : null))
    .filter((s) => s && Number.isFinite(s.start) && s.start >= range.start && s.start < range.end)
    .sort((a, b) => a.start - b.start);
}

const weighted = (list, field) => {
  const w = list.reduce((a, s) => a + Math.max(+s.activeMin || 0, 1), 0);
  if (!w) return null;
  return Math.round(list.reduce((a, s) => a + (+s[field] || 0) * Math.max(+s.activeMin || 0, 1), 0) / w);
};

const scopeLabel = (s) => (s && s.scope === 'in' ? '课内' : s && s.scope === 'out' ? '课外' : '');

export function scopeMinutes(items) {
  const r = { in: 0, out: 0, none: 0 };
  for (const s of items) r[s.scope === 'in' ? 'in' : s.scope === 'out' ? 'out' : 'none'] += +s.activeMin || 0;
  return r;
}

export function summarize(items, custom = []) {
  const bySubject = {};
  for (const s of items) (bySubject[s.subject] = bySubject[s.subject] || []).push(s);
  const subjects = Object.entries(bySubject)
    .map(([id, list]) => Object.assign(subjectOf(id, custom), {
      id, count: list.length, min: list.reduce((a, s) => a + (+s.activeMin || 0), 0), focus: weighted(list, 'focus'), effect: weighted(list, 'effect'),
    }))
    .sort((a, b) => b.min - a.min);
  return {
    count: items.length,
    totalMin: items.reduce((a, s) => a + (+s.activeMin || 0), 0),
    scopes: scopeMinutes(items),
    focus: weighted(items, 'focus'),
    effect: weighted(items, 'effect'),
    subjects,
  };
}

const NOTE_MAX = 400;
const clip = (t) => {
  const s = String(t || '').trim();
  return s.length > NOTE_MAX ? `${s.slice(0, NOTE_MAX)}…` : s;
};

function itemLine(s, custom) {
  const sub = subjectOf(s.subject, custom);
  const t = typeOf(s.type, s.subject);
  const amount = s.amount === null || s.amount === undefined ? '' : `，${s.amount}${t.unit}`;
  return { sub, t, amount, scope: scopeLabel(s), time: `${fmtClock(s.start)}–${fmtClock(s.end)}`, note: clip(s.note) };
}

// 生成邮件。name：昵称；goalMin：每日目标（分钟）
export function renderEmail({ name, range, items, custom = [], goalMin = 0 }) {
  const who = (name || '').trim() || '同学';
  const sum = summarize(items, custom);
  const subject = sum.count
    ? `【学习小站】${who} ${range.label.split(' ')[0]}学习日报：共${fmtMin(sum.totalMin)}，专注${sum.focus} · 效果${sum.effect}`
    : `【学习小站】${who} ${range.label.split(' ')[0]}学习日报：今天没有学习记录`;
  const pct = goalMin > 0 ? Math.round((sum.totalMin / goalMin) * 100) : null;

  // 纯文本版
  const lines = [`${who} 的学习日报 · ${range.label}`, ''];
  if (!sum.count) {
    lines.push('今天没有学习记录。');
  } else {
    lines.push(`总学习时间：${fmtMin(sum.totalMin)}（${sum.count} 次）${pct !== null ? `，目标完成 ${pct}%` : ''}`);
    lines.push(`平均专注度：${sum.focus} 分　平均学习效果：${sum.effect} 分`);
    lines.push(`课内：${fmtMin(sum.scopes.in)}　课外：${fmtMin(sum.scopes.out)}${sum.scopes.none > 0 ? `　未标记：${fmtMin(sum.scopes.none)}` : ''}`, '', '各科：');
    for (const s of sum.subjects) lines.push(`  ${s.emoji} ${s.name}　${fmtMin(s.min)}（${s.count} 次）　专注 ${s.focus} · 效果 ${s.effect}`);
    lines.push('', '明细：');
    for (const s of items) {
      const l = itemLine(s, custom);
      lines.push(`  ${l.time}　${l.sub.name}${l.scope ? `（${l.scope}）` : ''} · ${l.t.name}　${fmtMin(s.activeMin)}${l.amount}　专注 ${s.focus} · 效果 ${s.effect}`);
      if (l.note) lines.push(`      内容：${l.note.replace(/\n/g, ' / ')}`);
    }
  }
  lines.push('', '—— 学习小站 每晚 23:30 自动发送');
  const text = lines.join('\n');

  // HTML 版（内联样式，兼容邮箱客户端）
  const td = 'padding:6px 8px;border-bottom:1px solid #eef1f5;font-size:13px;';
  const stat = (label, value) => `<td style="padding:10px 12px;background:#f4f7fb;border-radius:10px;text-align:center"><div style="font-size:12px;color:#8a96a3">${label}</div><div style="font-size:20px;font-weight:700;color:#1f2933">${value}</div></td><td style="width:8px"></td>`;
  let body;
  if (!sum.count) {
    body = '<p style="margin:24px 0;color:#52606d;font-size:15px">今天没有学习记录。</p>';
  } else {
    body = `
      <table role="presentation" style="width:100%;border-collapse:separate;margin:14px 0"><tr>
        ${stat('总学习时间', esc(fmtMin(sum.totalMin)))}${stat('学习次数', `${sum.count} 次`)}${stat('平均专注度', sum.focus)}${stat('平均学习效果', sum.effect)}
      </tr></table>
      <p style="margin:0 0 6px;color:#52606d;font-size:13px">课内 <b>${esc(fmtMin(sum.scopes.in))}</b> · 课外 <b>${esc(fmtMin(sum.scopes.out))}</b>${sum.scopes.none > 0 ? ` · 未标记 <b>${esc(fmtMin(sum.scopes.none))}</b>` : ''}</p>
      ${pct !== null ? `<p style="margin:0 0 14px;color:#52606d;font-size:13px">今日目标 ${esc(fmtMin(goalMin))}，完成 <b>${pct}%</b></p>` : ''}
      <h3 style="margin:16px 0 6px;font-size:14px;color:#1f2933">各科</h3>
      <table style="width:100%;border-collapse:collapse">${sum.subjects.map((s) => `<tr><td style="${td}">${esc(s.emoji)} ${esc(s.name)}</td><td style="${td}text-align:right">${esc(fmtMin(s.min))}（${s.count} 次）</td><td style="${td}text-align:right;color:#52606d">专注 ${s.focus} · 效果 ${s.effect}</td></tr>`).join('')}</table>
      <h3 style="margin:18px 0 6px;font-size:14px;color:#1f2933">明细</h3>
      ${items.map((s) => {
        const l = itemLine(s, custom);
        return `<div style="padding:10px 0;border-bottom:1px solid #eef1f5">
          <div style="font-size:14px;color:#1f2933"><b>${esc(l.sub.emoji)} ${esc(l.sub.name)}</b>${l.scope ? ` <span style="font-size:11px;background:#eef1f5;border-radius:99px;padding:1px 8px;color:#52606d">${l.scope}</span>` : ''} · ${esc(l.t.name)} <span style="color:#8a96a3;font-size:12px">${l.time}</span></div>
          <div style="font-size:12px;color:#52606d;margin-top:2px">有效 ${esc(fmtMin(s.activeMin))}${esc(l.amount)} · 专注 ${s.focus} · 效果 ${s.effect}</div>
          ${l.note ? `<div style="font-size:13px;color:#1f2933;background:#f8fafc;border-radius:8px;padding:6px 10px;margin-top:6px;white-space:pre-wrap">${esc(l.note)}</div>` : ''}
        </div>`;
      }).join('')}`;
  }
  const html = `<!doctype html><html><body style="margin:0;padding:16px;background:#f4f7fb;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:20px 22px">
      <div style="font-size:18px;font-weight:700;color:#1f2933">📚 ${esc(who)} 的学习日报</div>
      <div style="font-size:13px;color:#8a96a3;margin-top:2px">${esc(range.label)}</div>
      ${body}
      <p style="margin:20px 0 0;font-size:12px;color:#8a96a3">学习小站 每晚 23:30（北京时间）自动发送。不想收到可以在网页「设置」里关闭。</p>
    </div></body></html>`;
  return { subject, text, html };
}

export function maskEmail(email) {
  const [u, d] = String(email || '').split('@');
  if (!d) return '';
  const head = u.length <= 2 ? u[0] || '' : u.slice(0, 2);
  const tail = u.length <= 4 ? '' : u.slice(-2);
  return `${head}***${tail}@${d}`;
}
