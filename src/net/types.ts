/** 서버와 주고받는 타입 (supabase/migrations 스키마와 1:1). Phaser 의존 금지 */
export type SuitCode = 'S' | 'H' | 'D' | 'C';

export interface Profile {
  id: string;
  nick: string;
  avatar: SuitCode;
  rating: number;
  season_points: number;
  wins: number;
  losses: number;
  draws: number;
  placement_left: number;
  best_campaign_wave: number;
}

import type { DuelRules } from '../systems/GameMode.ts';

/** 친구 대전 방장 규칙 (서버 normalize_rules 와 같은 키) — 게임 규칙 타입과 같은 것 */
export type RoomRules = DuelRules;

export type RoomStatus = 'waiting' | 'live' | 'done' | 'closed';

export interface Room {
  id: string;
  code: string;
  host: string;
  guest: string | null;
  rules: RoomRules;
  host_ready: boolean;
  guest_ready: boolean;
  status: RoomStatus;
  match_id: string | null;
  games_played: number;
  expires_at: string;
}

export interface OpponentInfo { id: string | null; name: string; rating: number; avatar: SuitCode }

/** match_public() 결과 — 상대가 사람인지 대체 상대인지는 담기지 않는다 */
export interface MatchInfo {
  id: string;
  mode: 'ranked' | 'friend';
  seed: string;
  waveCount: 20 | 40;
  rules: RoomRules;
  role: 'p1' | 'p2';
  opponent: OpponentInfo;
  startedAt: string;
  status: 'live' | 'verifying' | 'done' | 'void';
  winner: 'p1' | 'p2' | 'draw' | null;
  reason: string | null;
  ratingDelta: number | null;
}

export type PollResult =
  | { status: 'idle' }
  | { status: 'waiting'; waited: number; span: number }
  | { status: 'matched'; match: MatchInfo };

/** 내 최종 성적 (report_result) */
export interface MatchReport {
  /** 도달 라운드. 전부 클리어했으면 waveCount + 1 */
  reached: number;
  life: number;
  gold: number;
  /** 마지막 웨이브를 깬 시각(매치 시작 후 초). 클리어 못 했으면 null */
  clearedSec: number | null;
}

export interface Friend {
  id: string;
  name: string;
  avatar: SuitCode;
  rating: number;
  myWins: number;
  theirWins: number;
  draws: number;
  last: ('a' | 'b' | 'draw')[];
  iAm: 'a' | 'b';
}

export interface Invite {
  id: string;
  from_id: string;
  to_id: string;
  room_code: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  created_at: string;
}

/** 구경꾼에게 보이는 방 정보 (room_public) — 시드·상대 종류 없음 */
export interface WatchInfo {
  room: { id: string; code: string; status: RoomStatus; rules: RoomRules; host: string; guest: string | null; hostReady: boolean; guestReady: boolean; gamesPlayed: number; matchId: string | null };
  host: OpponentInfo & { id: string };
  guest: (OpponentInfo & { id: string }) | null;
  match: { id: string; waveCount: 20 | 40; rules: RoomRules; status: MatchInfo['status']; p1: string; p2: string | null; winner: MatchInfo['winner']; reason: string | null; startedAt: string } | null;
  spectators: number;
}

export interface LeaderboardRow {
  rank: number;
  id: string;
  name: string;
  avatar: SuitCode;
  rating: number;
  seasonPoints: number;
  wins: number;
  losses: number;
  draws: number;
  me: boolean;
}
export type LeaderboardKind = 'season' | 'rating';
export interface Leaderboard { kind: LeaderboardKind; rows: LeaderboardRow[]; me: LeaderboardRow | null; total: number }

export interface SeasonInfo {
  season: { id: number; name: string; startsAt: string; endsAt: string; rewards: { minPoints: number; diamonds: number }[] };
  me: { rating: number; seasonPoints: number; wins: number; losses: number; draws: number; placementLeft: number };
  /** 아직 받지 않은 지난 시즌 보상 */
  unclaimed: { seasonId: number; name: string; rank: number; points: number; diamonds: number }[];
}

/** 한 라운드의 입력 로그 — 결정론 재생·검증의 재료. 정의는 src/systems/InputLog.ts */
export type { RoundInput, RoundOp } from '../systems/InputLog.ts';
