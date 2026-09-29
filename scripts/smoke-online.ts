/**
 * 온라인 스모크 테스트 — 실제 Supabase 프로젝트를 상대로 전체 흐름을 한 번 돈다.
 * 실행: npm run smoke:online   (.env.local 의 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 사용)
 * 익명 계정 2개를 만들어 친구 대전(방→준비→실시간 이벤트→결과→재대결 준비)과 랭크 매칭·판정·로그 검증 함수를 확인한다.
 * SMOKE_SERVICE_KEY 가 있으면 끝에 테스트 계정·행을 지운다 (키는 파일에 저장하지 않는다).
 */
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY;
if (!URL_ || !ANON) throw new Error('.env.local 에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 필요합니다');

let passed = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (!cond) throw new Error(`FAIL: ${name} ${detail}`);
  passed++;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
};
const mk = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
async function rpc<T>(c: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}
const fails = async (p: Promise<unknown>, re: RegExp) => { try { await p; return false; } catch (e) { return re.test(String((e as Error).message)); } };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function login(nick: string): Promise<{ c: SupabaseClient; id: string }> {
  const c = mk();
  const { data, error } = await c.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`익명 로그인 실패: ${error?.message}`);
  await rpc(c, 'ensure_profile', { p_nick: nick, p_avatar: null });
  return { c, id: data.user.id };
}

