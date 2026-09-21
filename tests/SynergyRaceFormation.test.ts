/**
 * 종족·진형 시너지 (docs/synergy-design.md 1~2단계)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SynergySystem, auraTargets, auraSlots, type SynergiesTable } from '../src/systems/SynergySystem.ts';
import { Battle, type DeployedUnit, type WaveDef, type BattleConfig, type EnemyTypeDef } from '../src/systems/Battle.ts';
import { GameLoop, type GameData, type GamePhase } from '../src/systems/GameLoop.ts';
import { type UnitDef, type UnitRace } from '../src/systems/SummonMapper.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
const load = (f: string) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
const table: SynergiesTable = load('synergies.json');
const unitsJson = load('units.json');
const wavesJson = load('waves.json');
const heroesJson = load('heroes.json');
const units: UnitDef[] = unitsJson.units;
const config: BattleConfig = wavesJson.config;
const enemyTypes: Record<string, EnemyTypeDef> = wavesJson.enemyTypes;

const unit = (id: string): UnitDef => units.find((u) => u.id === id)!;
/** [id, slot] 쌍으로 배치 */
const place = (...pairs: [string, number][]): DeployedUnit[] => pairs.map(([id, slot]) => ({ def: unit(id), slot }));
const sys = () => new SynergySystem(table);
const active = (r: ReturnType<SynergySystem['apply']>, kind: string, key: string) => r.active.find((a) => a.kind === kind && a.key === key);

describe('데이터 무결성', () => {
  it('유닛 20종·영웅 8종 모두 race가 4종 중 하나', () => {
    const races: UnitRace[] = ['human', 'goblin', 'monster', 'spirit'];
    for (const u of units) expect(races).toContain(u.race);
    for (const h of heroesJson.heroes) expect(races).toContain(h.race);
  });
  it('종족은 수트와 다른 방향으로 잘려 있다 (각 종족이 2개 이상 수트에 걸침, 정령 제외)', () => {
    for (const r of ['human', 'goblin', 'monster']) {
      const suits = new Set(units.filter((u) => u.race === r).map((u) => u.suit));
      expect(suits.size).toBeGreaterThanOrEqual(2);
    }
  });
  it('synergies.json에 races 4종·formation 4종·caps 존재', () => {
    expect(Object.keys(table.races!)).toEqual(['human', 'goblin', 'monster', 'spirit']);
    expect(Object.keys(table.formation!)).toEqual(['melee', 'ranged', 'mid', 'mixed', 'corners', 'block', 'bingo']);
    expect(table.caps!.attackPct).toBe(120);
  });
});

describe('종족 — 휴먼 「대열」', () => {
  it('3기: 같은 행/열의 휴먼 수만큼 공격력 (+4%/기, 최대 16)', () => {
    // 슬롯 0,1,2 = 같은 행. 창격병 3기
    const us = place(['spear_striker', 0], ['spear_striker', 1], ['spear_striker', 2]);
    const r = sys().apply(us);
    expect(active(r, 'race', 'human')?.reached).toBe(3);
    // 각자 같은 행 아군 2기 → +8%. (♠3 시너지 +10%, 전열 3 +10% 도 같이 붙음)
    const suitPct = 10, meleePct = 10;
    for (const u of us) expect(u.attackPctBonus).toBeCloseTo(8 + suitPct + meleePct);
  });
  it('행/열이 다르면 대열 보너스 없음', () => {
    // 0(행0,열0), 6(행1,열1), 12(행2,열2) — 서로 다른 행·열
    const us = place(['spear_striker', 0], ['spear_striker', 6], ['spear_striker', 12]);
    sys().apply(us);
    for (const u of us) expect(u.attackPctBonus).toBeCloseTo(10 + 10); // 수트+전열만
  });
  it('7기: 가장자리 칸 휴먼만 사거리 +1', () => {
    const ids = ['spear_striker', 'twin_axe_warrior', 'crusher_rider', 'blacksteel_knight', 'novice_priest', 'choir_singer', 'cathedral_knight'];
    const us = place(...ids.map((id, i) => [id, i === 6 ? 12 : i] as [string, number])); // 마지막은 중앙(12)
    const r = sys().apply(us);
    expect(active(r, 'race', 'human')?.reached).toBe(7);
    for (const u of us) expect(u.rangeBonus).toBe(u.slot === 12 ? 0 : 1);
  });
  it('영웅은 종족 카운트에 포함되고 종족 효과도 받는다 (수트·클래스 카운트는 제외)', () => {
    const us = place(['spear_striker', 0], ['spear_striker', 1]);
    expect(active(sys().apply(us), 'race', 'human')).toBeUndefined();
    const hero: DeployedUnit = { def: { ...unit('spear_striker'), id: 'hero_x', name: '영웅', tier: 6 }, slot: 2 };
    const r = sys().apply(us, { hero });
    expect(active(r, 'race', 'human')?.count).toBe(3);
    // 대열: 영웅(슬롯 2)은 같은 행 휴먼 2기 → +8
    expect(hero.attackPctBonus).toBeGreaterThanOrEqual(8);
    // 수트 카운트는 영웅 제외: ♠2 (영웅 포함이면 3)
    expect(active(r, 'suit', 'S')?.count).toBe(2);
  });
});

