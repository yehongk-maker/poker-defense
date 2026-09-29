/**
 * 매치 로그 검증 = 개연성 검사(verify.ts) + 결정론 재생(InputLog.replayMatch). 순수 — 데이터는 인자로 받는다.
 * 서버(Edge Function)는 verifyServer.ts가 JSON 데이터를 묶어 이 함수를 부른다.
 */
import { verifyLog, type VerifyResult } from './verify.ts';
import type { MatchReport, RoomRules, RoundInput } from './types.ts';
import { replayMatch } from '../systems/InputLog.ts';
import { seedStreams } from '../systems/Seed.ts';
import { buildGameData, friendDuel, type ModeSources } from '../systems/GameMode.ts';

export interface MatchVerifyInput {
  seed: string;
  /** 로그를 낸 플레이어 id (손패 시드 스트림의 키) */
  playerId: string;
  waveCount: number;
  rules: RoomRules;
  report: MatchReport;
  /** 매치 벽시계 길이(초) */
  wallSec: number;
}

export interface MatchVerifyResult extends VerifyResult {
  /** 재생을 했는가. 메타 적용 방은 서버가 플레이어의 메타를 모르므로 재생하지 않는다 */
  replayed: boolean;
}

export function verifyMatchLog(sources: ModeSources, rounds: unknown, m: MatchVerifyInput): MatchVerifyResult {
  const base = verifyLog(rounds, { waveCount: m.waveCount, rules: m.rules, report: m.report, wallSec: m.wallSec });
  if (!Array.isArray(rounds) || rounds.length === 0) return { ...base, replayed: false };
  if (m.rules.applyMeta) return { ...base, replayed: false };

  const issues = [...base.issues];
  const mode = friendDuel({ ...m.rules, waves: m.waveCount as 20 | 40 }, m.seed);
  const data = buildGameData(sources, mode, null);
  const streams = seedStreams(m.seed, { player: m.playerId, sharedHand: m.rules.sharedHand });
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
