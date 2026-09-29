/**
 * 서버 스키마·RPC 검증 — supabase/migrations/*.sql 을 내장 Postgres(pglite)에 그대로 적용해 돌린다.
 * Supabase가 제공하는 것(auth 스키마·역할·realtime publication)은 최소한으로 흉내 낸다.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const migDir = join(dirname(fileURLToPath(import.meta.url)), '../supabase/migrations');

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), is_anonymous boolean default true);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  create publication supabase_realtime;
`;

let db: PGlite;
const users: Record<string, string> = {};

/** 로그인 사용자로 SQL 실행 (RLS·실행 권한 적용) */
async function as<T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ? users[user] : ''}', false); set role ${user ? 'authenticated' : 'anon'};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
const admin = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const rpc = async <T = Record<string, unknown>>(user: string, fn: string, args: unknown[] = []) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await as<{ r: T }>(user, `select to_jsonb(public.${fn}(${ph})) as r`, args);
  return rows[0].r;
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'));
  }
  for (const name of ['ann', 'bob', 'cat', 'dan']) {
    const [{ id }] = await admin<{ id: string }>('insert into auth.users default values returning id');
    users[name] = id;
  }
}, 60000);

describe('프로필', () => {
  it('ensure_profile: 첫 호출에 닉·아바타가 생기고 다시 불러도 같은 행', async () => {
    const p = await rpc<{ id: string; nick: string; rating: number; avatar: string }>('ann', 'ensure_profile', ['앤이', 'H']);
    expect(p.nick).toBe('앤이');
    expect(p.rating).toBe(1000);
    const again = await rpc<{ nick: string }>('ann', 'ensure_profile', ['다른닉', 'S']);
    expect(again.nick).toBe('앤이');
    const auto = await rpc<{ nick: string }>('bob', 'ensure_profile', [null, null]);
    expect(auto.nick).toMatch(/^플레이어\d{4}$/);
  });

  it('닉네임은 2~12자 (제약 위반은 거절)', async () => {
    await expect(rpc('dan', 'ensure_profile', ['댄', 'S'])).rejects.toThrow(/profiles_nick_check/);
  });

  it('로그인하지 않으면 RPC를 부를 수 없다', async () => {
    await expect(as(null, 'select public.ensure_profile()')).rejects.toThrow();
  });

  it('프로필은 직접 수정할 수 없고(정책 없음) update_profile로만 바꾼다', async () => {
    await as('ann', `update public.profiles set rating = 9999 where id = '${users.ann}'`);
    const [p] = await admin<{ rating: number }>(`select rating from public.profiles where id = '${users.ann}'`);
    expect(p.rating).toBe(1000);
    const u = await rpc<{ nick: string; avatar: string }>('ann', 'update_profile', ['앤2', 'C']);
    expect(u).toMatchObject({ nick: '앤2', avatar: 'C' });
  });
});