describe('종족 — 고블린 / 몬스터 / 정령', () => {
  it('고블린 3: 처치 골드 +1, 웨이브 시작 골드 +10 / 5: 공속 +15, 이탈 골드 8', () => {
    const three = place(['miner', 0], ['imp', 1], ['coin_thrower', 2]);
    const r3 = sys().apply(three);
    expect(r3.global.killGoldBonus).toBe(1);
    expect(r3.global.waveStartGold).toBe(10);
    expect(r3.global.leakGold).toBe(0);
    const five = place(['miner', 0], ['imp', 1], ['coin_thrower', 2], ['gem_shooter', 3], ['flame_caster', 4]);
    const r5 = sys().apply(five);
    expect(r5.global.leakGold).toBe(8);
    expect(five[0].attackSpeedPctBonus).toBeGreaterThanOrEqual(15);
  });
  it('몬스터 2/4/6: 광역 +15 → 적 이속 -8 → 시작 기절 3초', () => {
    const m = ['steel_colossus', 'vault_golem', 'golden_wyrm', 'skull_shaman', 'thunder_lord', 'abyss_dragon'];
    const r2 = sys().apply(place([m[0], 0], [m[1], 1]));
    expect(r2.global.enemySpeedPct).toBe(0);
    const r4 = sys().apply(place(...m.slice(0, 4).map((id, i) => [id, i] as [string, number])));
    expect(r4.global.enemySpeedPct).toBe(-8);
    expect(r4.global.waveStartStunSec).toBe(0);
    const r6 = sys().apply(place(...m.map((id, i) => [id, i] as [string, number])));
    expect(r6.global.waveStartStunSec).toBe(3);
  });
  it('정령 2: 제한 시간 +4 / 3(영웅 포함): +8, 라이프 회복 1', () => {
    const us = place(['light_healer', 0], ['seraphim', 1]);
    expect(sys().apply(us).global.timeLimitPlus).toBe(4);
    const spiritHero: DeployedUnit = { def: { ...unit('seraphim'), id: 'hero_s', tier: 6 }, slot: 12 };
    const r3 = sys().apply(us, { hero: spiritHero });
    expect(r3.global.timeLimitPlus).toBe(8);
    expect(r3.global.lifePerWave).toBeGreaterThanOrEqual(1);
  });
});

