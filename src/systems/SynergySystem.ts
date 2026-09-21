/**
 * SynergySystem — 필드 유닛 구성을 세서 시너지 버프를 계산하고
 * DeployedUnit의 보너스 필드를 채운다 (Battle이 그대로 소비).
 *
 * 4축 (GDD 3.2/3.2.2 + docs/synergy-design.md):
 *  - 수트(진영): 기수(중복 포함) 2/4/6 — 순수 빌드 보상
 *  - 클래스(역할): 서로 다른 유닛 종류 2/4 — 혼합 빌드·합성 유도
 *  - 종족: 기수 + 영웅 1 (heroRace) — 물량 빌드 보상. 위치(같은 행/열), 사거리+1 같은 룰 변화 포함
 *  - 진형: 사거리(range)·조건으로 자동 판정 — 배치가 곧 시너지
 *  - 상위 구간이 하위 구간을 대체 (누적 아님)
 *  - 영웅 패시브 "시너지 +1 카운트"(강철 파멸기/도굴왕)는 extraClassCounts로 주입
 *  - 성령체(saint) 시너지는 오라 유닛의 버프 효과를 증폭
 *  - 위치 시너지(3단계): 모서리 수비(슬롯 조건) · 밀집 방진(2×2 같은 수트) — formation 그룹의 countBy로 판정
 *  - 오라(aura_*)는 effect.area 대로 실제 칸에 적용: adjacent=8방 인접, adjacent4=상하좌우, global=전체 (자기 자신 제외)
 *  - caps: 시너지+오라 합산 공격력/공속 상한 (업그레이드·영웅 패시브는 상한 밖)
 *
 * 순수 로직: 데이터 주입(DI), Phaser 의존 없음.
 */

import { type Suit } from './PokerEvaluator.ts';
import { type UnitClass, type UnitRace } from './SummonMapper.ts';
import { type DeployedUnit } from './Battle.ts';
import { isEdgeSlot, type TrackGeometry } from './Geometry.ts';

export type SynergyKind = 'suit' | 'class' | 'race' | 'formation';

export interface SynergyEffect {
  type: string;
  scope: 'suit' | 'class' | 'race' | 'formation' | 'global' | 'economy' | 'battle';
  pct?: number;
  amount?: number;
  /** line_attack_pct: 같은 행/열 아군 1기당 % */
  pctPerAlly?: number;
  /** line_attack_pct: 상한 % */
  max?: number;
  /** time_limit_plus / wave_start_stun: 초 */
  sec?: number;
  /** range_plus: 가장자리 칸에만 */
  onlyEdge?: boolean;
  /** range_mult_override: 대상 사거리 */
  range?: number;
  /** range_mult_override: 배율 */
  mult?: number;
}

export interface SynergyGroupDef {
  name: string;
  thresholds: number[];
  effects: SynergyEffect[][];
  /**
   * formation 전용 카운트 방식:
   *  'range' = 해당 사거리 유닛 기수 / 'condition' = 다른 진형 그룹 카운트 조건 /
   *  'slots' = 지정 슬롯이 전부 (requireRange 사거리의) 유닛으로 차 있으면 1 /
   *  'block2x2SameSuit' = 같은 수트 4기가 2×2 블록을 이룬 개수
   */
  countBy?: 'range' | 'condition' | 'slots' | 'block2x2SameSuit';
  range?: number;
  condition?: Record<string, number>;
  slots?: number[];
  requireRange?: number;
}

export interface SynergiesTable {
  suits: Record<string, SynergyGroupDef>;
  classes: Record<string, SynergyGroupDef>;
  races?: Record<string, SynergyGroupDef>;
  formation?: Record<string, SynergyGroupDef>;
  caps?: { attackPct?: number; attackSpeedPct?: number };
}

export interface ActiveSynergy {
  kind: SynergyKind;
  key: string;
  name: string;
  /** 현재 카운트 */
  count: number;
  /** 도달한 threshold. 미발동 그룹은 결과에 포함되지 않음 */
  reached: number;
}

