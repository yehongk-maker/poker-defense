/**
 * 판돈 교차 검증 (순수). 입력 로그의 외부 골드·하트 증감(g/l)이 판돈 규칙으로 가능한 범위인지 본다.
 * 도착 순서까지 재현하지는 않는다 — 정직한 로그를 틀렸다고 하지 않도록 "넉넉한 경계"만 검사한다:
 *   · 낸 것(앤티·레이즈·콜)은 최소한 이만큼은 돼야 한다
 *   · 받은 것(판돈)은 이길 수 있었던 라운드의 판돈 합을 넘을 수 없다
 * 상대 로그가 있으면(사람 상대) 라운드 성적을 비교해 "질 수밖에 없던 라운드"를 뺀다.
 */
import type { DuelConfig } from '../systems/Betting.ts';
import type { RoundInput } from '../systems/InputLog.ts';

const roundTo = (v: number, unit: number): number => Math.round(v / unit) * unit;

export function anteMax(cfg: DuelConfig, wave: number): number {
  return Math.max(1, Math.round(cfg.ante.base + cfg.ante.perWave * wave));
}
export function anteMin(cfg: DuelConfig, wave: number): number {
  return Math.max(1, Math.round((cfg.ante.base + cfg.ante.perWave * wave) * (1 - cfg.comeback.anteDiscount)));
}
export function raiseOf(cfg: DuelConfig, wave: number): number {
  const r = cfg.raise;
  return Math.min(r.max, Math.max(r.roundTo, roundTo(r.base + r.perWave * wave, r.roundTo)));
}

const entered = (r: RoundInput): boolean => (r.ops ?? []).some((o) => o[0] === 'c');
const betWave = (r: RoundInput, b: RoundInput['bet'][number]): number => b.wave ?? r.wave;

/** 성적만으로 a가 b에게 지는가 (폴드 제외 — Betting.tryJudge와 같은 순서) */
function losesTo(a: RoundInput['result'], b: RoundInput['result']): boolean {
  if (a.lifeLost !== b.lifeLost) return a.lifeLost > b.lifeLost;
  if (a.cleared !== b.cleared) return !a.cleared;
  if (Math.abs(a.clearSec - b.clearSec) >= 0.05) return a.clearSec > b.clearSec;
  if (a.handRank !== b.handRank) return a.handRank < b.handRank;
  return false;
}

export interface BetCheck { issues: string[]; paid: number; required: number; won: number; allowed: number }

export function verifyBets(cfg: DuelConfig, betting: boolean, mine: readonly RoundInput[], theirs: readonly RoundInput[] | null): BetCheck {
  const issues: string[] = [];
  let paid = 0, won = 0, hearts = 0;
  for (const r of mine) for (const o of r.ops ?? []) {
    if (o[0] === 'g') { if (o[1] < 0) paid += -o[1]; else won += o[1]; }
    if (o[0] === 'l') hearts += Math.max(0, o[1]);
    if ((o[0] === 'g' || o[0] === 'l') && !Number.isFinite(o[1])) issues.push('bet:bad_amount');
  }
  if (!betting) {
    if (paid > 0 || won > 0 || hearts > 0) issues.push('bet:wallet_ops_without_betting');
    return { issues, paid, required: 0, won, allowed: 0 };
  }

  // 낸 것의 하한: 들어간 라운드의 (할인) 앤티 + 내가 한 레이즈·콜. 하트 대납 1개는 goldPerLife만큼 낸 것으로 친다
  let required = 0;
  for (const r of mine) {
    if (entered(r)) required += anteMin(cfg, r.wave);
    for (const b of r.bet) if (b.action === 'raise' || b.action === 'call') required += raiseOf(cfg, betWave(r, b));
  }
  if (paid + hearts * cfg.shortfall.goldPerLife < required) issues.push('bet:underpaid');

  // 받은 것의 상한
  const other = new Map((theirs ?? []).map((r) => [r.wave, r]));
  const theirFoldNear = (wave: number) => (theirs ?? []).some((r) => r.wave >= wave && r.wave <= wave + 3 && r.bet.some((b) => b.action === 'fold' && betWave(r, b) === wave));
  let allowed = 0, carry = 0;
  for (const r of mine) {
    if (!entered(r)) continue;
    const pot = carry + 2 * anteMax(cfg, r.wave) + 2 * raiseOf(cfg, r.wave);
    const o = other.get(r.wave);
    const both = theirs !== null && o !== undefined && !o.partial && !r.partial;
    const lost = both && losesTo(r.result, o.result) && !theirFoldNear(r.wave);
    const tie = both && !losesTo(r.result, o.result) && !losesTo(o.result, r.result);
    if (!lost) allowed += pot;
    carry = tie ? pot : 0;
  }
  if (won > allowed) issues.push('bet:overpaid_winnings');
  return { issues, paid, required, won, allowed };
}