describe('진형 — 사거리 자동 판정', () => {
  it('전열(근접 3): 근접만 공격 +10 / 6: +20 + 사거리 +1', () => {
    const three = place(['spear_striker', 0], ['miner', 1], ['twin_axe_warrior', 2]);
    const r = sys().apply(three);
    expect(active(r, 'formation', 'melee')?.reached).toBe(3);
    const six = place(['spear_striker', 0], ['miner', 1], ['twin_axe_warrior', 2], ['crusher_rider', 3], ['vault_golem', 4], ['cathedral_knight', 5]);
    sys().apply(six);
    for (const u of six) expect(u.rangeBonus).toBe(1);
  });
  it('후열(원거리 3): 공속 +10 / 6: 사거리 4 배율 0.9 덮어쓰기', () => {
    const ranged4 = units.filter((u) => u.range === 4).map((u) => u.id);
    expect(ranged4.length).toBeGreaterThanOrEqual(6);
    const three = place(...ranged4.slice(0, 3).map((id, i) => [id, i] as [string, number]));
    const r3 = sys().apply(three);
    expect(active(r3, 'formation', 'ranged')?.reached).toBe(3);
    expect(r3.global.rangeMultOverride['4']).toBeUndefined();
    const six = place(...ranged4.slice(0, 6).map((id, i) => [id, i] as [string, number]));
    expect(sys().apply(six).global.rangeMultOverride['4']).toBe(0.9);
  });
  it('전후열 완성: 근접 3 + 원거리 3 이면 전체 공격 +8·공속 +5', () => {
    const ranged4 = units.filter((u) => u.range === 4).slice(0, 3).map((u) => u.id);
    const us = place(['spear_striker', 0], ['miner', 1], ['imp', 2], ...ranged4.map((id, i) => [id, 5 + i] as [string, number]));
    // imp는 사거리 3 → 근접 2기뿐 → 미발동
    const r = sys().apply(us);
    expect(active(r, 'formation', 'mixed')).toBeUndefined();
    us[2] = { def: unit('twin_axe_warrior'), slot: 2 };
    const r2 = sys().apply(us);
    expect(active(r2, 'formation', 'mixed')?.reached).toBe(1);
  });
  it('시너지+오라 합산은 caps(공격 120/공속 70)를 넘지 않는다', () => {
    const us = place(...['spear_striker', 'twin_axe_warrior', 'crusher_rider', 'blacksteel_knight', 'spear_striker', 'spear_striker', 'spear_striker'].map((id, i) => [id, i] as [string, number]));
    sys().apply(us);
    for (const u of us) {
      expect(u.attackPctBonus!).toBeLessThanOrEqual(120);
      expect(u.attackSpeedPctBonus!).toBeLessThanOrEqual(70);
    }
  });
});

describe('위치 시너지 (3단계)', () => {
  it('모서리 수비: 모서리 4칸(0,4,20,24)이 전부 근접이면 그 4기 공격 +15', () => {
    const corners = place(['spear_striker', 0], ['twin_axe_warrior', 4], ['miner', 20], ['crusher_rider', 24]);
    const r = sys().apply(corners);
    expect(active(r, 'formation', 'corners')?.reached).toBe(1);
    // 슬롯 0 창격병: ♠3 +10, 전열 4→3구간 +10, 휴먼 3 대열(같은 행 4번 창격병? 아니 쌍도끼) … 모서리 +15 포함 여부만 확인
    const without = place(['spear_striker', 0], ['twin_axe_warrior', 4], ['miner', 20], ['crusher_rider', 23]); // 24 비움
    const r2 = sys().apply(without);
    expect(active(r2, 'formation', 'corners')).toBeUndefined();
    expect(corners[0].attackPctBonus! - without[0].attackPctBonus!).toBeCloseTo(15);
  });
  it('모서리에 원거리가 있으면 발동 안 함 (requireRange 2)', () => {
    const us = place(['spear_striker', 0], ['twin_axe_warrior', 4], ['miner', 20], ['coin_thrower', 24]);
    expect(active(sys().apply(us), 'formation', 'corners')).toBeUndefined();
  });
  it('밀집 방진: 같은 수트 4기가 2×2를 이루면 그 4기 공격 +10, 블록 수만큼 카운트', () => {
    const block = place(['spear_striker', 0], ['spear_striker', 1], ['twin_axe_warrior', 5], ['crusher_rider', 6]);
    const r = sys().apply(block);
    expect(active(r, 'formation', 'block')?.count).toBe(1);
    const mixed = place(['spear_striker', 0], ['spear_striker', 1], ['twin_axe_warrior', 5], ['miner', 6]); // ♦ 섞임
    expect(active(sys().apply(mixed), 'formation', 'block')).toBeUndefined();
    // 같은 구성인데 위치만 흩어지면(0,1,5,7) 블록이 아님 → 차이는 방진 +10 뿐이어야 한다
    const scattered = place(['spear_striker', 0], ['spear_striker', 1], ['twin_axe_warrior', 5], ['crusher_rider', 7]);
    expect(active(sys().apply(scattered), 'formation', 'block')).toBeUndefined();
    // 슬롯 5 쌍도끼: 대열(같은 열 0) 등 다른 축은 두 배치에서 동일
    expect(block[2].attackPctBonus! - scattered[2].attackPctBonus!).toBeCloseTo(10);
    // 2×3 → 블록 2개
    const two = place(['spear_striker', 0], ['spear_striker', 1], ['spear_striker', 2], ['twin_axe_warrior', 5], ['crusher_rider', 6], ['blacksteel_knight', 7]);
    expect(active(sys().apply(two), 'formation', 'block')?.count).toBe(2);
  });
  it('인접 오라: adjacent=8방, adjacent4=상하좌우, global=전체, 자기 제외', () => {
    const geo = { trackLength: 40, gridSize: 5 };
    expect(auraSlots(12, 'adjacent', geo).sort((a, b) => a - b)).toEqual([6, 7, 8, 11, 13, 16, 17, 18]);
    expect(auraSlots(12, 'adjacent4', geo).sort((a, b) => a - b)).toEqual([7, 11, 13, 17]);
    expect(auraSlots(0, 'adjacent', geo).sort((a, b) => a - b)).toEqual([1, 5, 6]);
    expect(auraSlots(12, 'global', geo).length).toBe(24);
    // 임프(고블린, 공격 시너지 없음)로 오라만 격리
    const us = place(['choir_singer', 12], ['imp', 7], ['imp', 6], ['imp', 24]);
    const t = auraTargets(us[0], 'adjacent4', us, geo);
    expect(t).toEqual([us[1]]); // 7만 상하좌우
    sys().apply(us);
    expect(us[1].attackPctBonus! - us[3].attackPctBonus!).toBeCloseTo(8); // 성가대원 오라 +8은 인접한 7에만
  });
  it('대성전 기사(global 오라)는 위치와 무관하게 전원 공속', () => {
    const us = place(['cathedral_knight', 0], ['spear_striker', 24], ['imp', 12]);
    sys().apply(us);
    expect(us[1].attackSpeedPctBonus).toBeGreaterThanOrEqual(10);
    expect(us[2].attackSpeedPctBonus).toBeGreaterThanOrEqual(10);
  });
});

