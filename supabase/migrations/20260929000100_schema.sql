-- 포커디펜스 서버 스키마 (docs/mode-design.md §2.5)
-- 테이블 + RLS. 쓰기는 전부 SECURITY DEFINER RPC(다음 마이그레이션)로만 한다 — 클라이언트는 자기 행 조회만.

-- ── 프로필 ─────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nick text not null check (char_length(nick) between 2 and 12),
  avatar text not null default 'S' check (avatar in ('S', 'H', 'D', 'C')),
  rating int not null default 1000,
  season_points int not null default 0 check (season_points >= 0),
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  placement_left int not null default 10 check (placement_left >= 0), -- 배치 10판은 K 2배
  best_campaign_wave int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 시즌 ───────────────────────────────────────────────
create table public.seasons (
  id serial primary key,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  rewards jsonb not null default '[]'::jsonb,
  check (ends_at > starts_at)
);

-- ── 매치 ───────────────────────────────────────────────
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('ranked', 'friend')),
  room_id uuid,
  seed text not null,
  wave_count int not null check (wave_count in (20, 40)),
  rules jsonb not null default '{}'::jsonb,
  p1 uuid not null references public.profiles (id) on delete cascade,
  p2 uuid references public.profiles (id) on delete set null, -- 대체 상대(고스트·봇)는 null
  -- 상대 표시용 (대체 상대는 여기 값으로, 사람은 프로필에서)
  p2_name text,
  p2_rating int,
  p2_avatar text check (p2_avatar is null or p2_avatar in ('S', 'H', 'D', 'C')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  winner text check (winner in ('p1', 'p2', 'draw')),
  reason text,
  status text not null default 'live' check (status in ('live', 'verifying', 'done', 'void')),
  p1_report jsonb,
  p2_report jsonb,
  rating_delta_p1 int,
  rating_delta_p2 int
);
create index matches_p1_idx on public.matches (p1, started_at desc);
create index matches_p2_idx on public.matches (p2, started_at desc);

-- 클라이언트에 보이지 않는 매치 내부 정보 (상대가 사람/고스트/봇 중 무엇인지) — 정책 없음 = 접근 불가
create table public.match_internal (
  match_id uuid primary key references public.matches (id) on delete cascade,
  opponent_kind text not null default 'human' check (opponent_kind in ('human', 'ghost', 'bot')),
  ghost_id uuid
);

-- 입력 로그 (결정론 재생·검증용)
create table public.match_logs (
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  rounds jsonb not null,
  checksum text,
  verified boolean not null default false,
  verify_note text,
  created_at timestamptz not null default now(),
  primary key (match_id, player_id)
);

-- 고스트 = 검증 대상이 된 랭크 매치 로그 (대체 매칭용)
create table public.ghosts (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles (id) on delete cascade,
  match_id uuid not null references public.matches (id) on delete cascade,
  rating int not null,
  wave_count int not null,
  seed text not null,
  created_at timestamptz not null default now(),
  unique (match_id, player_id)
);
create index ghosts_rating_idx on public.ghosts (wave_count, rating);

-- ── 친구 대전 방 ───────────────────────────────────────
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-HJ-NP-Z2-9]{6}$'), -- 혼동 문자 I·O·0·1 제외
  host uuid not null references public.profiles (id) on delete cascade,
  guest uuid references public.profiles (id) on delete set null,
  rules jsonb not null default '{}'::jsonb,
  host_ready boolean not null default false,
  guest_ready boolean not null default false,
  status text not null default 'waiting' check (status in ('waiting', 'live', 'done', 'closed')),
  match_id uuid references public.matches (id) on delete set null,
  games_played int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
-- 열려 있는 방끼리만 코드가 유일하면 된다 (닫힌 방의 코드는 재사용)
create unique index rooms_code_open_idx on public.rooms (code) where status <> 'closed';
create index rooms_host_idx on public.rooms (host);
create index rooms_guest_idx on public.rooms (guest);

alter table public.matches
  add constraint matches_room_fk foreign key (room_id) references public.rooms (id) on delete set null;

-- ── 친구 ───────────────────────────────────────────────
create table public.friends (
  a uuid not null references public.profiles (id) on delete cascade,
  b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b) -- 양방향 1행
);

create table public.head_to_head (
  a uuid not null references public.profiles (id) on delete cascade,
  b uuid not null references public.profiles (id) on delete cascade,
  a_wins int not null default 0,
  b_wins int not null default 0,
  draws int not null default 0,
  last_results jsonb not null default '[]'::jsonb, -- 최근 5판: 'a' | 'b' | 'draw'
  updated_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  room_code text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index invites_to_idx on public.invites (to_id, created_at desc);

-- ── 랭크 매칭 큐 ───────────────────────────────────────
create table public.queue (
  player_id uuid primary key references public.profiles (id) on delete cascade,
  rating int not null,
  enqueued_at timestamptz not null default now(),
  fallback_at timestamptz not null -- 이 시각이 지나면 고스트 → 봇 순으로 대체 매칭 (15~40초 랜덤)
);
create index queue_rating_idx on public.queue (rating);

-- 대체 상대(봇) 닉네임 풀
create table public.bot_names (
  name text primary key check (char_length(name) between 2 and 12)
);

-- ── RLS: 조회만 허용, 쓰기는 RPC ───────────────────────
alter table public.profiles enable row level security;
alter table public.seasons enable row level security;
alter table public.matches enable row level security;
alter table public.match_internal enable row level security;
alter table public.match_logs enable row level security;
alter table public.ghosts enable row level security;
alter table public.rooms enable row level security;
alter table public.friends enable row level security;
alter table public.head_to_head enable row level security;
alter table public.invites enable row level security;
alter table public.queue enable row level security;
alter table public.bot_names enable row level security;

-- 프로필은 공개 정보(닉·아바타·레이팅·전적)만 담으므로 로그인한 누구나 조회
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy seasons_select on public.seasons for select to authenticated using (true);
create policy matches_select on public.matches for select to authenticated
  using (p1 = (select auth.uid()) or p2 = (select auth.uid()));
create policy match_logs_select on public.match_logs for select to authenticated
  using (player_id = (select auth.uid()));
create policy rooms_select on public.rooms for select to authenticated
  using (host = (select auth.uid()) or guest = (select auth.uid()));
create policy friends_select on public.friends for select to authenticated
  using (a = (select auth.uid()) or b = (select auth.uid()));
create policy h2h_select on public.head_to_head for select to authenticated
  using (a = (select auth.uid()) or b = (select auth.uid()));
create policy invites_select on public.invites for select to authenticated
  using (from_id = (select auth.uid()) or to_id = (select auth.uid()));
create policy queue_select on public.queue for select to authenticated
  using (player_id = (select auth.uid()));
-- match_internal · ghosts · bot_names: 정책 없음 → 클라이언트 접근 불가

-- ── Realtime: 방·매치·초대 변경을 클라이언트가 구독 ─────
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.invites;
