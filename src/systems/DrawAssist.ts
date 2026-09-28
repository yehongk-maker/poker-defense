/**
 * DrawAssist — 행운 드로우 (GDD §3.1.1). 순수 로직.
 *
 * 플레이어 공개 규칙: "카드를 바꾸면, 남긴 카드와 어울리는 카드가 2배 잘 나온다."
 * 교환으로 새 카드를 뽑을 때, 남긴 카드 기준으로 족보를 올려주는 카드(아웃)의 추첨 가중치를 1 + outWeight배로 올린다.
 *
 * 아웃 판정 (셋 중 하나면 아웃):
 *  - 같은 숫자: 남긴 카드와 숫자가 같은 카드
 *  - 플러시: 남긴 카드 중 같은 무늬가 3장 이상일 때 그 무늬의 카드
 *  - 스트레이트: 남긴 카드가 가장 많이 들어간(3장 이상) 연속 5칸 구간의 빈 숫자 (A는 1로도 14로도 센다)
 *
 * 남긴 카드가 없으면(5장 전부 교환) 보정도 없다. 첫 배분은 보정하지 않는다.
 * rng는 주입 — 같은 시드면 같은 결과 (대전 로그 재현).
 */
import type { Card, Suit } from './PokerEvaluator.ts';

export interface DrawAssistConfig {
  /** 아웃 가중치 보너스. 0 = 순수 확률, 1 = 아웃이 2배 */
  outWeight: number;
}

const FLUSH_MIN = 3;
const STRAIGHT_MIN = 3;

/** 남긴 카드 기준 아웃 조건 (한 번 계산해 여러 장 판정에 재사용) */
export interface OutSpec {
  ranks: Set<number>;
  flushSuit: Suit | null;
  straightRanks: Set<number>;
}

export function outSpec(kept: readonly Card[]): OutSpec {
  const ranks = new Set(kept.map((c) => c.rank));
  // 플러시: 같은 무늬 3장 이상
  const bySuit = new Map<Suit, number>();
  for (const c of kept) bySuit.set(c.suit, (bySuit.get(c.suit) ?? 0) + 1);
  let flushSuit: Suit | null = null;
  for (const [s, n] of bySuit) if (n >= FLUSH_MIN && (flushSuit === null || n > (bySuit.get(flushSuit) ?? 0))) flushSuit = s;
  // 스트레이트: 5칸 구간(lo..lo+4, lo=1..10; A=1 또는 14)마다 남긴 카드의 서로 다른 숫자 수를 세고, 최댓값(≥3)인 구간들의 빈 숫자
  const straightRanks = new Set<number>();
  const windows: { lo: number; have: Set<number> }[] = [];
  let best = 0;
  for (let lo = 1; lo <= 10; lo++) {
    const have = new Set<number>();
    for (const r of ranks) {
      const rr = r === 14 && lo === 1 ? 1 : r;
      if (rr >= lo && rr <= lo + 4) have.add(rr);
    }
    windows.push({ lo, have });
    best = Math.max(best, have.size);
  }
  if (best >= STRAIGHT_MIN) {
    for (const w of windows) {
      if (w.have.size !== best) continue;
      for (let r = w.lo; r <= w.lo + 4; r++) if (!w.have.has(r)) straightRanks.add(r === 1 ? 14 : r);
    }
  }
  return { ranks, flushSuit, straightRanks };
}

export function isOut(card: Card, spec: OutSpec): boolean {
  return spec.ranks.has(card.rank) || card.suit === spec.flushSuit || spec.straightRanks.has(card.rank);
}

/** 덱에 남은 아웃 장수 (UI "어울리는 카드 N장 남음") */
export function countOuts(kept: readonly Card[], deck: readonly Card[]): number {
  if (kept.length === 0) return 0;
  const spec = outSpec(kept);
  let n = 0;
  for (const c of deck) if (isOut(c, spec)) n++;
  return n;
}

/**
 * 가중 추첨: 덱에서 한 장을 고른다 (아웃 = 1 + outWeight, 나머지 = 1).
 * @returns 고른 카드의 덱 인덱스
 */
export function pickIndex(kept: readonly Card[], deck: readonly Card[], outWeight: number, rng: () => number): number {
  if (deck.length === 0) throw new Error('Not enough cards in deck');
  if (outWeight <= 0 || kept.length === 0) return Math.min(deck.length - 1, Math.floor(rng() * deck.length));
  const spec = outSpec(kept);
  const w = 1 + outWeight;
  let total = 0;
  for (const c of deck) total += isOut(c, spec) ? w : 1;
  let roll = rng() * total;
  for (let i = 0; i < deck.length; i++) {
    roll -= isOut(deck[i], spec) ? w : 1;
    if (roll < 0) return i;
  }
  return deck.length - 1;
}
