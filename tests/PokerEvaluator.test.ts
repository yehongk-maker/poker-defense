import { describe, it, expect } from 'vitest';
import {
  evaluateHand,
  parseHand,
  createDeck,
  HandRank,
  type Card,
} from '../src/systems/PokerEvaluator.ts';

const rankOf = (codes: string) => evaluateHand(parseHand(codes)).rank;

describe('족보 10종 판정', () => {
  it('하이카드', () => {
    const r = evaluateHand(parseHand('AS 9H 7D 5C 2S'));
    expect(r.rank).toBe(HandRank.HighCard);
    expect(r.coreCards.length).toBe(1);
    expect(r.coreCards[0].rank).toBe(14); // 최고 카드 A
    expect(r.kickers.length).toBe(4);
  });

  it('원페어', () => {
    const r = evaluateHand(parseHand('KS KH 9D 5C 2S'));
    expect(r.rank).toBe(HandRank.OnePair);
    expect(r.coreCards.map((c) => c.rank)).toEqual([13, 13]);
    expect(r.kickers.map((c) => c.rank)).toEqual([9, 5, 2]); // 내림차순
  });

  it('투페어', () => {
    const r = evaluateHand(parseHand('KS KH 5D 5C 2S'));
    expect(r.rank).toBe(HandRank.TwoPair);
    expect(r.coreCards.map((c) => c.rank)).toEqual([13, 13, 5, 5]);
    expect(r.kickers.map((c) => c.rank)).toEqual([2]);
  });

  it('트리플', () => {
    expect(rankOf('QS QH QD 5C 2S')).toBe(HandRank.ThreeOfAKind);
  });

  it('스트레이트', () => {
    const r = evaluateHand(parseHand('9S 8H 7D 6C 5S'));
    expect(r.rank).toBe(HandRank.Straight);
    expect(r.coreCards.map((c) => c.rank)).toEqual([9, 8, 7, 6, 5]);
    expect(r.kickers).toEqual([]);
  });

  it('플러시', () => {
    const r = evaluateHand(parseHand('AH 9H 7H 5H 2H'));
    expect(r.rank).toBe(HandRank.Flush);
    expect(r.dominantSuit).toBe('H');
    expect(r.suitTied).toBe(false);
  });

  it('풀하우스', () => {
    const r = evaluateHand(parseHand('QS QH QD 5C 5S'));
    expect(r.rank).toBe(HandRank.FullHouse);
    expect(r.coreCards.map((c) => c.rank)).toEqual([12, 12, 12, 5, 5]);
  });

  it('포카드', () => {
    const r = evaluateHand(parseHand('7S 7H 7D 7C KS'));
    expect(r.rank).toBe(HandRank.FourOfAKind);
    expect(r.coreCards.length).toBe(4);
    expect(r.kickers.map((c) => c.rank)).toEqual([13]);
  });

  it('스트레이트 플러시', () => {
    expect(rankOf('9C 8C 7C 6C 5C')).toBe(HandRank.StraightFlush);
  });

  it('로열 스트레이트 플러시', () => {
    expect(rankOf('AS KS QS JS TS')).toBe(HandRank.RoyalStraightFlush);
  });
});

describe('엣지케이스', () => {
  it('휠 스트레이트(A-2-3-4-5): 하이카드는 5, A는 마지막', () => {
    const r = evaluateHand(parseHand('AS 2H 3D 4C 5S'));
    expect(r.rank).toBe(HandRank.Straight);
    expect(r.coreCards.map((c) => c.rank)).toEqual([5, 4, 3, 2, 14]);
  });

  it('휠 스트레이트 플러시는 로열이 아니다', () => {
    expect(rankOf('AD 2D 3D 4D 5D')).toBe(HandRank.StraightFlush);
  });

  it('A-K-Q-J-10 무늬 섞임은 그냥 스트레이트', () => {
    expect(rankOf('AS KH QD JC TS')).toBe(HandRank.Straight);
  });

  it('K-A-2-3-4 랩어라운드는 스트레이트가 아니다', () => {
    expect(rankOf('KS AH 2D 3C 4S')).toBe(HandRank.HighCard);
  });

  it('페어 있는 5장 연속처럼 보여도(중복 rank) 스트레이트 아님', () => {
    expect(rankOf('9S 9H 8D 7C 6S')).toBe(HandRank.OnePair);
  });
});

