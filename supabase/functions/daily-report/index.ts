// 每晚把当天的学习记录发到账号邮箱。
// - 定时：Supabase 的 pg_cron 在北京时间 23:30（UTC 15:30）调用，带 x-cron-secret 请求头
// - 手动：网页「设置」里的“发送测试邮件”，带用户的登录令牌
// 部署时需要关闭 JWT 校验（verify_jwt = false），函数里自己校验上面两种身份。
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import nodemailer from "npm:nodemailer@6.9.16";
import { processRequest } from "./core.mjs";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 可选：给所有账号的日报都抄送这些邮箱（只能由 Supabase 控制台里的 REPORT_CC 设置，网页上改不了）
const ccList = () => (Deno.env.get("REPORT_CC") ?? "").split(/[,;\s]+/).filter((e) => EMAIL_RE.test(e));

const must = <T>(r: { data: T; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

const db = {
  async getSecret() {
    const r = await admin.from("study_report_config").select("secret").eq("id", true).maybeSingle();
    return must(r)?.secret ?? null;
  },
  async listEnabledProfiles(limit: number) {
    const r = await admin.from("study_profile").select("user_id, settings").eq("settings->>reportEnabled", "true").limit(limit);
    return must(r) ?? [];
  },
  async getProfile(userId: string) {
    return must(await admin.from("study_profile").select("settings").eq("user_id", userId).maybeSingle());
  },
  async listSessions(userId: string, sinceIso: string) {
    const r = await admin.from("study_sessions").select("id, data").eq("user_id", userId).eq("deleted", false).gte("updated_at", sinceIso).limit(500);
    return must(r) ?? [];
  },
  async getUser(userId: string) {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data.user) return null;
    return { email: data.user.email ?? "", confirmed: !!data.user.email_confirmed_at };
  },
  async wasSent(userId: string, key: string) {
    const r = await admin.from("study_report_log").select("id").eq("user_id", userId).eq("report_date", key).eq("kind", "daily").eq("ok", true).limit(1);
    return (must(r) ?? []).length > 0;
  },
  async countTests(userId: string, key: string) {
    const r = await admin.from("study_report_log").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("report_date", key).eq("kind", "test");
    if (r.error) throw new Error(r.error.message);
    return r.count ?? 0;
  },
  async log(row: Record<string, unknown>) {
    const { error } = await admin.from("study_report_log").insert(row);
    if (error) throw new Error(error.message);
  },
  async verifyUser(jwt: string) {
    const { data, error } = await admin.auth.getUser(jwt);
    return error || !data.user ? null : { id: data.user.id };
  },
};

const mailer = {
  async send(m: { to: string; cc: string[]; subject: string; text: string; html: string }) {
    const user = Deno.env.get("SMTP_USER");
    const pass = Deno.env.get("SMTP_PASS");
    if (!user || !pass) throw Object.assign(new Error("SMTP not configured"), { code: "NO_SMTP" });
    const host = Deno.env.get("SMTP_HOST") ?? "smtp.qq.com";
    const port = Number(Deno.env.get("SMTP_PORT") ?? 465);
    // Supabase 云函数不允许连 25 和 587 端口，QQ / 163 的 SSL 端口 465 可以
    const transport = nodemailer.createTransport({
      host, port, secure: port === 465, auth: { user, pass }, connectionTimeout: 15000, socketTimeout: 30000,
    });
    await transport.sendMail({ from: `"学习小站" <${user}>`, to: m.to, cc: m.cc.length ? m.cc : undefined, subject: m.subject, text: m.text, html: m.html });
  },
};

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "method not allowed" });
  try {
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* 空请求体 */ }
    const auth = req.headers.get("authorization") ?? "";
    const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const r = await processRequest(
      { secret: req.headers.get("x-cron-secret") ?? "", bearer, body },
      { now: () => Date.now(), db, mailer, cc: ccList() },
    );
    return reply(r.status, r.json);
  } catch (e) {
    console.error("daily-report failed:", e instanceof Error ? e.message : e);
    return reply(500, { error: "服务出错了，请稍后再试" });
  }
});
