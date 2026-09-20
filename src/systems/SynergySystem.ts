/**
 * SynergySystem — 필드 유닛의 수트/클래스 구성을 세서 시너지 버프를 계산하고
 * DeployedUnit의 보너스 필드를 채운다 (Battle이 그대로 소비).
 *
 * GDD 3.2/3.2.2 근거:
 *  - 2축 시너지: 수트(2/4/6기) + 클래스(2/4기)
 *  - 수트 카운트는 "필드 위 같은 수트 유닛 수" (중복 포함 — 3.2),
 *    클래스 카운트는 "서로 다른 유닛 종류" 기준 (중복은 1 — 3.2.2, 합성 유도)
 *    ※ 수트당 유닛이 5종뿐이므로 종류 기준으로는 6구간이 불가능하다.
 *  - 상위 구간이 하위 구간을 대체 (누적 아님)
 *  - 영웅 패시브 "시너지 +1 카운트"(강철 파멸기/도굴왕)는 extraClassCounts로 주입
 *  - 성령체(saint) 시너지는 오라 유닛의 버프 효과를 증폭
 *  - 오라(aura_*) 효과 MVP 규칙: 위치 개념 없이 전체 유닛에 적용
 *    (씬에서 그리드 도입 시 adjacent 계산으로 교체 예정)
 *
 * 순수 로직: 데이터 주입(DI), Phaser 의존 없음.
 */

import { type Suit } from './PokerEvaluator.ts';
import { type UnitClass } from './SummonMapper.ts';
import { type DeployedUnit } from './Battle.ts';

export interface SynergyEffect {
  type: string;
  scope: 'suit' | 'class' | 'global' | 'economy';
  pct?: number;
  amount?: number;
}

export interface SynergyGroupDef {
  name: string;
  thresholds: number[];
  effects: SynergyEffect[][];
}

export interface SynergiesTable {
  suits: Record<string, SynergyGroupDef>;
  classes: Record<string, SynergyGroupDef>;
}

export interface ActiveSynergy {
  kind: 'suit' | 'class';
  key: string;
  name: string;
  /** 현재 카운트 (서로 다른 유닛 종류 수 + 영웅 보정) */
  count: number;
  /** 도달한 threshold (예: 4). 미발동 그룹은 결과에 포함되지 않음 */
  reached: number;
}

/** 경제/라운드 규칙에 적용되는 전역 시너지 (GameLoop이 소비) */
export interface GlobalSynergyMods {
  /** 웨이브 클리어 골드 +% (♦) */
  waveGoldPct: number;
  /** 웨이브 종료 시 라이프 회복 (♥6) */
  lifePerWave: number;
  /** 처치 골드 +N (약탈자 4) */
  killGoldBonus: number;
  /** 처치 시 확률 보너스 골드 (♦6) */
  bonusGoldChancePct: number;
  bonusGoldAmount: number;
}

export interface SynergyResult {
  active: ActiveSynergy[];
  global: GlobalSynergyMods;
}

export interface ApplyOptions {
  /** 영웅 패시브 등으로 인한 클래스 카운트 보정 (예: { destroyer: 1 }) */
  extraClassCounts?: Partial<Record<UnitClass, number>>;
  /** 라운드 내 업그레이드: 수트별 공격력 +% (예: { S: 12 }) */
  suitAttackUpgradePct?: Partial<Record<Suit, number>>;
}

export class SynergySystem {
  constructor(private table: SynergiesTable) {}

  /**
   * 유닛들의 보너스 필드를 재계산해서 채운다 (기존 값은 초기화 후 다시 계산).
   * @returns 활성 시너지 목록 + 전역(경제) 시너지
   */
  apply(units: DeployedUnit[], options: ApplyOptions = {}): SynergyResult {
    // 0) 초기화
    for (const u of units) {
      u.attackPctBonus = 0;
      u.attackSpeedPctBonus = 0;
      u.singleTargetPctBonus = 0;
      u.aoeRadiusPctBonus = 0;
      u.armorPierce = false;
      u.debuffDurationPctBonus = 0;
      u.extraSlowPct = 0;
    }
    const global: GlobalSynergyMods = {
      waveGoldPct: 0,
      lifePerWave: 0,
      killGoldBonus: 0,
      bonusGoldChancePct: 0,
      bonusGoldAmount: 0,
    };
    const active: ActiveSynergy[] = [];

    // 1) 카운트: 수트 = 유닛 기수(중복 포함), 클래스 = 서로 다른 유닛 종류
    const suitCounts = new Map<string, number>();
    const classCounts = new Map<string, Set<string>>();
    for (const u of units) {
      suitCounts.set(u.def.suit, (suitCounts.get(u.def.suit) ?? 0) + 1);
      (classCounts.get(u.def.class) ?? classCounts.set(u.def.class, new Set()).get(u.def.class)!).add(u.def.id);
    }

    // 2) 발동 구간 판정 → 효과 수집
    const collect = (
      kind: 'suit' | 'class',
      key: string,
      def: SynergyGroupDef,
      count: number
    ): void => {
      let reachedIdx = -1;
      for (let i = 0; i < def.thresholds.length; i++) {
        if (count >= def.thresholds[i]) reachedIdx = i;
      }
      if (reachedIdx < 0) return;
      active.push({ kind, key, name: def.name, count, reached: def.thresholds[reachedIdx] });
      for (const eff of def.effects[reachedIdx]) {
        this.applyEffect(eff, kind, key, units, global);
      }
    };

    for (const [key, def] of Object.entries(this.table.suits)) {
      collect('suit', key, def, suitCounts.get(key) ?? 0);
    }
    for (const [key, def] of Object.entries(this.table.classes)) {
      const extra = options.extraClassCounts?.[key as UnitClass] ?? 0;
      collect('class', key, def, (classCounts.get(key)?.size ?? 0) + extra);
    }

    // 3) 성령체 버프 증폭 배율 (오라 효과에 적용)
    const saintActive = active.find((a) => a.kind === 'class' && a.key === 'saint');
    const buffMult = saintActive
      ? 1 +
        (this.table.classes.saint.effects[
          this.table.classes.saint.thresholds.indexOf(saintActive.reached)
        ].find((e) => e.type === 'buff_effect_pct')?.pct ?? 0) / 100
      : 1;

    // 4) 오라 유닛 효과 (MVP: 전체 적용) — 성령체 배율 반영
    for (const src of units) {
      const eff = src.def.effect;
      if (!eff) continue;
      if (eff.type === 'aura_attack_speed') {
        const pct = (eff.pct as number) * buffMult;
        for (const u of units) u.attackSpeedPctBonus! += pct;
      } else if (eff.type === 'aura_attack_pct') {
        const pct = (eff.pct as number) * buffMult;
        for (const u of units) u.attackPctBonus! += pct;
      }
    }

    // 5) 라운드 내 수트 업그레이드
    if (options.suitAttackUpgradePct) {
      for (const u of units) {
        u.attackPctBonus! += options.suitAttackUpgradePct[u.def.suit] ?? 0;
      }
    }

    return { active, global };
  }

  private applyEffect(
    eff: SynergyEffect,
    kind: 'suit' | 'class',
    key: string,
    units: DeployedUnit[],
    global: GlobalSynergyMods
  ): void {
    const targets =
      eff.scope === 'global'
        ? units
        : eff.scope === 'suit'
          ? units.filter((u) => u.def.suit === key)
          : eff.scope === 'class'
            ? units.filter((u) => u.def.class === key)
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
      default:
        throw new Error(`Unknown synergy effect type: ${eff.type}`);
    }
  }
}
