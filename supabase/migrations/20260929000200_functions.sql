-- 포커디펜스 서버 로직 (RPC). 전부 SECURITY DEFINER + search_path 고정, authenticated 에게만 실행 권한.
-- 규칙 근거: docs/mode-design.md §1.1.1(숨김 대체 매칭) · §1.2(랭크) · §1.3(친구 대전) · §2.6(레이팅)

-- ── 공용 헬퍼 ──────────────────────────────────────────
create or replace function public.require_uid() returns uuid
language plpgsql stable set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return me;
end $$;

create or replace function public.new_seed() returns text
language sql volatile set search_path = public as $$
  select replace(gen_random_uuid()::text, '-', '')
$$;

-- ELO-lite: round(K × (score − 기대승률))
create or replace function public.elo_delta(ra int, rb int, score numeric, k int) returns int
language sql immutable set search_path = public as $$
  select round(k * (score - 1.0 / (1.0 + power(10.0, (rb - ra) / 400.0))))::int
$$;

-- 방장 규칙 정규화 (허용값 밖이면 기본값). 기본 = 랭크 대전과 동일
create or replace function public.normalize_rules(r jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'waves', case when jsonb_typeof(r -> 'waves') = 'number' and (r ->> 'waves')::numeric in (20, 40) then (r ->> 'waves')::int else 20 end,
    'betting', case when jsonb_typeof(r -> 'betting') = 'boolean' then (r -> 'betting')::boolean else true end,
    'allHeroes', case when jsonb_typeof(r -> 'allHeroes') = 'boolean' then (r -> 'allHeroes')::boolean else true end,
    'sharedHand', case when jsonb_typeof(r -> 'sharedHand') = 'boolean' then (r -> 'sharedHand')::boolean else false end,
    'speed', case when jsonb_typeof(r -> 'speed') = 'number' and (r ->> 'speed')::numeric in (1, 2) then (r ->> 'speed')::int else 1 end,
    'applyMeta', case when jsonb_typeof(r -> 'applyMeta') = 'boolean' then (r -> 'applyMeta')::boolean else false end,
    -- 교환권 매치당 상한: 0 / 3 / -1(무제한)
    'tickets', case when jsonb_typeof(r -> 'tickets') = 'number' and (r ->> 'tickets')::numeric in (0, 3, -1) then (r ->> 'tickets')::int else 3 end
  )
$$;

-- 랭크 대전 고정 규칙
create or replace function public.ranked_rules() returns jsonb
language sql immutable set search_path = public as $$
  select public.normalize_rules('{}'::jsonb)
$$;

-- 매치를 호출자 시점으로 직렬화 (상대 종류는 절대 포함하지 않는다)
create or replace function public.match_public(m public.matches, me uuid) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  role text := case when m.p1 = me then 'p1' else 'p2' end;
  opp_id uuid := case when m.p1 = me then m.p2 else m.p1 end;
  opp jsonb;
begin
  if opp_id is not null then
    select jsonb_build_object('id', p.id, 'name', p.nick, 'rating', p.rating, 'avatar', p.avatar)
      into opp from public.profiles p where p.id = opp_id;
  else
    opp := jsonb_build_object('id', null, 'name', m.p2_name, 'rating', m.p2_rating, 'avatar', m.p2_avatar);
  end if;
  return jsonb_build_object(
    'id', m.id, 'mode', m.mode, 'seed', m.seed, 'waveCount', m.wave_count, 'rules', m.rules,
    'role', role, 'opponent', opp, 'startedAt', m.started_at, 'status', m.status,
    'winner', m.winner, 'reason', m.reason,
    'ratingDelta', case when role = 'p1' then m.rating_delta_p1 else m.rating_delta_p2 end
  );
end $$;

-- ── 프로필 ─────────────────────────────────────────────
create or replace function public.ensure_profile(p_nick text default null, p_avatar text default null)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); p public.profiles;
begin
  select * into p from public.profiles where id = me;
  if found then return p; end if;
  insert into public.profiles (id, nick, avatar)
  values (
    me,
    coalesce(nullif(btrim(p_nick), ''), '플레이어' || lpad((floor(random() * 10000))::int::text, 4, '0')),
    coalesce(p_avatar, (array['S', 'H', 'D', 'C'])[1 + floor(random() * 4)::int])
  )
  returning * into p;
  return p;
