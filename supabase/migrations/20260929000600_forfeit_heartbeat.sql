-- 랭크 이탈 처리 (docs/mode-design.md §1.2 이탈, E단계)
--  · 매치 중 클라이언트는 10초마다 heartbeat → 서버가 "마지막으로 본 시각"을 안다 (클라이언트의 주장만 믿지 않기 위해)
--  · 나가면 기권패(forfeit_match). 새로 매칭을 시작해도 하던 랭크 매치는 기권패 (000500의 무효 처리를 대체 — 질 것 같을 때 나가서 레이팅을 지키는 것을 막는다)
--  · 상대가 25초 넘게 안 보이면 남은 쪽이 claim_absent → 상대 기권패로 바로 확정 (남은 쪽 승리)
-- 친구 대전은 대상이 아니다 (이탈하면 결과 없이 끝, 전적 미기록).

alter table public.matches
  add column if not exists p1_seen timestamptz not null default now(),
  add column if not exists p2_seen timestamptz not null default now();

alter table public.match_internal
  add column if not exists forfeit text check (forfeit in ('p1', 'p2'));

create or replace function public.heartbeat(p_match uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid();
begin
  update public.matches
     set p1_seen = case when p1 = me then now() else p1_seen end,
         p2_seen = case when p2 = me then now() else p2_seen end
   where id = p_match and status = 'live' and (p1 = me or p2 = me);
end $$;

-- 내부: 한쪽을 기권패로 기록하고, 확정할 수 있으면 확정한다
create or replace function public.apply_forfeit(p_match uuid, p_side text)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  blank jsonb := '{"reached":1,"life":0,"gold":0,"clearedSec":null}'::jsonb;
  won jsonb := '{"reached":2,"life":1,"gold":0,"clearedSec":null}'::jsonb;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'live' then return m; end if;
  insert into public.match_internal (match_id, forfeit) values (m.id, p_side)
  on conflict (match_id) do update set forfeit = coalesce(public.match_internal.forfeit, excluded.forfeit);
  -- 기권한 쪽은 빈 성적, 상대 쪽은 아직 보고 전이면 "이긴 성적"으로 채워 바로 확정한다.
  -- (상대 보고를 기다리면 매치가 live로 남아 기권한 사람의 다음 매칭을 막는다. 상대의 실제 보고는 확정 뒤라 무시되고, 승리는 그대로다)
  if p_side = 'p1' then
    update public.matches set p1_report = blank, p2_report = coalesce(p2_report, won) where id = m.id;
  else
    update public.matches set p2_report = blank, p1_report = coalesce(p1_report, won) where id = m.id;
  end if;
  select * into m from public.matches where id = p_match;
  if m.p1_report is not null and m.p2_report is not null then
    m := public.finalize_match(m.id);
    update public.matches set reason = 'forfeit' where id = m.id returning * into m;
  end if;
  return m;
end $$;

create or replace function public.forfeit_match(p_match uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if not found then raise exception 'match_not_found'; end if;
  if m.p1 <> me and m.p2 is distinct from me then raise exception 'not_in_match'; end if;
  if m.mode = 'ranked' and m.status = 'live' then
    m := public.apply_forfeit(m.id, case when m.p1 = me then 'p1' else 'p2' end);
  end if;
  return public.match_public(m, me);
end $$;

-- 상대가 안 보인다는 주장. 서버가 본 마지막 시각으로 확인한다. true면 상대 기권패로 매치가 확정됐다
create or replace function public.claim_absent(p_match uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); m public.matches; mi public.match_internal; side text; seen timestamptz;
begin
  select * into m from public.matches where id = p_match;
  if not found then raise exception 'match_not_found'; end if;
  if m.p1 <> me and m.p2 is distinct from me then raise exception 'not_in_match'; end if;
  if m.mode <> 'ranked' or m.p2 is null then return false; end if;
  if m.status <> 'live' then return true; end if;
  side := case when m.p1 = me then 'p2' else 'p1' end;
  select * into mi from public.match_internal where match_id = m.id;
  if mi.forfeit = side then return true; end if;
  seen := case when side = 'p1' then m.p1_seen else m.p2_seen end;
  if seen > now() - interval '25 seconds' then return false; end if;
  perform public.apply_forfeit(m.id, side);
  return true;
end $$;

-- 기권한 쪽의 성적은 이미 채워져 있으므로, 늦게 온 보고가 그것을 덮어쓰지 않는다 (기존 report_result는 null일 때만 채운다 — 그대로 둔다).
-- 확정 뒤 이유를 'forfeit'으로 남기기 위해 report_result를 감싼다.
create or replace function public.report_result(p_match uuid, p_report jsonb, p_opponent jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); m public.matches; mi public.match_internal;
begin
  select * into m from public.matches where id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if m.p1 <> me and m.p2 is distinct from me then raise exception 'not_in_match'; end if;
  if m.status <> 'live' then return public.match_public(m, me); end if;

  if m.p1 = me then
    if m.p1_report is null then
      update public.matches set p1_report = public.clean_report(p_report, m.wave_count) where id = m.id;
    end if;
    if m.p2 is null then
      if p_opponent is null then raise exception 'opponent_report_required'; end if;
      update public.matches set p2_report = public.clean_report(p_opponent, m.wave_count) where id = m.id and p2_report is null;
    end if;
  else
    if m.p2_report is null then
      update public.matches set p2_report = public.clean_report(p_report, m.wave_count) where id = m.id;
    end if;
  end if;

  select * into m from public.matches where id = p_match;
  if m.p1_report is not null and m.p2_report is not null then
    m := public.finalize_match(m.id);
    select * into mi from public.match_internal where match_id = m.id;
    if mi.forfeit is not null then
      update public.matches set reason = 'forfeit' where id = m.id returning * into m;
    end if;
  end if;
  return public.match_public(m, me);
end $$;

-- 새 매칭을 시작하면 하던 랭크 매치는 기권패
create or replace function public.enqueue()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); p public.profiles; r record;
begin
  p := public.ensure_profile();
  for r in select id, p1 from public.matches where mode = 'ranked' and status = 'live' and (p1 = me or p2 = me) loop
    perform public.apply_forfeit(r.id, case when r.p1 = me then 'p1' else 'p2' end);
  end loop;
  select * into p from public.profiles where id = me; -- 기권패로 레이팅이 바뀌었을 수 있다
  insert into public.queue (player_id, rating, enqueued_at, fallback_at)
  values (me, p.rating, now(), now() + make_interval(secs => 15 + random() * 25))
  on conflict (player_id) do update
    set rating = excluded.rating, enqueued_at = excluded.enqueued_at, fallback_at = excluded.fallback_at;
  return public.poll_match();
end $$;

grant execute on function public.heartbeat(uuid), public.forfeit_match(uuid), public.claim_absent(uuid) to authenticated;
revoke execute on function public.apply_forfeit(uuid, text) from public, anon, authenticated;
