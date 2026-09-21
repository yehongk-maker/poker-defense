/**
 * GameLoop — 한 판(40웨이브)의 전체 상태머신.
 * 카드 페이즈 → 소환 → 전투 → 정산을 묶고 경제/라이프/조각/영웅/합성/판매/업그레이드를 관리한다.
 *
 * 상태 흐름:
 *   card --confirmHand()--> manage(정비: 판매/합성/업그레이드/영웅) --startCombat()--> combat
 *   combat --(cleared)--> card(다음 웨이브) | --(life 0)--> defeat | --(40클리어)--> victory
 *
 * 순수 로직: Phaser 의존 없음. 씬은 이 클래스의 메서드를 버튼에, tick을 update에 연결한다.
 * 영웅 액티브 스킬은 씬/전투 연출 단계에서 구현 (heroes.json에 데이터만 정의됨).
 */

import { type Suit, type HandResult } from './PokerEvaluator.ts';
import { CardPhase, type CardPhaseConfig } from './CardPhase.ts';
import {
  SummonMapper,
  type UnitDef,
  type UnitClass,
  type HandsTable,
} from './SummonMapper.ts';
import {
  Battle,
  type DeployedUnit,
  type WaveDef,
  type EnemyTypeDef,
  type BattleConfig,
  type BattleTickEvents,
} from './Battle.ts';
import { SynergySystem, type SynergiesTable, type SynergyResult } from './SynergySystem.ts';
import { coverage, type TrackGeometry } from './Geometry.ts';

export type GamePhase = 'card' | 'manage' | 'combat' | 'victory' | 'defeat';

export interface HeroDef {
  id: string;
  name: string;
  suit: Suit;
  unlock: 'basic' | 'meta';
  combat: { baseDps: number; attackInterval: number; attackType: 'melee' | 'ranged' | 'magic'; range: number };
  passive: Record<string, unknown> & { type: string };
  active: Record<string, unknown> & { id: string; cooldownSec: number };
}

export type HeroGrade = 'S' | 'A' | 'B';

export interface GameConfig {
  startLife: number;
  startGold: number;
  maxSlots: number;
  sellRatio: number;
  totalWaves: number;
  upgrade: { baseCost: number; costGrowth: number; maxLevel: number; attackPctPerLevel: number };
  hero: {
    shardsRequired: number;
    grades: Record<HeroGrade, { minRemainingWaves: number; mult: number }>;
  };
}

export interface GameData {
  units: UnitDef[];
  hands: HandsTable;
  synergies: SynergiesTable;
  heroes: HeroDef[];
  waves: WaveDef[];
  enemyTypes: Record<string, EnemyTypeDef>;
  battleConfig: BattleConfig;
  config: GameConfig;
  /** 메타 업그레이드 반영값 (없으면 기본) */
  cardPhase?: CardPhaseConfig;
  /** 해금된 영웅 id 목록 (없으면 basic 전원) */
  unlockedHeroes?: string[];
}

export interface DeployResult {
  deployed: DeployedUnit[];
  /** 슬롯 초과로 자동 판매된 유닛과 환급 골드 */
  overflowSold: { unit: UnitDef; gold: number }[];
  shardsGained: number;
  /** 로열 스트레이트 플러시: 조각 없이 영웅 선택 가능 상태 */
  freeHeroSummon: boolean;
}

export class GameLoop {
  readonly cardPhase: CardPhase;

  private mapper: SummonMapper;
  private synergy: SynergySystem;
  private rng: () => number;

