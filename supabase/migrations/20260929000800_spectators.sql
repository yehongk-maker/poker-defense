-- 친구 방 관전 (docs/mode-design.md §1.3, F단계 나머지)
--  · 방 코드를 아는 사람은 구경꾼으로 들어올 수 있다 (방마다 최대 8명). 방의 두 사람은 구경꾼이 될 수 없다.
--  · 구경꾼은 방 행(입장·준비·시작·종료)을 구독하고, 대전 중에는 매치의 공개 이벤트 채널을 듣는다.
--  · 매치 행은 구경꾼에게 열지 않는다 — 시드가 들어 있어서다. 필요한 공개 정보는 watch_info가 골라서 준다.

create table public.room_spectators (
  room_id uuid not null references public.rooms (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, player_id)
);
create index room_spectators_player_idx on public.room_spectators (player_id);
alter table public.room_spectators enable row level security;

-- 정책 안에서 서로의 테이블을 다시 조회하면 RLS가 되돌아 들어가므로, 확인은 SECURITY DEFINER 함수로 한다
create or replace function public.is_room_member(p_room uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rooms r where r.id = p_room and (r.host = p_user or r.guest = p_user))
$$;
create or replace function public.is_room_spectator(p_room uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_spectators s where s.room_id = p_room and s.player_id = p_user)
$$;

create policy room_spectators_select on public.room_spectators for select to authenticated
  using (player_id = (select auth.uid()) or public.is_room_member(room_id, (select auth.uid())) or public.is_room_spectator(room_id, (select auth.uid())));
create policy rooms_select_spectator on public.rooms for select to authenticated
  using (public.is_room_spectator(id, (select auth.uid())));

alter publication supabase_realtime add table public.room_spectators;

-- 구경꾼에게 주는 방 정보: 두 사람의 공개 프로필 + 매치의 공개 부분 (시드·상대 종류 없음)
create or replace function public.room_public(r public.rooms) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.matches; h jsonb; g jsonb; mj jsonb := null;
begin
  select jsonb_build_object('id', p.id, 'name', p.nick, 'avatar', p.avatar, 'rating', p.rating) into h from public.profiles p where p.id = r.host;
  if r.guest is not null then
    select jsonb_build_object('id', p.id, 'name', p.nick, 'avatar', p.avatar, 'rating', p.rating) into g from public.profiles p where p.id = r.guest;
  end if;
  if r.match_id is not null then
    select * into m from public.matches where id = r.match_id;
    if found then
      mj := jsonb_build_object('id', m.id, 'waveCount', m.wave_count, 'rules', m.rules, 'status', m.status,
                               'p1', m.p1, 'p2', m.p2, 'winner', m.winner, 'reason', m.reason, 'startedAt', m.started_at);
    end if;
  end if;
  return jsonb_build_object(
    'room', jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status, 'rules', r.rules, 'host', r.host, 'guest', r.guest,
                               'hostReady', r.host_ready, 'guestReady', r.guest_ready, 'gamesPlayed', r.games_played, 'matchId', r.match_id),
    'host', h, 'guest', g, 'match', mj,
    'spectators', (select count(*) from public.room_spectators s where s.room_id = r.id)
  );
end $$;

create or replace function public.watch_room(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); r public.rooms; n int;
begin
  perform public.ensure_profile();
  perform public.close_stale_rooms();
  select * into r from public.rooms where code = upper(btrim(p_code)) and status <> 'closed' for update;
  if not found then raise exception 'room_not_found'; end if;
  if r.host = me or r.guest = me then raise exception 'in_room'; end if;
  if not exists (select 1 from public.room_spectators where room_id = r.id and player_id = me) then
    select count(*) into n from public.room_spectators where room_id = r.id;
    if n >= 8 then raise exception 'spectators_full'; end if;
    insert into public.room_spectators (room_id, player_id) values (r.id, me);
  end if;
  return public.room_public(r);
end $$;

create or replace function public.watch_info(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); r public.rooms;
begin
  select * into r from public.rooms where code = upper(btrim(p_code)) order by created_at desc limit 1;
  if not found then raise exception 'room_not_found'; end if;
  if not public.is_room_spectator(r.id, me) then raise exception 'not_watching'; end if;
  return public.room_public(r);
end $$;

create or replace function public.unwatch_room(p_code text)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid();
begin
  delete from public.room_spectators s using public.rooms r
   where s.room_id = r.id and r.code = upper(btrim(p_code)) and s.player_id = me;
end $$;

-- 구경하던 사람이 그 방의 빈 자리에 들어가면 구경꾼에서 빠진다
create or replace function public.spectator_leaves_on_join() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.guest is not null and new.guest is distinct from old.guest then
    delete from public.room_spectators where room_id = new.id and player_id = new.guest;
  end if;
  return new;
end $$;
create trigger rooms_spectator_leaves after update of guest on public.rooms
  for each row execute function public.spectator_leaves_on_join();

grant execute on function public.watch_room(text), public.watch_info(text), public.unwatch_room(text) to authenticated;
revoke execute on function public.room_public(public.rooms), public.spectator_leaves_on_join() from public, anon, authenticated;