end $$;

create or replace function public.update_profile(p_nick text default null, p_avatar text default null)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); p public.profiles;
begin
  update public.profiles
     set nick = coalesce(nullif(btrim(p_nick), ''), nick),
         avatar = coalesce(p_avatar, avatar),
         updated_at = now()
   where id = me
  returning * into p;
  if not found then raise exception 'profile_missing'; end if;
  return p;
end $$;

create or replace function public.report_campaign(p_wave int)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); p public.profiles;
begin
  update public.profiles set best_campaign_wave = greatest(best_campaign_wave, least(greatest(p_wave, 0), 40)), updated_at = now()
   where id = me returning * into p;
  return p;
end $$;

-- ── 친구 대전 방 ───────────────────────────────────────
create or replace function public.gen_room_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from public.rooms where code = c and status <> 'closed');
  end loop;
  return c;
end $$;

-- 만료된 대기 방 정리 (방 만들기·참가 때 기회적으로 호출)
create or replace function public.close_stale_rooms() returns void
language sql security definer set search_path = public as $$
  update public.rooms set status = 'closed'
   where status in ('waiting', 'done') and expires_at < now()
$$;

create or replace function public.create_room(p_rules jsonb default '{}'::jsonb)
returns public.rooms
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); r public.rooms;
begin
  perform public.ensure_profile();
  perform public.close_stale_rooms();
  -- 내가 열어둔 다른 방은 닫는다 (한 번에 방 하나)
  update public.rooms set status = 'closed' where host = me and status in ('waiting', 'done');
  update public.rooms set guest = null, guest_ready = false where guest = me and status in ('waiting', 'done');
  insert into public.rooms (code, host, rules)
  values (public.gen_room_code(), me, public.normalize_rules(coalesce(p_rules, '{}'::jsonb)))
  returning * into r;
  return r;
end $$;

create or replace function public.join_room(p_code text)
returns public.rooms
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); r public.rooms;
begin
  perform public.ensure_profile();
  perform public.close_stale_rooms();
  select * into r from public.rooms
   where code = upper(btrim(p_code)) and status <> 'closed'
   for update;
  if not found then raise exception 'room_not_found'; end if;
  if r.host = me or r.guest = me then return r; end if; -- 재입장
  if r.status <> 'waiting' then raise exception 'room_in_progress'; end if;
  if r.guest is not null then raise exception 'room_full'; end if;
  update public.rooms
     set guest = me, guest_ready = false, host_ready = false, expires_at = now() + interval '30 minutes'
   where id = r.id
  returning * into r;
  return r;
end $$;

create or replace function public.set_room_rules(p_code text, p_rules jsonb)
returns public.rooms
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); r public.rooms;
begin
  select * into r from public.rooms where code = upper(btrim(p_code)) and status in ('waiting', 'done') for update;
  if not found then raise exception 'room_not_found'; end if;
  if r.host <> me then raise exception 'host_only'; end if;
  -- 규칙이 바뀌면 준비 상태를 푼다 (바뀐 룰을 확인하고 다시 준비)
  update public.rooms
     set rules = public.normalize_rules(coalesce(p_rules, '{}'::jsonb)), host_ready = false, guest_ready = false
   where id = r.id
  returning * into r;
  return r;
end $$;

