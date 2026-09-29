-- 시즌·랭킹 (docs/mode-design.md §2.6, F단계)
--  · 리더보드: 시즌 포인트 / 레이팅 상위 + 내 순위. 랭크 대전을 한 판 이상 한 사람만.
--  · 시즌 넘김: 끝난 시즌의 순위·포인트를 season_results에 남기고, 시즌 포인트 0 · 레이팅은 1000 쪽으로 절반 당김, 다음 시즌(4주) 생성.
--    cron 없이 "필요할 때 넘김" — 시즌을 읽는 RPC와 매칭 시작(enqueue)이 먼저 ensure_season()을 부른다.
--  · 보상: 포인트 구간별 다이아(seasons.rewards). 수령은 서버에 1회만 기록, 다이아는 클라이언트 메타(localStorage)에 더한다.

create table public.season_results (
  season_id int not null references public.seasons (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  points int not null,
  rating int not null,
  rank int not null,
  diamonds int not null default 0,
  claimed_at timestamptz,
  primary key (season_id, player_id)
);
alter table public.season_results enable row level security;
create policy season_results_select on public.season_results for select to authenticated
  using (player_id = (select auth.uid()));

create index if not exists profiles_season_idx on public.profiles (season_points desc, rating desc);
create index if not exists profiles_rating_idx on public.profiles (rating desc);

-- 포인트에 해당하는 보상 다이아 (도달한 구간 중 가장 큰 것)
create or replace function public.season_reward(p_rewards jsonb, p_points int) returns int
language sql immutable set search_path = public as $$
  select coalesce(max((r ->> 'diamonds')::int), 0)
    from jsonb_array_elements(p_rewards) r
   where (r ->> 'minPoints')::int <= p_points
$$;

-- 지금 시즌을 돌려준다. 끝났으면 결과를 남기고 다음 시즌을 연다.
-- 오래 비어 있었어도 다음 시즌은 "지금"부터 4주 — 아무도 없던 시즌을 만들지 않는다
create or replace function public.ensure_season() returns public.seasons
language plpgsql security definer set search_path = public as $$
declare s public.seasons; n int; start_at timestamptz;
begin
  perform pg_advisory_xact_lock(7726001);
  select * into s from public.seasons order by ends_at desc limit 1;
  if not found then
    insert into public.seasons (name, starts_at, ends_at, rewards)
    values ('시즌 1', date_trunc('day', now()), date_trunc('day', now()) + interval '28 days',
            '[{"minPoints":100,"diamonds":50},{"minPoints":300,"diamonds":150},{"minPoints":600,"diamonds":300}]'::jsonb)
    returning * into s;
    return s;
  end if;
  if s.ends_at > now() then return s; end if;

  insert into public.season_results (season_id, player_id, points, rating, rank, diamonds)
  select s.id, p.id, p.season_points, p.rating,
         rank() over (order by p.season_points desc, p.rating desc),
         public.season_reward(s.rewards, p.season_points)
    from public.profiles p
   where p.wins + p.losses + p.draws > 0
  on conflict do nothing;

  update public.profiles
     set season_points = 0,
         rating = greatest(100, 1000 + (rating - 1000) / 2),
         updated_at = now()
   where wins + losses + draws > 0;

  n := coalesce(nullif(regexp_replace(s.name, '[^0-9]', '', 'g'), '')::int, s.id) + 1;
  start_at := greatest(s.ends_at, date_trunc('day', now()));
  insert into public.seasons (name, starts_at, ends_at, rewards)
  values ('시즌 ' || n, start_at, start_at + interval '28 days', s.rewards)
  returning * into s;
  return s;
end $$;

-- 리더보드. p_kind: 'season'(시즌 포인트) | 'rating'. 상위 p_limit명 + 내 순위(목록 밖이어도)
create or replace function public.leaderboard(p_kind text default 'season', p_limit int default 50)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_uid();
  s public.seasons;
  lim int := least(greatest(coalesce(p_limit, 50), 1), 100);
  by_rating boolean := coalesce(p_kind, 'season') = 'rating';
  top jsonb; mine jsonb; total int;
begin
  s := public.ensure_season();
  with ranked as (
    select p.id, p.nick, p.avatar, p.rating, p.season_points, p.wins, p.losses, p.draws,
           rank() over (order by case when by_rating then p.rating else p.season_points end desc,
                                 case when by_rating then p.season_points else p.rating end desc) as rk
      from public.profiles p
     where p.wins + p.losses + p.draws > 0
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
        'rank', r.rk, 'id', r.id, 'name', r.nick, 'avatar', r.avatar, 'rating', r.rating,
        'seasonPoints', r.season_points, 'wins', r.wins, 'losses', r.losses, 'draws', r.draws, 'me', r.id = me
      ) order by r.rk, r.nick), '[]'::jsonb)
       from (select * from ranked order by rk, nick limit lim) r),
    (select jsonb_build_object(
        'rank', r.rk, 'id', r.id, 'name', r.nick, 'avatar', r.avatar, 'rating', r.rating,
        'seasonPoints', r.season_points, 'wins', r.wins, 'losses', r.losses, 'draws', r.draws, 'me', true)
       from ranked r where r.id = me),
    (select count(*) from ranked)
  into top, mine, total;
  return jsonb_build_object('kind', case when by_rating then 'rating' else 'season' end, 'rows', top, 'me', mine, 'total', total);