const ids: string[] = [];
try {
  console.log(`프로젝트: ${URL_}`);
  console.log('1) 익명 로그인 · 프로필');
  const A = await login('스모크A'), B = await login('스모크B');
  ids.push(A.id, B.id);
  ok('익명 계정 2개 + 프로필', A.id !== B.id);
  const anonOnly = mk();
  ok('로그인 없이는 RPC 거절', await fails(rpc(anonOnly, 'ensure_profile', { p_nick: null, p_avatar: null }), /permission denied|not_authenticated/i));
  const { data: direct } = await A.c.from('profiles').update({ rating: 9999 }).eq('id', A.id).select();
  ok('프로필 직접 수정 불가 (RLS)', (direct ?? []).length === 0);

  console.log('2) 친구 대전 방');
  const room = await rpc<{ id: string; code: string; rules: Record<string, unknown> }>(A.c, 'create_room', { p_rules: { betting: false, waves: 20, speed: 9 } });
  ok('방 생성 + 규칙 정규화', /^[A-HJ-NP-Z2-9]{6}$/.test(room.code) && room.rules.speed === 1 && room.rules.betting === false, `코드 ${room.code}`);

  // 방 행 변경 구독 (Realtime postgres_changes)
  const roomEvents: { guest: string | null; status: string }[] = [];
  const rowCh = A.c.channel(`room-row:${room.id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` }, (p) => roomEvents.push(p.new as { guest: string | null; status: string }));
  await new Promise<void>((res, rej) => rowCh.subscribe((s) => (s === 'SUBSCRIBED' ? res() : s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' ? rej(new Error(`realtime ${s}`)) : undefined)));

  await wait(2500); // postgres_changes 는 SUBSCRIBED 뒤 서버 쪽 구독이 붙기까지 잠깐 걸린다
  await rpc(B.c, 'join_room', { p_code: room.code.toLowerCase() });
  const { data: seenByB } = await B.c.from('rooms').select('code');
  ok('손님은 자기 방만 보인다', (seenByB ?? []).length === 1);
  await rpc(A.c, 'set_ready', { p_code: room.code, p_ready: true });
  const live = await rpc<{ status: string; match_id: string }>(B.c, 'set_ready', { p_code: room.code, p_ready: true });
  ok('양쪽 준비 → 매치 시작', live.status === 'live' && !!live.match_id);
  await wait(2500);
  ok('방 변경이 실시간으로 방장에게 도착', roomEvents.some((e) => e.guest === B.id) && roomEvents.some((e) => e.status === 'live'), `${roomEvents.length}건`);

  console.log('3) 매치 실시간 이벤트 (broadcast + presence)');
  const chan = (c: SupabaseClient, me: string) => c.channel(`match:${live.match_id}`, { config: { broadcast: { self: false }, presence: { key: me } } });
  const chA = chan(A.c, A.id), chB = chan(B.c, B.id);
  const gotB: unknown[] = [];
  let presentForA = false;
  chB.on('broadcast', { event: 'e' }, (m) => gotB.push(m.payload));
  chA.on('presence', { event: 'sync' }, () => { presentForA = Object.keys(chA.presenceState()).some((k) => k !== A.id); });
  const sub = (ch: ReturnType<typeof chan>) => new Promise<void>((res, rej) => ch.subscribe((s) => (s === 'SUBSCRIBED' ? (void ch.track({ at: Date.now() }), res()) : s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' ? rej(new Error(`realtime ${s}`)) : undefined)));
  await sub(chA); await sub(chB);
  await wait(800);
  const t0 = Date.now();
  await chA.send({ type: 'broadcast', event: 'e', payload: { t: 'bet', wave: 1, action: 'raise', amount: 10, sentAt: t0 } });
  await wait(1200);
  ok('이벤트가 상대에게 도착', gotB.length === 1 && (gotB[0] as { t: string }).t === 'bet');
  ok('상대 접속 상태(presence) 확인', presentForA);

  console.log('4) 결과 보고 · 판정 · 상대 전적');
  const r1 = await rpc<{ status: string }>(A.c, 'report_result', { p_match: live.match_id, p_report: { reached: 21, life: 5, gold: 80, clearedSec: 600 }, p_opponent: null });
  ok('한쪽 보고만으로는 확정 안 됨', r1.status === 'live');
  const r2 = await rpc<{ status: string; winner: string; reason: string; ratingDelta: number }>(B.c, 'report_result', { p_match: live.match_id, p_report: { reached: 15, life: 0, gold: 0 }, p_opponent: null });
  ok('양쪽 보고 → 확정', r2.status === 'done' && r2.winner === 'p1' && r2.reason === 'first_clear' && r2.ratingDelta === 0, `${r2.winner} · ${r2.reason}`);
  await rpc(A.c, 'add_friend', { p_other: B.id });
  const friends = await rpc<{ name: string; myWins: number }[]>(A.c, 'list_friends');
  ok('친구 추가 + 상대 전적', friends.length === 1 && friends[0].myWins === 1, `${friends[0].name} 상대 ${friends[0].myWins}승`);
  await rpc(A.c, 'leave_room', { p_code: room.code });

  console.log('5) 랭크 매칭 · 레이팅');
  const q1 = await rpc<{ status: string }>(A.c, 'enqueue');
  const q2 = await rpc<{ status: string; match: { id: string; seed: string; waveCount: number; opponent: { name: string } } }>(B.c, 'enqueue');
  ok('큐의 두 사람이 매칭', q1.status === 'waiting' && q2.status === 'matched' && q2.match.waveCount === 20, `상대 ${q2.match.opponent.name}`);
  ok('응답에 상대 종류가 없다', !/bot|ghost|opponent_kind/i.test(JSON.stringify(q2.match)));
  const mine = await rpc<{ status: string; match: { id: string; seed: string } }>(A.c, 'poll_match');
  ok('양쪽이 같은 매치·같은 시드', mine.match.id === q2.match.id && mine.match.seed === q2.match.seed);
  await rpc(A.c, 'report_result', { p_match: q2.match.id, p_report: { reached: 9, life: 0, gold: 0 }, p_opponent: null });
  const fin = await rpc<{ winner: string; ratingDelta: number }>(B.c, 'report_result', { p_match: q2.match.id, p_report: { reached: 13, life: 0, gold: 0 }, p_opponent: null });
  ok('랭크 확정 + 레이팅 반영 (배치 K 64, 동일 레이팅 → +32)', fin.ratingDelta === 32, `+${fin.ratingDelta}`);
  const { data: hidden } = await A.c.from('match_internal').select('*');
  ok('match_internal 은 클라이언트가 못 읽는다', (hidden ?? []).length === 0);

  console.log('6) 입력 로그 제출 · 검증 함수');
  const rounds = Array.from({ length: 8 }, (_, i) => ({
    wave: i + 1, exchanges: [0], ticketExchanges: 0, confirmedAt: 4,
    manage: { moves: [], sells: [], merges: [], upgrades: [] }, combatSec: 0.1, skills: [], bet: [{ action: 'check', at: 3 }],
    result: { lifeLost: i === 7 ? 10 : 0, clearSec: 0.1, handRank: 1, cleared: i < 7 },
  }));
  await rpc(A.c, 'submit_log', { p_match: q2.match.id, p_rounds: rounds, p_checksum: 'smoke' });
  const { data: v, error: ve } = await A.c.functions.invoke('verify-match', { body: { matchId: q2.match.id } });
  ok('verify-match 함수 호출', !ve && !!v?.results?.[A.id], ve ? String(ve.message) : JSON.stringify(v.results[A.id]));
  // A의 보고는 reached 9인데 로그는 8라운드에서 탈락 → reached_mismatch 가 잡혀야 한다
  ok('로그와 성적 불일치를 잡는다', v.results[A.id].ok === false && v.results[A.id].issues.includes('reached_mismatch'));

  await A.c.removeAllChannels(); await B.c.removeAllChannels();
  console.log(`\n통과 ${passed}개`);
} finally {
  const key = process.env.SMOKE_SERVICE_KEY;
  if (key && ids.length) {
    const admin = createClient(URL_, key, { auth: { persistSession: false } });
    for (const id of ids) await admin.auth.admin.deleteUser(id); // profiles → 방·매치·로그 등은 cascade
    const { count } = await admin.from('profiles').select('*', { count: 'exact', head: true });
    console.log(`정리: 테스트 계정 ${ids.length}개 삭제, 남은 프로필 ${count ?? 0}개`);
  } else if (ids.length) {
    console.log(`정리 안 함 (SMOKE_SERVICE_KEY 없음). 테스트 계정: ${ids.join(', ')}`);
  }
}
process.exit(0);
