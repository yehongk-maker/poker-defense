/**
 * PokerEvaluator — 족보 판정 순수함수 (Phaser 의존 없음, 외부 의존성 없음)
 *
 * GDD 3.1/3.2 근거:
 *  - 5장 카드 → 족보 10종 판정 (하이카드 ~ 로열 스트레이트 플러시)
 *  - 구성 카드(coreCards)와 다수 수트(dominantSuit) 반환
 *  - 혼합 족보의 수트 결정: 족보 구성 카드 중 다수 수트, 동수면 랜덤(rng 주입 가능)
 *  - A-2-3-4-5(휠) 스트레이트 인정, 이때 하이카드는 5
 */

export type Suit = 'S' | 'H' | 'D' | 'C'; // ♠ ♥ ♦ ♣

/** 2~10 = 숫자, 11=J, 12=Q, 13=K, 14=A */
export interface Card {
  rank: number;
  suit: Suit;
}

export enum HandRank {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
  RoyalStraightFlush = 9,
}

export interface HandResult {
  rank: HandRank;
  /** 족보를 구성한 카드 (하이카드=최고 1장, 원페어=2장, 포카드=4장, 스트레이트류/풀하우스=5장) */
  coreCards: Card[];
  /** 족보에 포함되지 않은 나머지 카드 (내림차순) */
  kickers: Card[];
  /** coreCards 중 다수 수트. 동수면 rng로 결정 */
  dominantSuit: Suit;
  /** 다수 수트가 동수 경합이었는지 (true면 rng로 결정됨) */
  suitTied: boolean;
}

const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];

/** "AS", "TD", "9H", "KC" 같은 표기를 Card로 변환 (테스트/디버그 편의) */
export function parseCard(code: string): Card {
  const m = /^(10|[2-9TJQKA])([SHDC])$/.exec(code.toUpperCase());
  if (!m) throw new Error(`Invalid card code: ${code}`);
  const map: Record<string, number> = { T: 10, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
  const rank = map[m[1]] ?? Number(m[1]);
  return { rank, suit: m[2] as Suit };
}

export function parseHand(codes: string): Card[] {
  return codes.trim().split(/\s+/).map(parseCard);
}

/** 52장 표준 덱 생성 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) deck.push({ rank, suit });
  }
  return deck;
}

function validate(cards: Card[]): void {
  if (!Array.isArray(cards) || cards.length !== 5) {
    throw new Error(`evaluateHand requires exactly 5 cards, got ${cards?.length}`);
  }
  const seen = new Set<string>();
  for (const c of cards) {
    if (!Number.isInteger(c.rank) || c.rank < 2 || c.rank > 14) {
      throw new Error(`Invalid rank: ${c.rank}`);
    }
    if (!SUITS.includes(c.suit)) throw new Error(`Invalid suit: ${c.suit}`);
    const key = `${c.rank}${c.suit}`;
    if (seen.has(key)) throw new Error(`Duplicate card: ${key}`);
    seen.add(key);
  }
}

/**
 * 스트레이트 판정. 성립 시 내림차순 5장(휠이면 [5,4,3,2,A]) 반환, 아니면 null.
 */
function detectStraight(cards: Card[]): Card[] | null {
  const byRankDesc = [...cards].sort((a, b) => b.rank - a.rank);
  const ranks = byRankDesc.map((c) => c.rank);
  if (new Set(ranks).size !== 5) return null;

  // 일반 스트레이트: 연속 5장
  if (ranks[0] - ranks[4] === 4) return byRankDesc;

  // 휠(A-2-3-4-5): A는 낮은 카드로 취급, 하이카드는 5
  if (ranks[0] === 14 && ranks[1] === 5 && ranks[1] - ranks[4] === 3) {
    return [...byRankDesc.slice(1), byRankDesc[0]]; // [5,4,3,2,A]
  }
  return null;
}

/** coreCards의 다수 수트 결정. 동수면 rng로 경합 수트 중 하나 선택 */
function pickDominantSuit(
  coreCards: Card[],
  rng: () => number
): { suit: Suit; tied: boolean } {
  const counts = new Map<Suit, number>();
  for (const c of coreCards) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
  const max = Math.max(...counts.values());
  const tiedSuits = SUITS.filter((s) => counts.get(s) === max);
  if (tiedSuits.length === 1) return { suit: tiedSuits[0], tied: false };
  const idx = Math.min(Math.floor(rng() * tiedSuits.length), tiedSuits.length - 1);
  return { suit: tiedSuits[idx], tied: true };
}

/**
 * 5장 카드의 족보를 판정한다.
 * @param cards 정확히 5장 (순서 무관)
 * @param rng   다수 수트 동수 경합 시 사용할 난수원 (기본 Math.random, 테스트 시 주입)
 */
export function evaluateHand(cards: Card[], rng: () => number = Math.random): HandResult {
  validate(cards);

  const desc = [...cards].sort((a, b) => b.rank - a.rank);

  // rank별 그룹 → [count, rank] 내림차순 (count 우선, 같으면 rank)
  const groups = new Map<number, Card[]>();
  for (const c of desc) {
    const arr = groups.get(c.rank) ?? [];
    arr.push(c);
    groups.set(c.rank, arr);
  }
  const grouped = [...groups.values()].sort(
    (a, b) => b.length - a.length || b[0].rank - a[0].rank
  );

  const isFlush = cards.every((c) => c.suit === cards[0].suit);
  const straight = detectStraight(cards);

  let rank: HandRank;
  let coreCards: Card[];

  if (isFlush && straight) {
    // 휠 스트레이트 플러시는 로열 아님 (하이카드 5)
    const isRoyal = straight[0].rank === 14 && straight[4].rank === 10;
    rank = isRoyal ? HandRank.RoyalStraightFlush : HandRank.StraightFlush;
    coreCards = straight;
  } else if (grouped[0].length === 4) {
    rank = HandRank.FourOfAKind;
    coreCards = grouped[0];
  } else if (grouped[0].length === 3 && grouped[1].length === 2) {
    rank = HandRank.FullHouse;
    coreCards = [...grouped[0], ...grouped[1]];
  } else if (isFlush) {
    rank = HandRank.Flush;
    coreCards = desc;
  } else if (straight) {
    rank = HandRank.Straight;
    coreCards = straight;
  } else if (grouped[0].length === 3) {
    rank = HandRank.ThreeOfAKind;
    coreCards = grouped[0];
  } else if (grouped[0].length === 2 && grouped[1].length === 2) {
    rank = HandRank.TwoPair;
    coreCards = [...grouped[0], ...grouped[1]];
  } else if (grouped[0].length === 2) {
    rank = HandRank.OnePair;
    coreCards = grouped[0];
  } else {
    rank = HandRank.HighCard;
    coreCards = [desc[0]];
  }

  const coreSet = new Set(coreCards);
  const kickers = desc.filter((c) => !coreSet.has(c));
  const { suit: dominantSuit, tied: suitTied } = pickDominantSuit(coreCards, rng);

  return { rank, coreCards, kickers, dominantSuit, suitTied };
}
