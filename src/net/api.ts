/** 서버 RPC 래퍼 — supabase/migrations/…functions.sql 의 함수와 1:1. 오류는 서버 예외 코드(room_full 등)를 메시지로 던진다 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getClient } from './supabase.ts';
import { normalizeRoomCode } from './roomCode.ts';
import type { Friend, Invite, Leaderboard, LeaderboardKind, MatchInfo, MatchReport, PollResult, Profile, Room, RoomRules, RoundInput, SeasonInfo } from './types.ts';
import type { MatchEvent, MatchTransport, PeerRole, Unsubscribe } from './MatchTransport.ts';
import type { WatchInfo } from './types.ts';

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

// ── 프로필 ──
export const updateProfile = (nick?: string, avatar?: string) => rpc<Profile>('update_profile', { p_nick: nick ?? null, p_avatar: avatar ?? null });
export const reportCampaign = (wave: number) => rpc<Profile>('report_campaign', { p_wave: wave });

/** 공개 프로필 (닉·아바타·레이팅) */
export async function getProfile(id: string): Promise<Profile | null> {
  const { data } = await getClient().from('profiles').select('*').eq('id', id).maybeSingle();
  return (data as Profile | null) ?? null;
}

// ── 친구 대전 방 ──
export async function getRoom(roomId: string): Promise<Room | null> {
  const { data } = await getClient().from('rooms').select('*').eq('id', roomId).maybeSingle();
  return (data as Room | null) ?? null;
}

/**
 * 내가 참가한 매치 정보 (친구 방이 live가 되면 room.match_id로 읽는다). RLS로 내 매치만 보인다.
 * 상대가 어떤 종류인지는 여기에도 없다 — 표시용 닉·레이팅·아바타만.
 */
export async function getMatch(matchId: string, me: string): Promise<MatchInfo> {
  const { data, error } = await getClient().from('matches').select('*').eq('id', matchId).single();
  if (error || !data) throw new Error('match_not_found');
  const m = data as { id: string; mode: 'ranked' | 'friend'; seed: string; wave_count: 20 | 40; rules: RoomRules; p1: string; p2: string | null; p2_name: string | null; p2_rating: number | null; p2_avatar: Profile['avatar'] | null; started_at: string; status: MatchInfo['status']; winner: MatchInfo['winner']; reason: string | null; rating_delta_p1: number | null; rating_delta_p2: number | null };
  const role = m.p1 === me ? 'p1' : 'p2';
  const oppId = role === 'p1' ? m.p2 : m.p1;
  const p = oppId ? await getProfile(oppId) : null;
  return {
    id: m.id, mode: m.mode, seed: m.seed, waveCount: m.wave_count, rules: m.rules, role,
    opponent: p ? { id: p.id, name: p.nick, rating: p.rating, avatar: p.avatar } : { id: null, name: m.p2_name ?? '상대', rating: m.p2_rating ?? 1000, avatar: m.p2_avatar ?? 'S' },
    startedAt: m.started_at, status: m.status, winner: m.winner, reason: m.reason,
    ratingDelta: role === 'p1' ? m.rating_delta_p1 : m.rating_delta_p2,
  };
}

export const createRoom = (rules: Partial<RoomRules> = {}) => rpc<Room>('create_room', { p_rules: rules });
export const joinRoom = (code: string) => rpc<Room>('join_room', { p_code: normalizeRoomCode(code) });
export const setRoomRules = (code: string, rules: Partial<RoomRules>) => rpc<Room>('set_room_rules', { p_code: code, p_rules: rules });
export const setReady = (code: string, ready = true) => rpc<Room>('set_ready', { p_code: code, p_ready: ready });
export const leaveRoom = (code: string) => rpc<void>('leave_room', { p_code: code });
export const kickGuest = (code: string) => rpc<Room>('kick_guest', { p_code: code });

/**
 * 방 변경 구독 (입장·준비·규칙·매치 시작). RLS 덕에 내 방만 온다.
 * 구독이 붙기 전(SUBSCRIBED 뒤 1~2초)에 일어난 변경은 놓칠 수 있으므로, 구독 완료 시와 그 2초 뒤에 현재 행을 한 번씩 읽어 맞춘다.
 */
