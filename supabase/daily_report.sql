-- 学习小站 · 每晚 23:30（北京时间）自动发送学习日报
-- 在 schema.sql 之后运行一次（重复运行没关系）。需要先部署 Edge Function「daily-report」。

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 函数地址和调用密钥（只有数据库管理员 / service_role 能读，网页端完全访问不到）
create table if not exists public.study_report_config (
  id boolean primary key default true check (id),
  url text not null,
  secret text not null default (gen_random_uuid()::text || gen_random_uuid()::text)
);

-- 发送记录：同一天不重复发；测试邮件每天限次
create table if not exists public.study_report_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  report_date date not null,
  kind text not null check (kind in ('daily', 'test')),
  ok boolean not null,
  error text,
  sent_at timestamptz not null default now()
);
create index if not exists study_report_log_user_date_idx on public.study_report_log (user_id, report_date, kind);

alter table public.study_report_config enable row level security;
alter table public.study_report_log enable row level security;
revoke all on public.study_report_config from anon, authenticated;
revoke all on public.study_report_log from anon, authenticated;

-- 把下面的地址换成你自己的项目地址（Project URL + /functions/v1/daily-report）
insert into public.study_report_config (id, url)
values (true, 'https://xvltwxmemntfjgwnekaq.supabase.co/functions/v1/daily-report')
on conflict (id) do update set url = excluded.url;

create or replace function public.study_send_daily_report()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
begin
  select * into cfg from public.study_report_config where id;
  if not found then
    raise exception 'study_report_config is empty';
  end if;
  perform net.http_post(
    url := cfg.url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cfg.secret),
    body := jsonb_build_object('mode', 'daily'),
    timeout_milliseconds := 120000
  );
end;
$$;
revoke all on function public.study_send_daily_report() from public, anon, authenticated;

-- pg_cron 按 UTC 计时：北京时间 23:30 = UTC 15:30；15:45 再补发一次（已发送成功的会自动跳过）
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('study-daily-report', 'study-daily-report-retry');
  perform cron.schedule('study-daily-report', '30 15 * * *', 'select public.study_send_daily_report()');
  perform cron.schedule('study-daily-report-retry', '45 15 * * *', 'select public.study_send_daily_report()');
end;
$$;