describe('빙고 (4단계) — 같은 수트로 한 줄 완성', () => {
  const S = ['spear_striker', 'twin_axe_warrior', 'crusher_rider', 'blacksteel_knight', 'steel_colossus'];
  const row0 = () => place(...S.map((id, i) => [id, i] as [string, number]));

  it('가로 한 줄 5기 같은 수트 → 빙고 1줄, 줄 구성원 공격 +20', () => {
    const us = row0();
    const r = sys().apply(us);
    expect(active(r, 'formation', 'bingo')?.count).toBe(1);
    expect(r.bingoLines.length).toBe(1);
    expect(r.bingoLines[0]).toEqual({ cells: [0, 1, 2, 3, 4], key: 'S', kind: 'row' });
    // 줄이 안 되는 배치(0,7,12,18,21)와 비교 — 강철 거신(몬스터, 대열 없음)으로 순수 빙고 차이 확인
    const scattered = place(...S.map((id, i) => [id, [0, 7, 12, 18, 21][i]] as [string, number]));
    const r2 = sys().apply(scattered);
    expect(active(r2, 'formation', 'bingo')).toBeUndefined();
    expect(us[4].attackPctBonus! - scattered[4].attackPctBonus!).toBeCloseTo(20);
  });

  it('세로·대각선도 줄로 인정', () => {
    const col = place(...S.map((id, i) => [id, i * 5] as [string, number]));
    expect(sys().apply(col).bingoLines[0].kind).toBe('col');
    const diag = place(...S.map((id, i) => [id, i * 6] as [string, number]));
    // 대각선 (0,6,12,18,24)
    expect(sys().apply(diag).bingoLines.map((l) => l.kind)).toEqual(['diag']);
    const anti = place(...S.map((id, i) => [id, 4 + i * 4] as [string, number])); // 4,8,12,16,20
    expect(sys().apply(anti).bingoLines.map((l) => l.kind)).toEqual(['diag']);
  });

  it('빈 칸이 있거나 수트가 섞이면 줄 아님', () => {
    const four = place(...S.slice(0, 4).map((id, i) => [id, i] as [string, number]));
    expect(sys().apply(four).bingoLines.length).toBe(0);
    const mixed = place(...S.slice(0, 4).map((id, i) => [id, i] as [string, number]), ['miner', 4]);
    expect(sys().apply(mixed).bingoLines.length).toBe(0);
  });

  it('교차점(가로+세로)은 줄 2개 → 보너스 2배 중첩, 2줄 구간 공속 +10', () => {
    // 행 0: 슬롯 0~4 ♠, 열 0: 슬롯 0,5,10,15,20 ♠ (슬롯 0 공유) → 9기
    const ids = ['spear_striker', 'twin_axe_warrior', 'crusher_rider', 'blacksteel_knight', 'steel_colossus', 'spear_striker', 'twin_axe_warrior', 'crusher_rider', 'blacksteel_knight'];
    const slots = [0, 1, 2, 3, 4, 5, 10, 15, 20];
    const us = place(...ids.map((id, i) => [id, slots[i]] as [string, number]));
    const r = sys().apply(us);
    expect(active(r, 'formation', 'bingo')?.count).toBe(2);
    expect(r.bingoLines.map((l) => l.kind).sort()).toEqual(['col', 'row']);
    // 다른 축·상한(caps)을 배제하고 빙고만 있는 테이블로 순수 값 확인
    const only = new SynergySystem({ suits: {}, classes: {}, formation: { bingo: table.formation!.bingo } });
    only.apply(us);
    expect(us[0].attackPctBonus).toBe(40); // 교차점: 행+열 = 2줄
    expect(us[5].attackPctBonus).toBe(20); // 열만
    expect(us[4].attackPctBonus).toBe(20); // 행만
    expect(us[8].attackSpeedPctBonus).toBe(10); // 2줄 구간 공속
  });

  it('영웅도 줄을 완성할 수 있다 (수트 기준)', () => {
    const four = place(...S.slice(0, 4).map((id, i) => [id, i] as [string, number]));
    const hero: DeployedUnit = { def: { ...unit('blacksteel_knight'), id: 'hero_k', name: '검은 대공', tier: 6 }, slot: 4 };
    const r = sys().apply(four, { hero });
    expect(r.bingoLines.length).toBe(1);
    expect(hero.attackPctBonus).toBeGreaterThanOrEqual(20);
  });

  it('종족 기준 줄(matchBy race)도 지원한다', () => {
    const custom = new SynergySystem({ suits: {}, classes: {}, formation: { rb: { name: '종족 빙고', countBy: 'lines', matchBy: 'race', thresholds: [1], effects: [[{ type: 'per_line_attack_pct', pct: 5, scope: 'formation' }]] } } });
    // 휴먼 5기 한 줄 (수트 섞임: ♠4 + ♥1)
    const us = place(['spear_striker', 0], ['twin_axe_warrior', 1], ['crusher_rider', 2], ['blacksteel_knight', 3], ['novice_priest', 4]);
    const r = custom.apply(us);
    expect(r.bingoLines[0]?.key).toBe('human');
    expect(us[4].attackPctBonus).toBe(5);
  });
});

