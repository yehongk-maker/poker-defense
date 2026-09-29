/**
 * GameLoop — 한 판(40웨이브)의 전체 상태머신.
 * 카드 페이즈 → 소환 → 전투 → 정산을 묶고 경제/하트/영웅 토큰/영웅/합성/판매/업그레이드를 관리한다.
 *
 * 상태 흐름:
 *   card --confirmHand()--> manage(정비: 판매/합성/업그레이드/영웅) --startCombat()--> combat
 *   combat --(cleared)--> card(다음 웨이브) | --(life 0)--> defeat | --(40클리어)--> victory
 *
 * 순수 로직: Phaser 의존 없음. 씬은 이 클래스의 메서드를 버튼에, tick을 update에 연결한다.
 * 영웅 액티브 스킬은 씬/전투 연출 단계에서 구현 (heroes.json에 데이터만 정의됨).
 */

import type { RngStreams } from './Seed.ts';
import type { RoundOp, LoopListener } from './InputLog.ts';
import { type Suit, type HandResult, type Card } from './PokerEvaluator.ts';
import { CardPhase, type CardPhaseConfig } from './CardPhase.ts';
import {
  SummonMapper,
  type UnitDef,
  type HeroShardType,
  type ShardKey,
  type ShardBag,
  SHARD_KEYS,
  type UnitClass,
  type UnitRace,
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

/** 조각 종류 한글명 (오류 메시지·UI 공용) */
export const SHARD_LABEL: Record<ShardKey, string> = { straight: '스트레이트', flush: '플러시', fullHouse: '풀하우스', wild: '와일드' };

export type GamePhase = 'card' | 'manage' | 'combat' | 'victory' | 'defeat';

export interface HeroDef {
  id: string;
  name: string;
  suit: Suit;
  unlock: 'basic' | 'meta';
  /** 소환에 필요한 조각 종류 (wild로 대체 가능) — GDD 3.3 */
  shardType: HeroShardType;
  /** 종족 시너지 카운트 +1 (docs/synergy-design.md) */
  race: UnitRace;
  combat: { baseDps: number; attackInterval: number; attackType: 'melee' | 'ranged' | 'magic'; range: number; targets?: 'ground' | 'air' | 'both' };
  passive: Record<string, unknown> & { type: string };
  active: { id: string; name: string; cooldownSec: number; desc: string; params: Record<string, number> };
}

/** 영웅 액티브 스킬 사용 결과 (토스트/연출용) */
export interface HeroSkillResult {
  id: string;
  name: string;
  /** 사람이 읽는 요약 (예: "적 5기 피해, 2기 처치") */
  text: string;
  affected: number;
  kills: number;
  goldEarned: number;
}

export type HeroGrade = 'S' | 'A' | 'B';

export interface GameConfig {
  startLife: number;
  startGold: number;
  maxSlots: number;
  sellRatio: number;
  totalWaves: number;
  upgrade: { baseCost: number; costGrowth: number; maxLevel: number; attackPctPerLevel: number };
  /** 행운 드로우 (GDD 3.1.1). 없으면 순수 확률. 솔로·대전 모두 같은 값 — 대전 공정성 */
  drawAssist?: { outWeight: number };
  /** 한 판(매치)에서 쓸 수 있는 카드 교환권 상한. 없으면 무제한 (캠페인). 대전은 duel.json match.ticketsPerMatch */
  ticketsPerRun?: number;
  /** 전투 시뮬 고정 step(초). 있으면 tickCombat이 dt를 모아 이 간격으로만 진행한다 (온라인 결정론). 없으면 가변 dt */
  simStep?: number;
  hero: {
    /** 영웅 1명 소환에 필요한 조각 수 (해당 종류 + wild 합) */
    shardsRequired: number;
    /** 보스 웨이브 클리어 보상: types 중 랜덤 1종을 amount개 (마지막 웨이브 제외) */
    bossShards?: { amount: number; types: HeroShardType[] };
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

/** 한 라운드(웨이브)의 방어 성적 — 베팅 판정(Betting) 등 외부 비교용 */
export interface RoundReport {
  wave: number;
  /** 이 라운드에 확정한 족보 등급 */
  handRank: number;
  /** 이 라운드 전투에서 잃은 하트 */
  lifeLost: number;
  /** 전투 시작부터 종료(클리어/탈락)까지 걸린 전투 시간(초) */
  clearSec: number;
  cleared: boolean;
}

export interface DeployResult {
  deployed: DeployedUnit[];
  /** 슬롯 초과로 자동 판매된 유닛과 환급 골드 */
  overflowSold: { unit: UnitDef; gold: number }[];
  /** 이번 족보로 얻은 영웅 조각 */
  shardsGained: ShardBag;
  /** 로열 스트레이트 플러시: 조각 없이 영웅 선택 가능 상태 */
  freeHeroSummon: boolean;
}

/** 이어하기용 판 저장 (GameLoop.snapshot / restore) */
export interface RunSnapshot {
  version: 1;
  wave: number;
  gold: number;
  life: number;
  shards: Record<ShardKey, number>;
  units: { id: string; slot: number }[];
  hero: { id: string; grade: HeroGrade; slot: number } | null;
  freeHero: boolean;
  upgrades: Record<Suit, number>;
  heroSkillCd: number;
  ticketsUsedRun: number;
  revivesUsed: number;
  pity: Record<string, number>;
}

/** 전투 tick 결과 + 보스 처치 조각 보상 */
export interface CombatTickEvents extends BattleTickEvents {
  /** 보스 웨이브를 클리어한 tick에만 채워진다 */
  bossShard?: { type: HeroShardType; amount: number };
}

/** 영웅별 조각 진행도 (UI 게이지용) */
export interface HeroProgress {
  hero: HeroDef;
  /** 해당 종류 조각 보유량 */
  typed: number;
  /** 쓸 수 있는 wild 보유량 */
  wild: number;
  need: number;
  ready: boolean;
}

export class GameLoop {
  readonly cardPhase: CardPhase;

  private mapper: SummonMapper;
  private synergy: SynergySystem;
  /** 손패·소환용 난수 (라운드마다 교체될 수 있다) */
  private handRng: () => number;
  /** 전투·보스 조각용 난수 */
  private combatRng: () => number;
  private streams: RngStreams | null;
  /** 입력 기록기 (InputLog). 없으면 기록하지 않는다 */
  listener: LoopListener | null = null;
  private stepAcc = 0;
  private _combatSteps = 0;

  private _phase: GamePhase = 'card';
  private _wave = 1;
  private _gold: number;
  private _life: number;
  private _shards: Record<ShardKey, number> = { straight: 0, flush: 0, fullHouse: 0, wild: 0 };
  private _units: DeployedUnit[] = [];
  private _hero: { def: HeroDef; grade: HeroGrade; unit: DeployedUnit } | null = null;
  private freeHero = false;
  private upgradeLevels: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 };
  private battle_: Battle | null = null;
  private lastSynergy: SynergyResult | null = null;
  private lifeNegationsLeft = 0; // 빛의 치유사: 웨이브당 1회 무효
  private heroSkillCd = 0;       // 영웅 액티브 남은 쿨타임(초). 전투 중에만 감소, 웨이브를 넘어 유지
  private coverageCache = new Map<number, number[]>(); // range → 슬롯별 트랙 커버리지
  private roundHandRank = 0;
  private _ticketsUsedRun = 0;
  private _revivesUsed = 0;
  private roundLifeLost = 0;
  private _lastRound: RoundReport | null = null;

  /**
   * @param rng 난수 하나(테스트·캠페인) 또는 라운드별 시드 스트림(온라인 대전, Seed.seedStreams)
   */
  constructor(private data: GameData, rng: (() => number) | RngStreams = Math.random) {
    this.streams = typeof rng === 'function' ? null : rng;
    const base = typeof rng === 'function' ? rng : Math.random;
    this.handRng = this.streams ? this.streams.hand(1) : base;
    this.combatRng = base;
    const g = data.battleConfig;
    if (g.gridSize * g.gridSize !== data.config.maxSlots) {
      throw new Error(`maxSlots(${data.config.maxSlots}) must equal gridSize²(${g.gridSize * g.gridSize})`);
    }
    this._gold = data.config.startGold;
    this._life = data.config.startLife;
    const hand = () => this.handRng();
    this.mapper = new SummonMapper(data.units, data.hands, hand);
    this.synergy = new SynergySystem(data.synergies);
    this.cardPhase = new CardPhase({ drawAssist: data.config.drawAssist, ...(data.cardPhase ?? {}) }, hand);
    this.cardPhase.onExchange = (index, kind) => this.emit([kind === 'ticket' ? 'xt' : kind === 'bonus' ? 'xb' : 'x', index]);
    this.beginRound();
  }

  /** 라운드 시작: 시드 스트림이 있으면 이 라운드의 손패 난수로 바꾸고 새 패를 받는다 */
  private beginRound(): void {
    if (this.streams) this.handRng = this.streams.hand(this._wave);
    this.cardPhase.start();
  }

  private emit(op: RoundOp): void {
    this.listener?.op(op, this._wave);
  }
  /** 전투 중이면 현재 step 번호를 붙인다 (재생 시 같은 step에 실행) */
  private emitTimed(kind: 'sk' | 'g' | 'l', value?: number): void {
    if (!this.listener) return;
    const step = this._phase === 'combat' ? this._combatSteps : undefined;
    if (kind === 'sk') this.emit(['sk', this._combatSteps]);
    else this.emit(step === undefined ? [kind, value!] : [kind, value!, step]);
  }

  // ── 상태 조회 ──────────────────────────────────────────────
  get phase(): GamePhase { return this._phase; }
  get wave(): number { return this._wave; }
  get gold(): number { return this._gold; }
  get life(): number { return this._life; }
  /** 이번 판에서 쓴 카드 교환권 수 */
  get ticketsUsedRun(): number { return this._ticketsUsedRun; }
  /** 이번 판 교환권 남은 사용 가능 횟수 (상한 없으면 Infinity) */
  get ticketsLeftRun(): number {
    const cap = this.data.config.ticketsPerRun;
    return cap === undefined ? Infinity : Math.max(0, cap - this._ticketsUsedRun);
  }
  /**
   * 카드 교환권으로 교환 (카드 페이즈). 매치당 상한(config.ticketsPerRun)을 지키고 사용 수를 센다.
   * 교환권 재고(계정 보유)는 호출 측(MetaProgress)이 차감한다.
   */
  exchangeWithTicket(index: number): Card {
    this.assertPhase('card');
    if (this.ticketsLeftRun <= 0) throw new Error(`이 판에서는 교환권을 ${this.data.config.ticketsPerRun}회까지만 쓸 수 있습니다`);
    const c = this.cardPhase.exchangeWithTicket(index);
    this._ticketsUsedRun++;
    return c;
  }
  /** 가장 최근에 끝난 라운드의 성적 (전투가 끝날 때마다 갱신) */
  get lastRound(): RoundReport | null { return this._lastRound; }

  // ── 외부 시스템(베팅 등)용 골드·하트 조작 ─────────────────
  addGold(n: number): void {
    if (n < 0) throw new Error('addGold: negative');
    this._gold += n;
    if (n > 0) this.emitTimed('g', n);
  }
  spendGold(n: number): void {
    if (n < 0) throw new Error('spendGold: negative');
    if (this._gold < n) throw new Error(`Not enough gold: need ${n}, have ${Math.floor(this._gold)}`);
    this._gold -= n;
    if (n > 0) this.emitTimed('g', -n);
  }
  /** 하트 차감 (앤티 대납 등). 0이 되면 즉시 탈락. 이미 끝난 판에는 무효 */
  loseLife(n: number): void {
    if (n <= 0 || this._phase === 'victory' || this._phase === 'defeat') return;
    this.emitTimed('l', n);
    this._life = Math.max(0, this._life - n);
    if (this._life === 0) {
      this._phase = 'defeat';
      this.battle_ = null;
    }
  }
  /** 보유 영웅 조각 (종류별 + wild) */
  get shards(): Readonly<Record<ShardKey, number>> { return this._shards; }
  /** 해금된 영웅별 조각 진행도 */
  get heroProgress(): HeroProgress[] {
    const need = this.data.config.hero.shardsRequired;
    return this.unlockedHeroes.map((hero) => {
      const typed = this._shards[hero.shardType];
      const wild = this._shards.wild;
      return { hero, typed, wild, need, ready: this.freeHero || typed + wild >= need };
    });
  }
  /** 이 영웅을 지금 소환할 수 있는가 (조각 종류가 맞아야 한다) */
  canSummon(heroId: string): boolean {
    if (this._hero !== null) return false;
    return this.heroProgress.some((p) => p.hero.id === heroId && p.ready);
  }
  /** 로열 스트레이트 플러시로 받은 무료 소환권 보유 여부 */
  get hasFreeHeroSummon(): boolean { return this.freeHero; }
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
  /** 완성된 빙고 줄 (TrackView가 선으로 표시) */
  get bingoLines() { return this.lastSynergy?.bingoLines ?? []; }
  /** 모든 시너지 그룹의 현재 카운트 (`kind:key` → n). 도감 UI용 */
  get synergyCounts(): Readonly<Record<string, number>> { return this.lastSynergy?.counts ?? {}; }
  get synergyTable(): SynergiesTable { return this.data.synergies; }
  /** 진행 중인 전투 (combat 페이즈에서만 non-null) — 씬이 적 위치를 그리는 데 사용 */
  get battle(): Battle | null { return this.battle_; }
  get upgrades(): Readonly<Record<Suit, number>> { return this.upgradeLevels; }
  /** 영웅 액티브 스킬 남은 쿨타임(초) */
  get heroSkillCooldown(): number { return this.heroSkillCd; }
  /** 전투 중이고 영웅이 있고 쿨타임이 끝났으면 true */
  get heroSkillReady(): boolean {
    return this._phase === 'combat' && this._hero !== null && this.heroSkillCd <= 0;
  }
  /** 해금된 영웅 중 하나라도 소환 가능한가 */
  get canSummonHero(): boolean {
    return this._hero === null && this.heroProgress.some((p) => p.ready);
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
  /**
   * 지금 등급이 유지되는 마지막 웨이브와 그다음 등급 (DESIGN §5-04 "웨이브 N 이후엔 A급으로 하락!" 카피용).
   * 최하 등급이면 null.
   */
  get heroGradeDrop(): { until: number; next: HeroGrade } | null {
    const g = this.data.config.hero.grades;
    const total = this.data.config.totalWaves;
    const now = this.heroGradeNow;
    if (now === 'S') return { until: total + 1 - g.S.minRemainingWaves, next: 'A' };
    if (now === 'A') return { until: total + 1 - g.A.minRemainingWaves, next: 'B' };
    return null;
  }

  // ── 카드 페이즈 → 소환 ─────────────────────────────────────
  /** 카드 확정(수동 confirm 또는 타이머 자동 확정) 후 호출. 소환/조각/영웅권을 처리하고 manage 페이즈로 */
  confirmHand(): DeployResult {
    this.assertPhase('card');
    const result: HandResult =
      this.cardPhase.state === 'done' ? this.cardPhase.handResult! : this.cardPhase.confirm();
    this.roundHandRank = result.rank;
    const outcome = this.mapper.map(result);

    const res: DeployResult = { deployed: [], overflowSold: [], shardsGained: outcome.shards, freeHeroSummon: false };
    for (const s of outcome.units) {
      const def = this.mapper.unitById(s.unitId);
      const slot = this.autoSlot(def.range);
      if (slot === null) {
        const gold = Math.floor(def.value * this.data.config.sellRatio);
        this._gold += gold;
        res.overflowSold.push({ unit: def, gold });
      } else {
        const du: DeployedUnit = { def, slot, placed: false }; // 소환 직후: 1회 배치 가능
        this._units.push(du);
        res.deployed.push(du);
      }
    }
    for (const k of SHARD_KEYS) this._shards[k] += outcome.shards[k] ?? 0;
    if (outcome.heroSummon && this._hero === null) {
      this.freeHero = true;
      res.freeHeroSummon = true;
    }
    this._phase = 'manage';
    this.recalcSynergy();
    this.emit(['c']);
    return res;
  }

  // ── 정비(manage): 판매/합성/업그레이드/영웅 ─────────────────
  /**
   * 유닛 배치 (정비 페이즈). 소환 직후(placed=false)인 유닛만, 빈 칸으로, 1회만 옮길 수 있다.
   * 옮기면 배치가 확정되어(placed=true) 더는 못 움직인다. 전투 시작 시 남은 미확정 유닛도 모두 확정된다.
   * 자리 교환은 없다 (확정된 유닛은 판매만 가능).
   */
  moveUnit(fromSlot: number, toSlot: number): void {
    this.assertPhase('manage');
    const max = this.data.config.maxSlots;
    if (![fromSlot, toSlot].every((x) => Number.isInteger(x) && x >= 0 && x < max)) throw new Error(`Invalid slot ${fromSlot}→${toSlot}`);
    const a = this.unitAtSlot(fromSlot);
    if (!a) throw new Error(`No unit at slot ${fromSlot}`);
    if (a.placed) throw new Error('배치가 확정된 유닛은 옮길 수 없습니다 (판매만 가능)');
    if (fromSlot === toSlot) return;
    if (this.unitAtSlot(toSlot)) throw new Error('빈 칸으로만 옮길 수 있습니다');
    a.slot = toSlot;
    a.placed = true;
    this.recalcSynergy();
    this.emit(['mv', fromSlot, toSlot]);
  }

  /** 아직 배치를 확정하지 않은(1회 이동 가능한) 유닛 — 영웅 포함 */
  get unplacedUnits(): DeployedUnit[] {
    const out = this._units.filter((u) => !u.placed);
    if (this._hero && !this._hero.unit.placed) out.push(this._hero.unit);
    return out;
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
    this.emit(['sell', index]);
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
    const mergedDef = this.mapper.unitFor(def.suit, def.tier + 1, def.cards); // 변형(low/high) 유지
    const merged: DeployedUnit = { def: mergedDef, slot: this.autoSlot(mergedDef.range)!, placed: false }; // 합성 결과도 1회 배치 가능
    this._units.push(merged);
    this.recalcSynergy();
    this.emit(['mg', unitId]);
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
    this.emit(['up', suit]);
  }

  /** 영웅 소환. 등급은 남은 웨이브 수로 결정 (일찍 소환할수록 강함 — GDD 3.3) */
  summonHero(heroId: string): { def: HeroDef; grade: HeroGrade } {
    this.assertPhase('manage');
    if (this._hero) throw new Error('Hero already summoned');
    const def = this.unlockedHeroes.find((h) => h.id === heroId);
    if (!def) throw new Error(`Hero not unlocked: ${heroId}`);
    if (!this.canSummon(heroId)) throw new Error(`${SHARD_LABEL[def.shardType]} 조각이 부족합니다 (${def.name})`);
    const slot = this.autoSlot(def.combat.range);
    if (slot === null) throw new Error('No free slot for hero — sell a unit first');

    if (this.freeHero) {
      this.freeHero = false;
    } else {
      // 해당 종류 조각을 먼저 쓰고, 모자라면 wild로 채운다
      let need = this.data.config.hero.shardsRequired;
      const fromTyped = Math.min(need, this._shards[def.shardType]);
      this._shards[def.shardType] -= fromTyped;
      need -= fromTyped;
      this._shards.wild -= need;
    }

    const grade = this.heroGradeNow;

    const heroUnitDef = this.heroUnitDef(def, grade);
    this._hero = { def, grade, unit: { def: heroUnitDef, slot, placed: false } };
    this.recalcSynergy();
    this.emit(['hero', heroId]);
    return { def, grade };
  }

  /** 영웅을 전투 유닛으로 구성 (수트·클래스 시너지 카운트 제외 — GDD 3.3). 근접 영웅은 지상만, 대공 영웅은 공중 특화 */
  private heroUnitDef(def: HeroDef, grade: HeroGrade): UnitDef {
    const mult = this.data.config.hero.grades[grade].mult;
    return {
      id: `hero_${def.id}`, name: def.name, suit: def.suit, tier: 6, cards: 'high',
      class: 'transcendent' as UnitClass, race: def.race, attackType: def.combat.attackType, targets: def.combat.targets ?? 'both',
      baseDps: def.combat.baseDps * mult, dpsFactor: 1.0,
      attackInterval: def.combat.attackInterval, range: def.combat.range,
      value: 0, effect: null, desc: `${def.name} (${grade}급)`,
    };
  }

  // ── 부활 (캠페인 광고 보상, GDD §9.2) ─────────────────────
  get revivesUsed(): number { return this._revivesUsed; }
  /** 탈락 직후 부활: 하트를 회복하고 **같은 웨이브**를 카드 페이즈부터 다시. 판당 maxPerRun회 */
  revive(restoreLife: number, maxPerRun = 1): void {
    this.assertPhase('defeat');
    if (this._revivesUsed >= maxPerRun) throw new Error('부활은 판당 한 번만 가능합니다');
    this._revivesUsed++;
    this._life = Math.min(this.data.config.startLife, Math.max(1, restoreLife));
    this.battle_ = null;
    this._phase = 'card';
    this.emit(['rv', this._life]);
    this.beginRound();
  }

  // ── 저장/이어하기 (캠페인) ─────────────────────────────────
  /** 카드 페이즈 시작 시점의 판 상태. 손패는 저장하지 않는다(이어하면 새로 받는다) */
  snapshot(): RunSnapshot {
    return {
      version: 1,
      wave: this._wave, gold: this._gold, life: this._life,
      shards: { ...this._shards },
      units: this._units.map((u) => ({ id: u.def.id, slot: u.slot })),
      hero: this._hero ? { id: this._hero.def.id, grade: this._hero.grade, slot: this._hero.unit.slot } : null,
      freeHero: this.freeHero,
      upgrades: { ...this.upgradeLevels },
      heroSkillCd: this.heroSkillCd,
      ticketsUsedRun: this._ticketsUsedRun,
      revivesUsed: this._revivesUsed,
      pity: { ...this.cardPhase.pityLevels },
    };
  }

  /** 저장된 판을 복원한다. 데이터(웨이브 수·유닛 id)가 맞지 않으면 throw → 호출 측이 저장을 버린다 */
  static restore(data: GameData, snap: RunSnapshot, rng: () => number = Math.random): GameLoop {
    if (snap.version !== 1) throw new Error('unknown snapshot version');
    if (!Number.isInteger(snap.wave) || snap.wave < 1 || snap.wave > data.config.totalWaves) throw new Error('snapshot wave out of range');
    const g = new GameLoop(data, rng);
    g._wave = snap.wave;
    g._gold = Math.max(0, snap.gold);
    g._life = Math.min(data.config.startLife, Math.max(1, snap.life));
    for (const k of SHARD_KEYS) g._shards[k] = Math.max(0, Math.floor(snap.shards?.[k] ?? 0));
    const used = new Set<number>();
    for (const u of snap.units) {
      if (u.slot < 0 || u.slot >= data.config.maxSlots || used.has(u.slot)) throw new Error('snapshot slot invalid');
      used.add(u.slot);
      g._units.push({ def: g.mapper.unitById(u.id), slot: u.slot, placed: true });
    }
    if (snap.hero) {
      const def = data.heroes.find((h) => h.id === snap.hero!.id);
      if (!def || used.has(snap.hero.slot)) throw new Error('snapshot hero invalid');
      g._hero = { def, grade: snap.hero.grade, unit: { def: g.heroUnitDef(def, snap.hero.grade), slot: snap.hero.slot, placed: true } };
    }
    g.freeHero = !!snap.freeHero && g._hero === null;
    for (const s of ['S', 'H', 'D', 'C'] as Suit[]) g.upgradeLevels[s] = Math.max(0, Math.min(data.config.upgrade.maxLevel, Math.floor(snap.upgrades?.[s] ?? 0)));
    g.heroSkillCd = Math.max(0, snap.heroSkillCd ?? 0);
    g._ticketsUsedRun = Math.max(0, snap.ticketsUsedRun ?? 0);
    g._revivesUsed = Math.max(0, snap.revivesUsed ?? 0);
    g.cardPhase.restorePity(snap.pity ?? {});
    g.recalcSynergy();
    return g;
  }

  // ── 전투 ──────────────────────────────────────────────────
  startCombat(): void {
    this.assertPhase('manage');
    const waveDef = this.data.waves[this._wave - 1];
    if (!waveDef) throw new Error(`No wave ${this._wave}`);
    // 전투 시작 = 배치 확정
    for (const u of this._units) u.placed = true;
    if (this._hero) this._hero.unit.placed = true;
    this.recalcSynergy();

    const g = this.lastSynergy!.global;
    const mods = { killGoldBonus: g.killGoldBonus, killGoldPct: 0, bonusGoldChancePct: g.bonusGoldChancePct, bonusGoldAmount: g.bonusGoldAmount };
    if (this._hero?.def.passive.type === 'kill_gold_pct') {
      mods.killGoldPct = this._hero.def.passive.pct as number;
    }
    const airKillGoldMult = this._hero?.def.passive.type === 'air_kill_gold_mult' ? (this._hero.def.passive.mult as number) : 1;
    const airSpeedPct = this._hero?.def.passive.type === 'air_slow_pct' ? -(this._hero.def.passive.pct as number) : 0;
    this._gold += g.waveStartGold; // 고블린: 웨이브 시작 골드

    const combatUnits = this._hero ? [...this._units, this._hero.unit] : [...this._units];
    this.lifeNegationsLeft = this._units.filter((u) => u.def.effect?.type === 'negate_life_loss').length;

    if (this.streams) this.combatRng = this.streams.combat(this._wave);
    this.battle_ = new Battle(waveDef, this.data.enemyTypes, combatUnits, this.data.battleConfig, {
      getGold: () => this._gold,
      rng: this.combatRng,
      globalMods: { ...mods, airKillGoldMult },
      battleMods: {
        airSpeedPct,
        timeLimitBonus: g.timeLimitPlus,
        enemySpeedPct: g.enemySpeedPct,
        waveStartStunSec: g.waveStartStunSec,
        rangeMultOverride: g.rangeMultOverride,
      },
    });
    this.roundLifeLost = 0;
    this.stepAcc = 0;
    this._combatSteps = 0;
    this.emit(['go']);
    this._phase = 'combat';
  }

  /** 이번 전투에서 진행한 시뮬 step 수 (입력 로그의 시각 단위) */
  get combatSteps(): number { return this._combatSteps; }
  /** 고정 step 사이의 진행 비율 0~1 (렌더 보간용). 가변 dt면 항상 1 */
  get combatAlpha(): number {
    const step = this.data.config.simStep;
    return step ? Math.min(1, this.stepAcc / step) : 1;
  }

  /**
   * 전투 프레임 진행. 씬 update()에서 호출.
   * config.simStep이 있으면 dt를 모아 고정 step으로만 진행한다(한 번에 0~여러 step) — 프레임률과 무관하게 같은 결과.
   */
  tickCombat(dt: number): CombatTickEvents {
    this.assertPhase('combat');
    const step = this.data.config.simStep;
    if (!step) return this.advance(dt);
    this.stepAcc += dt;
    const out: CombatTickEvents = { hits: [], kills: 0, goldEarned: 0, lifeLost: 0, timeUp: false, leaked: 0, cleared: false };
    while (this.stepAcc >= step - 1e-9 && this._phase === 'combat') {
      this.stepAcc = Math.max(0, this.stepAcc - step);
      const ev = this.advance(step);
      out.hits.push(...ev.hits);
      out.kills += ev.kills;
      out.goldEarned += ev.goldEarned;
      out.lifeLost += ev.lifeLost;
      out.leaked += ev.leaked;
      out.timeUp = out.timeUp || ev.timeUp;
      out.cleared = out.cleared || ev.cleared;
      if (ev.bossShard) out.bossShard = ev.bossShard;
    }
    return out;
  }

  /** 고정 step 한 번 (입력 로그 재생용). simStep이 없으면 fallback 간격을 쓴다 */
  stepCombat(fallback = 0.1): CombatTickEvents {
    this.assertPhase('combat');
    return this.advance(this.data.config.simStep ?? fallback);
  }

  private advance(dt: number): CombatTickEvents {
    const ev: CombatTickEvents = this.battle_!.tick(dt);
    this._combatSteps++;
    this._gold += ev.goldEarned;
    if (this.heroSkillCd > 0) this.heroSkillCd = Math.max(0, this.heroSkillCd - dt);
    if (ev.leaked > 0) this._gold += ev.leaked * this.lastSynergy!.global.leakGold; // 고블린 5: 이탈 적당 골드 회수

    // 하트 차감 (빛의 치유사 무효 → 태산 수호자 확률 무효 순서)
    let loss = ev.lifeLost;
    while (loss > 0 && this.lifeNegationsLeft > 0) { loss--; this.lifeNegationsLeft--; }
    if (loss > 0 && this._hero?.def.passive.type === 'life_save_chance_pct') {
      const pct = this._hero.def.passive.pct as number;
      let saved = 0;
      for (let i = 0; i < loss; i++) if (this.combatRng() * 100 < pct) saved++;
      loss -= saved;
    }
    this._life -= loss;
    this.roundLifeLost += loss;

    if (this._life <= 0) {
      this._life = 0;
      this._phase = 'defeat';
      this._lastRound = { wave: this._wave, handRank: this.roundHandRank, lifeLost: this.roundLifeLost, clearSec: this.battle_!.time, cleared: false };
      this.listener?.roundEnd(this._lastRound, this._combatSteps);
      return ev;
    }

    if (ev.cleared) {
      this._lastRound = { wave: this._wave, handRank: this.roundHandRank, lifeLost: this.roundLifeLost, clearSec: this.battle_!.time, cleared: true };
      this.listener?.roundEnd(this._lastRound, this._combatSteps);
      const g = this.lastSynergy!.global;
      this._gold += this.battle_!.clearGold(g.waveGoldPct);
      this._life = Math.min(this.data.config.startLife, this._life + g.lifePerWave);
      this.battle_ = null;
      if (this._wave >= this.data.config.totalWaves) {
        this._phase = 'victory';
      } else {
        // 보스 처치 보상: 랜덤 종류 영웅 조각 (마지막 웨이브는 게임이 끝나므로 제외) — GDD 3.3
        const boss = this.data.config.hero.bossShards;
        if (boss && this.data.waves[this._wave - 1]?.boss && boss.types.length > 0) {
          const type = boss.types[Math.min(Math.floor(this.combatRng() * boss.types.length), boss.types.length - 1)];
          this._shards[type] += boss.amount;
          ev.bossShard = { type, amount: boss.amount };
        }
        this._wave++;
        this._phase = 'card';
        this.beginRound();
      }
    }
    return ev;
  }

  // ── 영웅 액티브 스킬 (GDD 3.3: 수동, 쿨 45초, 등급 배율 S×1.5/A×1.0/B×0.7) ─────
  /**
   * 전투 중 영웅 액티브 사용. 등급 배율은 피해·지속시간·골드에 적용되고, 대상 수(targets/turrets/boltsPerSec)는 고정.
   * @throws 전투 중이 아니거나 영웅이 없거나 쿨타임 중
   */
  useHeroSkill(): HeroSkillResult {
    this.assertPhase('combat');
    if (!this._hero) throw new Error('No hero');
    if (this.heroSkillCd > 0) throw new Error(`Skill on cooldown: ${Math.ceil(this.heroSkillCd)}s`);
    const b = this.battle_!;
    const { def, grade, unit } = this._hero;
    const mult = this.data.config.hero.grades[grade].mult;
    const p = def.active.params;
    /** 영웅 기본 1회 피해 (등급 배율은 baseDps에 이미 반영됨) */
    const heroDmg = unit.def.baseDps * unit.def.dpsFactor * unit.def.attackInterval;
    const sec = (v: number) => Math.round(v * mult * 10) / 10;

    let out: { affected: number; kills: number; goldEarned: number };
    let text: string;
    switch (def.active.id) {
      case 'earth_slam': { // 트랙 전체 광역 + 기절
        out = b.damageAllEnemies(unit, heroDmg * p.dmgMult, sec(p.stunSec));
        text = `적 ${out.affected}기 강타 (${out.kills}기 처치), ${sec(p.stunSec)}초 기절`;
        break;
      }
      case 'execute_strike': { // 최고 HP 적 n체 초대미지
        out = b.hitTopHpEnemies(unit, p.targets, heroDmg * p.dmgMult);
        text = `최고 HP ${out.affected}기 처형 검격 (${out.kills}기 처치)`;
        break;
      }
      case 'sanctuary': { // 하트 피해 무효
        out = b.setSanctuary(sec(p.durationSec));
        text = `${sec(p.durationSec)}초간 하트 피해 무효`;
        break;
      }
      case 'rock_wall': { // 적 정지
        out = b.freezeEnemies(sec(p.durationSec));
        text = `${sec(p.durationSec)}초간 적 전체 정지`;
        break;
      }
      case 'golden_bullet': { // 최대 HP 적 즉사 (보스는 %)
        out = b.executeHighestHp(unit, p.bossDmgPct * mult);
        text = out.kills > 0 ? '최대 HP 적 즉사!' : `보스에게 최대 HP ${Math.round(p.bossDmgPct * mult)}% 피해`;
        break;
      }
      case 'grand_heist': { // 골드 강탈 + 감속
        out = b.slowAllEnemies(Math.round(p.slowPct * mult), sec(p.durationSec), Math.round(p.goldPerEnemy * mult));
        this._gold += 0; // 골드는 다음 tick 이벤트로 합산됨
        text = `적 ${out.affected}기에게서 💰${out.goldEarned} 강탈, 이속 -${Math.round(p.slowPct * mult)}%`;
        break;
      }
      case 'abyss_summon': { // 유령 포탑
        const turrets: DeployedUnit[] = [];
        for (let i = 0; i < p.turrets; i++) {
          turrets.push({
            def: {
              id: `ghost_turret_${i}`, name: '유령 포탑', suit: def.suit, tier: 0, cards: 'high', class: 'arcanist', race: 'monster',
              attackType: 'magic', targets: 'both', baseDps: p.turretDps * mult, dpsFactor: 1, attackInterval: 1.0, range: 6,
              value: 0, effect: null, desc: '심연 소환 임시 포탑',
            },
            slot: unit.slot,
          });
        }
        out = b.addTemporaryUnits(turrets, sec(p.durationSec));
        text = `유령 포탑 ${p.turrets}기 소환 (${sec(p.durationSec)}초)`;
        break;
      }
      case 'thunder_storm': { // 무작위 낙뢰
        out = b.startStorm(unit, p.boltDmg * mult, p.boltsPerSec, sec(p.durationSec));
        text = `${sec(p.durationSec)}초간 초당 ${p.boltsPerSec}발 낙뢰`;
        break;
      }
      // ── 대공 영웅 ──
      case 'flak_barrage': { // 공중 적 전체 피해 + 추락(정지)
        out = b.damageAllEnemies(unit, heroDmg * p.dmgMult, sec(p.stunSec), 'air');
        text = out.affected > 0 ? `공중 적 ${out.affected}기 탄막 (${out.kills}기 격추), ${sec(p.stunSec)}초 추락` : '공중 적이 없습니다';
        break;
      }
      case 'light_of_falling': { // 공중 적 전체 정지 (스폰 포함)
        out = b.freezeAirEnemies(sec(p.durationSec));
        text = `${sec(p.durationSec)}초간 공중 적 정지`;
        break;
      }
      case 'bombard_support': { // 공중 상위 HP n체 초대미지
        out = b.hitTopHpEnemies(unit, p.targets, heroDmg * p.dmgMult, 'air');
        text = out.affected > 0 ? `공중 ${out.affected}기 포격 (${out.kills}기 격추)` : '공중 적이 없습니다';
        break;
      }
      case 'void_gale': { // 공중 적에게만 낙뢰
        out = b.startStorm(unit, p.boltDmg * mult, p.boltsPerSec, sec(p.durationSec), 'air');
        text = `${sec(p.durationSec)}초간 공중 적에게 초당 ${p.boltsPerSec}발 낙뢰`;
        break;
      }
      default:
        throw new Error(`Unknown hero skill: ${def.active.id}`);
    }
    this.heroSkillCd = def.active.cooldownSec;
    this.emitTimed('sk');
    return { id: def.active.id, name: def.active.name, text, ...out };
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
    this.lastSynergy = this.synergy.apply(this._units, { extraClassCounts, suitAttackUpgradePct, hero: this._hero?.unit, geometry: this.geometry });

    // 영웅 패시브 (시너지 재계산 후 덧셈 — apply()가 영웅 보너스도 초기화·계산해 두었으므로 여기서는 더하기만)
    if (this._hero) {
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
        case 'air_attack_pct': { // 대공 영웅: 공중 적 피해 +% (global 또는 특정 수트), 영웅 자신 포함
          const targets = hp.scope === 'suit' ? this._units.filter((u) => u.def.suit === hp.suit) : [...this._units];
          for (const u of targets) u.airAttackPctBonus = (u.airAttackPctBonus ?? 0) + (hp.pct as number);
          this._hero.unit.airAttackPctBonus = (this._hero.unit.airAttackPctBonus ?? 0) + (hp.pct as number);
          break;
        }
        // class_count / kill_gold_pct / life_save_chance_pct / air_kill_gold_mult / air_slow_pct는 각각
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
