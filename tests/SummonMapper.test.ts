import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SummonMapper,
  type UnitDef,
  type HandsTable,
} from '../src/systems/SummonMapper.ts';
import { evaluateHand, parseHand, HandRank } from '../src/systems/PokerEvaluator.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
const unitsJson = JSON.parse(readFileSync(join(dataDir, 'units.json'), 'utf8'));
const handsJson = JSON.parse(readFileSync(join(dataDir, 'hands.json'), 'utf8'));
const units: UnitDef[] = unitsJson.units;
const hands: HandsTable = handsJson;

const mapper = () => new SummonMapper(units, hands, () => 0.1);
const outcomeOf = (codes: string) => mapper().map(evaluateHand(parseHand(codes), () => 0.1));

describe('units.json 데이터 무결성 — GDD 3.2.1', () => {
  it('수트 4종 × 티어 5단계 × 변형 2(low/high) = 정확히 40종', () => {
    expect(units.length).toBe(40);
    for (const s of ['S', 'H', 'D', 'C'] as const) {
      for (let t = 1; t <= 5; t++) {
        for (const b of ['low', 'high'] as const) {
          expect(units.filter((u) => u.suit === s && u.tier === t && u.cards === b).length).toBe(1);
        }
      }
    }
  });

  it('지상/공중 분리: 모든 수트에 대공 가능(both/air) 유닛과 지상 전용 유닛이 공존', () => {
    for (const s of ['S', 'H', 'D', 'C'] as const) {
      const su = units.filter((u) => u.suit === s);
      expect(su.some((u) => u.targets === 'both' || u.targets === 'air')).toBe(true);
      expect(su.some((u) => u.targets === 'ground')).toBe(true);
    }
  });

  it('baseDps = 8×2.2^(티어-1), value = 40×2.5^(티어-1) 공식 준수', () => {
    for (const u of units) {
      const dps = 8 * Math.pow(2.2, u.tier - 1);
      const val = 40 * Math.pow(2.5, u.tier - 1);
      expect(Math.abs(u.baseDps - dps) < 0.5).toBe(true);
      expect(Math.abs(u.value - Math.round(val)) <= 1).toBe(true);
    }
  });

  it('클래스 5종이 모두 존재하고 T5는 전원 초월체 (엔드게임 시너지)', () => {
    const classes = new Set(units.map((u) => u.class));
    expect(classes.size).toBe(5);
    for (const u of units.filter((u) => u.tier === 5)) {
      expect(u.class).toBe('transcendent');
    }
  });

  it('id 중복 없음', () => {
    expect(new Set(units.map((u) => u.id)).size).toBe(40);
  });
});

