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

/** 한 라운드의 입력 로그 — 결정론 재생·검증의 재료. 정의는 src/systems/InputLog.ts */
export type { RoundInput, RoundOp } from '../systems/InputLog.ts';