describe('친구 대전 방', () => {
  let code = '';

  it('방 만들기: 6자리 코드(혼동 문자 없음), 규칙은 허용값으로 정규화', async () => {
    const r = await rpc<{ code: string; rules: Record<string, unknown>; status: string }>('ann', 'create_room', [
      JSON.stringify({ waves: 40, betting: false, speed: 9, tickets: 7, sharedHand: true }),
    ]);
    code = r.code;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(r.status).toBe('waiting');
    expect(r.rules).toEqual({ waves: 40, betting: false, allHeroes: true, sharedHand: true, speed: 1, applyMeta: false, tickets: 3 });
  });

  it('코드로 참가 (소문자·공백 허용), 제3자는 들어올 수 없고 방도 안 보인다', async () => {
    const r = await rpc<{ guest: string }>('bob', 'join_room', [` ${code.toLowerCase()} `]);
    expect(r.guest).toBe(users.bob);
    await rpc('cat', 'ensure_profile', ['캣츠', 'D']);
    await expect(rpc('cat', 'join_room', [code])).rejects.toThrow(/room_full/);
    expect((await as('cat', 'select * from public.rooms')).length).toBe(0); // RLS
    expect((await as('bob', 'select * from public.rooms')).length).toBe(1);
  });

  it('방장만 규칙을 바꾸고, 바꾸면 준비가 풀린다', async () => {
    await rpc('bob', 'set_ready', [code, true]);
    await expect(rpc('bob', 'set_room_rules', [code, '{}'])).rejects.toThrow(/host_only/);
    const r = await rpc<{ guest_ready: boolean; rules: { waves: number } }>('ann', 'set_room_rules', [code, JSON.stringify({ waves: 20 })]);
    expect(r.guest_ready).toBe(false);
    expect(r.rules.waves).toBe(20);
  });

  it('양쪽 준비 → 매치 생성(새 시드, 친구 모드), 방은 live', async () => {
    const a = await rpc<{ status: string; match_id: string | null }>('ann', 'set_ready', [code, true]);
    expect(a.status).toBe('waiting');
    const b = await rpc<{ status: string; match_id: string }>('bob', 'set_ready', [code, true]);
    expect(b.status).toBe('live');
    const [m] = await as<{ mode: string; seed: string; wave_count: number; p1: string; p2: string }>('ann', `select * from public.matches where id = '${b.match_id}'`);
    expect(m).toMatchObject({ mode: 'friend', wave_count: 20, p1: users.ann, p2: users.bob });
    expect(m.seed).toMatch(/^[0-9a-f]{32}$/);
    expect((await as('cat', 'select * from public.matches')).length).toBe(0); // 남의 매치는 안 보임
  });

  it('결과 보고: 양쪽 보고가 모이면 확정, 친구 대전은 레이팅 그대로 + 상대 전적', async () => {
    const [{ match_id }] = await admin<{ match_id: string }>(`select match_id from public.rooms where code = '${code}' and status = 'live'`);
    const first = await rpc<{ status: string }>('ann', 'report_result', [match_id, JSON.stringify({ reached: 21, life: 6, gold: 120, clearedSec: 610 }), null]);
    expect(first.status).toBe('live');
    const done = await rpc<{ status: string; winner: string; reason: string; role: string; ratingDelta: number }>('bob', 'report_result', [
      match_id, JSON.stringify({ reached: 17, life: 0, gold: 40 }), null,
    ]);
    expect(done).toMatchObject({ status: 'done', winner: 'p1', reason: 'first_clear', role: 'p2', ratingDelta: 0 });
    const [pa] = await admin<{ rating: number; wins: number }>(`select rating, wins from public.profiles where id = '${users.ann}'`);
    expect(pa).toEqual({ rating: 1000, wins: 0 });
    const [h] = await admin<{ a: string; a_wins: number; b_wins: number; last_results: string[] }>('select * from public.head_to_head');
    const annIsA = h.a === users.ann;
    expect(annIsA ? h.a_wins : h.b_wins).toBe(1);
    expect(h.last_results).toEqual([annIsA ? 'a' : 'b']);
    const [r] = await admin<{ status: string }>(`select status from public.rooms where code = '${code}' and status <> 'closed'`);
    expect(r.status).toBe('done');
  });

  it('재대결: 끝난 방에서 둘 다 준비하면 새 시드로 다음 판', async () => {
    const [{ seed: before }] = await admin<{ seed: string }>(`select m.seed from public.rooms r join public.matches m on m.id = r.match_id where r.code = '${code}' and r.status = 'done'`);
    await rpc('bob', 'set_ready', [code, true]);
    const r = await rpc<{ status: string; games_played: number; match_id: string }>('ann', 'set_ready', [code, true]);
    expect(r).toMatchObject({ status: 'live', games_played: 2 });
    const [{ seed }] = await admin<{ seed: string }>(`select seed from public.matches where id = '${r.match_id}'`);
    expect(seed).not.toBe(before);
  });

  it('친구 추가는 같이 한 상대만, 초대는 친구에게만', async () => {
    await expect(rpc('ann', 'add_friend', [users.cat])).rejects.toThrow(/never_played/);
    await rpc('ann', 'add_friend', [users.bob]);
    const list = await rpc<{ name: string; myWins: number; theirWins: number }[]>('ann', 'list_friends', []);
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ myWins: 1, theirWins: 0 });
    const bobs = await rpc<{ myWins: number; theirWins: number }[]>('bob', 'list_friends', []);
    expect(bobs[0]).toMatchObject({ myWins: 0, theirWins: 1 });
  });

  it('방장이 나가면 방이 닫히고 코드는 재사용 가능해진다', async () => {
    await rpc('ann', 'leave_room', [code]);
    expect((await admin(`select 1 from public.rooms where code = '${code}' and status <> 'closed'`)).length).toBe(0);
    await expect(rpc('bob', 'join_room', [code])).rejects.toThrow(/room_not_found/);
    const fresh = await rpc<{ code: string }>('ann', 'create_room', ['{}']);
    await expect(rpc('cat', 'invite_friend', [users.ann, fresh.code])).rejects.toThrow(/not_friends/);
    const inv = await rpc<{ to_id: string; status: string }>('ann', 'invite_friend', [users.bob, fresh.code]);
    expect(inv).toMatchObject({ to_id: users.bob, status: 'pending' });
    expect((await as('bob', 'select * from public.invites')).length).toBe(1);
    expect((await as('cat', 'select * from public.invites')).length).toBe(0);
  });
});

