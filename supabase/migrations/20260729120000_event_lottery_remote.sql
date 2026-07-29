-- 活動抽獎「手機遙控」最小 Supabase 架構。
--
-- 設計原則（對照 PR 說明的隱私範圍）：
--   * 這張表只存「配對 session」本身（誰是主控電腦、誰是手機、什麼時候到期／
--     撤銷），完全不含參加者名單、員工編號、部門、得獎紀錄或任何圖片——那些
--     資料永遠只留在瀏覽器 localStorage，不會被寫進 Supabase。
--   * pairing token 只存 SHA-256 雜湊，不存明文；RPC 回傳值也刻意不含雜湊本身。
--   * 資料表本身不開放任何直接的 SELECT/INSERT/UPDATE/DELETE 權限，一律只能
--     透過下面三個 SECURITY DEFINER RPC 存取，RPC 內部逐一檢查權限與有效期限。
--   * Realtime 廣播頻道（lottery:<session-id>）只有 session 的 host 或已配對的
--     手機（authenticated user，含匿名登入）能加入，且 session 必須未過期、未撤銷。

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.lottery_remote_sessions (
  id uuid primary key default gen_random_uuid(),
  topic text unique not null,
  host_user_id uuid not null,
  remote_user_id uuid null,
  pairing_token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lottery_remote_sessions_host_user_id_idx on public.lottery_remote_sessions (host_user_id);
create index if not exists lottery_remote_sessions_remote_user_id_idx on public.lottery_remote_sessions (remote_user_id);
create index if not exists lottery_remote_sessions_expires_at_idx on public.lottery_remote_sessions (expires_at);

-- 開啟 RLS 且不建立任何 policy：資料表對 anon／authenticated 一律無法直接
-- SELECT/INSERT/UPDATE/DELETE，所有存取都必須經過下面的 SECURITY DEFINER RPC。
alter table public.lottery_remote_sessions enable row level security;

revoke all on public.lottery_remote_sessions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC：create_lottery_remote_session — 電腦按下「啟用手機遙控」時呼叫。
-- ---------------------------------------------------------------------------
create or replace function public.create_lottery_remote_session(pairing_token text)
returns table (id uuid, topic text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_id uuid := gen_random_uuid();
  new_topic text;
  new_expires_at timestamptz := now() + interval '6 hours';
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if pairing_token is null or length(pairing_token) < 32 then
    raise exception 'invalid pairing token';
  end if;

  new_topic := 'lottery:' || new_id::text;

  insert into public.lottery_remote_sessions
    (id, topic, host_user_id, pairing_token_hash, expires_at, created_at, updated_at)
  values
    (new_id, new_topic, auth.uid(), encode(digest(pairing_token, 'sha256'), 'hex'), new_expires_at, now(), now());

  return query select new_id, new_topic, new_expires_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC：claim_lottery_remote_session — 手機掃描 QR Code 後呼叫，配對成功即綁定
-- 這支手機的 auth.uid()。同一 session 只允許一支手機；已經被別人配對時拒絕。
-- 同一支手機（同一個 auth.uid()）重整或重新掃碼可以再次 claim 成功，方便斷線
-- 或重新整理後恢復。
-- ---------------------------------------------------------------------------
create or replace function public.claim_lottery_remote_session(session_id uuid, pairing_token text)
returns table (id uuid, topic text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  session_row public.lottery_remote_sessions;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select * into session_row
  from public.lottery_remote_sessions s
  where s.id = claim_lottery_remote_session.session_id
  for update;

  if not found then
    raise exception 'session not found';
  end if;
  if session_row.revoked_at is not null then
    raise exception 'session revoked';
  end if;
  if session_row.expires_at <= now() then
    raise exception 'session expired';
  end if;
  if session_row.pairing_token_hash <> encode(digest(pairing_token, 'sha256'), 'hex') then
    raise exception 'invalid pairing token';
  end if;
  if session_row.remote_user_id is not null and session_row.remote_user_id <> auth.uid() then
    raise exception 'session already claimed by another device';
  end if;

  update public.lottery_remote_sessions s
  set remote_user_id = auth.uid(), updated_at = now()
  where s.id = claim_lottery_remote_session.session_id;

  return query select session_row.id, session_row.topic, session_row.expires_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC：revoke_lottery_remote_session — 只有 host 可以撤銷；撤銷後舊手機的所有
-- 指令都會被 realtime RLS 與舞台端的 session 檢查一併拒絕。
-- ---------------------------------------------------------------------------
create or replace function public.revoke_lottery_remote_session(session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.lottery_remote_sessions s
  set revoked_at = now(), updated_at = now()
  where s.id = revoke_lottery_remote_session.session_id
    and s.host_user_id = auth.uid();

  if not found then
    raise exception 'session not found or not owned by caller';
  end if;
end;
$$;

revoke all on function public.create_lottery_remote_session(text) from public;
revoke all on function public.claim_lottery_remote_session(uuid, text) from public;
revoke all on function public.revoke_lottery_remote_session(uuid) from public;

grant execute on function public.create_lottery_remote_session(text) to authenticated;
grant execute on function public.claim_lottery_remote_session(uuid, text) to authenticated;
grant execute on function public.revoke_lottery_remote_session(uuid) to authenticated;

-- Realtime 的 RLS policy 需要判斷 session 成員，但 session table 刻意不給
-- authenticated 直接 SELECT。用 SECURITY DEFINER helper 讓 policy 能安全讀取
-- 成員關係，同時不開放 pairing_token_hash 或任何 session row 給瀏覽器查詢。
create or replace function public.is_lottery_remote_session_member(requested_topic text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.lottery_remote_sessions s
    where s.topic = requested_topic
      and s.revoked_at is null
      and s.expires_at > now()
      and (s.host_user_id = auth.uid() or s.remote_user_id = auth.uid())
  );
$$;

revoke all on function public.is_lottery_remote_session_member(text) from public;
grant execute on function public.is_lottery_remote_session_member(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime Authorization：private broadcast channel `lottery:<session-id>`。
-- 只有 session 的 host 或已配對的手機（authenticated，含匿名登入），且 session
-- 尚未過期、尚未撤銷，才能加入或送出 broadcast 訊息。第一版不使用 Presence。
-- ---------------------------------------------------------------------------
alter table realtime.messages enable row level security;

drop policy if exists "lottery session members can receive broadcast" on realtime.messages;
create policy "lottery session members can receive broadcast"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and public.is_lottery_remote_session_member((select realtime.topic()))
);

drop policy if exists "lottery session members can send broadcast" on realtime.messages;
create policy "lottery session members can send broadcast"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and public.is_lottery_remote_session_member((select realtime.topic()))
);