-- 준비/재대결: 양쪽 다 준비되면 새 시드로 매치를 만든다 (판이 끝난 방에서 다시 준비 = 재대결)
create or replace function public.set_ready(p_code text, p_ready boolean default true)
returns public.rooms
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); r public.rooms; m public.matches;
begin
  select * into r from public.rooms where code = upper(btrim(p_code)) and status in ('waiting', 'done') for update;
  if not found then raise exception 'room_not_found'; end if;
  if r.host <> me and r.guest is distinct from me then raise exception 'not_in_room'; end if;
  if r.guest is null then raise exception 'waiting_for_guest'; end if;

  if r.host = me then r.host_ready := p_ready; else r.guest_ready := p_ready; end if;

  if r.host_ready and r.guest_ready then
    insert into public.matches (mode, room_id, seed, wave_count, rules, p1, p2)
    values ('friend', r.id, public.new_seed(), (r.rules ->> 'waves')::int, r.rules, r.host, r.guest)
    returning * into m;
    insert into public.match_internal (match_id, opponent_kind) values (m.id, 'human');
    update public.rooms
       set host_ready = false, guest_ready = false, status = 'live', match_id = m.id,
           games_played = games_played + 1, expires_at = now() + interval '2 hours'
     where id = r.id
    returning * into r;
  else
    update public.rooms set host_ready = r.host_ready, guest_ready = r.guest_ready where id = r.id
    returning * into r;
  end if;
  return r;
end $$;

create or replace function public.leave_room(p_code text)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); r public.rooms;
begin
  select * into r from public.rooms where code = upper(btrim(p_code)) and status <> 'closed' for update;
  if not found then return; end if;
  if r.host = me then
    update public.rooms set status = 'closed' where id = r.id; -- 방장이 나가면 방 폐기
  elsif r.guest = me then
    if r.status = 'live' then
      update public.rooms set status = 'closed' where id = r.id;
    else
      update public.rooms set guest = null, guest_ready = false, host_ready = false, status = 'waiting',
             expires_at = now() + interval '10 minutes'
       where id = r.id;
    end if;
  end if;
end $$;

create or replace function public.kick_guest(p_code text)
returns public.rooms
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); r public.rooms;
begin
  select * into r from public.rooms where code = upper(btrim(p_code)) and status in ('waiting', 'done') for update;
  if not found then raise exception 'room_not_found'; end if;
  if r.host <> me then raise exception 'host_only'; end if;
  update public.rooms set guest = null, guest_ready = false, host_ready = false, status = 'waiting'
   where id = r.id returning * into r;
  return r;
end $$;

-- ── 랭크 매칭 ──────────────────────────────────────────
create or replace function public.enqueue()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); p public.profiles;
begin
  p := public.ensure_profile();
  insert into public.queue (player_id, rating, enqueued_at, fallback_at)
  values (me, p.rating, now(), now() + make_interval(secs => 15 + random() * 25)) -- 15~40초 랜덤
  on conflict (player_id) do update
    set rating = excluded.rating, enqueued_at = excluded.enqueued_at, fallback_at = excluded.fallback_at;
  return public.poll_match();
end $$;

create or replace function public.cancel_queue()
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid();
begin
  delete from public.queue where player_id = me;
end $$;

-- 매칭 시도 (클라이언트가 2~3초마다 호출). 사람 → (fallback_at 이후) 고스트 → 봇
create or replace function public.poll_match()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_uid();
  q public.queue;
  opp public.queue;
  m public.matches;
  g public.ghosts;
  gp public.profiles;
  waited numeric;
  span int;
  bot_name text;