describe('랭크 매칭', () => {
  it('레이팅이 가까운 두 사람이 큐에 있으면 바로 매칭 (20웨이브, 같은 시드)', async () => {
    await admin('delete from public.matches'); // 앞 테스트의 live 매치 정리
    const a = await rpc<{ status: string }>('ann', 'enqueue', []);
    expect(a.status).toBe('waiting');
    const b = await rpc<{ status: string; match: { id: string; seed: string; waveCount: number; role: string; opponent: { name: string } } }>('bob', 'enqueue', []);
    expect(b.status).toBe('matched');
    expect(b.match).toMatchObject({ waveCount: 20, role: 'p2' });
    expect(b.match.opponent.name).toBe('앤2');
    const a2 = await rpc<{ status: string; match: { id: string; seed: string; role: string } }>('ann', 'poll_match', []);
    expect(a2).toMatchObject({ status: 'matched' });
    expect(a2.match.id).toBe(b.match.id);
    expect(a2.match.seed).toBe(b.match.seed);
    expect(a2.match.role).toBe('p1');
    expect((await admin('select 1 from public.queue')).length).toBe(0);
  });

  it('랭크 결과: 승자 +, 패자 −, 배치 기간은 K 64, 시즌 포인트 +20/−8(바닥 0)', async () => {
    const [{ id }] = await admin<{ id: string }>(`select id from public.matches where mode = 'ranked' and status = 'live'`);
    await rpc('ann', 'report_result', [id, JSON.stringify({ reached: 12, life: 0, gold: 10 }), null]);
    const r = await rpc<{ winner: string; reason: string; ratingDelta: number }>('bob', 'report_result', [id, JSON.stringify({ reached: 15, life: 0, gold: 0 }), null]);
    expect(r).toMatchObject({ winner: 'p2', reason: 'wave', ratingDelta: 32 }); // 동일 레이팅, K 64 × 0.5
    const rows = await admin<{ nick: string; rating: number; wins: number; losses: number; season_points: number; placement_left: number }>(
      `select nick, rating, wins, losses, season_points, placement_left from public.profiles where id in ('${users.ann}', '${users.bob}') order by rating`);
    expect(rows[0]).toMatchObject({ rating: 968, losses: 1, season_points: 0, placement_left: 9 });
    expect(rows[1]).toMatchObject({ rating: 1032, wins: 1, season_points: 20, placement_left: 9 });
  });

  it('레이팅 차이가 범위(처음 ±100) 밖이면 사람끼리는 안 잡힌다', async () => {
    await rpc('dan', 'ensure_profile', ['댄스', 'S']);
    await admin(`update public.profiles set rating = 1500 where id = '${users.dan}'`);
    await rpc('dan', 'enqueue', []);
    const c = await rpc<{ status: string; span: number }>('cat', 'enqueue', []);
    expect(c).toMatchObject({ status: 'waiting', span: 100 });
    await rpc('dan', 'cancel_queue', []);
  });

  it('대기가 fallback_at을 넘기면 봇이 일반 상대처럼 붙는다 (종류는 클라이언트에 안 보임)', async () => {
    await admin(`update public.queue set fallback_at = now() - interval '1 second' where player_id = '${users.cat}'`);
    const r = await rpc<{ status: string; match: Record<string, unknown> & { id: string; opponent: { id: string | null; name: string; rating: number; avatar: string } } }>('cat', 'poll_match', []);
    expect(r.status).toBe('matched');
    expect(r.match.opponent.id).toBeNull();
    expect(r.match.opponent.name.length).toBeGreaterThanOrEqual(2);
    expect(Math.abs(r.match.opponent.rating - 1000)).toBeLessThanOrEqual(80);
    expect(JSON.stringify(r.match)).not.toMatch(/bot|ghost|opponent_kind/i);
    // 내부 표에는 기록되지만 클라이언트는 읽을 수 없다
    const [mi] = await admin<{ opponent_kind: string }>(`select opponent_kind from public.match_internal where match_id = '${r.match.id}'`);
    expect(mi.opponent_kind).toBe('bot');
    expect((await as('cat', 'select * from public.match_internal')).length).toBe(0);
    expect((await as('cat', 'select * from public.bot_names')).length).toBe(0);
    expect(await rpc('cat', 'get_opponent_script', [r.match.id])).toBeNull(); // 봇은 대본 없음
  });

  it('대체 상대 판은 상대 성적을 같이 보고하고, K가 절반이다', async () => {
    const [{ id, p2_rating }] = await admin<{ id: string; p2_rating: number }>(`select id, p2_rating from public.matches where p1 = '${users.cat}' and status = 'live'`);
    await expect(rpc('cat', 'report_result', [id, JSON.stringify({ reached: 21, life: 3, gold: 50, clearedSec: 500 }), null])).rejects.toThrow(/opponent_report_required/);
    const r = await rpc<{ status: string; winner: string; ratingDelta: number }>('cat', 'report_result', [
      id, JSON.stringify({ reached: 21, life: 3, gold: 50, clearedSec: 500 }), JSON.stringify({ reached: 14, life: 0, gold: 0 }),
    ]);
    expect(r).toMatchObject({ status: 'done', winner: 'p1' });
    const expected = Math.round(32 * (1 - 1 / (1 + Math.pow(10, (p2_rating - 1000) / 400)))); // 배치 K 64의 절반
    expect(r.ratingDelta).toBe(expected);
  });

  it('검증된 로그만 고스트가 되고, 다음 사람의 대체 매칭에 고스트로 쓰인다', async () => {
    const [{ id }] = await admin<{ id: string }>(`select id from public.matches where p1 = '${users.cat}' order by started_at desc limit 1`);
    const rounds = Array.from({ length: 6 }, (_, i) => ({ wave: i + 1, exchanges: [0], skills: [] }));
    await rpc('cat', 'submit_log', [id, JSON.stringify(rounds), 'abc']);
    expect((await admin('select 1 from public.ghosts')).length).toBe(0); // 검증 전에는 고스트가 아니다
    // verify-match(Edge Function, service role)가 재생 검사를 통과시킨 뒤 하는 일
    await admin(`update public.match_logs set verified = true where match_id = '${id}' and player_id = '${users.cat}'`);
    await admin(`insert into public.ghosts (player_id, match_id, rating, wave_count, seed) select '${users.cat}', m.id, 1000, m.wave_count, m.seed from public.matches m where m.id = '${id}'`);
    expect((await admin('select 1 from public.ghosts')).length).toBe(1);
    expect((await as('ann', 'select * from public.ghosts')).length).toBe(0); // 클라이언트 접근 불가

    await admin(`update public.profiles set rating = 1000 where id = '${users.dan}'`);
    await rpc('dan', 'enqueue', []);
    await admin(`update public.queue set fallback_at = now() - interval '1 second' where player_id = '${users.dan}'`);
    const r = await rpc<{ status: string; match: { id: string; opponent: { name: string; id: string | null } } }>('dan', 'poll_match', []);
    expect(r.status).toBe('matched');
    expect(r.match.opponent.name).toBe('캣츠'); // 고스트 주인의 닉으로 보인다
    expect(r.match.opponent.id).toBeNull();
    const script = await rpc<{ rounds: unknown[]; seed: string; player: string }>('dan', 'get_opponent_script', [r.match.id]);
    expect(script.rounds.length).toBe(6);
    expect(script.player).toBe(users.cat); // 손패 시드 스트림의 키
    const [m] = await admin<{ seed: string }>(`select seed from public.matches where id = '${r.match.id}'`);
    expect(m.seed).toBe(script.seed); // 같은 웨이브·같은 전투 난수
  });
});