describe('족보 → 소환 매핑 — GDD 3.1 테이블', () => {
  it('하이카드 → T1 유닛 1기', () => {
    const o = outcomeOf('AS 9H 7D 5C 2S');
    expect(o.units.map((u) => u.tier)).toEqual([1]);
    expect(o.jokerShards).toBe(0);
    expect(o.heroSummon).toBe(false);
  });

  it('원페어 → T1 유닛 2기 (페어 수트 종족)', () => {
    const o = outcomeOf('KS KH 9D 5C 2S');
    expect(o.units.map((u) => u.tier)).toEqual([1, 1]);
    expect(o.units[0].unitId).toBe(o.units[1].unitId); // 같은 수트 → 같은 유닛
  });

  it('투페어 → T2(높은 페어 수트·변형) + T1(낮은 페어 수트·변형)', () => {
    // 높은 페어 K♠K♠ 불가 → K♠K♥? 페어 내 수트 다르면 rng. 명확한 케이스로:
    // 높은 페어 = K♦K♦ 불가하므로 같은 수트 페어는 불가능(중복카드). 다른 수트지만
    // rng()=0.1 < 0.5 → 첫 카드 수트 선택으로 결정적.
    const o = outcomeOf('KD KC 5S 5H 2S');
    expect(o.units.map((u) => u.tier)).toEqual([2, 1]);
    expect(o.units[0].suit).toBe('D'); // 높은 페어(K)의 첫 카드 수트
    expect(o.units[1].suit).toBe('S'); // 낮은 페어(5)의 첫 카드 수트
    expect(o.units[0].unitId).toBe('firework_merchant'); // ♦T2 high (K) // ♦T2
    expect(o.units[1].unitId).toBe('spear_striker'); // ♠T1
  });

  it('트리플 → T2 유닛 2기', () => {
    const o = outcomeOf('QS QH QD 5C 2S');
    expect(o.units.map((u) => u.tier)).toEqual([2, 2]);
  });

  it('스트레이트 → T3 1기, 조각 0', () => {
    const o = outcomeOf('9S 8H 7D 6C 5S');
    expect(o.units.map((u) => u.tier)).toEqual([3]);
    expect(o.jokerShards).toBe(0);
  });

  it('플러시 → T3 1기 + 조커 조각 1 (수트 = 플러시 수트)', () => {
    const o = outcomeOf('AH 9H 7H 5H 2H');
    expect(o.units.map((u) => u.tier)).toEqual([3]);
    expect(o.units[0].unitId).toBe('inquisitor'); // ♥T3 high (A 포함) // ♥T3
    expect(o.jokerShards).toBe(1);
  });

  it('풀하우스 → T4 1기', () => {
    const o = outcomeOf('QS QH QD 5C 5S');
    expect(o.units.map((u) => u.tier)).toEqual([4]);
    expect(o.jokerShards).toBe(0);
  });

  it('포카드 → T4 1기 + 조각 1', () => {
    const o = outcomeOf('7S 7H 7D 7C KS');
    expect(o.units.map((u) => u.tier)).toEqual([4]);
    expect(o.jokerShards).toBe(1);
  });

  it('스트레이트 플러시 → T5 1기 + 조각 2', () => {
    const o = outcomeOf('9C 8C 7C 6C 5C');
    expect(o.units.map((u) => u.tier)).toEqual([5]);
    expect(o.units[0].unitId).toBe('void_lord'); // ♣T5 high (9 포함) // ♣T5
    expect(o.jokerShards).toBe(2);
  });

  it('변형 규칙: 최고 숫자 8 이하 = low, 9 이상 = high (킥커는 무시)', () => {
    const straight = outcomeOf('6S 5H 4D 3C 2S'); // 최고 6 → low, 다수 수트 S
    expect(straight.units[0].unitId).toBe('crusher_rider'); // ♠T3 low
    const quads = outcomeOf('7S 7H 7D 7C KS'); // 구성 카드는 7×4 (K는 킥커) → low
    expect(units.find((u) => u.id === quads.units[0].unitId)!.cards).toBe('low');
    const high = outcomeOf('AS 9H 7D 5C 2S'); // 하이카드 A → high
    expect(high.units[0].unitId).toBe('chain_archer'); // ♠T1 high
  });

  it('로열 스트레이트 플러시 → 유닛 없이 영웅 즉시 소환', () => {
    const o = outcomeOf('AS KS QS JS TS');
    expect(o.heroSummon).toBe(true);
    expect(o.units).toEqual([]);
    expect(o.handRank).toBe(HandRank.RoyalStraightFlush);
  });
});

describe('투페어 수트 rng 분기', () => {
  it('rng ≥ 0.5면 페어의 두 번째 카드 수트 선택', () => {
    const m = new SummonMapper(units, hands, () => 0.9);
    const o = m.map(evaluateHand(parseHand('KD KC 5S 5H 2S'), () => 0.1));
    expect(o.units[0].suit).toBe('C');
    expect(o.units[1].suit).toBe('H');
  });
});

describe('데이터 무결성 검증 (생성자)', () => {
  it('유닛 누락 시 생성자에서 throw', () => {
    const missing = units.filter((u) => u.id !== 'imp');
    expect(() => new SummonMapper(missing, hands)).toThrow();
  });

  it('수트×티어 중복 시 throw', () => {
    const dup = [...units, { ...units[0], id: 'dup_unit' }];
    expect(() => new SummonMapper(dup, hands)).toThrow();
  });
});

describe('전수 검증: 어떤 5장 조합에서도 매핑이 항상 성공', () => {
  it('50,000 무작위 손패 → 소환 결과 유효 (유닛 존재, 수트 일치)', () => {
    let seed = 777;
    const rng = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return (seed >>> 0) / 0xffffffff;
    };
    const m = new SummonMapper(units, hands, rng);
    const suits = ['S', 'H', 'D', 'C'] as const;
    const base: { rank: number; suit: (typeof suits)[number] }[] = [];
    for (const s of suits) for (let r = 2; r <= 14; r++) base.push({ rank: r, suit: s });

    for (let i = 0; i < 50_000; i++) {
      const deck = [...base];
      for (let j = deck.length - 1; j > 0; j--) {
        const k = Math.floor(rng() * (j + 1));
        [deck[j], deck[k]] = [deck[k], deck[j]];
      }
      const result = evaluateHand(deck.slice(0, 5), rng);
      const o = m.map(result);
      if (!o.heroSummon && o.units.length === 0) throw new Error('empty summon');
      for (const u of o.units) {
        if (!units.some((d) => d.id === u.unitId && d.suit === u.suit && d.tier === u.tier)) {
          throw new Error(`invalid summon ${u.unitId}`);
        }
      }
    }
    expect(true).toBe(true);
  });
});