begin
  -- 이미 잡힌 매치가 있으면 그것 (상대가 나를 골랐을 때)
  select * into m from public.matches
   where mode = 'ranked' and status = 'live' and (p1 = me or p2 = me)
   order by started_at desc limit 1;
  if found then
    delete from public.queue where player_id = me;
    return jsonb_build_object('status', 'matched', 'match', public.match_public(m, me));
  end if;

  select * into q from public.queue where player_id = me for update;
  if not found then return jsonb_build_object('status', 'idle'); end if;

  waited := extract(epoch from (now() - q.enqueued_at));
  span := least(400, 100 + 50 * floor(waited / 10)::int); -- ±100에서 10초마다 +50, 최대 ±400

  -- 1) 사람
  select * into opp from public.queue
   where player_id <> me and abs(rating - q.rating) <= span
   order by enqueued_at
   limit 1
   for update skip locked;
  if found then
    insert into public.matches (mode, seed, wave_count, rules, p1, p2)
    values ('ranked', public.new_seed(), 20, public.ranked_rules(), opp.player_id, me)
    returning * into m;
    insert into public.match_internal (match_id, opponent_kind) values (m.id, 'human');
    delete from public.queue where player_id in (me, opp.player_id);
    return jsonb_build_object('status', 'matched', 'match', public.match_public(m, me));
  end if;

  -- 2) 대체 매칭 (유저에겐 일반 상대로 보인다)
  if now() >= q.fallback_at then
    select * into g from public.ghosts
     where player_id <> me and wave_count = 20 and abs(rating - q.rating) <= 150
     order by random() limit 1;
    if found then
      select * into gp from public.profiles where id = g.player_id;
      insert into public.matches (mode, seed, wave_count, rules, p1, p2, p2_name, p2_rating, p2_avatar)
      values ('ranked', g.seed, 20, public.ranked_rules(), me, null, gp.nick, g.rating, gp.avatar)
      returning * into m;
      insert into public.match_internal (match_id, opponent_kind, ghost_id) values (m.id, 'ghost', g.id);
    else
      -- 최근 5판에 쓴 닉은 피한다
      select b.name into bot_name from public.bot_names b
       where b.name not in (
         select x.p2_name from public.matches x
          where x.p1 = me and x.p2 is null and x.p2_name is not null
          order by x.started_at desc limit 5)
       order by random() limit 1;
      if bot_name is null then select b.name into bot_name from public.bot_names b order by random() limit 1; end if;
      insert into public.matches (mode, seed, wave_count, rules, p1, p2, p2_name, p2_rating, p2_avatar)
      values ('ranked', public.new_seed(), 20, public.ranked_rules(), me, null,
              coalesce(bot_name, '플레이어' || lpad((floor(random() * 10000))::int::text, 4, '0')),
              greatest(100, q.rating + (floor(random() * 161)::int - 80)), -- 레이팅 ±80
              (array['S', 'H', 'D', 'C'])[1 + floor(random() * 4)::int])
      returning * into m;
      insert into public.match_internal (match_id, opponent_kind) values (m.id, 'bot');
    end if;
    delete from public.queue where player_id = me;
    return jsonb_build_object('status', 'matched', 'match', public.match_public(m, me));
  end if;

  return jsonb_build_object('status', 'waiting', 'waited', round(waited), 'span', span);
end $$;

-- 대체 상대의 대본: 고스트면 입력 로그, 봇이면 null(클라이언트가 봇 두뇌로 진행). 사람 상대면 호출 불가
create or replace function public.get_opponent_script(p_match uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); m public.matches; mi public.match_internal; l public.match_logs; g public.ghosts;
begin
  select * into m from public.matches where id = p_match and p1 = me;
  if not found then raise exception 'match_not_found'; end if;
  if m.p2 is not null then raise exception 'live_opponent'; end if;
  select * into mi from public.match_internal where match_id = m.id;
  if mi.opponent_kind = 'ghost' then
    select * into g from public.ghosts where id = mi.ghost_id;
    select * into l from public.match_logs where match_id = g.match_id and player_id = g.player_id;
    return jsonb_build_object('rounds', l.rounds, 'seed', g.seed);
  end if;
  return null;
end $$;

