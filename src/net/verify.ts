/**
 * 입력 로그 개연성 검사 (순수). 서버 Edge Function(verify-match)과 테스트가 같은 코드를 쓴다.
 * 지금은 "있을 수 없는 로그"를 걸러내는 단계이고, 결정론 재생(시드 + 로그 → 성적 일치)은 InputLog 구현(B단계) 뒤에 replay 검사로 추가한다.
 */
import type { MatchReport, RoomRules, RoundInput } from './types.ts';

export interface VerifyContext {
  waveCount: number;
  rules: RoomRules;
  report: MatchReport;
  /** 매치 벽시계 길이(초): ended_at - started_at */
  wallSec: number;
  /** 카드 제한 시간(초). 메타 적용 방은 +10 */
  cardTimerSec?: number;
  /** 웨이브 제한 시간 상한(초) — 보스 45 */
  maxCombatSec?: number;
  /** 카드당 기본 교환 횟수 (메타 적용 방은 2) */
  exchangeLimit?: number;
  heroSkillCooldownSec?: number;
}

export interface VerifyResult { ok: boolean; issues: string[] }

const SLACK = 1.5; // 타이머 경계·프레임 오차 허용(초)

export function verifyLog(input: readonly RoundInput[] | unknown, ctx: VerifyContext): VerifyResult {
  const issues: string[] = [];
  const timer = ctx.cardTimerSec ?? (ctx.rules.applyMeta ? 40 : 30);
  const maxCombat = ctx.maxCombatSec ?? 45;
  const perCard = ctx.exchangeLimit ?? (ctx.rules.applyMeta ? 2 : 1);
  const cooldown = ctx.heroSkillCooldownSec ?? 45;

  if (!Array.isArray(input) || input.length === 0) return { ok: false, issues: ['rounds_empty'] };
  const rounds = input as readonly RoundInput[];
  if (rounds.length > ctx.waveCount) issues.push('too_many_rounds');

  let tickets = 0;
  let simSec = 0;
  let lastSkillAbs = -Infinity; // 쿨타임은 전투 시간 누적 기준 (웨이브를 넘어 유지)
  let combatAbs = 0;
  let heroSummoned = false;
  rounds.forEach((r, i) => {
    const tag = `r${i + 1}`;
    if (r.wave !== i + 1) issues.push(`${tag}:wave_order`);
    // 교환
    if (r.exchanges.some((x) => !Number.isInteger(x) || x < 0 || x > 4)) issues.push(`${tag}:exchange_index`);
    const normal = r.exchanges.length - r.ticketExchanges;
    if (r.ticketExchanges < 0 || normal < 0) issues.push(`${tag}:ticket_count`);
    if (normal > 5 * perCard) issues.push(`${tag}:too_many_exchanges`);
    const perIndex = new Map<number, number>();
    for (const x of r.exchanges) perIndex.set(x, (perIndex.get(x) ?? 0) + 1);
    tickets += Math.max(0, r.ticketExchanges);
    // 시간
    if (r.confirmedAt < 0 || r.confirmedAt > timer + SLACK) issues.push(`${tag}:confirm_time`);
    if (r.combatSec < 0 || r.combatSec > maxCombat + SLACK) issues.push(`${tag}:combat_time`);
    if (Math.abs(r.result.clearSec - r.combatSec) > SLACK) issues.push(`${tag}:clear_time_mismatch`);
    // 스킬
    if (r.manage.hero) { if (heroSummoned) issues.push(`${tag}:second_hero`); heroSummoned = true; }
    for (const t of r.skills) {
      if (!heroSummoned) { issues.push(`${tag}:skill_without_hero`); break; }
      if (t < 0 || t > r.combatSec + SLACK) issues.push(`${tag}:skill_time`);
      const abs = combatAbs + t;
      if (abs - lastSkillAbs < cooldown - SLACK) issues.push(`${tag}:skill_cooldown`);
      lastSkillAbs = abs;
    }
    combatAbs += r.combatSec;
    // 베팅
    if (!ctx.rules.betting && r.bet.length > 0) issues.push(`${tag}:bet_disabled`);
    if (r.bet.filter((b) => b.action === 'raise').length > 1) issues.push(`${tag}:double_raise`);
    // 결과
    if (r.result.lifeLost < 0 || r.result.handRank < 0 || r.result.handRank > 9) issues.push(`${tag}:result_range`);
    if (!r.result.cleared && i < rounds.length - 1) issues.push(`${tag}:continued_after_defeat`);
    simSec += r.combatSec; // 카드·정비 시간은 빨리 넘길 수 있으므로 하한에는 전투 시간만
  });

  // 교환권 매치 상한
  if (ctx.rules.tickets >= 0 && tickets > ctx.rules.tickets) issues.push('ticket_cap');

  // 성적과 로그의 일치
  const last = rounds[rounds.length - 1];
  const expectedReached = last.result.cleared ? rounds.length + 1 : rounds.length;
  if (ctx.report.reached !== Math.min(expectedReached, ctx.waveCount + 1)) issues.push('reached_mismatch');
  // 잃은 하트 = 전투에서 잃은 것 + 판돈 앤티 대납(ops의 l)
  const paid = (r: RoundInput) => (r.ops ?? []).reduce((n, o) => n + (o[0] === 'l' ? Math.max(0, Number(o[1]) || 0) : 0), 0);
  const lifeLost = rounds.reduce((s, r) => s + Math.max(0, r.result.lifeLost) + paid(r), 0);
  if (ctx.report.life < 0 || (lifeLost === 0 && ctx.report.life < 1)) issues.push('life_mismatch');
  if (ctx.report.clearedSec !== null && ctx.report.reached !== ctx.waveCount + 1) issues.push('cleared_without_clear');

  // 배속 위반: 시뮬 전투 시간 합 ≤ 벽시계 × 허용 배속
  if (simSec > ctx.wallSec * ctx.rules.speed + SLACK * rounds.length) issues.push('speed_violation');
  if (ctx.report.clearedSec !== null && ctx.report.clearedSec * ctx.rules.speed + SLACK * rounds.length < simSec) issues.push('cleared_too_fast');

  return { ok: issues.length === 0, issues };
}
