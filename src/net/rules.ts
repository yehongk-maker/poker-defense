/** 방 규칙 정규화 — 서버 normalize_rules 와 같은 결과를 내는 순수 함수 (UI 미리보기·테스트용) */
import type { RoomRules } from './types.ts';

export const DEFAULT_RULES: RoomRules = { waves: 20, betting: true, allHeroes: true, sharedHand: false, speed: 1, applyMeta: false, tickets: 3 };

export function normalizeRules(r: Partial<Record<keyof RoomRules, unknown>> | null | undefined): RoomRules {
  const x = r ?? {};
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const oneOf = <T extends number>(v: unknown, allowed: readonly T[], d: T): T => (typeof v === 'number' && (allowed as readonly number[]).includes(v) ? (v as T) : d);
  return {
    waves: oneOf(x.waves, [20, 40] as const, DEFAULT_RULES.waves),
    betting: bool(x.betting, DEFAULT_RULES.betting),
    allHeroes: bool(x.allHeroes, DEFAULT_RULES.allHeroes),
    sharedHand: bool(x.sharedHand, DEFAULT_RULES.sharedHand),
    speed: oneOf(x.speed, [1, 2] as const, DEFAULT_RULES.speed),
    applyMeta: bool(x.applyMeta, DEFAULT_RULES.applyMeta),
    tickets: oneOf(x.tickets, [0, 3, -1] as const, DEFAULT_RULES.tickets),
  };
}

/** 기본(랭크와 동일)과 다르면 방 화면에 "커스텀" 배지 */
export function isCustom(r: RoomRules): boolean {
  return (Object.keys(DEFAULT_RULES) as (keyof RoomRules)[]).some((k) => r[k] !== DEFAULT_RULES[k]);
}

/** 결과 화면 캡션용 한 줄 요약 */
export function describeRules(r: RoomRules): string {
  const parts = [`${r.waves}웨이브`, r.betting ? '판돈 있음' : '판돈 없음'];
  if (r.sharedHand) parts.push('동일 손패');
  if (!r.allHeroes) parts.push('영웅 각자 해금');
  if (r.speed !== 1) parts.push(`배속 ×${r.speed}`);
  if (r.applyMeta) parts.push('메타 적용');
  parts.push(r.tickets === -1 ? '교환권 무제한' : r.tickets === 0 ? '교환권 금지' : `교환권 ${r.tickets}회`);
  return parts.join(' · ');
}