/** 경제/전투 규칙에 적용되는 전역 시너지 (GameLoop/Battle이 소비) */
export interface GlobalSynergyMods {
  /** 웨이브 클리어 골드 +% (♦) */
  waveGoldPct: number;
  /** 웨이브 종료 시 라이프 회복 (♥6, 정령3) */
  lifePerWave: number;
  /** 처치 골드 +N (약탈자 4, 고블린) */
  killGoldBonus: number;
  /** 처치 시 확률 보너스 골드 (♦6) */
  bonusGoldChancePct: number;
  bonusGoldAmount: number;
  /** 웨이브 시작 시 골드 (고블린) */
  waveStartGold: number;
  /** 시간 초과 이탈 적 1기당 골드 (고블린 5) */
  leakGold: number;
  /** 웨이브 제한 시간 +초 (정령) */
  timeLimitPlus: number;
  /** 적 이동 속도 % (몬스터 4: -8) */
  enemySpeedPct: number;
  /** 웨이브 시작 시 적 기절 초 (몬스터 6) */
  waveStartStunSec: number;
  /** 사거리별 공격 배율 덮어쓰기 (후열 6: {"4": 0.9}) */
  rangeMultOverride: Record<string, number>;
}

export interface SynergyResult {
  active: ActiveSynergy[];
  global: GlobalSynergyMods;
}

export interface ApplyOptions {
  /** 영웅 패시브 등으로 인한 클래스 카운트 보정 (예: { destroyer: 1 }) */
  extraClassCounts?: Partial<Record<UnitClass, number>>;
  /** 영웅 종족 (종족 카운트 +1) */
  heroRace?: UnitRace;
  /** 라운드 내 업그레이드: 수트별 공격력 +% (예: { S: 12 }) */
  suitAttackUpgradePct?: Partial<Record<Suit, number>>;
  /** 슬롯 격자 (행/열·가장자리 판정). 기본 5×5 */
  geometry?: TrackGeometry;
}

const DEFAULT_GEOMETRY: TrackGeometry = { trackLength: 40, gridSize: 5 };

/** 오라 범위 안의 아군 (자기 자신 제외) */
export function auraTargets(src: DeployedUnit, area: string, units: DeployedUnit[], geo: TrackGeometry): DeployedUnit[] {
  if (area === 'global') return units.filter((u) => u !== src);
  const n = geo.gridSize;
  const r0 = Math.floor(src.slot / n), c0 = src.slot % n;
  const maxDist = area === 'adjacent4' ? 1 : 2; // adjacent4: 맨해튼 1, adjacent: 체비셰프 1
  return units.filter((u) => {
    if (u === src) return false;
    const dr = Math.abs(Math.floor(u.slot / n) - r0), dc = Math.abs((u.slot % n) - c0);
    return area === 'adjacent4' ? dr + dc === 1 : Math.max(dr, dc) === 1 && dr + dc <= maxDist;
  });
}

/** 오라 범위 슬롯 목록 (UI 표시용) */
export function auraSlots(slot: number, area: string, geo: TrackGeometry): number[] {
  const n = geo.gridSize;
  if (area === 'global') return Array.from({ length: n * n }, (_, i) => i).filter((i) => i !== slot);
  const r0 = Math.floor(slot / n), c0 = slot % n;
  const out: number[] = [];
  for (let i = 0; i < n * n; i++) {
    if (i === slot) continue;
    const dr = Math.abs(Math.floor(i / n) - r0), dc = Math.abs((i % n) - c0);
    if (area === 'adjacent4' ? dr + dc === 1 : Math.max(dr, dc) === 1) out.push(i);
  }
  return out;
}

export class SynergySystem {
  constructor(private table: SynergiesTable) {}