describe('Battle이 전투 규칙 시너지를 소비한다', () => {
  const w: WaveDef = { wave: 5, boss: false, hp: 1e9, spawnInterval: 0.2, timeLimit: 10, groups: [{ type: 'normal', count: 3 }] };
  const run = (b: Battle, sec: number) => { for (let t = 0; t < sec; t += 0.1) b.tick(0.1); };

  it('timeLimitBonus: 제한 시간이 늘어난다', () => {
    const b = new Battle(w, enemyTypes, [], config, { battleMods: { timeLimitBonus: 4 } });
    expect(b.timeLimit).toBe(14);
    run(b, 12);
    expect(b.cleared).toBe(false);
    run(b, 3);
    expect(b.cleared).toBe(true);
  });
  it('enemySpeedPct -8: 이동 거리가 8% 줄어든다', () => {
    const a = new Battle(w, enemyTypes, [], config);
    const b = new Battle(w, enemyTypes, [], config, { battleMods: { enemySpeedPct: -8 } });
    run(a, 5); run(b, 5);
    const d = (x: Battle) => Math.max(...x.aliveEnemies.map((e) => e.laps * 40 + e.pos));
    expect(d(b)).toBeCloseTo(d(a) * 0.92, 1);
  });
  it('waveStartStunSec 3: 3초 동안 스폰된 적은 3초까지 움직이지 않는다', () => {
    const b = new Battle(w, enemyTypes, [], config, { battleMods: { waveStartStunSec: 3 } });
    run(b, 2.9);
    expect(b.aliveEnemies.every((e) => e.pos === 0)).toBe(true);
    run(b, 1);
    expect(b.aliveEnemies.some((e) => e.pos > 0)).toBe(true);
  });
  it('rangeBonus: 안쪽 칸(슬롯 6, 트랙까지 2셀)의 근접(사거리 2)이 +1이면 트랙에 닿는다', () => {
    const def = unit('spear_striker');
    const w2: WaveDef = { ...w, hp: 10, timeLimit: 30 };
    const noBonus = new Battle(w2, enemyTypes, [{ def, slot: 6 }], config);
    const bonus = new Battle(w2, enemyTypes, [{ def, slot: 6, rangeBonus: 1 }], config);
    let k1 = 0, k2 = 0;
    for (let t = 0; t < 30; t += 0.1) { k1 += noBonus.tick(0.1).kills; k2 += bonus.tick(0.1).kills; }
    expect(k1).toBe(0);
    expect(k2).toBeGreaterThan(0);
  });
  it('rangeMultOverride: 사거리 4 배율 0.75 → 0.9', () => {
    const def = unit('coin_thrower'); // ranged 4
    const w2: WaveDef = { ...w, hp: 1e9, spawnInterval: 0, timeLimit: 30, groups: [{ type: 'normal', count: 1 }] };
    const a = new Battle(w2, enemyTypes, [{ def, slot: 12 }], config);
    const b = new Battle(w2, enemyTypes, [{ def, slot: 12 }], config, { battleMods: { rangeMultOverride: { '4': 0.9 } } });
    run(a, 10); run(b, 10);
    const dmg = (x: Battle) => x.aliveEnemies[0].maxHp - x.aliveEnemies[0].hp;
    expect(dmg(b)).toBeCloseTo(dmg(a) * 0.9 / 0.75, 0);
  });
});

