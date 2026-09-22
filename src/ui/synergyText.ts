/**
 * synergies.json → 사람이 읽는 설명 (도감·툴팁). Phaser 의존 없음 (테스트 가능).
 */
import type { SynergyEffect, SynergyGroupDef, SynergyKind } from '../systems/SynergySystem.ts';
import { CLASS_NAME, RACE_NAME, SUIT_NAME, SUIT_SYMBOL } from './theme.ts';
import type { Suit } from '../systems/PokerEvaluator.ts';

export const KIND_LABEL: Record<SynergyKind, string> = { suit: '진영', class: '역할', race: '종족', formation: '진형' };

/** 그룹 표시 이름 (수트는 기호+이름) */
export function groupTitle(kind: SynergyKind, key: string, def: SynergyGroupDef): string {
  if (kind === 'suit') return `${SUIT_SYMBOL[key as Suit]} ${def.name}`;
  return def.name;
}

/** 카운트 단위: 수트·종족·진형(사거리)은 "기", 클래스는 "종", 조건형은 "완성" */
export function countLabel(kind: SynergyKind, def: SynergyGroupDef, count: number): string {
  if (kind === 'class') return `${count}종`;
  if (kind === 'formation') {
    if (def.countBy === 'lines') return `${count}줄`;
    if (def.countBy === 'block2x2SameSuit') return `${count}블록`;
    if (def.countBy === 'condition' || def.countBy === 'slots') return count >= 1 ? '완성' : '미완성';
  }
  return `${count}기`;
}

/** 발동 조건 설명 (그룹 부제) */
export function groupCondition(kind: SynergyKind, key: string, def: SynergyGroupDef): string {
  switch (kind) {
    case 'suit': return `${SUIT_NAME[key as Suit]} 유닛 기수 (중복 포함)`;
    case 'class': return '서로 다른 유닛 종류 수 (같은 유닛 중복은 1)';
    case 'race': return `${RACE_NAME[key] ?? key} 유닛 기수 + 영웅`;
    case 'formation':
      switch (def.countBy) {
        case 'range': return def.rangeMin !== undefined ? `사거리 ${def.rangeMin} 이상 유닛 기수 (영웅 포함)` : `사거리 ${def.range} 유닛 기수 (영웅 포함)`;
        case 'condition': return Object.entries(def.condition ?? {}).map(([k, n]) => `${FORMATION_REF[k] ?? k} ${n}기 이상`).join(' + ');
        case 'slots': return `모서리 ${def.slots?.length ?? 4}칸이 전부${def.requireRange ? ` 사거리 ${def.requireRange}` : ''} 유닛`;
        case 'block2x2SameSuit': return '같은 수트 4기가 2×2 블록 (블록마다 카운트)';
        case 'lines': return `같은 ${def.matchBy === 'race' ? '종족' : '수트'} 5기가 가로·세로·대각 한 줄 (줄마다 카운트)`;
        default: return '';
      }
  }
}
const FORMATION_REF: Record<string, string> = { melee: '근접(사거리 2)', ranged: '원거리(사거리 4)', mid: '중거리(사거리 3)' };

/** 구간 라벨: "3기" / "2종" / "1줄" / "완성" */
export function thresholdLabel(kind: SynergyKind, def: SynergyGroupDef, threshold: number): string {
  if (kind === 'formation' && (def.countBy === 'condition' || def.countBy === 'slots')) return '완성';
  return countLabel(kind, def, threshold);
}

function scopeLabel(eff: SynergyEffect, kind: SynergyKind, key: string): string {
  switch (eff.scope) {
    case 'global': return '전체';
    case 'suit': return `${SUIT_SYMBOL[key as Suit]} 유닛`;
    case 'class': return `${CLASS_NAME[key] ?? key} 유닛`;
    case 'race': return `${RACE_NAME[key] ?? key} 유닛`;
    case 'formation': return kind === 'formation' ? '해당 유닛' : '진형 유닛';
    default: return '';
  }
}

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** 효과 1개 설명 */
export function describeEffect(eff: SynergyEffect, kind: SynergyKind, key: string): string {
  const who = scopeLabel(eff, kind, key);
  switch (eff.type) {
    case 'attack_pct': return `${who} 공격력 ${sign(eff.pct!)}%`;
    case 'attack_speed_pct': return `${who} 공속 ${sign(eff.pct!)}%`;
    case 'single_target_pct': return `${who} 단일 피해 ${sign(eff.pct!)}%`;
    case 'aoe_radius_pct': return `${who} 광역 범위 ${sign(eff.pct!)}%`;
    case 'armor_pierce': return `${who} 물리 저항 무시`;
    case 'debuff_duration_pct': return `${who} 디버프 지속 ${sign(eff.pct!)}%`;
    case 'extra_slow_pct': return `${who} 감속 추가 -${eff.pct}%`;
    case 'buff_effect_pct': return `오라 버프 효과 ${sign(eff.pct!)}%`;
    case 'wave_gold_pct': return `웨이브 클리어 골드 ${sign(eff.pct!)}%`;
    case 'life_per_wave': return `웨이브 종료 시 하트 +${eff.amount}`;
    case 'kill_gold_bonus': return `처치 골드 +${eff.amount}`;
    case 'kill_bonus_gold_chance': return `처치 시 ${eff.pct}% 확률로 골드 +${eff.amount}`;
    case 'wave_start_gold': return `웨이브 시작 시 골드 +${eff.amount}`;
    case 'leak_gold': return `시간 초과 이탈 적 1기당 골드 +${eff.amount}`;
    case 'time_limit_plus': return `웨이브 제한 시간 +${eff.sec}초`;
    case 'enemy_speed_pct': return `적 이동 속도 ${sign(eff.pct!)}%`;
    case 'wave_start_stun': return `웨이브 시작 시 적 전체 ${eff.sec}초 기절`;
    case 'range_plus': return `${who} 사거리 +${eff.amount}${eff.onlyEdge ? ' (가장자리 칸만)' : ''}`;
    case 'range_mult_override': return `사거리 ${eff.range} 공격 배율 → ×${eff.mult}`;
    case 'line_attack_pct': return `같은 행·열의 ${who} 1기당 공격력 +${eff.pctPerAlly}% (최대 +${eff.max}%)`;
    case 'per_line_attack_pct': return `줄 구성원 공격력 +${eff.pct}% × 속한 줄 수 (교차점 중첩)`;
    case 'per_line_attack_speed_pct': return `줄 구성원 공속 +${eff.pct}% × 속한 줄 수`;
    default: return eff.type;
  }
}

/** 구간 효과 묶음 설명 */
export function describeTier(effects: SynergyEffect[], kind: SynergyKind, key: string): string {
  return effects.map((e) => describeEffect(e, kind, key)).join(' · ');
}
