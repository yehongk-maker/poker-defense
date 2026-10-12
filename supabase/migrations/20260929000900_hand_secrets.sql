-- 손패 시드 비밀 (보안 보강)
-- 문제: 손패 난수가 "매치 시드 + 플레이어 id + 라운드"로 정해졌다. 대전 상대는 매치 시드와 내 id를 둘 다 알기 때문에
--       클라이언트를 고치면 내 손패(교환으로 나올 카드 포함)를 계산할 수 있었다.
-- 해결: 매치마다 플레이어별 비밀 손패 키(hand_key)를 서버가 만들어 본인에게만 준다. 손패 = (매치 시드, hand_key, 라운드).
--       매치 행(matches)은 두 사람이 모두 읽을 수 있으므로 키는 별도 테이블에 두고 RLS로 "내 행"만 연다.
--  · 동일 손패 규칙(친구 대전 sharedHand)이면 두 사람의 키가 같다 — 같은 패를 받는 것이 규칙이다.
--  · 전투 난수(매치 시드)는 그대로 공유한다. 전투는 공개 정보라 숨길 것이 없다.
--  · 이미 있던 매치는 옛 방식과 같은 결과가 나오는 키('p:'||플레이어 id, 동일 손패는 'shared')로 채운다 —
--    끝난 판의 로그 검증과 기존 고스트가 그대로 재생된다. 끝난 판이라 비밀일 필요가 없다.

create table public.match_secrets (
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  hand_key text not null,
  primary key (match_id, player_id)
);
alter table public.match_secrets enable row level security;
create policy match_secrets_select on public.match_secrets for select to authenticated
  using (player_id = (select auth.uid()));
-- Realtime 발행 대상에 넣지 않는다 (변경이 다른 사람에게 흘러가지 않게)

-- 추측할 수 없는 키: gen_random_uuid()는 암호학적 난수 (122비트 × 2)
create or replace function public.new_hand_key() returns text
language sql volatile set search_path = public as $$
  select 'k:' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

-- 매치가 만들어질 때 두 사람(대체 상대 매치는 나 혼자)의 키를 만든다.
-- 매치를 만드는 함수(set_ready·poll_match …)를 고치지 않아도 되도록 트리거로 한다.
create or replace function public.make_hand_secrets() returns trigger
language plpgsql security definer set search_path = public as $$
declare shared text;
begin
  if coalesce((new.rules ->> 'sharedHand')::boolean, false) then
    shared := public.new_hand_key();
    insert into public.match_secrets (match_id, player_id, hand_key) values (new.id, new.p1, shared);
    if new.p2 is not null then
      insert into public.match_secrets (match_id, player_id, hand_key) values (new.id, new.p2, shared);
    end if;
  else
    insert into public.match_secrets (match_id, player_id, hand_key) values (new.id, new.p1, public.new_hand_key());
    if new.p2 is not null then
      insert into public.match_secrets (match_id, player_id, hand_key) values (new.id, new.p2, public.new_hand_key());
    end if;
  end if;
  return new;
end $$;
create trigger matches_hand_secrets after insert on public.matches
  for each row execute function public.make_hand_secrets();

-- 옛 매치 채우기 (옛 방식과 같은 키)
insert into public.match_secrets (match_id, player_id, hand_key)
select m.id, x.pid,
       case when coalesce((m.rules ->> 'sharedHand')::boolean, false) then 'shared' else 'p:' || x.pid::text end
  from public.matches m
  cross join lateral (values (m.p1), (m.p2)) as x(pid)
 where x.pid is not null
on conflict do nothing;

-- 매치 정보에 "내" 손패 키를 담는다 (상대 키는 어디에도 나가지 않는다)
create or replace function public.match_public(m public.matches, me uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  role text := case when m.p1 = me then 'p1' else 'p2' end;
  opp_id uuid := case when m.p1 = me then m.p2 else m.p1 end;
  opp jsonb;
  hk text;
begin
  if opp_id is not null then
    select jsonb_build_object('id', p.id, 'name', p.nick, 'rating', p.rating, 'avatar', p.avatar)
      into opp from public.profiles p where p.id = opp_id;
  else
    opp := jsonb_build_object('id', null, 'name', m.p2_name, 'rating', m.p2_rating, 'avatar', m.p2_avatar);
  end if;
  select s.hand_key into hk from public.match_secrets s where s.match_id = m.id and s.player_id = me;
  return jsonb_build_object(
    'id', m.id, 'mode', m.mode, 'seed', m.seed, 'handKey', hk, 'waveCount', m.wave_count, 'rules', m.rules,
    'role', role, 'opponent', opp, 'startedAt', m.started_at, 'status', m.status,
    'winner', m.winner, 'reason', m.reason,
    'ratingDelta', case when role = 'p1' then m.rating_delta_p1 else m.rating_delta_p2 end
  );
end $$;

-- 고스트 대본: 그 판(끝난 판)을 친 사람의 손패 키를 같이 준다 — 이 기기가 고스트의 손패를 그대로 다시 만들어야 하므로
create or replace function public.get_opponent_script(p_match uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); m public.matches; mi public.match_internal; l public.match_logs; g public.ghosts; hk text;
begin
  select * into m from public.matches where id = p_match and p1 = me;
  if not found then raise exception 'match_not_found'; end if;
  if m.p2 is not null then raise exception 'live_opponent'; end if;
  select * into mi from public.match_internal where match_id = m.id;
  if mi.opponent_kind = 'ghost' then
    select * into g from public.ghosts where id = mi.ghost_id;
    select * into l from public.match_logs where match_id = g.match_id and player_id = g.player_id;
    if l.rounds is null then return null; end if;
    select s.hand_key into hk from public.match_secrets s where s.match_id = g.match_id and s.player_id = g.player_id;
    if hk is null then return null; end if; -- 키를 모르면 손패를 다시 만들 수 없다 → 봇 두뇌로
    return jsonb_build_object('rounds', l.rounds, 'seed', g.seed, 'player', g.player_id, 'handKey', hk);
  end if;
  return null;
end $$;

revoke execute on function public.new_hand_key(), public.make_hand_secrets() from public, anon, authenticated;
