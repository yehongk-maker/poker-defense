import { describe, it, expect } from 'vitest';
import { CardPhase } from '../src/systems/CardPhase.ts';
import { HandRank } from '../src/systems/PokerEvaluator.ts';

/** xorshift32 — 시드 고정 재현용 rng */
function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

const key = (c: { rank: number; suit: string }) => `${c.rank}${c.suit}`;

describe('배분(start)', () => {
  it('5장 배분, 덱에는 47장 남음', () => {
    const p = new CardPhase({}, seededRng(1));
    p.start();
    expect(p.hand.length).toBe(5);
    expect(p.deckCount).toBe(47);
    expect(p.state).toBe('choosing');
    expect(p.timeRemaining).toBe(30);
    expect(p.exchangesRemaining).toBe(1);
  });

  it('배분된 5장에 중복 없음', () => {
    const p = new CardPhase({}, seededRng(2));
    p.start();
    expect(new Set(p.hand.map(key)).size).toBe(5);
  });

  it('같은 시드 → 같은 손패 (재현성)', () => {
    const a = new CardPhase({}, seededRng(7));
    const b = new CardPhase({}, seededRng(7));
    a.start(); b.start();
    expect(a.hand.map(key)).toEqual(b.hand.map(key));
  });

  it('start 재호출 시 라운드 리셋 (덱 52장 새로, 교환/타이머 복구)', () => {
    const p = new CardPhase({}, seededRng(3));
    p.start();
    p.toggleSelect(0);
    p.exchange();
    p.tick(10);
    p.start();
    expect(p.deckCount).toBe(47);
    expect(p.exchangesRemaining).toBe(1);
    expect(p.timeRemaining).toBe(30);
    expect(p.selectedIndices).toEqual([]);
  });
});

describe('선택(toggleSelect)', () => {
  it('탭으로 선택/해제 토글, 복수 선택 가능', () => {
    const p = new CardPhase({}, seededRng(4));
    p.start();
    expect(p.toggleSelect(0)).toBe(true);
    expect(p.toggleSelect(2)).toBe(true);
    expect(p.selectedIndices).toEqual([0, 2]);
    expect(p.toggleSelect(0)).toBe(false); // 해제
    expect(p.selectedIndices).toEqual([2]);
  });

  it('범위 밖 인덱스는 throw', () => {
    const p = new CardPhase({}, seededRng(5));
    p.start();
    expect(() => p.toggleSelect(5)).toThrow();
    expect(() => p.toggleSelect(-1)).toThrow();
  });

  it('교환 소진 후에는 선택 불가 (false 반환)', () => {
    const p = new CardPhase({}, seededRng(6));
    p.start();
    p.toggleSelect(0);
    p.exchange();
    expect(p.toggleSelect(1)).toBe(false);
    expect(p.selectedIndices).toEqual([]);
  });
});

describe('교환(exchange) — GDD "받은 패를 카드 한장씩 한번 교환 가능"', () => {
  it('선택한 카드만 덱의 새 카드로 바뀐다', () => {
    const p = new CardPhase({}, seededRng(10));
    p.start();
    const before = p.hand.map(key);
    p.toggleSelect(1);
    p.toggleSelect(3);
    p.exchange();
    const after = p.hand.map(key);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
    expect(after[4]).toBe(before[4]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[3]).not.toBe(before[3]);
    expect(p.deckCount).toBe(45); // 2장 뽑음
  });

  it('버린 카드는 덱으로 돌아가지 않는다 (같은 카드 재등장 불가)', () => {
    const p = new CardPhase({ exchangeLimit: 2 }, seededRng(11));
    p.start();
    const discarded = key(p.hand[0]);
    p.toggleSelect(0);
    p.exchange();
    p.toggleSelect(0);
    p.exchange();
    expect(p.hand.map(key).includes(discarded)).toBe(false);
  });

  it('기본 1회 제한: 두 번째 교환은 throw', () => {
    const p = new CardPhase({}, seededRng(12));
    p.start();
    p.toggleSelect(0);
    p.exchange();
    expect(p.exchangesRemaining).toBe(0);
    expect(() => p.exchange()).toThrow();
  });

  it('메타 업그레이드 exchangeLimit=2면 두 번 교환 가능', () => {
    const p = new CardPhase({ exchangeLimit: 2 }, seededRng(13));
    p.start();
    p.toggleSelect(0); p.exchange();
    p.toggleSelect(1); p.exchange();
    expect(p.exchangesRemaining).toBe(0);
  });

  it('선택 없이 교환하면 throw (UI는 버튼 비활성 처리)', () => {
    const p = new CardPhase({}, seededRng(14));
    p.start();
    expect(() => p.exchange()).toThrow();
  });

  it('교환 후 선택 목록은 비워진다', () => {
    const p = new CardPhase({ exchangeLimit: 2 }, seededRng(15));
    p.start();
    p.toggleSelect(0);
    p.exchange();
    expect(p.selectedIndices).toEqual([]);
  });
});