describe('GameLoop 연동', () => {
  const baseData = (): GameData => ({
    units, hands: load('hands.json'), synergies: table, heroes: heroesJson.heroes,
    waves: wavesJson.waves, enemyTypes, battleConfig: config, config: load('config.json'),
  });
  function seededRng(seed: number) { let s = seed; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; }; }

  it('활성 시너지에 race/formation kind가 나온다', () => {
    let found = false;
    for (let seed = 1; seed < 60 && !found; seed++) {
      const g = new GameLoop(baseData(), seededRng(seed));
      for (let r = 0; r < 6 && g.phase !== 'defeat'; r++) {
        g.confirmHand();
        if (g.activeSynergies.some((a) => a.kind === 'race' || a.kind === 'formation')) { found = true; break; }
        g.startCombat();
        for (let t = 0; t < 60 && g.phase === 'combat'; t += 0.1) g.tickCombat(0.1);
        if (g.phase !== 'card') break;
      }
    }
    expect(found).toBe(true);
  });

  it('고블린 3 시너지: 전투 시작 시 골드 +10', () => {
    // 손패를 강제할 수 없으므로 시드를 돌려 고블린 3기 이상이 된 판을 찾는다
    for (let seed = 1; seed < 200; seed++) {
      const g = new GameLoop(baseData(), seededRng(seed));
      for (let r = 0; r < 8 && (g.phase === 'card' || g.phase === 'manage'); r++) {
        g.confirmHand();
        const goblins = g.units.filter((u) => u.def.race === 'goblin').length;
        if (goblins >= 3) {
          const before = g.gold;
          g.startCombat();
          expect(g.gold).toBe(before + 10);
          return;
        }
        g.startCombat();
        for (let t = 0; t < 60 && (g.phase as GamePhase) === 'combat'; t += 0.1) g.tickCombat(0.1);
      }
    }
    throw new Error('no seed produced 3 goblins');
  });
});