-- ── 결과 보고·판정 ─────────────────────────────────────
-- 성적 비교: 둘 다 클리어면 먼저 끝낸 쪽 → 도달 라운드 → 하트 → 골드 → 무승부
-- report = { reached:int(클리어는 waveCount+1), life:int, gold:int, clearedSec:number|null }
create or replace function public.decide_winner(a jsonb, b jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  a_clear numeric := nullif(a ->> 'clearedSec', '')::numeric;
  b_clear numeric := nullif(b ->> 'clearedSec', '')::numeric;
  ar int := coalesce((a ->> 'reached')::int, 0);
  br int := coalesce((b ->> 'reached')::int, 0);
  al int := coalesce((a ->> 'life')::int, 0);
  bl int := coalesce((b ->> 'life')::int, 0);
  ag int := coalesce(floor((a ->> 'gold')::numeric)::int, 0);
  bg int := coalesce(floor((b ->> 'gold')::numeric)::int, 0);
begin
  if a_clear is not null and b_clear is not null and a_clear <> b_clear then
    return jsonb_build_object('winner', case when a_clear < b_clear then 'a' else 'b' end, 'reason', 'first_clear');
  elsif a_clear is not null and b_clear is null then
    return jsonb_build_object('winner', 'a', 'reason', 'first_clear');
  elsif b_clear is not null and a_clear is null then
    return jsonb_build_object('winner', 'b', 'reason', 'first_clear');
  elsif ar <> br then
    return jsonb_build_object('winner', case when ar > br then 'a' else 'b' end, 'reason', 'wave');
  elsif al <> bl then
    return jsonb_build_object('winner', case when al > bl then 'a' else 'b' end, 'reason', 'life');
  elsif ag <> bg then
    return jsonb_build_object('winner', case when ag > bg then 'a' else 'b' end, 'reason', 'gold');
  end if;
  return jsonb_build_object('winner', 'draw', 'reason', 'draw');
end $$;

create or replace function public.clean_report(r jsonb, wave_count int) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'reached', least(greatest(coalesce((r ->> 'reached')::int, 1), 1), wave_count + 1),
    'life', least(greatest(coalesce((r ->> 'life')::int, 0), 0), 99),
    'gold', greatest(coalesce(floor((r ->> 'gold')::numeric)::int, 0), 0),
    'clearedSec', case when coalesce((r ->> 'reached')::int, 0) >= wave_count + 1 and jsonb_typeof(r -> 'clearedSec') = 'number'
                       then greatest((r ->> 'clearedSec')::numeric, 0) else null end
  )
$$;

-- 매치 확정: 승자 기록 + (랭크) 레이팅·시즌 포인트 / (친구) 상대 전적
create or replace function public.finalize_match(p_match uuid)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  mi public.match_internal;
  d jsonb;
  w text;
  s1 numeric;
  k1 int; k2 int;
  r1 int; r2 int;
  d1 int := 0; d2 int := 0;
  pp1 public.profiles; pp2 public.profiles;
  lo uuid; hi uuid; res text;
begin
  select * into m from public.matches where id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if m.status in ('done', 'void') then return m; end if;
  if m.p1_report is null or m.p2_report is null then raise exception 'reports_incomplete'; end if;
  select * into mi from public.match_internal where match_id = m.id;

  d := public.decide_winner(m.p1_report, m.p2_report);
  w := case d ->> 'winner' when 'a' then 'p1' when 'b' then 'p2' else 'draw' end;
  s1 := case w when 'p1' then 1 when 'p2' then 0 else 0.5 end;

  select * into pp1 from public.profiles where id = m.p1 for update;
  if m.p2 is not null then select * into pp2 from public.profiles where id = m.p2 for update; end if;

  if m.mode = 'ranked' then
    r1 := pp1.rating;
    r2 := coalesce(pp2.rating, m.p2_rating, 1000);
    k1 := case when pp1.placement_left > 0 then 64 else 32 end;
    if coalesce(mi.opponent_kind, 'human') <> 'human' then k1 := k1 / 2; end if; -- 대체 상대는 K 절반
    d1 := public.elo_delta(r1, r2, s1, k1);
    update public.profiles
       set rating = greatest(100, rating + d1),
           wins = wins + (w = 'p1')::int, losses = losses + (w = 'p2')::int, draws = draws + (w = 'draw')::int,
           season_points = greatest(0, season_points + case w when 'p1' then 20 when 'p2' then -8 else 5 end),
           placement_left = greatest(0, placement_left - 1), updated_at = now()
     where id = m.p1;
    if m.p2 is not null then
      k2 := case when pp2.placement_left > 0 then 64 else 32 end;
      d2 := public.elo_delta(r2, r1, 1 - s1, k2);
      update public.profiles
         set rating = greatest(100, rating + d2),
             wins = wins + (w = 'p2')::int, losses = losses + (w = 'p1')::int, draws = draws + (w = 'draw')::int,
             season_points = greatest(0, season_points + case w when 'p2' then 20 when 'p1' then -8 else 5 end),
             placement_left = greatest(0, placement_left - 1), updated_at = now()
       where id = m.p2;
    end if;
  elsif m.p2 is not null then
    -- 친구 대전: 랭크 미반영, 상대 전적만
    lo := least(m.p1, m.p2); hi := greatest(m.p1, m.p2);
    res := case when w = 'draw' then 'draw' when (w = 'p1') = (m.p1 = lo) then 'a' else 'b' end;
    insert into public.head_to_head (a, b, a_wins, b_wins, draws, last_results)
    values (lo, hi, (res = 'a')::int, (res = 'b')::int, (res = 'draw')::int, jsonb_build_array(res))
    on conflict (a, b) do update
      set a_wins = head_to_head.a_wins + (res = 'a')::int,
          b_wins = head_to_head.b_wins + (res = 'b')::int,
          draws = head_to_head.draws + (res = 'draw')::int,
          last_results = (
            select coalesce(jsonb_agg(v order by ord), '[]'::jsonb)
              from (
                select v, ord from jsonb_array_elements(head_to_head.last_results || jsonb_build_array(res)) with ordinality t(v, ord)
                 order by ord desc limit 5
              ) x
          ),
          updated_at = now();
  end if;

  update public.matches
     set winner = w, reason = d ->> 'reason', ended_at = now(), status = 'done',
         rating_delta_p1 = d1, rating_delta_p2 = d2
   where id = m.id
  returning * into m;

  if m.room_id is not null then
    update public.rooms set status = 'done', host_ready = false, guest_ready = false,
           expires_at = now() + interval '10 minutes'
     where id = m.room_id and status = 'live';
  end if;
  return m;
