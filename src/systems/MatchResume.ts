/**
 * 대전 이어하기 (재접속) — 저장 형식과 복원 (순수).
 * 내 판은 "시드 + 입력 로그"로 정확히 되돌린다 (결정론 재생과 같은 코드). 그래서 저장 파일을 고쳐도 서버 검증을 통과하는 판만 만들 수 있다.
 * 이 기기에서 돌던 상대(대체 상대)는 그 상대의 마지막 라운드 시작 시점으로 돌아간다.
 */
import { GameLoop, type GameData, type RunSnapshot } from './GameLoop.ts';
import type { GameMode } from './GameMode.ts';
import type { BettingSnapshot } from './Betting.ts';
import type { OpponentIdentity } from './Opponent.ts';
import type { OpponentScript } from './Duel.ts';
import { InputRecorder, replayInto, type RoundInput } from './InputLog.ts';
import { seedStreams } from './Seed.ts';

export interface SavedOpponent {
  /** 상대의 마지막 카드 페이즈 시작 시점 */
  snapshot: RunSnapshot | null;
  script: OpponentScript | null;
  presetId: string | null;
}

export interface SavedMatch {
  version: 1;
  /** live = 사람 상대(실시간), online = 서버 매치 + 이 기기의 상대, local = 서버 없음 */
  kind: 'live' | 'online' | 'local';
  matchId: string | null;
  roomCode: string | null;
  me: string | null;
  opponentId: string | null;
  identity: OpponentIdentity;
  mode: GameMode;
  playerId: string;
  seed: string;
  rounds: RoundInput[];
  /** 카드 선택 중이었다면 그때까지 쓴 시간(초) */
  cardElapsed: number;
  betting: BettingSnapshot | null;
  opponent: SavedOpponent | null;
  /** 매치 시작 후 흐른 시간(초)과 저장 시각(ms) — 자리를 비운 시간도 매치 시간에 넣는다 */
  clock: number;
  savedAt: number;
  bestRank: number;
}

export function isSavedMatch(x: unknown): x is SavedMatch {
  const s = x as SavedMatch | null;
  return !!s && s.version === 1 && typeof s.seed === 'string' && typeof s.playerId === 'string' && Array.isArray(s.rounds)
    && !!s.mode && typeof s.mode.id === 'string' && !!s.identity && typeof s.identity.name === 'string'
    && (s.kind === 'live' || s.kind === 'online' || s.kind === 'local');
}

export interface ResumedLoop { loop: GameLoop; recorder: InputRecorder }

/**
 * 저장된 로그로 내 판을 되돌린다.
 * @throws 로그가 재생되지 않으면 (저장이 깨졌거나 데이터가 바뀜) — 호출 측이 저장을 버린다
 */
export function resumeLoop(data: GameData, saved: Pick<SavedMatch, 'seed' | 'playerId' | 'mode' | 'rounds' | 'cardElapsed'>): ResumedLoop {
  const loop = new GameLoop(data, seedStreams(saved.seed, { player: saved.playerId, sharedHand: saved.mode.sharedHand }));
  // 입력이 하나도 없는 마지막 라운드(막 받은 패)는 재생할 것이 없다
  const rounds = saved.rounds.filter((r, i) => !(i === saved.rounds.length - 1 && r.partial && (r.ops ?? []).length === 0));
  const { issues } = replayInto(loop, data, rounds);
  if (issues.length > 0) throw new Error(`resume_failed: ${issues[0]}`);
  if (loop.phase === 'card' && saved.cardElapsed > 0) {
    // 쓴 시간은 그대로 (새로고침으로 제한 시간을 되돌릴 수 없다). 확정은 씬이 하도록 1초는 남긴다
    const p = loop.cardPhase;
    p.tick(Math.min(saved.cardElapsed, Math.max(0, p.timeRemaining - 1)));
  }
  const recorder = new InputRecorder(loop, data.config.simStep, rounds);
  return { loop, recorder };
}

/** 자리를 비운 시간을 더한 매치 시계 */
export function resumedClock(saved: Pick<SavedMatch, 'clock' | 'savedAt'>, now: number): number {
  return saved.clock + Math.max(0, (now - saved.savedAt) / 1000);
}
