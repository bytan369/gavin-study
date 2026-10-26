-- 学习小站 · Supabase 数据表
-- 在 Supabase 控制台 → SQL Editor 中粘贴并运行一次即可（重复运行也没关系）。
-- 每个账号只能读写自己的数据（行级安全策略 RLS）。

-- 学习记录：一条学习一行，data 存完整记录；删除时保留一行 deleted = true，方便其他设备同步删除
create table if not exists public.study_sessions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);
create index if not exists study_sessions_user_updated_idx on public.study_sessions (user_id, updated_at);

-- 个人设置和正在进行的计时（每个账号一行）
create table if not exists public.study_profile (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  running jsonb,
  updated_at timestamptz not null default clock_timestamp()
);

-- 更新时间由数据库统一生成，各设备据此增量拉取
create or replace function public.study_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists study_sessions_touch on public.study_sessions;
create trigger study_sessions_touch
  before insert or update on public.study_sessions
  for each row execute function public.study_touch_updated_at();

drop trigger if exists study_profile_touch on public.study_profile;
create trigger study_profile_touch
  before insert or update on public.study_profile
  for each row execute function public.study_touch_updated_at();

-- 行级安全：只能访问自己的数据
alter table public.study_sessions enable row level security;
alter table public.study_profile enable row level security;

drop policy if exists "own study sessions" on public.study_sessions;
create policy "own study sessions" on public.study_sessions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own study profile" on public.study_profile;
create policy "own study profile" on public.study_profile
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.study_sessions to authenticated;
grant select, insert, update, delete on public.study_profile to authenticated;
revoke all on public.study_sessions from anon;
revoke all on public.study_profile from anon;
revoke truncate, references, trigger on public.study_sessions, public.study_profile from authenticated;
