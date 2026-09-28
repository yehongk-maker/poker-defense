/** 행운 드로우 (GDD §3.1.1): 아웃 판정·가중 추첨·CardPhase 연동 */
import { describe, it, expect } from 'vitest';
import { countOuts, isOut, outSpec, pickIndex } from '../src/systems/DrawAssist.ts';
import { CardPhase } from '../src/systems/CardPhase.ts';
import { createDeck, parseCard, parseHand, evaluateHand, HandRank } from '../src/systems/PokerEvaluator.ts';

function rng(seed: number) { let s = seed; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; }; }
const rest = (codes: string) => { const hand = parseHand(codes); return createDeck().filter((c) => !hand.some((h) => h.rank === c.rank && h.suit === c.suit)); };

describe('아웃 판정', () => {
  it('같은 숫자: Q♠Q♥ 남김 → 나머지 Q 2장이 아웃', () => {
    const spec = outSpec(parseHand('QS QH'));
    expect(isOut(parseCard('QD'), spec)).toBe(true);
    expect(isOut(parseCard('QC'), spec)).toBe(true);
    expect(isOut(parseCard('KD'), spec)).toBe(false);
    expect(countOuts(parseHand('QS QH'), rest('QS QH 2D 5C 9S'))).toBe(2);
  });

  it('플러시: 같은 무늬 3장 이상 남기면 그 무늬가 아웃 (2장이면 아님)', () => {
    expect(isOut(parseCard('3H'), outSpec(parseHand('AH KH 7H 4H')))).toBe(true);
    expect(isOut(parseCard('3S'), outSpec(parseHand('AH KH 7H 4H')))).toBe(false);
    expect(outSpec(parseHand('AH KH 7S 4C')).flushSuit).toBeNull();
    // A♥K♥7♥4♥ 남김 → 하트 9장 (+ 같은 숫자 A·K·7·4 각 3장 = 12) = 21
    expect(countOuts(parseHand('AH KH 7H 4H'), rest('AH KH 7H 4H 2C'))).toBe(9 + 12);
  });

  it('스트레이트: 9-8-7-6 남김 → 10과 5만 (4·J는 아님)', () => {
    const spec = outSpec(parseHand('9S 8H 7D 6C'));
    expect([...spec.straightRanks].sort((a, b) => a - b)).toEqual([5, 10]);
    expect(isOut(parseCard('4S'), spec)).toBe(false);
    expect(isOut(parseCard('JS'), spec)).toBe(false);
  });

  it('스트레이트: A-2-3-4 남김 → 5 (A는 1로도 센다), 3장 미만이면 스트레이트 아웃 없음', () => {
    expect([...outSpec(parseHand('AS 2H 3D 4C')).straightRanks]).toEqual([5]);
    expect(outSpec(parseHand('9S 8H')).straightRanks.size).toBe(0);
    // Q-K-A 남김: 10-J 구간(10~A) 빈 숫자 = 10, J
    expect([...outSpec(parseHand('QS KH AD')).straightRanks].sort((a, b) => a - b)).toEqual([10, 11]);
  });

  it('남긴 카드가 없으면 아웃도 없다', () => {
    expect(countOuts([], createDeck())).toBe(0);
  });
});

describe('가중 추첨', () => {
  it('outWeight 0이거나 남긴 카드가 없으면 균등 추첨', () => {
    const deck = rest('QS QH 2D 5C 9S');
    const hits = new Set<number>();
    const r = rng(3);
    for (let i = 0; i < 400; i++) hits.add(pickIndex(parseHand('QS QH'), deck, 0, r));
    expect(hits.size).toBeGreaterThan(deck.length * 0.8);
  });

  it('outWeight 1이면 아웃이 약 2배로 뽑힌다 (Q 2장 아웃 vs 45장)', () => {
    const kept = parseHand('QS QH'), deck = rest('QS QH 2D 5C 9S');
    const r = rng(11);
    let outs = 0;
    const N = 40_000;
    for (let i = 0; i < N; i++) if (deck[pickIndex(kept, deck, 1, r)].rank === 12) outs++;
    // 기대: 2×2 / (2×2 + 45) = 8.2%  (균등이면 4.3%)
    expect(outs / N).toBeGreaterThan(0.07);
    expect(outs / N).toBeLessThan(0.095);
  });
});

describe('CardPhase 연동', () => {
  it('outsFor: 그 카드를 뺀 나머지 기준으로 덱의 아웃 수를 센다', () => {
    const p = new CardPhase({ drawAssist: { outWeight: 1 } }, rng(5));
    p.start();
    (p as unknown as { handCards: unknown[] }).handCards = parseHand('9S 8H 7D 6C KS');
    // K를 바꾸면 9-8-7-6 유지 → 스트레이트 아웃 10·5 (각 4장) + 같은 숫자 9·8·7·6 (각 3장) = 8 + 12 = 20 (덱 잔여 기준 근사: 덱에 그 카드들이 다 있을 때)
    const deckHas = (rank: number) => (p as unknown as { deck: { rank: number }[] }).deck.filter((c) => c.rank === rank).length;
    const expected = deckHas(10) + deckHas(5) + deckHas(9) + deckHas(8) + deckHas(7) + deckHas(6);
    expect(p.outsFor(4)).toBe(expected);
    expect(p.outWeight).toBe(1);
  });

  it('보정이 켜지면 드로우 성공률이 오른다: 플러시 드로우 1장 교환 (보정 없음 ~19% → 있음 ~26%)', () => {
    const rate = (w: number, seed: number) => {
      const r = rng(seed);
      let ok = 0;
      const N = 6000;
      for (let i = 0; i < N; i++) {
        const p = new CardPhase({ drawAssist: { outWeight: w } }, r);
        p.start();
        (p as unknown as { handCards: unknown[] }).handCards = parseHand('AH KH 7H 4H 2C');
        // 덱에서 손패 카드 제거 (start가 섞은 덱과 손패가 겹치지 않게)
        const hand = p.hand;
        const d = p as unknown as { deck: { rank: number; suit: string }[] };
        d.deck = createDeck().filter((c) => !hand.some((h) => h.rank === c.rank && h.suit === c.suit));
        // 덱 셔플
        for (let j = d.deck.length - 1; j > 0; j--) { const k = Math.floor(r() * (j + 1)); [d.deck[j], d.deck[k]] = [d.deck[k], d.deck[j]]; }
        p.exchangeCard(4);
        if (evaluateHand([...p.hand], () => 0).rank >= HandRank.Flush) ok++;
      }
      return ok / N;
    };
    const off = rate(0, 21), on = rate(1, 22);
    expect(off).toBeGreaterThan(0.15); expect(off).toBeLessThan(0.23);
    expect(on).toBeGreaterThan(0.23); expect(on).toBeLessThan(0.30);
  });

  it('같은 시드면 같은 결과 (재현성)', () => {
    const run = () => { const p = new CardPhase({ drawAssist: { outWeight: 1 } }, rng(99)); p.start(); p.exchangeCard(0); p.exchangeCard(3); return p.hand.map((c) => `${c.rank}${c.suit}`).join(' '); };
    expect(run()).toBe(run());
  });
});