end $$;

-- 내 시즌 현황: 지금 시즌 + 내 프로필 + 아직 안 받은 지난 시즌 보상
create or replace function public.my_season()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); s public.seasons; p public.profiles; pending jsonb;
begin
  s := public.ensure_season();
  p := public.ensure_profile();
  select coalesce(jsonb_agg(jsonb_build_object(
           'seasonId', r.season_id, 'name', x.name, 'rank', r.rank, 'points', r.points, 'diamonds', r.diamonds
         ) order by r.season_id), '[]'::jsonb)
    into pending
    from public.season_results r join public.seasons x on x.id = r.season_id
   where r.player_id = me and r.claimed_at is null and r.diamonds > 0;
  return jsonb_build_object(
    'season', jsonb_build_object('id', s.id, 'name', s.name, 'startsAt', s.starts_at, 'endsAt', s.ends_at, 'rewards', s.rewards),
    'me', jsonb_build_object('rating', p.rating, 'seasonPoints', p.season_points, 'wins', p.wins, 'losses', p.losses,
                             'draws', p.draws, 'placementLeft', p.placement_left),
    'unclaimed', pending
  );
end $$;

-- 지난 시즌 보상 수령 (한 번만). 받은 다이아 수를 돌려준다
create or replace function public.claim_season_reward(p_season int)
returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); d int;
begin
  update public.season_results
     set claimed_at = now()
   where season_id = p_season and player_id = me and claimed_at is null and diamonds > 0
  returning diamonds into d;
  if not found then raise exception 'reward_not_found'; end if;
  return d;
end $$;

-- 매칭을 시작할 때도 시즌을 넘긴다 (끝난 시즌에 포인트가 쌓이지 않게)
create or replace function public.enqueue()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); p public.profiles; r record;
begin
  p := public.ensure_profile();
  perform public.ensure_season();
  for r in select id, p1 from public.matches where mode = 'ranked' and status = 'live' and (p1 = me or p2 = me) loop
    perform public.apply_forfeit(r.id, case when r.p1 = me then 'p1' else 'p2' end);
  end loop;
  select * into p from public.profiles where id = me; -- 기권패·시즌 넘김으로 레이팅이 바뀌었을 수 있다
  insert into public.queue (player_id, rating, enqueued_at, fallback_at)
  values (me, p.rating, now(), now() + make_interval(secs => 15 + random() * 25))
  on conflict (player_id) do update
    set rating = excluded.rating, enqueued_at = excluded.enqueued_at, fallback_at = excluded.fallback_at;
  return public.poll_match();
end $$;

grant execute on function public.leaderboard(text, int), public.my_season(), public.claim_season_reward(int) to authenticated;
revoke execute on function public.ensure_season(), public.season_reward(jsonb, int) from public, anon, authenticated;
