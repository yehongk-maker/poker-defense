-- 고스트전 (docs/mode-design.md §2.2, D단계)
--  1) 고스트는 "검증을 통과한" 로그만: submit_log는 로그만 저장하고, 고스트 등록은 verify-match(Edge Function, service role)가 재생 검사 통과 후에 한다.
--  2) 대본에 그 판을 친 플레이어 키를 같이 준다 — 손패 시드 스트림(시드 + 플레이어 키 + 라운드)을 복원하는 데 필요하다.

create or replace function public.submit_log(p_match uuid, p_rounds jsonb, p_checksum text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if not found then raise exception 'match_not_found'; end if;
  if m.p1 <> me and m.p2 is distinct from me then raise exception 'not_in_match'; end if;
  if jsonb_typeof(p_rounds) <> 'array' then raise exception 'rounds_must_be_array'; end if;
  insert into public.match_logs (match_id, player_id, rounds, checksum)
  values (m.id, me, p_rounds, p_checksum)
  on conflict (match_id, player_id) do nothing;
end $$;

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
    if l.rounds is null then return null; end if; -- 로그가 지워졌으면 봇 두뇌로
    return jsonb_build_object('rounds', l.rounds, 'seed', g.seed, 'player', g.player_id);
  end if;
  return null;
end $$;

-- 검증 전에 등록된 고스트 정리
delete from public.ghosts g
 where not exists (
   select 1 from public.match_logs l
    where l.match_id = g.match_id and l.player_id = g.player_id and l.verified
 );