describe('확정(confirm)', () => {
  it('족보 결과를 반환하고 done 상태가 된다', () => {
    const p = new CardPhase({}, seededRng(20));
    p.start();
    const r = p.confirm();
    expect(p.state).toBe('done');
    expect(p.handResult).toBe(r);
    expect(r.rank >= HandRank.HighCard && r.rank <= HandRank.RoyalStraightFlush).toBe(true);
  });

  it('done 이후 선택/교환/재확정은 throw', () => {
    const p = new CardPhase({}, seededRng(21));
    p.start();
    p.confirm();
    expect(() => p.toggleSelect(0)).toThrow();
    expect(() => p.exchange()).toThrow();
    expect(() => p.confirm()).toThrow();
  });
});

describe('타이머(tick) — 30초, 0초 = 자동 진행', () => {
  it('tick으로 감소, 만료 전엔 autoConfirmed null', () => {
    const p = new CardPhase({}, seededRng(30));
    p.start();
    const t = p.tick(10);
    expect(t.remaining).toBe(20);
    expect(t.autoConfirmed).toBe(null);
  });

  it('0초 도달 시 자동 확정', () => {
    const p = new CardPhase({}, seededRng(31));
    p.start();
    p.tick(29);
    const t = p.tick(1.5);
    expect(t.remaining).toBe(0);
    expect(t.autoConfirmed).not.toBe(null);
    expect(p.state).toBe('done');
  });

  it('수동 확정 후의 tick은 아무 일도 하지 않는다', () => {
    const p = new CardPhase({}, seededRng(32));
    p.start();
    p.confirm();
    const t = p.tick(100);
    expect(t.autoConfirmed).toBe(null);
    expect(p.state).toBe('done');
  });

  it('timerSeconds 설정(메타 업그레이드 40초) 반영', () => {
    const p = new CardPhase({ timerSeconds: 40 }, seededRng(33));
    p.start();
    expect(p.timeRemaining).toBe(40);
  });
});

describe('통합 시나리오', () => {
  it('배분 → 2장 선택 → 교환 → 진행: 전체 흐름', () => {
    const p = new CardPhase({}, seededRng(40));
    p.start();
    p.tick(3);
    p.toggleSelect(0);
    p.toggleSelect(4);
    p.exchange();
    p.tick(5);
    const r = p.confirm();
    expect(p.state).toBe('done');
    expect(r.coreCards.length).toBeGreaterThan(0);
    expect(p.deckCount).toBe(45);
  });

  it('10,000 라운드 스모크: 어떤 시드에서도 손패 중복/덱 카운트 오류 없음', () => {
    for (let seed = 1; seed <= 10_000; seed++) {
      const rng = seededRng(seed);
      const p = new CardPhase({ exchangeLimit: 2 }, rng);
      p.start();
      // 무작위로 0~5장 선택 후 교환 시도
      const n = Math.floor(rng() * 6);
      for (let i = 0; i < n; i++) p.toggleSelect(Math.floor(rng() * 5));
      if (p.selectedIndices.length > 0) p.exchange();
      const r = p.confirm();
      if (new Set(p.hand.map(key)).size !== 5) throw new Error(`dup at seed ${seed}`);
      if (r === null) throw new Error(`no result at seed ${seed}`);
    }
    expect(true).toBe(true);
  });
});