describe('랭크 이탈 = 기권패', () => {
  it('대체 상대 매치를 끝내지 않고 다시 매칭하면 그 판은 기권패(레이팅 하락)가 되고 새로 대기한다', async () => {
    const [{ id }] = await admin<{ id: string }>(`select id from public.matches where p1 = '${users.dan}' and status = 'live' order by started_at desc limit 1`);
    const [before] = await admin<{ rating: number; losses: number }>(`select rating, losses from public.profiles where id = '${users.dan}'`);
    const r = await rpc<{ status: string }>('dan', 'enqueue', []);
    expect(r.status).toBe('waiting');
    const [m] = await admin<{ status: string; reason: string; winner: string }>(`select status, reason, winner from public.matches where id = '${id}'`);
    expect(m).toMatchObject({ status: 'done', reason: 'forfeit', winner: 'p2' });
    const [after] = await admin<{ rating: number; losses: number }>(`select rating, losses from public.profiles where id = '${users.dan}'`);
    expect(after.rating).toBeLessThan(before.rating);
    expect(after.losses).toBe(before.losses + 1);
    await rpc('dan', 'cancel_queue', []);
  });

  const pair = async () => {
    await admin(`update public.profiles set rating = 1000 where id in ('${users.ann}', '${users.bob}')`);
    await rpc('ann', 'enqueue', []);
    const r = await rpc<{ status: string; match: { id: string } }>('bob', 'enqueue', []);
    expect(r.status).toBe('matched');
    return r.match.id;
  };

  it('기권하면 바로 확정되고 상대가 이긴다. 기권한 사람의 다음 매칭을 막지 않는다', async () => {
    const id = await pair();
    const r = await rpc<{ status: string; winner: string; role: string; reason: string }>('bob', 'forfeit_match', [id]);
    expect(r.status).toBe('done');
    expect(r.reason).toBe('forfeit');
    expect(r.winner).not.toBe(r.role);
    // 남은 사람이 뒤늦게 보고해도 결과는 그대로
    const late = await rpc<{ status: string; winner: string; role: string }>('ann', 'report_result', [id, JSON.stringify({ reached: 9, life: 4, gold: 10 }), null]);
    expect(late.winner).toBe(late.role);
    expect((await rpc<{ status: string }>('bob', 'enqueue', [])).status).toBe('waiting');
    await rpc('bob', 'cancel_queue', []);
  });

  it('상대가 안 보인다는 주장은 서버가 본 시각으로 확인한다', async () => {
    const id = await pair();
    await rpc('ann', 'heartbeat', [id]);
    await rpc('bob', 'heartbeat', [id]);
    expect(await rpc<boolean>('ann', 'claim_absent', [id])).toBe(false); // 방금 봤다
    const [live] = await admin<{ status: string }>(`select status from public.matches where id = '${id}'`);
    expect(live.status).toBe('live');
    const [{ p1 }] = await admin<{ p1: string }>(`select p1 from public.matches where id = '${id}'`);
    const bobSide = p1 === users.bob ? 'p1' : 'p2';
    await admin(`update public.matches set ${bobSide}_seen = now() - interval '40 seconds' where id = '${id}'`);
    expect(await rpc<boolean>('ann', 'claim_absent', [id])).toBe(true);
    const [m] = await admin<{ status: string; reason: string; winner: string }>(`select status, reason, winner from public.matches where id = '${id}'`);
    expect(m).toMatchObject({ status: 'done', reason: 'forfeit', winner: bobSide === 'p1' ? 'p2' : 'p1' });
  });

  it('친구 대전에는 기권패가 없다', async () => {
    const [f] = await admin<{ id: string; p1: string }>(`select id, p1 from public.matches where mode = 'friend' limit 1`);
    if (!f) return;
    const who = Object.entries(users).find(([, v]) => v === f.p1)![0];
    const before = await admin<{ status: string }>(`select status from public.matches where id = '${f.id}'`);
    await rpc(who, 'forfeit_match', [f.id]);
    expect(await admin(`select status from public.matches where id = '${f.id}'`)).toEqual(before);
    expect(await rpc<boolean>(who, 'claim_absent', [f.id])).toBe(false);
  });
});