end $$;

-- 내 성적 보고. 사람 상대: 양쪽 보고가 모이면 확정. 대체 상대: p_opponent 에 상대 성적을 같이 보낸다
create or replace function public.report_result(p_match uuid, p_report jsonb, p_opponent jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); m public.matches;
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
      update public.matches set p2_report = public.clean_report(p_opponent, m.wave_count) where id = m.id;
    end if;
  else
    if m.p2_report is null then
      update public.matches set p2_report = public.clean_report(p_report, m.wave_count) where id = m.id;
    end if;
  end if;

  select * into m from public.matches where id = p_match;
  if m.p1_report is not null and m.p2_report is not null then
    m := public.finalize_match(m.id);
  end if;
  return public.match_public(m, me);
end $$;

-- 상대가 보고 없이 사라졌을 때: 매치 최대 시간(웨이브당 90초)이 지나면 내 보고만으로 확정 (상대는 1라운드 탈락 처리)
create or replace function public.claim_timeout(p_match uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); m public.matches; blank jsonb := '{"reached":1,"life":0,"gold":0}'::jsonb;
begin
  select * into m from public.matches where id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if m.p1 <> me and m.p2 is distinct from me then raise exception 'not_in_match'; end if;
  if m.status <> 'live' then return public.match_public(m, me); end if;
  if now() < m.started_at + make_interval(secs => m.wave_count * 90) then raise exception 'too_early'; end if;
  if m.p1 = me and m.p1_report is not null and m.p2_report is null then
    update public.matches set p2_report = blank where id = m.id;
  elsif m.p2 = me and m.p2_report is not null and m.p1_report is null then
    update public.matches set p1_report = blank where id = m.id;
  else
    raise exception 'report_first';
  end if;
  m := public.finalize_match(m.id);
  update public.matches set reason = 'timeout' where id = m.id returning * into m;
  return public.match_public(m, me);
end $$;

-- 입력 로그 제출 (검증·고스트 재료). 랭크 사람 매치의 로그는 고스트 후보가 된다
create or replace function public.submit_log(p_match uuid, p_rounds jsonb, p_checksum text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); m public.matches; p public.profiles;
begin
  select * into m from public.matches where id = p_match;
  if not found then raise exception 'match_not_found'; end if;
  if m.p1 <> me and m.p2 is distinct from me then raise exception 'not_in_match'; end if;
  if jsonb_typeof(p_rounds) <> 'array' then raise exception 'rounds_must_be_array'; end if;
  insert into public.match_logs (match_id, player_id, rounds, checksum)
  values (m.id, me, p_rounds, p_checksum)
  on conflict (match_id, player_id) do nothing;
  if m.mode = 'ranked' and jsonb_array_length(p_rounds) >= 5 then
    select * into p from public.profiles where id = me;
    insert into public.ghosts (player_id, match_id, rating, wave_count, seed)
    values (me, m.id, p.rating, m.wave_count, m.seed)
    on conflict (match_id, player_id) do nothing;
  end if;
