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
  /**
   * 행운 게이지(피티): 노린 족보(아웃 종류)가 안 나오면 다음에 같은 종류를 노릴 때 그 종류의 outWeight를 mult배씩 올린다.
   * 레벨은 maxLevel까지, 성공하면 0으로. 없거나 maxLevel 0이면 꺼짐.
   */
  pity?: { mult: number | Partial<Record<OutKind, number>>; maxLevel: number };
}

/** 종류별 게이지 배율 조회 (숫자 하나면 전 종류 공통, 없는 종류는 1 = 게이지 없음) */
export function pityMultOf(mult: number | Partial<Record<OutKind, number>>, kind: OutKind): number {
  return typeof mult === 'number' ? mult : (mult[kind] ?? 1);
}

/** 아웃 종류 = 노리는 족보 루트. rank(같은 숫자 → 투페어·트리플·풀하우스·포카드), flush, straight */
export type OutKind = 'rank' | 'flush' | 'straight';
export const OUT_KINDS: readonly OutKind[] = ['rank', 'flush', 'straight'];
/** 종류별 아웃 가중치 보너스 (카드가 여러 종류에 해당하면 가장 큰 값) */
export type OutWeights = Record<OutKind, number>;

const FLUSH_MIN = 3;
const STRAIGHT_MIN = 3;

/** 남긴 카드 기준 아웃 조건 (한 번 계산해 여러 장 판정에 재사용) */
export interface OutSpec {
  ranks: Set<number>;
  flushSuit: Suit | null;
  straightRanks: Set<number>;
  /** 남긴 카드에 같은 숫자 짝(2장 이상)이 있는가 — "풀하우스 루트를 노림"의 근거 */
  hasPair: boolean;
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
  const seen = new Set<number>();
  let hasPair = false;
  for (const c of kept) { if (seen.has(c.rank)) hasPair = true; seen.add(c.rank); }
  return { ranks, flushSuit, straightRanks, hasPair };
}

/** 카드가 해당하는 아웃 종류들 */
export function outKinds(card: Card, spec: OutSpec): OutKind[] {
  const k: OutKind[] = [];
  if (spec.ranks.has(card.rank)) k.push('rank');
  if (card.suit === spec.flushSuit) k.push('flush');
  if (spec.straightRanks.has(card.rank)) k.push('straight');
  return k;
}

/** 남긴 카드가 "노리는" 족보 루트: 짝이 있으면 rank, 같은 무늬 3장+면 flush, 연속 3장+면 straight */
export function targetsOf(spec: OutSpec): OutKind[] {
  const t: OutKind[] = [];
  if (spec.hasPair) t.push('rank');
  if (spec.flushSuit !== null) t.push('flush');
  if (spec.straightRanks.size > 0) t.push('straight');
  return t;
}

/** 카드 추첨 가중치 = 1 + (해당하는 종류 중 가장 큰 보너스) */
export function cardWeight(card: Card, spec: OutSpec, w: OutWeights): number {
  let best = 0;
  if (spec.ranks.has(card.rank)) best = Math.max(best, w.rank);
  if (card.suit === spec.flushSuit) best = Math.max(best, w.flush);
  if (spec.straightRanks.has(card.rank)) best = Math.max(best, w.straight);
  return 1 + best;
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
 * 가중 추첨: 덱에서 한 장을 고른다 (아웃 = 1 + 종류별 보너스, 나머지 = 1).
 * @param weights 숫자 하나면 모든 종류에 같은 보너스
 * @returns 고른 카드의 덱 인덱스
 */
export function pickIndex(kept: readonly Card[], deck: readonly Card[], weights: number | OutWeights, rng: () => number): number {
  if (deck.length === 0) throw new Error('Not enough cards in deck');
  const w: OutWeights = typeof weights === 'number' ? { rank: weights, flush: weights, straight: weights } : weights;
  if ((w.rank <= 0 && w.flush <= 0 && w.straight <= 0) || kept.length === 0) return Math.min(deck.length - 1, Math.floor(rng() * deck.length));
  const spec = outSpec(kept);
  let total = 0;
  for (const c of deck) total += cardWeight(c, spec, w);
  let roll = rng() * total;
  for (let i = 0; i < deck.length; i++) {
    roll -= cardWeight(deck[i], spec, w);
    if (roll < 0) return i;
  }
  return deck.length - 1;
}

/** 이 종류를 노렸을 때 "성공"으로 치는 족보 (HandRank 숫자): rank=풀하우스 이상, flush=플러시·스플·로열, straight=스트레이트·스플·로열 */
export function kindAchieved(kind: OutKind, rank: number): boolean {
  // HandRank: Straight 4, Flush 5, FullHouse 6, FourOfAKind 7, StraightFlush 8, Royal 9
  if (kind === 'rank') return rank >= 6;
  if (kind === 'flush') return rank === 5 || rank >= 8;
  return rank === 4 || rank >= 8;
}