  /**
   * 유닛들의 보너스 필드를 재계산해서 채운다 (기존 값은 초기화 후 다시 계산).
   * @returns 활성 시너지 목록 + 전역(경제/전투) 시너지
   */
  apply(units: DeployedUnit[], options: ApplyOptions = {}): SynergyResult {
    const geo = options.geometry ?? DEFAULT_GEOMETRY;

    // 0) 초기화
    for (const u of units) {
      u.attackPctBonus = 0;
      u.attackSpeedPctBonus = 0;
      u.singleTargetPctBonus = 0;
      u.aoeRadiusPctBonus = 0;
      u.armorPierce = false;
      u.debuffDurationPctBonus = 0;
      u.extraSlowPct = 0;
      u.rangeBonus = 0;
    }
    const global: GlobalSynergyMods = {
      waveGoldPct: 0, lifePerWave: 0, killGoldBonus: 0, bonusGoldChancePct: 0, bonusGoldAmount: 0,
      waveStartGold: 0, leakGold: 0, timeLimitPlus: 0, enemySpeedPct: 0, waveStartStunSec: 0, rangeMultOverride: {},
    };
    const active: ActiveSynergy[] = [];

    // 1) 카운트
    const suitCounts = new Map<string, number>();
    const classCounts = new Map<string, Set<string>>();
    const raceCounts = new Map<string, number>();
    for (const u of units) {
      suitCounts.set(u.def.suit, (suitCounts.get(u.def.suit) ?? 0) + 1);
      (classCounts.get(u.def.class) ?? classCounts.set(u.def.class, new Set()).get(u.def.class)!).add(u.def.id);
      raceCounts.set(u.def.race, (raceCounts.get(u.def.race) ?? 0) + 1);
    }
    if (options.heroRace) raceCounts.set(options.heroRace, (raceCounts.get(options.heroRace) ?? 0) + 1);

    // 2) 발동 구간 판정 → 효과 수집
    const collect = (kind: SynergyKind, key: string, def: SynergyGroupDef, count: number, members: DeployedUnit[]): void => {
      let reachedIdx = -1;
      for (let i = 0; i < def.thresholds.length; i++) {
        if (count >= def.thresholds[i]) reachedIdx = i;
      }
      if (reachedIdx < 0) return;
      active.push({ kind, key, name: def.name, count, reached: def.thresholds[reachedIdx] });
      for (const eff of def.effects[reachedIdx]) {
        this.applyEffect(eff, kind, key, units, members, global, geo);
      }
    };

    for (const [key, def] of Object.entries(this.table.suits)) {
      collect('suit', key, def, suitCounts.get(key) ?? 0, units.filter((u) => u.def.suit === key));
    }
    for (const [key, def] of Object.entries(this.table.classes)) {
      const extra = options.extraClassCounts?.[key as UnitClass] ?? 0;
      collect('class', key, def, (classCounts.get(key)?.size ?? 0) + extra, units.filter((u) => u.def.class === key));
    }
    for (const [key, def] of Object.entries(this.table.races ?? {})) {
      collect('race', key, def, raceCounts.get(key) ?? 0, units.filter((u) => u.def.race === key));
    }
    // 진형: range 그룹 먼저(조건 그룹이 이 카운트를 참조)
    const formation = this.table.formation ?? {};
    const formationCounts = new Map<string, number>();
    for (const [key, def] of Object.entries(formation)) {
      if (def.countBy === 'range') {
        const members = units.filter((u) => u.def.range === def.range);
        formationCounts.set(key, members.length);
        collect('formation', key, def, members.length, members);
      }
    }
    for (const [key, def] of Object.entries(formation)) {
      if (def.countBy === 'condition') {
        const met = Object.entries(def.condition ?? {}).every(([k, n]) => (formationCounts.get(k) ?? 0) >= n);
        collect('formation', key, def, met ? 1 : 0, []);
      } else if (def.countBy === 'slots') {
        // 지정 슬롯이 전부 (사거리 조건을 만족하는) 유닛으로 차 있어야 발동
        const members = (def.slots ?? [])
          .map((sl) => units.find((u) => u.slot === sl))
          .filter((u): u is DeployedUnit => !!u && (def.requireRange === undefined || u.def.range === def.requireRange));
        const full = members.length === (def.slots ?? []).length && members.length > 0;
        collect('formation', key, def, full ? 1 : 0, full ? members : []);
      } else if (def.countBy === 'block2x2SameSuit') {
        const { blocks, members } = this.sameSuitBlocks(units, geo);
        collect('formation', key, def, blocks, members);
      }
    }

    // 3) 성령체 버프 증폭 배율 (오라 효과에 적용)
    const saintActive = active.find((a) => a.kind === 'class' && a.key === 'saint');
    const buffMult = saintActive
      ? 1 +
        (this.table.classes.saint.effects[
          this.table.classes.saint.thresholds.indexOf(saintActive.reached)
        ].find((e) => e.type === 'buff_effect_pct')?.pct ?? 0) / 100
      : 1;

    // 4) 오라 유닛 효과 — effect.area(adjacent/adjacent4/global) 범위의 아군에게, 성령체 배율 반영
    for (const src of units) {
      const eff = src.def.effect;
      if (!eff) continue;
      if (eff.type !== 'aura_attack_speed' && eff.type !== 'aura_attack_pct') continue;
      const pct = (eff.pct as number) * buffMult;
      for (const u of auraTargets(src, String(eff.area ?? 'global'), units, geo)) {
        if (eff.type === 'aura_attack_speed') u.attackSpeedPctBonus! += pct;
        else u.attackPctBonus! += pct;
      }
    }

    // 5) 시너지·오라 합산 상한 (docs/synergy-design.md 4장: 4축 곱연산 폭주 방지)
    const capA = this.table.caps?.attackPct;
    const capS = this.table.caps?.attackSpeedPct;
    for (const u of units) {
      if (capA !== undefined) u.attackPctBonus = Math.min(u.attackPctBonus!, capA);
      if (capS !== undefined) u.attackSpeedPctBonus = Math.min(u.attackSpeedPctBonus!, capS);
    }

    // 6) 라운드 내 수트 업그레이드 (상한 밖)
    if (options.suitAttackUpgradePct) {
      for (const u of units) {
        u.attackPctBonus! += options.suitAttackUpgradePct[u.def.suit] ?? 0;
      }
    }

    return { active, global };
  }