  private _phase: GamePhase = 'card';
  private _wave = 1;
  private _gold: number;
  private _life: number;
  private _shards = 0;
  private _units: DeployedUnit[] = [];
  private _hero: { def: HeroDef; grade: HeroGrade; unit: DeployedUnit } | null = null;
  private freeHero = false;
  private upgradeLevels: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 };
  private battle_: Battle | null = null;
  private lastSynergy: SynergyResult | null = null;
  private lifeNegationsLeft = 0; // 빛의 치유사: 웨이브당 1회 무효
  private coverageCache = new Map<number, number[]>(); // range → 슬롯별 트랙 커버리지

  constructor(private data: GameData, rng: () => number = Math.random) {
    this.rng = rng;
    const g = data.battleConfig;
    if (g.gridSize * g.gridSize !== data.config.maxSlots) {
      throw new Error(`maxSlots(${data.config.maxSlots}) must equal gridSize²(${g.gridSize * g.gridSize})`);
    }
    this._gold = data.config.startGold;
    this._life = data.config.startLife;
    this.mapper = new SummonMapper(data.units, data.hands, rng);
    this.synergy = new SynergySystem(data.synergies);
    this.cardPhase = new CardPhase(data.cardPhase ?? {}, rng);
    this.cardPhase.start();
  }

  // ── 상태 조회 ──────────────────────────────────────────────
  get phase(): GamePhase { return this._phase; }
  get wave(): number { return this._wave; }
  get gold(): number { return this._gold; }
  get life(): number { return this._life; }
  get shards(): number { return this._shards; }
  get units(): readonly DeployedUnit[] { return this._units; }
  get geometry(): TrackGeometry { return { trackLength: this.data.battleConfig.trackLength, gridSize: this.data.battleConfig.gridSize }; }
  /** 영웅 포함, 슬롯에 놓인 유닛 (없으면 null) */
  unitAtSlot(slot: number): DeployedUnit | null {
    if (this._hero && this._hero.unit.slot === slot) return this._hero.unit;
    return this._units.find((u) => u.slot === slot) ?? null;
  }
  /** 비어 있는 슬롯 목록 */
  get freeSlots(): number[] {
    const used = new Set(this._units.map((u) => u.slot));
    if (this._hero) used.add(this._hero.unit.slot);
    const out: number[] = [];
    for (let i = 0; i < this.data.config.maxSlots; i++) if (!used.has(i)) out.push(i);
    return out;
  }
  /** 사거리별 슬롯 트랙 커버리지(0~1) — UI 힌트/자동 배치용 */
  slotCoverage(range: number): number[] {
    let c = this.coverageCache.get(range);
    if (!c) {
      c = [];
      for (let i = 0; i < this.data.config.maxSlots; i++) c.push(coverage(this.geometry, i, range));
      this.coverageCache.set(range, c);
    }
    return c;
  }
  get hero() { return this._hero; }
  get activeSynergies() { return this.lastSynergy?.active ?? []; }
  /** 진행 중인 전투 (combat 페이즈에서만 non-null) — 씬이 적 위치를 그리는 데 사용 */
  get battle(): Battle | null { return this.battle_; }
  get upgrades(): Readonly<Record<Suit, number>> { return this.upgradeLevels; }
  get canSummonHero(): boolean {
    return this._hero === null &&
      (this.freeHero || this._shards >= this.data.config.hero.shardsRequired);
  }
  get unlockedHeroes(): HeroDef[] {
    return this.data.heroes.filter((h) => this.isHeroUnlocked(h.id));
  }
  /** 전체 영웅 8종 (해금 여부 무관 — 선택 UI에서 잠금 표시용) */
  get allHeroes(): readonly HeroDef[] { return this.data.heroes; }
  isHeroUnlocked(id: string): boolean {
    const ids = this.data.unlockedHeroes;
    const h = this.data.heroes.find((h) => h.id === id);
    return !!h && (ids ? ids.includes(h.id) : h.unlock === 'basic');
  }
  /** 지금 소환하면 받을 영웅 등급 (남은 웨이브 기준 — GDD 3.3) */
  get heroGradeNow(): HeroGrade {
    const remaining = this.data.config.totalWaves - this._wave + 1;
    const g = this.data.config.hero.grades;
    return remaining >= g.S.minRemainingWaves ? 'S' : remaining >= g.A.minRemainingWaves ? 'A' : 'B';
  }

  // ── 카드 페이즈 → 소환 ─────────────────────────────────────
  /** 카드 확정(수동 confirm 또는 타이머 자동 확정) 후 호출. 소환/조각/영웅권을 처리하고 manage 페이즈로 */
  confirmHand(): DeployResult {
    this.assertPhase('card');
    const result: HandResult =
      this.cardPhase.state === 'done' ? this.cardPhase.handResult! : this.cardPhase.confirm();
    const outcome = this.mapper.map(result);

    const res: DeployResult = { deployed: [], overflowSold: [], shardsGained: outcome.jokerShards, freeHeroSummon: false };
    for (const s of outcome.units) {
      const def = this.mapper.unitFor(s.suit, s.tier);
      const slot = this.autoSlot(def.range);
      if (slot === null) {
        const gold = Math.floor(def.value * this.data.config.sellRatio);
        this._gold += gold;
        res.overflowSold.push({ unit: def, gold });
      } else {
        const du: DeployedUnit = { def, slot };
        this._units.push(du);
        res.deployed.push(du);
      }
    }
    this._shards += outcome.jokerShards;
    if (outcome.heroSummon && this._hero === null) {
      this.freeHero = true;
      res.freeHeroSummon = true;
    }
    this._phase = 'manage';
    this.recalcSynergy();
    return res;
  }

  // ── 정비(manage): 판매/합성/업그레이드/영웅 ─────────────────
  /**
   * 유닛 배치 이동 (정비 페이즈). 대상 칸에 유닛/영웅이 있으면 자리를 맞바꾼다.
   * @returns 이동 후 from 칸에 남는 유닛 (교환된 유닛) 또는 null
   */
  moveUnit(fromSlot: number, toSlot: number): DeployedUnit | null {
    this.assertPhase('manage');
    const max = this.data.config.maxSlots;
    if (![fromSlot, toSlot].every((x) => Number.isInteger(x) && x >= 0 && x < max)) throw new Error(`Invalid slot ${fromSlot}→${toSlot}`);
    const a = this.unitAtSlot(fromSlot);
    if (!a) throw new Error(`No unit at slot ${fromSlot}`);
    if (fromSlot === toSlot) return null;
    const b = this.unitAtSlot(toSlot);
    a.slot = toSlot;
    if (b) b.slot = fromSlot;
    return b;
  }

  /** 자동 배치: 사거리에 맞춰 트랙 커버리지가 가장 큰 빈 칸 (근접=가장자리, 원거리=안쪽이 자연 발생) */
  private autoSlot(range: number): number | null {
    const free = this.freeSlots;
    if (free.length === 0) return null;
    const cov = this.slotCoverage(range);
    let best = free[0];
    for (const s of free) if (cov[s] > cov[best] + 1e-9) best = s;
    return best;
  }

  /** 유닛 판매: 소환가치의 70% 환급 */
  sellUnit(index: number): number {
    this.assertPhase('manage');
    const u = this._units[index];
    if (!u) throw new Error(`No unit at ${index}`);
    const gold = Math.floor(u.def.value * this.data.config.sellRatio);
    this._units.splice(index, 1);
    this._gold += gold;
    this.recalcSynergy();
    return gold;
  }

  /** 동일 유닛 3기 합성 → 같은 수트 상위 티어 1기 (T5는 불가) */
  mergeUnits(unitId: string): DeployedUnit {
    this.assertPhase('manage');
    const idxs = this._units
      .map((u, i) => ({ u, i }))
      .filter(({ u }) => u.def.id === unitId)
      .map(({ i }) => i);
    if (idxs.length < 3) throw new Error(`Need 3× ${unitId}, have ${idxs.length}`);
    const def = this._units[idxs[0]].def;
    if (def.tier >= 5) throw new Error('T5 units cannot merge');
    for (const i of idxs.slice(0, 3).reverse()) this._units.splice(i, 1);
    const mergedDef = this.mapper.unitFor(def.suit, def.tier + 1);
    const merged: DeployedUnit = { def: mergedDef, slot: this.autoSlot(mergedDef.range)! };
    this._units.push(merged);
    this.recalcSynergy();
    return merged;
  }

  /** 합성 가능한 유닛 id 목록 */
  get mergeable(): string[] {
    const counts = new Map<string, number>();
    for (const u of this._units) counts.set(u.def.id, (counts.get(u.def.id) ?? 0) + 1);
    return [...counts.entries()]
      .filter(([id, n]) => n >= 3 && this._units.find((u) => u.def.id === id)!.def.tier < 5)
      .map(([id]) => id);
  }

  /** 수트 업그레이드 비용: 50×1.4^Lv */
  upgradeCost(suit: Suit): number | null {
    const lv = this.upgradeLevels[suit];
    if (lv >= this.data.config.upgrade.maxLevel) return null;
    return Math.round(this.data.config.upgrade.baseCost * Math.pow(this.data.config.upgrade.costGrowth, lv));
  }

  buyUpgrade(suit: Suit): void {
    this.assertPhase('manage');
    const cost = this.upgradeCost(suit);
    if (cost === null) throw new Error(`${suit} upgrade maxed`);
    if (this._gold < cost) throw new Error(`Not enough gold: need ${cost}, have ${this._gold}`);
    this._gold -= cost;
    this.upgradeLevels[suit]++;
    this.recalcSynergy();
  }

  /** 영웅 소환. 등급은 남은 웨이브 수로 결정 (일찍 소환할수록 강함 — GDD 3.3) */
  summonHero(heroId: string): { def: HeroDef; grade: HeroGrade } {
    this.assertPhase('manage');
    if (this._hero) throw new Error('Hero already summoned');
    if (!this.canSummonHero) throw new Error('Not enough joker shards');
    const def = this.unlockedHeroes.find((h) => h.id === heroId);
    if (!def) throw new Error(`Hero not unlocked: ${heroId}`);
    const slot = this.autoSlot(def.combat.range);
    if (slot === null) throw new Error('No free slot for hero — sell a unit first');

    if (this.freeHero) this.freeHero = false;
    else this._shards -= this.data.config.hero.shardsRequired;

    const grade = this.heroGradeNow;
    const mult = this.data.config.hero.grades[grade].mult;

    // 영웅을 전투 유닛으로 구성 (시너지 카운트 제외 — GDD 3.3)
    const heroUnitDef: UnitDef = {
      id: `hero_${def.id}`, name: def.name, suit: def.suit, tier: 6,
      class: 'transcendent' as UnitClass, attackType: def.combat.attackType,
      baseDps: def.combat.baseDps * mult, dpsFactor: 1.0,
      attackInterval: def.combat.attackInterval, range: def.combat.range,
      value: 0, effect: null, desc: `${def.name} (${grade}급)`,
    };
    this._hero = { def, grade, unit: { def: heroUnitDef, slot } };
    this.recalcSynergy();
    return { def, grade };
  }

  // ── 전투 ──────────────────────────────────────────────────
  startCombat(): void {
    this.assertPhase('manage');
    const waveDef = this.data.waves[this._wave - 1];
    if (!waveDef) throw new Error(`No wave ${this._wave}`);
    this.recalcSynergy();

    const g = this.lastSynergy!.global;
    const mods = { killGoldBonus: g.killGoldBonus, killGoldPct: 0, bonusGoldChancePct: g.bonusGoldChancePct, bonusGoldAmount: g.bonusGoldAmount };
    if (this._hero?.def.passive.type === 'kill_gold_pct') {
      mods.killGoldPct = this._hero.def.passive.pct as number;
    }

    const combatUnits = this._hero ? [...this._units, this._hero.unit] : [...this._units];
    this.lifeNegationsLeft = this._units.filter((u) => u.def.effect?.type === 'negate_life_loss').length;

    this.battle_ = new Battle(waveDef, this.data.enemyTypes, combatUnits, this.data.battleConfig, {
      getGold: () => this._gold,
      rng: this.rng,
      globalMods: mods,
    });
    this._phase = 'combat';
  }

  /** 전투 프레임 진행. 씬 update()에서 호출 */
  tickCombat(dt: number): BattleTickEvents {
    this.assertPhase('combat');
    const ev = this.battle_!.tick(dt);
    this._gold += ev.goldEarned;

    // 라이프 차감 (빛의 치유사 무효 → 태산 수호자 확률 무효 순서)
    let loss = ev.lifeLost;
    while (loss > 0 && this.lifeNegationsLeft > 0) { loss--; this.lifeNegationsLeft--; }
    if (loss > 0 && this._hero?.def.passive.type === 'life_save_chance_pct') {
      const pct = this._hero.def.passive.pct as number;
      let saved = 0;
      for (let i = 0; i < loss; i++) if (this.rng() * 100 < pct) saved++;
      loss -= saved;
    }
    this._life -= loss;

    if (this._life <= 0) {
      this._life = 0;
      this._phase = 'defeat';
      return ev;
    }

    if (ev.cleared) {
      const g = this.lastSynergy!.global;
      this._gold += this.battle_!.clearGold(g.waveGoldPct);
      this._life = Math.min(this.data.config.startLife, this._life + g.lifePerWave);
      this.battle_ = null;
      if (this._wave >= this.data.config.totalWaves) {
        this._phase = 'victory';
      } else {
        this._wave++;
        this._phase = 'card';
        this.cardPhase.start();
      }
    }
    return ev;
  }

  // ── 내부 ──────────────────────────────────────────────────
  /** 시너지 + 라운드 업그레이드 + 영웅 패시브를 유닛 보너스 필드에 반영 */
  private recalcSynergy(): void {
    const p = this._hero?.def.passive;
    const extraClassCounts =
      p?.type === 'class_count'
        ? ({ [p.class as UnitClass]: p.plus as number } as Partial<Record<UnitClass, number>>)
        : undefined;
    const up = this.data.config.upgrade.attackPctPerLevel;
    const suitAttackUpgradePct = {
      S: this.upgradeLevels.S * up, H: this.upgradeLevels.H * up,
      D: this.upgradeLevels.D * up, C: this.upgradeLevels.C * up,
    };
    this.lastSynergy = this.synergy.apply(this._units, { extraClassCounts, suitAttackUpgradePct });

    // 영웅 패시브 (시너지 재계산 후 덧셈 — 영웅 유닛 자체는 시너지 카운트 제외)
    if (this._hero) {
      this._hero.unit.attackPctBonus = 0;
      this._hero.unit.attackSpeedPctBonus = 0;
      this._hero.unit.chainTargetsBonus = 0;
      const hp = this._hero.def.passive;
      switch (hp.type) {
        case 'suit_attack_pct':
          for (const u of this._units.filter((u) => u.def.suit === hp.suit)) {
            u.attackPctBonus! += hp.pct as number;
          }
          break;
        case 'global_attack_speed_pct':
          for (const u of this._units) u.attackSpeedPctBonus! += hp.pct as number;
          this._hero.unit.attackSpeedPctBonus! += hp.pct as number;
          break;
        case 'suit_aoe_radius_pct':
          for (const u of this._units.filter((u) => u.def.suit === hp.suit)) {
            u.aoeRadiusPctBonus! += hp.pct as number;
          }
          break;
        case 'chain_targets_plus':
          for (const u of this._units.filter((u) => u.def.effect?.type === 'chain_lightning')) {
            u.chainTargetsBonus = (u.chainTargetsBonus ?? 0) + (hp.plus as number);
          }
          break;
        // class_count / kill_gold_pct / life_save_chance_pct는 각각
        // recalcSynergy 상단 / startCombat / tickCombat에서 처리
      }
    }
  }

  private assertPhase(expected: GamePhase): void {
    if (this._phase !== expected) {
      throw new Error(`Invalid phase: ${this._phase} (expected '${expected}')`);
    }
  }
}
