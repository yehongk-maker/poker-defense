/**
 * SummonMapper — 확정된 족보(HandResult)를 소환 결과로 변환
 *
 * GDD 3.1/3.2 근거:
 *  - 족보 → 소환 유닛 티어 목록 + 영웅 토큰 + 영웅 즉시 소환 여부 (hands.json)
 *  - 수트가 종족 결정: 소환 유닛은 다수 수트(dominantSuit)의 유닛
 *  - 투페어 예외: T2는 높은 페어의 수트, T1은 낮은 페어의 수트 (페어 내 동수면 rng)
 *  - 카드 숫자 = 변형: 족보 구성 카드의 최고 숫자 2~8 = low, 9~A = high (수트×티어당 2종, 총 40종). 투페어는 각 페어의 숫자로.
 *  - 지상/공중: UnitDef.targets (ground/air/both) — Battle이 공격 가능 여부 판정
 *
 * 순수 로직: 데이터는 생성자 주입(DI). Vite에서는 JSON import,
 * 테스트/시뮬레이터에서는 fs로 읽어 넘긴다.
 */

import {
  type Card,
  type HandResult,
  type Suit,
  HandRank,
} from './PokerEvaluator.ts';

export type UnitClass = 'raider' | 'destroyer' | 'saint' | 'arcanist' | 'transcendent';
/** 종족 시너지 축 (docs/synergy-design.md) */
export type UnitRace = 'human' | 'goblin' | 'monster' | 'spirit';
/** 공격 가능 대상: ground=지상만, air=공중만, both=모두 */
export type TargetBand = 'ground' | 'air' | 'both';
/** 변형: 족보 구성 카드 최고 숫자 2~8=low, 9~A=high */
export type CardBand = 'low' | 'high';

export interface UnitDef {
  id: string;
  name: string;
  suit: Suit;
  tier: number;
  cards: CardBand;
  class: UnitClass;
  race: UnitRace;
  attackType: 'melee' | 'ranged' | 'magic';
  targets: TargetBand;
  baseDps: number;
  dpsFactor: number;
  attackInterval: number;
  range: number;
  value: number;
  effect: Record<string, unknown> | null;
  desc: string;
}

export interface HandOutcomeDef {
  summonTiers: number[];
  jokerShards: number;
  heroSummon: boolean;
}

export type HandsTable = Record<keyof typeof HandRank, HandOutcomeDef>;

export interface SummonSpec {
  unitId: string;
  name: string;
  suit: Suit;
  tier: number;
}

export interface SummonOutcome {
  handRank: HandRank;
  units: SummonSpec[];
  jokerShards: number;
  /** true면 유닛 대신 영웅 선택 소환 (로열 스트레이트 플러시) */
  heroSummon: boolean;
}

const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
const BANDS: readonly CardBand[] = ['low', 'high'];

/** 카드 숫자 → 변형 밴드 (9 이상 = high) */
export function bandOfRank(rank: number): CardBand {
  return rank >= 9 ? 'high' : 'low';
}

export class SummonMapper {
  private byKey = new Map<string, UnitDef>(); // `${suit}${tier}:${band}` → unit
  private byId = new Map<string, UnitDef>();

  constructor(
    units: UnitDef[],
    private hands: HandsTable,
    private rng: () => number = Math.random
  ) {
    for (const u of units) {
      const k = `${u.suit}${u.tier}:${u.cards}`;
      if (this.byKey.has(k)) throw new Error(`Duplicate unit for ${k}`);
      if (this.byId.has(u.id)) throw new Error(`Duplicate unit id ${u.id}`);
      this.byKey.set(k, u);
      this.byId.set(u.id, u);
    }
    // 데이터 무결성: 모든 수트×티어(1~5)×변형(low/high) 칸이 채워져 있어야 한다
    for (const s of SUITS) {
      for (let t = 1; t <= 5; t++) {
        for (const b of BANDS) {
          if (!this.byKey.has(`${s}${t}:${b}`)) throw new Error(`Missing unit for ${s}${t}:${b}`);
        }
      }
    }
  }

  /** 수트+티어+변형으로 유닛 정의 조회 */
  unitFor(suit: Suit, tier: number, band: CardBand): UnitDef {
    const u = this.byKey.get(`${suit}${tier}:${band}`);
    if (!u) throw new Error(`No unit for ${suit}${tier}:${band}`);
    return u;
  }

  unitById(id: string): UnitDef {
    const u = this.byId.get(id);
    if (!u) throw new Error(`No unit ${id}`);
    return u;
  }

  /** 족보 결과 → 소환 결과 */
  map(result: HandResult): SummonOutcome {
    const def = this.hands[HandRank[result.rank] as keyof typeof HandRank];
    if (!def) throw new Error(`No hand outcome for ${HandRank[result.rank]}`);

    const units: SummonSpec[] = [];

    if (result.rank === HandRank.TwoPair) {
      // coreCards = [높은 페어 2장, 낮은 페어 2장] (PokerEvaluator가 보장). 변형은 각 페어의 숫자로 결정
      const highPair = result.coreCards.slice(0, 2);
      const lowPair = result.coreCards.slice(2, 4);
      units.push(this.spec(this.pairSuit(highPair), def.summonTiers[0], bandOfRank(highPair[0].rank)));
      units.push(this.spec(this.pairSuit(lowPair), def.summonTiers[1], bandOfRank(lowPair[0].rank)));
    } else {
      // 변형: 족보 구성 카드의 최고 숫자 기준
      const band = bandOfRank(Math.max(...result.coreCards.map((c) => c.rank)));
      for (const tier of def.summonTiers) {
        units.push(this.spec(result.dominantSuit, tier, band));
      }
    }

    return {
      handRank: result.rank,
      units,
      jokerShards: def.jokerShards,
      heroSummon: def.heroSummon,
    };
  }

  private spec(suit: Suit, tier: number, band: CardBand): SummonSpec {
    const u = this.unitFor(suit, tier, band);
    return { unitId: u.id, name: u.name, suit: u.suit, tier: u.tier };
  }

  /** 페어 2장의 수트 결정: 같으면 그 수트, 다르면 rng */
  private pairSuit(pair: Card[]): Suit {
    if (pair[0].suit === pair[1].suit) return pair[0].suit;
    return this.rng() < 0.5 ? pair[0].suit : pair[1].suit;
  }
}