describe('다수 수트(dominantSuit) 결정 — GDD 3.2', () => {
  it('다수 수트가 명확하면 그 수트 (투페어 SSH → S)', () => {
    const r = evaluateHand(parseHand('KS KH 5S 5D 2C'));
    // core: KS KH 5S 5D → S=2, H=1, D=1
    expect(r.dominantSuit).toBe('S');
    expect(r.suitTied).toBe(false);
  });

  it('동수 경합이면 rng로 결정되고 suitTied=true', () => {
    const hand = parseHand('KS KH 9D 5C 2S'); // core: KS,KH → S:1 H:1 동수
    const first = evaluateHand(hand, () => 0);
    const second = evaluateHand(hand, () => 0.99);
    expect(first.suitTied).toBe(true);
    expect(second.suitTied).toBe(true);
    expect(first.dominantSuit).not.toBe(second.dominantSuit);
    // rng 고정 시 결정적 (같은 입력 → 같은 출력)
    expect(evaluateHand(hand, () => 0).dominantSuit).toBe(first.dominantSuit);
  });

  it('하이카드의 수트는 최고 카드의 수트', () => {
    const r = evaluateHand(parseHand('AD 9H 7S 5C 2S'));
    expect(r.dominantSuit).toBe('D');
    expect(r.suitTied).toBe(false);
  });
});

describe('입력 검증', () => {
  it('5장이 아니면 throw', () => {
    expect(() => evaluateHand(parseHand('AS KS QS'))).toThrow();
    expect(() => evaluateHand(parseHand('AS KS QS JS TS 9S'))).toThrow();
  });

  it('중복 카드는 throw', () => {
    expect(() => evaluateHand(parseHand('AS AS QS JS TS'))).toThrow();
  });

  it('잘못된 rank/suit는 throw', () => {
    const bad: Card[] = [
      { rank: 15, suit: 'S' },
      { rank: 2, suit: 'H' },
      { rank: 3, suit: 'D' },
      { rank: 4, suit: 'C' },
      { rank: 5, suit: 'S' },
    ];
    expect(() => evaluateHand(bad)).toThrow();
  });
});

describe('확률 분포 검증 (GDD 3.1 테이블과 대조, 20만 판)', () => {
  it('무작위 5장 배분 시 족보 빈도가 이론값과 근사', () => {
    // 이론값(%): 하이카드 50.1, 원페어 42.3, 투페어 4.75, 트리플 2.11,
    //            스트레이트 0.39, 플러시 0.20, 풀하우스 0.14
    const N = 200_000;
    const counts = new Array<number>(10).fill(0);
    let seed = 12345;
    const rng = () => {
      // xorshift32 — 재현 가능한 시뮬레이션
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return ((seed >>> 0) / 0xffffffff);
    };
    const base = createDeck();
    for (let i = 0; i < N; i++) {
      const deck = [...base];
      for (let j = deck.length - 1; j > 0; j--) {
        const k = Math.floor(rng() * (j + 1));
        [deck[j], deck[k]] = [deck[k], deck[j]];
      }
      counts[evaluateHand(deck.slice(0, 5), rng).rank]++;
    }
    const pct = (r: HandRank) => (counts[r] / N) * 100;
    expect(pct(HandRank.HighCard)).toBeGreaterThan(49);
    expect(pct(HandRank.HighCard)).toBeLessThan(51.2);
    expect(pct(HandRank.OnePair)).toBeGreaterThan(41.2);
    expect(pct(HandRank.OnePair)).toBeLessThan(43.4);
    expect(pct(HandRank.TwoPair)).toBeGreaterThan(4.4);
    expect(pct(HandRank.TwoPair)).toBeLessThan(5.1);
    expect(pct(HandRank.ThreeOfAKind)).toBeGreaterThan(1.8);
    expect(pct(HandRank.ThreeOfAKind)).toBeLessThan(2.4);
    expect(pct(HandRank.Straight)).toBeGreaterThan(0.25);
    expect(pct(HandRank.Straight)).toBeLessThan(0.55);
    expect(pct(HandRank.Flush)).toBeGreaterThan(0.1);
    expect(pct(HandRank.Flush)).toBeLessThan(0.32);
  });
});
