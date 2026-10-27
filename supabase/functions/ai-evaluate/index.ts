// 云端 AI 评估。部署时关闭 JWT 校验（verify_jwt = false），函数里自己校验登录令牌。
// 需要在 Supabase 控制台 Edge Functions → Secrets 设置 AI_API_KEY（默认用硅基流动的免费模型 Qwen/Qwen3-8B）。
// 可选：AI_BASE_URL、AI_MODEL、AI_PROVIDER（用于选择附加参数，如关闭思考模式）、AI_DAILY_LIMIT（每人每天次数）。
import "./ai.js"; // 与网页共用同一份 js/ai.js（提示词、调用、解析），加载后挂在 globalThis.AI
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { handle } from "./core.mjs";

// deno-lint-ignore no-explicit-any
const AI = (globalThis as any).AI;
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const env = {
  apiKey: (Deno.env.get("AI_API_KEY") ?? "").trim(),
  baseUrl: Deno.env.get("AI_BASE_URL") ?? "https://api.siliconflow.cn/v1",
  model: Deno.env.get("AI_MODEL") ?? "Qwen/Qwen3-8B",
  provider: Deno.env.get("AI_PROVIDER") ?? "siliconflow",
  dailyLimit: Number(Deno.env.get("AI_DAILY_LIMIT") ?? 60),
};

const deps = {
  AI,
  env,
  now: () => Date.now(),
  async verifyUser(jwt: string) {
    const { data, error } = await admin.auth.getUser(jwt);
    return error || !data.user ? null : { id: data.user.id };
  },
  async countSince(userId: string, iso: string) {
    const r = await admin.from("study_ai_log").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", iso);
    if (r.error) throw new Error(r.error.message);
    return r.count ?? 0;
  },
  async log(userId: string, kind: string) {
    const { error } = await admin.from("study_ai_log").insert({ user_id: userId, kind });
    if (error) throw new Error(error.message);
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
    const r = await handle({ bearer, body }, deps);
    return reply(r.status, r.json);
  } catch (e) {
    console.error("ai-evaluate failed:", e instanceof Error ? e.message : e);
    return reply(500, { error: "云端 AI 出错了，稍后再试" });
  }
});