  /** 같은 수트 4기가 이루는 2×2 블록 수와 그 구성원(중복 제거) */
  private sameSuitBlocks(units: DeployedUnit[], geo: TrackGeometry): { blocks: number; members: DeployedUnit[] } {
    const n = geo.gridSize;
    const bySlot = new Map<number, DeployedUnit>();
    for (const u of units) bySlot.set(u.slot, u);
    const members = new Set<DeployedUnit>();
    let blocks = 0;
    for (let row = 0; row < n - 1; row++) {
      for (let col = 0; col < n - 1; col++) {
        const tl = row * n + col;
        const quad = [tl, tl + 1, tl + n, tl + n + 1].map((sl) => bySlot.get(sl));
        if (quad.some((u) => !u)) continue;
        const suit = quad[0]!.def.suit;
        if (!quad.every((u) => u!.def.suit === suit)) continue;
        blocks++;
        for (const u of quad) members.add(u!);
      }
    }
    return { blocks, members: [...members] };
  }

  private applyEffect(
    eff: SynergyEffect,
    kind: SynergyKind,
    key: string,
    units: DeployedUnit[],
    members: DeployedUnit[],
    global: GlobalSynergyMods,
    geo: TrackGeometry
  ): void {
    const targets =
      eff.scope === 'global' ? units
      : eff.scope === kind ? members
      : [];

    switch (eff.type) {
      case 'attack_pct':
        for (const u of targets) u.attackPctBonus! += eff.pct!;
        break;
      case 'attack_speed_pct':
        for (const u of targets) u.attackSpeedPctBonus! += eff.pct!;
        break;
      case 'single_target_pct':
        for (const u of targets) u.singleTargetPctBonus! += eff.pct!;
        break;
      case 'aoe_radius_pct':
        for (const u of targets) u.aoeRadiusPctBonus! += eff.pct!;
        break;
      case 'armor_pierce':
        for (const u of targets) u.armorPierce = true;
        break;
      case 'debuff_duration_pct':
        for (const u of targets) u.debuffDurationPctBonus! += eff.pct!;
        break;
      case 'extra_slow_pct':
        for (const u of targets) u.extraSlowPct! += eff.pct!;
        break;
      case 'range_plus':
        for (const u of targets) {
          if (eff.onlyEdge && !isEdgeSlot(geo, u.slot)) continue;
          u.rangeBonus! += eff.amount!;
        }
        break;
      case 'line_attack_pct': {
        // 같은 행 또는 같은 열에 있는 같은 그룹 아군 1기당 +pctPerAlly (자기 제외, 최대 max)
        const n = geo.gridSize;
        for (const u of targets) {
          const row = Math.floor(u.slot / n), col = u.slot % n;
          let allies = 0;
          for (const o of members) {
            if (o === u) continue;
            if (Math.floor(o.slot / n) === row || o.slot % n === col) allies++;
          }
          u.attackPctBonus! += Math.min(eff.max ?? Infinity, allies * (eff.pctPerAlly ?? 0));
        }
        break;
      }
      case 'buff_effect_pct':
        break; // apply()의 오라 단계에서 배율로 처리
      case 'wave_gold_pct':
        global.waveGoldPct += eff.pct!;
        break;
      case 'life_per_wave':
        global.lifePerWave += eff.amount!;
        break;
      case 'kill_gold_bonus':
        global.killGoldBonus += eff.amount!;
        break;
      case 'kill_bonus_gold_chance':
        global.bonusGoldChancePct += eff.pct!;
        global.bonusGoldAmount += eff.amount!;
        break;
      case 'wave_start_gold':
        global.waveStartGold += eff.amount!;
        break;
      case 'leak_gold':
        global.leakGold += eff.amount!;
        break;
      case 'time_limit_plus':
        global.timeLimitPlus += eff.sec!;
        break;
      case 'enemy_speed_pct':
        global.enemySpeedPct += eff.pct!;
        break;
      case 'wave_start_stun':
        global.waveStartStunSec = Math.max(global.waveStartStunSec, eff.sec!);
        break;
      case 'range_mult_override':
        global.rangeMultOverride[String(eff.range)] = eff.mult!;
        break;
      default:
        throw new Error(`Unknown synergy effect type: ${eff.type}`);
    }
  }
}
