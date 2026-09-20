import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SynergySystem, type SynergiesTable } from '../src/systems/SynergySystem.ts';
import { type DeployedUnit } from '../src/systems/Battle.ts';
import { type UnitDef } from '../src/systems/SummonMapper.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
const table: SynergiesTable = JSON.parse(readFileSync(join(dataDir, 'synergies.json'), 'utf8'));
const units: UnitDef[] = JSON.parse(readFileSync(join(dataDir, 'units.json'), 'utf8')).units;

const unit = (id: string): UnitDef => units.find((u) => u.id === id)!;
const deploy = (...ids: string[]): DeployedUnit[] => ids.map((id) => ({ def: unit(id) }));
const sys = () => new SynergySystem(table);

describe('synergies.json 무결성', () => {
  it('수트 4종 + 클래스 5종, thresholds와 effects 길이 일치', () => {
    expect(Object.keys(table.suits).length).toBe(4);
    expect(Object.keys(table.classes).length).toBe(5);
    for (const g of [...Object.values(table.suits), ...Object.values(table.classes)]) {
      expect(g.effects.length).toBe(g.thresholds.length);
    }
  });

  it('units.json의 모든 클래스가 synergies.json에 존재', () => {
    for (const u of units) {
      expect(table.classes[u.class] !== undefined).toBe(true);
    }
  });
});

describe('수트 시너지 — 2/4/6 구간', () => {
  it('♠ 1기: 미발동', () => {
    const squad = deploy('spear_striker');
    const r = sys().apply(squad);
    expect(r.active.filter((a) => a.key === 'S').length).toBe(0);
    expect(squad[0].attackPctBonus).toBe(0);
  });

  it('♠ 2종: 공격력 +10% (♠ 유닛에만)', () => {
    const squad = deploy('spear_striker', 'twin_axe_warrior', 'imp');
    const r = sys().apply(squad);
    const s = r.active.find((a) => a.key === 'S')!;
    expect(s.reached).toBe(2);
    expect(squad[0].attackPctBonus).toBe(10);
    expect(squad[1].attackPctBonus).toBe(10);
    expect(squad[2].attackPctBonus).toBe(0); // ♣ 임프는 제외
  });

  it('수트는 기수 카운트: 같은 유닛 3기도 ♠3 → 2구간 발동', () => {
    const squad = deploy('spear_striker', 'spear_striker', 'spear_striker');
    const r = sys().apply(squad);
    expect(r.active.find((a) => a.key === 'S')!.reached).toBe(2);
    expect(r.active.find((a) => a.key === 'S')!.count).toBe(3);
  });

  it('클래스는 종류 카운트: 같은 유닛 중복은 1 (합성 유도)', () => {
    // 쌍도끼 전사(destroyer) 3기 → 종류 1 → 파괴병기 미발동
    const squad = deploy('twin_axe_warrior', 'twin_axe_warrior', 'twin_axe_warrior');
    const r = sys().apply(squad);
    expect(r.active.filter((a) => a.key === 'destroyer').length).toBe(0);
  });

  it('♠ 6기(중복 포함): 6구간 방어 관통 발동', () => {
    const squad = deploy('spear_striker', 'spear_striker', 'twin_axe_warrior', 'crusher_rider', 'blacksteel_knight', 'steel_colossus');
    const r = sys().apply(squad);
    expect(r.active.find((a) => a.key === 'S')!.reached).toBe(6);
    expect(squad[0].armorPierce).toBe(true);
    expect(squad[0].attackPctBonus).toBe(25);
  });

  it('♠ 4종: +25%로 대체 (누적 아님)', () => {
    const squad = deploy('spear_striker', 'twin_axe_warrior', 'crusher_rider', 'blacksteel_knight');
    sys().apply(squad);
    expect(squad[0].attackPctBonus).toBe(25);
  });

  it('♠ 5기(5종 전원): 4구간 유지, 6구간은 아직', () => {
    const squad = deploy('spear_striker', 'twin_axe_warrior', 'crusher_rider', 'blacksteel_knight', 'steel_colossus');
    const r = sys().apply(squad);
    expect(r.active.find((a) => a.key === 'S')!.reached).toBe(4);
    expect(squad[0].armorPierce).toBe(false);
  });

  it('♥ 시너지: 전체 공속 (수트 무관 전 유닛)', () => {
    const squad = deploy('novice_priest', 'choir_singer', 'spear_striker');
    sys().apply(squad);
    // ♥2 시너지 global 공속 +8, 그리고 두 오라 유닛(공속+3, 공격+8)이 성령체 2시너지 ×1.25 증폭
    expect(squad[2].attackSpeedPctBonus! > 8).toBe(true);
  });

  it('♦ 시너지: 경제 전역 효과 (waveGoldPct)', () => {
    const squad = deploy('miner', 'coin_thrower');
    const r = sys().apply(squad);
    expect(r.global.waveGoldPct).toBe(10);
  });
});

