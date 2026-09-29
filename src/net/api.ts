/** 서버 RPC 래퍼 — supabase/migrations/…functions.sql 의 함수와 1:1. 오류는 서버 예외 코드(room_full 등)를 메시지로 던진다 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getClient } from './supabase.ts';
import { normalizeRoomCode } from './roomCode.ts';
import type { Friend, Invite, MatchInfo, MatchReport, PollResult, Profile, Room, RoomRules, RoundInput } from './types.ts';
import type { MatchEvent, MatchTransport, Unsubscribe } from './MatchTransport.ts';

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

// ── 프로필 ──
export const updateProfile = (nick?: string, avatar?: string) => rpc<Profile>('update_profile', { p_nick: nick ?? null, p_avatar: avatar ?? null });
export const reportCampaign = (wave: number) => rpc<Profile>('report_campaign', { p_wave: wave });

// ── 친구 대전 방 ──
export const createRoom = (rules: Partial<RoomRules> = {}) => rpc<Room>('create_room', { p_rules: rules });
export const joinRoom = (code: string) => rpc<Room>('join_room', { p_code: normalizeRoomCode(code) });
export const setRoomRules = (code: string, rules: Partial<RoomRules>) => rpc<Room>('set_room_rules', { p_code: code, p_rules: rules });
export const setReady = (code: string, ready = true) => rpc<Room>('set_ready', { p_code: code, p_ready: ready });
export const leaveRoom = (code: string) => rpc<void>('leave_room', { p_code: code });
export const kickGuest = (code: string) => rpc<Room>('kick_guest', { p_code: code });

/** 방 변경 구독 (입장·준비·규칙·매치 시작). RLS 덕에 내 방만 온다 */
export function subscribeRoom(roomId: string, onChange: (room: Room) => void): Unsubscribe {
  const ch = getClient()
    .channel(`room-row:${roomId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, (p) => onChange(p.new as Room))
    .subscribe();
  return () => { void getClient().removeChannel(ch); };
}

// ── 랭크 매칭 ──
export const enqueue = () => rpc<PollResult>('enqueue');
export const pollMatch = () => rpc<PollResult>('poll_match');
export const cancelQueue = () => rpc<void>('cancel_queue');
/** 대체 상대의 대본(입력 로그). 없으면 null → 클라이언트 봇 두뇌로 진행. 사람 상대면 오류 */
export const getOpponentScript = (matchId: string) => rpc<{ rounds: RoundInput[]; seed: string } | null>('get_opponent_script', { p_match: matchId });

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
export const claimTimeout = (matchId: string) => rpc<MatchInfo>('claim_timeout', { p_match: matchId });
export const submitLog = (matchId: string, rounds: RoundInput[], checksum?: string) =>
  rpc<void>('submit_log', { p_match: matchId, p_rounds: rounds, p_checksum: checksum ?? null });

/** 매치 확정(상대 보고 도착) 구독 */
export function subscribeMatch(matchId: string, onDone: (status: string) => void): Unsubscribe {
  const ch = getClient()
    .channel(`match-row:${matchId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, (p) => onDone((p.new as { status: string }).status))
    .subscribe();
  return () => { void getClient().removeChannel(ch); };
}

// ── 친구 ──
export const addFriend = (otherId: string) => rpc<void>('add_friend', { p_other: otherId });
export const removeFriend = (otherId: string) => rpc<void>('remove_friend', { p_other: otherId });
export const listFriends = () => rpc<Friend[]>('list_friends');
export const inviteFriend = (friendId: string, code: string) => rpc<Invite>('invite_friend', { p_friend: friendId, p_code: code });
export const answerInvite = (inviteId: string, accept: boolean) => rpc<Invite>('answer_invite', { p_invite: inviteId, p_accept: accept });

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
  private handlers = new Set<(e: MatchEvent) => void>();
  private presence = new Set<(on: boolean) => void>();

  constructor(private matchId: string, private me: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ch = getClient().channel(`match:${this.matchId}`, { config: { broadcast: { self: false }, presence: { key: this.me } } });
      ch.on('broadcast', { event: 'e' }, (msg) => this.handlers.forEach((h) => h(msg.payload as MatchEvent)));
      ch.on('presence', { event: 'sync' }, () => {
        const others = Object.keys(ch.presenceState()).filter((k) => k !== this.me);
        this.presence.forEach((h) => h(others.length > 0));
      });
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') { void ch.track({ at: Date.now() }); resolve(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`realtime_${status.toLowerCase()}`));
      });
      this.ch = ch;
    });
  }

  send(event: MatchEvent): void {
    if (!this.ch) throw new Error('transport_closed');
    void this.ch.send({ type: 'broadcast', event: 'e', payload: event });
  }

  on(handler: (e: MatchEvent) => void): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onPresence(handler: (on: boolean) => void): Unsubscribe {
    this.presence.add(handler);
    return () => this.presence.delete(handler);
  }

  close(): void {
    if (this.ch) void getClient().removeChannel(this.ch);
    this.ch = null;
  }
}
