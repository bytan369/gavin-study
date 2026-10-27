-- 学习小站 · 云端 AI 评估的使用记录（用来限制每人每天的次数）
-- 在 schema.sql 之后运行一次（重复运行没关系）。只有云端函数（service_role）能读写，网页端访问不到。
create table if not exists public.study_ai_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('ping', 'evaluate')),
  created_at timestamptz not null default now()
);
create index if not exists study_ai_log_user_time_idx on public.study_ai_log (user_id, created_at);
alter table public.study_ai_log enable row level security;
revoke all on public.study_ai_log from anon, authenticated;