describe('시즌·랭킹', () => {
  type Row = { rank: number; id: string; name: string; rating: number; seasonPoints: number; me: boolean };
  type Board = { kind: string; rows: Row[]; me: Row | null; total: number };

  it('리더보드: 랭크 대전을 한 사람만, 시즌 포인트 순, 내 순위 포함', async () => {
    await admin(`update public.profiles set season_points = 120, rating = 1010, wins = 6, losses = 1 where id = '${users.ann}'`);
    await admin(`update public.profiles set season_points = 340, rating = 990, wins = 17, losses = 0 where id = '${users.bob}'`);
    const b = await rpc<Board>('ann', 'leaderboard', ['season', 50]);
    expect(b.kind).toBe('season');
    expect(b.rows[0]).toMatchObject({ rank: 1, id: users.bob, seasonPoints: 340, me: false });
    expect(b.me).toMatchObject({ id: users.ann, me: true });
    expect(b.rows.every((r, i) => i === 0 || b.rows[i - 1].seasonPoints >= r.seasonPoints)).toBe(true);
    const [{ n }] = await admin<{ n: number }>('select count(*)::int as n from public.profiles where wins + losses + draws > 0');
    expect(b.total).toBe(n);
    expect(JSON.stringify(b)).not.toMatch(/bot|ghost|opponent_kind/i);
  });

  it('레이팅 순 리더보드와 상한', async () => {
    const b = await rpc<Board>('ann', 'leaderboard', ['rating', 1]);
    expect(b.kind).toBe('rating');
    expect(b.rows.length).toBe(1);
    const [{ top }] = await admin<{ top: number }>('select max(rating)::int as top from public.profiles where wins + losses + draws > 0');
    expect(b.rows[0].rating).toBe(top);
    expect(b.me).not.toBeNull(); // 목록 밖이어도 내 순위는 온다
  });

  it('내 시즌 현황: 시즌 기간·보상 구간·내 포인트', async () => {
    const m = await rpc<{ season: { name: string; endsAt: string; rewards: { minPoints: number; diamonds: number }[] }; me: { seasonPoints: number }; unclaimed: unknown[] }>('ann', 'my_season', []);
    expect(m.season.name).toBe('시즌 1');
    expect(new Date(m.season.endsAt).getTime()).toBeGreaterThan(Date.now());
    expect(m.season.rewards.map((r) => r.minPoints)).toEqual([100, 300, 600]);
    expect(m.me.seasonPoints).toBe(120);
    expect(m.unclaimed).toEqual([]);
  });

  it('시즌이 끝나면: 결과 기록 → 포인트 0 · 레이팅은 1000 쪽으로 절반 → 다음 시즌', async () => {
    await admin(`update public.profiles set rating = 1200 where id = '${users.bob}'`);
    await admin(`update public.seasons set starts_at = now() - interval '29 days', ends_at = now() - interval '1 hour'`);
    const m = await rpc<{ season: { name: string; endsAt: string }; me: { seasonPoints: number; rating: number }; unclaimed: { seasonId: number; rank: number; points: number; diamonds: number; name: string }[] }>('bob', 'my_season', []);
    expect(m.season.name).toBe('시즌 2');
    expect(new Date(m.season.endsAt).getTime()).toBeGreaterThan(Date.now() + 27 * 86400e3);
    expect(m.me).toMatchObject({ seasonPoints: 0, rating: 1100 });
    expect(m.unclaimed).toEqual([expect.objectContaining({ name: '시즌 1', rank: 1, points: 340, diamonds: 150 })]);
    // 다시 불러도 한 번만 넘어간다
    await rpc('ann', 'my_season', []);
    expect((await admin('select 1 from public.seasons')).length).toBe(2);
    const ann = await rpc<{ unclaimed: { diamonds: number }[] }>('ann', 'my_season', []);
    expect(ann.unclaimed).toEqual([expect.objectContaining({ points: 120, diamonds: 50 })]);
  });

  it('보상은 한 번만 받는다. 남의 결과는 보이지 않는다', async () => {
    const [{ id }] = await admin<{ id: number }>(`select id from public.seasons where name = '시즌 1'`);
    expect(await rpc<number>('bob', 'claim_season_reward', [id])).toBe(150);
    await expect(rpc('bob', 'claim_season_reward', [id])).rejects.toThrow(/reward_not_found/);
    expect((await rpc<{ unclaimed: unknown[] }>('bob', 'my_season', [])).unclaimed).toEqual([]);
    const seen = await as<{ player_id: string }>('ann', 'select player_id from public.season_results');
    expect(seen.every((r) => r.player_id === users.ann)).toBe(true);
    // 보상 구간에 못 미친 사람은 받을 것이 없다
    await expect(rpc('dan', 'claim_season_reward', [id])).rejects.toThrow(/reward_not_found/);
  });

  it('클라이언트는 시즌 결과·시즌을 직접 고칠 수 없다', async () => {
    await as('ann', `update public.season_results set diamonds = 9999 where player_id = '${users.ann}'`).catch(() => undefined);
    const [r] = await admin<{ diamonds: number }>(`select diamonds from public.season_results where player_id = '${users.ann}'`);
    expect(r.diamonds).toBe(50);
    await expect(rpc('ann', 'ensure_season', [])).rejects.toThrow();
  });
});