describe('클래스 시너지 — 수트 교차 혼합 빌드', () => {
  it('약탈자 2종(♠창격병 + ♦광부): 전체 공속 +8%', () => {
    const squad = deploy('spear_striker', 'miner');
    const r = sys().apply(squad);
    expect(r.active.find((a) => a.key === 'raider')!.reached).toBe(2);
    expect(squad[0].attackSpeedPctBonus).toBe(8);
    expect(squad[1].attackSpeedPctBonus).toBe(8);
  });

  it('약탈자 4종: 공속 +18% + 처치 골드 +1', () => {
    const squad = deploy('spear_striker', 'miner', 'coin_thrower', 'imp');
    const r = sys().apply(squad);
    expect(r.global.killGoldBonus).toBe(1);
    expect(squad[0].attackSpeedPctBonus).toBe(18);
  });

  it('파괴병기: 단일 피해 보너스는 해당 클래스에만', () => {
    const squad = deploy('twin_axe_warrior', 'blacksteel_knight', 'imp');
    sys().apply(squad);
    expect(squad[0].singleTargetPctBonus).toBe(12);
    expect(squad[1].singleTargetPctBonus).toBe(12);
    expect(squad[2].singleTargetPctBonus).toBe(0);
  });

  it('초월체 2종: 광역 반경 +15%', () => {
    const squad = deploy('steel_colossus', 'abyss_dragon');
    sys().apply(squad);
    expect(squad[0].aoeRadiusPctBonus).toBe(15);
  });

  it('술법체 4종: 디버프 지속 +30% + 추가 감속 -10%', () => {
    const squad = deploy('flame_caster', 'skull_shaman', 'thunder_lord', 'gem_shooter');
    sys().apply(squad);
    expect(squad[1].debuffDurationPctBonus).toBe(30);
    expect(squad[1].extraSlowPct).toBe(10);
  });
});

describe('영웅 패시브: 클래스 카운트 +1 (강철 파멸기/도굴왕)', () => {
  it('파괴병기 1종 + 영웅 보정 +1 → 2구간 발동', () => {
    const squad = deploy('blacksteel_knight');
    const r = sys().apply(squad, { extraClassCounts: { destroyer: 1 } });
    expect(r.active.find((a) => a.key === 'destroyer')!.reached).toBe(2);
    expect(squad[0].singleTargetPctBonus).toBe(12);
  });
});

describe('성령체 버프 증폭 — 오라 효과 배율', () => {
  it('성령체 2시너지: 오라 pct ×1.25', () => {
    // 견습 사제(오라 공속+3) + 성가대원(오라 공격+8) → saint 2종 발동
    const squad = deploy('novice_priest', 'choir_singer');
    sys().apply(squad);
    // 공속: ♥2 global 8 + 오라 3×1.25 = 11.75
    expect(Math.abs(squad[0].attackSpeedPctBonus! - 11.75) < 0.01).toBe(true);
    // 공격: 오라 8×1.25 = 10
    expect(Math.abs(squad[0].attackPctBonus! - 10) < 0.01).toBe(true);
  });

  it('성령체 미발동이면 오라는 원래 수치', () => {
    const squad = deploy('novice_priest', 'spear_striker');
    sys().apply(squad);
    expect(squad[1].attackSpeedPctBonus).toBe(3); // 오라만, 증폭 없음
  });
});

describe('라운드 내 수트 업그레이드 주입', () => {
  it('suitAttackUpgradePct가 해당 수트에만 합산', () => {
    const squad = deploy('spear_striker', 'imp');
    sys().apply(squad, { suitAttackUpgradePct: { S: 12 } });
    expect(squad[0].attackPctBonus).toBe(12);
    expect(squad[1].attackPctBonus).toBe(0);
  });
});

describe('재계산 안전성', () => {
  it('apply를 여러 번 호출해도 보너스가 누적되지 않는다', () => {
    const squad = deploy('spear_striker', 'twin_axe_warrior');
    const s = sys();
    s.apply(squad);
    s.apply(squad);
    s.apply(squad);
    expect(squad[0].attackPctBonus).toBe(10);
  });
});