export function subscribeRoom(roomId: string, onChange: (room: Room) => void): Unsubscribe {
  let alive = true;
  const refetch = async () => {
    const { data } = await getClient().from('rooms').select('*').eq('id', roomId).maybeSingle();
    if (alive && data) onChange(data as Room);
  };
  const ch = getClient()
    .channel(`room-row:${roomId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, (p) => onChange(p.new as Room))
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      void refetch();
      setTimeout(() => void refetch(), 2000);
    });
  return () => { alive = false; void getClient().removeChannel(ch); };
}

// ── 관전 ──
export const watchRoom = (code: string) => rpc<WatchInfo>('watch_room', { p_code: normalizeRoomCode(code) });
export const watchInfo = (code: string) => rpc<WatchInfo>('watch_info', { p_code: code });
/** 방의 구경꾼 수 (방 사람·구경꾼만 셀 수 있다) */
export async function countSpectators(roomId: string): Promise<number> {
  const { count } = await getClient().from('room_spectators').select('player_id', { count: 'exact', head: true }).eq('room_id', roomId);
  return count ?? 0;
}
export const unwatchRoom = (code: string) => rpc<void>('unwatch_room', { p_code: code });

// ── 랭크 매칭 ──
export const enqueue = () => rpc<PollResult>('enqueue');
export const pollMatch = () => rpc<PollResult>('poll_match');
export const cancelQueue = () => rpc<void>('cancel_queue');
/** 대체 상대의 대본(입력 로그). 없으면 null → 클라이언트 봇 두뇌로 진행. 사람 상대면 오류 */
export const getOpponentScript = (matchId: string) => rpc<{ rounds: RoundInput[]; seed: string; player: string } | null>('get_opponent_script', { p_match: matchId });

/**
 * 매칭될 때까지 기다린다 (2.5초마다 poll). 대기가 길어지면 서버가 알아서 상대를 붙인다.
 * @returns 취소 함수와 결과 Promise
 */
export function findMatch(onTick?: (waitedSec: number) => void, intervalMs = 2500): { promise: Promise<MatchInfo>; cancel: () => Promise<void> } {
  let stopped = false;
  const promise = (async () => {
    let r = await enqueue();
    while (!stopped) {
      if (r.status === 'matched') return r.match;
      if (r.status === 'waiting') onTick?.(r.waited);
      await new Promise((res) => setTimeout(res, intervalMs));
      if (stopped) break;
      r = await pollMatch();
    }
    throw new Error('match_cancelled');
  })();
  return { promise, cancel: async () => { stopped = true; await cancelQueue(); } };
}

// ── 결과 ──
export const reportResult = (matchId: string, report: MatchReport, opponent?: MatchReport) =>
  rpc<MatchInfo>('report_result', { p_match: matchId, p_report: report, p_opponent: opponent ?? null });
/** 랭크 매치 중 10초마다: 서버가 나를 마지막으로 본 시각 */
export const heartbeat = (matchId: string) => rpc<void>('heartbeat', { p_match: matchId });
/** 랭크 매치를 나감 = 기권패 (친구 대전은 아무 일도 없다) */
export const forfeitMatch = (matchId: string) => rpc<MatchInfo>('forfeit_match', { p_match: matchId });
/** 상대가 안 보인다 → 서버가 확인해 맞으면 상대 기권패로 확정하고 true */
export const claimAbsent = (matchId: string) => rpc<boolean>('claim_absent', { p_match: matchId });
export const claimTimeout = (matchId: string) => rpc<MatchInfo>('claim_timeout', { p_match: matchId });
export const submitLog = (matchId: string, rounds: RoundInput[], checksum?: string) =>
  rpc<void>('submit_log', { p_match: matchId, p_rounds: rounds, p_checksum: checksum ?? null });

/** 로그 검증 요청 (Edge Function verify-match). 결과는 서버에 기록되고, 통과한 랭크 로그는 고스트 후보가 된다 */
export async function verifyMatch(matchId: string, me: string): Promise<{ ok: boolean; issues: string[]; replayed: boolean } | null> {
  const { data, error } = await getClient().functions.invoke('verify-match', { body: { matchId } });
  if (error || !data?.results) return null;
  return (data.results as Record<string, { ok: boolean; issues: string[]; replayed: boolean }>)[me] ?? null;
}

/** 매치 확정(상대 보고 도착) 구독 */
export function subscribeMatch(matchId: string, onDone: (status: string) => void): Unsubscribe {
  const ch = getClient()
    .channel(`match-row:${matchId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, (p) => onDone((p.new as { status: string }).status))
    .subscribe();
  return () => { void getClient().removeChannel(ch); };
}

// ── 시즌·랭킹 ──
export const getLeaderboard = (kind: LeaderboardKind, limit = 50) => rpc<Leaderboard>('leaderboard', { p_kind: kind, p_limit: limit });
export const getMySeason = () => rpc<SeasonInfo>('my_season');
/** 지난 시즌 보상 수령 (서버에 1회 기록). 받은 다이아 수 */
export const claimSeasonReward = (seasonId: number) => rpc<number>('claim_season_reward', { p_season: seasonId });

// ── 친구 ──
export const addFriend = (otherId: string) => rpc<void>('add_friend', { p_other: otherId });
export const removeFriend = (otherId: string) => rpc<void>('remove_friend', { p_other: otherId });
export const listFriends = () => rpc<Friend[]>('list_friends');
export const inviteFriend = (friendId: string, code: string) => rpc<Invite>('invite_friend', { p_friend: friendId, p_code: code });
export const answerInvite = (inviteId: string, accept: boolean) => rpc<Invite>('answer_invite', { p_invite: inviteId, p_accept: accept });

/** 아직 답하지 않은, 유효한 초대 (화면에 들어올 때 한 번 읽는다) */
export async function pendingInvites(myId: string): Promise<Invite[]> {
  const { data } = await getClient().from('invites').select('*').eq('to_id', myId).eq('status', 'pending')
    .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(3);
  return (data as Invite[] | null) ?? [];
}

export function subscribeInvites(myId: string, onInvite: (invite: Invite) => void): Unsubscribe {
  const ch = getClient()
    .channel(`invites:${myId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'invites', filter: `to_id=eq.${myId}` }, (p) => onInvite(p.new as Invite))
    .subscribe();
  return () => { void getClient().removeChannel(ch); };
}

// ── 매치 실시간 통로 ──
/** Realtime broadcast 채널 match:<id>. DB를 거치지 않는 저지연 릴레이 */
export class SupabaseTransport implements MatchTransport {
  private ch: RealtimeChannel | null = null;
  private handlers = new Set<(e: MatchEvent, from?: string) => void>();
  private presence = new Set<(on: boolean) => void>();
  private joins = new Set<(who: { id: string; role: PeerRole }) => void>();
  private peerOn = false;

  /** @param role 구경꾼은 'spectator' — 상대 접속 판단에서 빠지고, 이벤트를 보내지 않는다 */
  constructor(private matchId: string, private me: string, private role: PeerRole = 'player') {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ch = getClient().channel(`match:${this.matchId}`, { config: { broadcast: { self: false }, presence: { key: this.me } } });
      ch.on('broadcast', { event: 'e' }, (msg) => {
        const { _from, ...event } = msg.payload as MatchEvent & { _from?: string };
        this.handlers.forEach((h) => h(event as MatchEvent, _from));
      });
      const roleOf = (p: unknown): PeerRole => ((p as { role?: string } | undefined)?.role === 'spectator' ? 'spectator' : 'player');
      ch.on('presence', { event: 'join' }, ({ key, newPresences }) => {
        if (key === this.me) return;
        const who = { id: key, role: roleOf(newPresences[0]) };
        this.joins.forEach((h) => h(who));
      });
      ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState();
        const others = Object.keys(state).filter((k) => k !== this.me && state[k].some((p) => roleOf(p) === 'player'));
        this.peerOn = others.length > 0;
        this.presence.forEach((h) => h(this.peerOn));
      });
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') { void ch.track({ at: Date.now(), role: this.role }); resolve(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`realtime_${status.toLowerCase()}`));
      });
      this.ch = ch;
    });
  }

  send(event: MatchEvent): void {
    if (!this.ch) throw new Error('transport_closed');
    if (this.role === 'spectator') return; // 구경꾼은 듣기만 한다
    void this.ch.send({ type: 'broadcast', event: 'e', payload: { ...event, _from: this.me } });
  }

  on(handler: (e: MatchEvent, from?: string) => void): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onJoin(handler: (who: { id: string; role: PeerRole }) => void): Unsubscribe {
    this.joins.add(handler);
    return () => this.joins.delete(handler);
  }

  /** 등록 즉시 현재 상태를 한 번 알려 준다 (나중에 등록한 쪽이 접속 사실을 놓치지 않게) */
  onPresence(handler: (on: boolean) => void): Unsubscribe {
    this.presence.add(handler);
    if (this.peerOn) handler(true);
    return () => this.presence.delete(handler);
  }

  close(): void {
    if (this.ch) void getClient().removeChannel(this.ch);
    this.ch = null;
  }
}