describe('친구 방 관전', () => {
  type Info = { room: { id: string; code: string; status: string; matchId: string | null }; host: { name: string }; guest: { name: string } | null; match: Record<string, unknown> | null; spectators: number };
  let code = '';

  it('코드를 아는 사람은 구경꾼으로 들어온다. 방의 두 사람은 구경꾼이 될 수 없다', async () => {
    const room = await rpc<{ id: string; code: string }>('ann', 'create_room', [JSON.stringify({})]);
    code = room.code;
    await rpc('bob', 'join_room', [code]);
    const info = await rpc<Info>('cat', 'watch_room', [code.toLowerCase()]);
    expect(info.room).toMatchObject({ code, status: 'waiting' });
    expect(info.host.name).toBeTruthy();
    expect(info.guest).not.toBeNull();
    expect(info.spectators).toBe(1);
    expect((await rpc<Info>('cat', 'watch_room', [code])).spectators).toBe(1); // 다시 들어와도 한 명
    await expect(rpc('ann', 'watch_room', [code])).rejects.toThrow(/in_room/);
    await expect(rpc('dan', 'watch_room', ['ZZZZZZ'])).rejects.toThrow(/room_not_found/);
  });

  it('구경꾼은 그 방 행만 보이고, 매치 행(시드)은 보이지 않는다', async () => {
    expect((await as<{ code: string }>('cat', 'select code from public.rooms')).map((r) => r.code)).toContain(code);
    expect((await as<{ code: string }>('dan', `select code from public.rooms where code = '${code}'`)).length).toBe(0);
    await rpc('ann', 'set_ready', [code, true]);
    await rpc('bob', 'set_ready', [code, true]);
    const info = await rpc<Info>('cat', 'watch_info', [code]);
    expect(info.room.status).toBe('live');
    expect(info.match).toMatchObject({ status: 'live', waveCount: 20 });
    expect(JSON.stringify(info)).not.toMatch(/seed|opponent_kind|ghost|bot/i);
    expect((await as('cat', `select id from public.matches where id = '${info.room.matchId}'`)).length).toBe(0);
    await expect(rpc('dan', 'watch_info', [code])).rejects.toThrow(/not_watching/);
  });

  it('방 사람들은 구경꾼 수를 볼 수 있고, 남은 볼 수 없다', async () => {
    expect((await as('ann', 'select 1 from public.room_spectators')).length).toBe(1);
    expect((await as('dan', 'select 1 from public.room_spectators')).length).toBe(0);
  });

  it('끝나면 구경꾼에게 승자가 보인다', async () => {
    const before = await rpc<Info>('cat', 'watch_info', [code]);
    const id = before.room.matchId!;
    await rpc('ann', 'report_result', [id, JSON.stringify({ reached: 12, life: 0, gold: 3 }), null]);
    await rpc('bob', 'report_result', [id, JSON.stringify({ reached: 9, life: 0, gold: 0 }), null]);
    const info = await rpc<Info>('cat', 'watch_info', [code]);
    expect(info.room.status).toBe('done');
    expect(info.match).toMatchObject({ status: 'done', winner: 'p1', reason: 'wave' });
  });

  it('여덟 명까지, 나가면 자리가 난다', async () => {
    const [{ id }] = await admin<{ id: string }>(`select id from public.rooms where code = '${code}' and status <> 'closed'`);
    await admin(`insert into auth.users (id) select gen_random_uuid() from generate_series(1, 7)`).catch(() => undefined);
    const extra = await admin<{ id: string }>(`select u.id from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id) limit 7`);
    for (const [i, u] of extra.entries()) {
      await admin(`insert into public.profiles (id, nick) values ('${u.id}', '구경${i + 1}')`);
      await admin(`insert into public.room_spectators (room_id, player_id) values ('${id}', '${u.id}')`);
    }
    if (extra.length === 7) await expect(rpc('dan', 'watch_room', [code])).rejects.toThrow(/spectators_full/);
    await rpc('cat', 'unwatch_room', [code]);
    expect((await rpc<Info>('dan', 'watch_room', [code])).spectators).toBeLessThanOrEqual(8);
    await expect(rpc('cat', 'watch_info', [code])).rejects.toThrow(/not_watching/);
  });
});