end $$;

-- ── 친구 ───────────────────────────────────────────────
-- 같이 한 판(매치) 또는 같은 방에 있었던 상대만 추가 가능 (연락처 접근 없음)
create or replace function public.add_friend(p_other uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid();
begin
  if p_other = me then raise exception 'self'; end if;
  if not exists (
    select 1 from public.matches where (p1 = me and p2 = p_other) or (p1 = p_other and p2 = me)
    union all
    select 1 from public.rooms where (host = me and guest = p_other) or (host = p_other and guest = me)
  ) then
    raise exception 'never_played';
  end if;
  insert into public.friends (a, b) values (least(me, p_other), greatest(me, p_other))
  on conflict do nothing;
end $$;

create or replace function public.remove_friend(p_other uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid();
begin
  delete from public.friends where a = least(me, p_other) and b = greatest(me, p_other);
end $$;

create or replace function public.list_friends()
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare me uuid := public.require_uid(); out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.nick, 'avatar', p.avatar, 'rating', p.rating,
           'myWins', case when h.a = me then h.a_wins else h.b_wins end,
           'theirWins', case when h.a = me then h.b_wins else h.a_wins end,
           'draws', coalesce(h.draws, 0),
           'last', coalesce(h.last_results, '[]'::jsonb),
           'iAm', case when f.a = me then 'a' else 'b' end
         ) order by p.nick), '[]'::jsonb)
    into out
    from public.friends f
    join public.profiles p on p.id = case when f.a = me then f.b else f.a end
    left join public.head_to_head h on h.a = f.a and h.b = f.b
   where f.a = me or f.b = me;
  return out;
end $$;

create or replace function public.invite_friend(p_friend uuid, p_code text)
returns public.invites
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); i public.invites;
begin
  if not exists (select 1 from public.friends where a = least(me, p_friend) and b = greatest(me, p_friend)) then
    raise exception 'not_friends';
  end if;
  if not exists (select 1 from public.rooms where code = upper(btrim(p_code)) and host = me and status = 'waiting') then
    raise exception 'room_not_found';
  end if;
  update public.invites set status = 'expired' where from_id = me and to_id = p_friend and status = 'pending';
  insert into public.invites (from_id, to_id, room_code) values (me, p_friend, upper(btrim(p_code)))
  returning * into i;
  return i;
end $$;

create or replace function public.answer_invite(p_invite uuid, p_accept boolean)
returns public.invites
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); i public.invites;
begin
  update public.invites
     set status = case when expires_at < now() then 'expired' when p_accept then 'accepted' else 'declined' end
   where id = p_invite and to_id = me and status = 'pending'
  returning * into i;
  if not found then raise exception 'invite_not_found'; end if;
  return i;
end $$;

-- ── 실행 권한: 로그인 사용자만 (익명 로그인 포함). 내부 헬퍼는 클라이언트에서 못 부른다 ──
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.ensure_profile(text, text), public.update_profile(text, text), public.report_campaign(int),
  public.create_room(jsonb), public.join_room(text), public.set_room_rules(text, jsonb),
  public.set_ready(text, boolean), public.leave_room(text), public.kick_guest(text),
  public.enqueue(), public.cancel_queue(), public.poll_match(), public.get_opponent_script(uuid),
  public.report_result(uuid, jsonb, jsonb), public.claim_timeout(uuid), public.submit_log(uuid, jsonb, text),
  public.add_friend(uuid), public.remove_friend(uuid), public.list_friends(),
  public.invite_friend(uuid, text), public.answer_invite(uuid, boolean),
  public.normalize_rules(jsonb), public.elo_delta(int, int, numeric, int)
to authenticated;
revoke execute on function
  public.finalize_match(uuid), public.close_stale_rooms(), public.gen_room_code(), public.new_seed(),
  public.match_public(public.matches, uuid), public.decide_winner(jsonb, jsonb), public.clean_report(jsonb, int),
  public.ranked_rules(), public.require_uid()
from authenticated;
