/**
 * 매치 로그 검증 = 개연성 검사(verify.ts) + 결정론 재생(InputLog.replayMatch). 순수 — 데이터는 인자로 받는다.
 * 서버(Edge Function)는 verifyServer.ts가 JSON 데이터를 묶어 이 함수를 부른다.
 */
import { verifyLog, type VerifyResult } from './verify.ts';
import type { MatchReport, RoomRules, RoundInput } from './types.ts';
import { replayMatch } from '../systems/InputLog.ts';
import { seedStreams } from '../systems/Seed.ts';
import { buildGameData, friendDuel, type ModeSources } from '../systems/GameMode.ts';
import type { DuelConfig } from '../systems/Betting.ts';
import { verifyBets } from './verifyBets.ts';

export interface MatchVerifyInput {
  seed: string;
  /** 로그를 낸 플레이어 id */
  playerId: string;
  /** 그 플레이어의 손패 키 (match_secrets). 비밀 키 도입 전 매치는 'p:'+id로 채워져 있다 */
  handKey?: string | null;
  waveCount: number;
  rules: RoomRules;
  report: MatchReport;
  /** 매치 벽시계 길이(초) */
  wallSec: number;
  /** 판돈 규칙 (duel.json). 있으면 판돈 증감을 검사한다 */
  duel?: DuelConfig;
  /** 상대의 로그 (사람 상대 매치). 있으면 라운드 성적을 비교해 판돈 상한을 좁힌다 */
  opponentRounds?: unknown;
}

export interface MatchVerifyResult extends VerifyResult {
  /** 재생을 했는가. 메타 적용 방은 서버가 플레이어의 메타를 모르므로 재생하지 않는다 */
  replayed: boolean;
}

export function verifyMatchLog(sources: ModeSources, rounds: unknown, m: MatchVerifyInput): MatchVerifyResult {
  const base = verifyLog(rounds, { waveCount: m.waveCount, rules: m.rules, report: m.report, wallSec: m.wallSec });
  if (!Array.isArray(rounds) || rounds.length === 0) return { ...base, replayed: false };
  const issues = [...base.issues];
  if (m.duel) {
    const theirs = Array.isArray(m.opponentRounds) && m.opponentRounds.length > 0 ? (m.opponentRounds as RoundInput[]) : null;
    try { issues.push(...verifyBets(m.duel, m.rules.betting, rounds as RoundInput[], theirs).issues); } catch { issues.push('bet:crashed'); }
  }
  if (m.rules.applyMeta) return { ok: issues.length === 0, issues, replayed: false };

  const mode = friendDuel({ ...m.rules, waves: m.waveCount as 20 | 40 }, m.seed);
  const data = buildGameData(sources, mode, null);
  const streams = seedStreams(m.seed, { handKey: m.handKey, player: m.playerId, sharedHand: m.rules.sharedHand });
  let re;
  try {
    re = replayMatch(data, streams, rounds as RoundInput[]);
  } catch {
    return { ok: false, issues: [...issues, 'replay:crashed'], replayed: true };
  }
  for (const i of re.issues) issues.push(`replay:${i}`);
  if (re.final.reached !== m.report.reached) issues.push('replay:reached');
  if (re.final.life !== m.report.life) issues.push('replay:life');
  if (Math.floor(re.final.gold) !== Math.floor(m.report.gold)) issues.push('replay:gold');
  return { ok: issues.length === 0, issues, replayed: true };
}