describe('판정·레이팅 순수 함수', () => {
  const decide = async (a: object, b: object) =>
    (await admin<{ r: { winner: string; reason: string } }>('select public.decide_winner($1::jsonb, $2::jsonb) as r', [JSON.stringify(a), JSON.stringify(b)]))[0].r;

  it('판정 순서: 먼저 클리어 → 도달 라운드 → 하트 → 골드 → 무승부', async () => {
    expect(await decide({ reached: 21, clearedSec: 600 }, { reached: 21, clearedSec: 590 })).toEqual({ winner: 'b', reason: 'first_clear' });
    expect(await decide({ reached: 21, clearedSec: 600 }, { reached: 20 })).toEqual({ winner: 'a', reason: 'first_clear' });
    expect(await decide({ reached: 12, life: 0 }, { reached: 14, life: 0 })).toEqual({ winner: 'b', reason: 'wave' });
    expect(await decide({ reached: 12, life: 3 }, { reached: 12, life: 1 })).toEqual({ winner: 'a', reason: 'life' });
    expect(await decide({ reached: 12, life: 3, gold: 9 }, { reached: 12, life: 3, gold: 10 })).toEqual({ winner: 'b', reason: 'gold' });
    expect(await decide({ reached: 12, life: 3, gold: 9 }, { reached: 12, life: 3, gold: 9 })).toEqual({ winner: 'draw', reason: 'draw' });
  });

  it('보고값은 범위로 잘린다 (도달 라운드 ≤ 웨이브+1, 클리어 시간은 클리어했을 때만)', async () => {
    const [{ r }] = await admin<{ r: Record<string, unknown> }>(`select public.clean_report('{"reached": 99, "life": -5, "gold": 12.7, "clearedSec": 100}'::jsonb, 20) as r`);
    expect(r).toEqual({ reached: 21, life: 0, gold: 12, clearedSec: 100 });
    const [{ r: r2 }] = await admin<{ r: Record<string, unknown> }>(`select public.clean_report('{"reached": 10, "clearedSec": 100}'::jsonb, 20) as r`);
    expect(r2.clearedSec).toBeNull();
  });
});
