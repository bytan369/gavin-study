// 日报的业务流程。数据库和邮件通过 deps 注入，方便在 Node 里用假实现测试；真实接线见 index.ts。
import { dayRange, sessionsOfDay, renderEmail, maskEmail } from './report.mjs';

export const MAX_USERS_PER_RUN = 200;
export const MAX_TESTS_PER_DAY = 5;

// 常量时间比较，避免通过响应时间猜密钥
export function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

export function describeMailError(e) {
  const code = e && e.code;
  if (code === 'NO_SMTP') return '邮件服务还没配置好（缺少发件邮箱设置）';
  if (code === 'EAUTH') return '发件邮箱登录失败，请检查授权码是否正确';
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET') return '连不上邮件服务器，请稍后再试';
  return '邮件发送失败，请稍后再试';
}

async function sendReport(userId, settings, range, deps) {
  const user = await deps.db.getUser(userId);
  if (!user || !user.email) return { ok: false, reason: '账号没有邮箱' };
  if (!user.confirmed) return { ok: false, reason: '邮箱还没有验证' };
  const rows = await deps.db.listSessions(userId, new Date(range.start).toISOString());
  const items = sessionsOfDay(rows, range);
  const mail = renderEmail({ name: settings.name, range, items, custom: settings.custom, goalMin: settings.goal });
  const me = user.email.toLowerCase();
  const cc = (deps.cc || []).filter((e) => e.toLowerCase() !== me);
  await deps.mailer.send({ to: user.email, cc, subject: mail.subject, text: mail.text, html: mail.html });
  return { ok: true, to: user.email, count: items.length };
}

const trim = (s) => String(s || '').slice(0, 200);

/**
 * req: { secret: x-cron-secret 请求头, bearer: 用户的登录令牌, body: 请求内容 }
 * 返回 { status, json }
 */
export async function processRequest(req, deps) {
  const mode = req.body && req.body.mode;
  const range = dayRange(deps.now());

  if (mode === 'daily') {
    const secret = await deps.db.getSecret();
    if (!secret || !req.secret || !safeEqual(secret, req.secret)) return { status: 401, json: { error: 'unauthorized' } };
    const profiles = await deps.db.listEnabledProfiles(MAX_USERS_PER_RUN);
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const p of profiles) {
      try {
        if (await deps.db.wasSent(p.user_id, range.key)) {
          skipped++;
          continue;
        }
        const r = await sendReport(p.user_id, p.settings || {}, range, deps);
        await deps.db.log({ user_id: p.user_id, report_date: range.key, kind: 'daily', ok: r.ok, error: r.ok ? null : r.reason });
        if (r.ok) sent++;
        else failed++;
      } catch (e) {
        failed++;
        await deps.db.log({ user_id: p.user_id, report_date: range.key, kind: 'daily', ok: false, error: trim(e && (e.code || e.message)) }).catch(() => {});
      }
    }
    return { status: 200, json: { date: range.key, sent, skipped, failed } };
  }

  if (mode === 'test') {
    const user = req.bearer ? await deps.db.verifyUser(req.bearer) : null;
    if (!user) return { status: 401, json: { error: '请先登录' } };
    if ((await deps.db.countTests(user.id, range.key)) >= MAX_TESTS_PER_DAY) {
      return { status: 429, json: { error: `今天已经发过 ${MAX_TESTS_PER_DAY} 封测试邮件了，明天再试` } };
    }
    const profile = await deps.db.getProfile(user.id);
    try {
      const r = await sendReport(user.id, (profile && profile.settings) || {}, range, deps);
      await deps.db.log({ user_id: user.id, report_date: range.key, kind: 'test', ok: r.ok, error: r.ok ? null : r.reason });
      if (!r.ok) return { status: 422, json: { error: r.reason } };
      return { status: 200, json: { ok: true, to: maskEmail(r.to), count: r.count } };
    } catch (e) {
      await deps.db.log({ user_id: user.id, report_date: range.key, kind: 'test', ok: false, error: trim(e && (e.code || e.message)) }).catch(() => {});
      return { status: 502, json: { error: describeMailError(e) } };
    }
  }

  return { status: 400, json: { error: 'bad request' } };
}
