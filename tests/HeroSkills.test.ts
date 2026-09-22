/**
 * 영웅 액티브 스킬 8종 (GDD 3.3) — Battle 스킬 API + GameLoop.useHeroSkill
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Battle, type DeployedUnit, type WaveDef, type BattleConfig, type EnemyTypeDef } from '../src/systems/Battle.ts';
import { GameLoop, type GameData, type GamePhase } from '../src/systems/GameLoop.ts';
import { type UnitDef } from '../src/systems/SummonMapper.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
const load = (f: string) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
const unitsJson = load('units.json');
const wavesJson = load('waves.json');
const heroesJson = load('heroes.json');
const units: UnitDef[] = unitsJson.units;
const config: BattleConfig = wavesJson.config;
const enemyTypes: Record<string, EnemyTypeDef> = wavesJson.enemyTypes;

const hero: DeployedUnit = {
  def: { id: 'hero_test', name: '테스트 영웅', suit: 'S', tier: 6, cards: 'high', class: 'transcendent', race: 'human', attackType: 'melee', targets: 'both',
    baseDps: 100, dpsFactor: 1, attackInterval: 1, range: 2, value: 0, effect: null, desc: '' },
  slot: 0,
};
const wave = (over: Partial<WaveDef> = {}): WaveDef => ({ wave: 5, boss: false, hp: 100, spawnInterval: 0, timeLimit: 30, groups: [{ type: 'skeleton', count: 5 }], ...over });
const run = (b: Battle, sec: number) => { const sum = { kills: 0, gold: 0, life: 0, hits: 0, skillHits: 0 }; for (let t = 0; t < sec; t += 0.1) { const ev = b.tick(0.1); sum.kills += ev.kills; sum.gold += ev.goldEarned; sum.life += ev.lifeLost; sum.hits += ev.hits.length; sum.skillHits += ev.hits.filter((h) => h.skill).length; } return sum; };

describe('Battle 스킬 API', () => {
  it('damageAllEnemies: 전체 피해 + 기절, 이벤트는 다음 tick에 합산', () => {
    const b = new Battle(wave(), enemyTypes, [], config);
    b.tick(0.1); // 스폰
    const r = b.damageAllEnemies(hero, 60, 1);
    expect(r.affected).toBe(5);
    expect(r.kills).toBe(0);
    expect(b.aliveEnemies.every((e) => e.hp === 40)).toBe(true);
    const ev = b.tick(0.1);
    expect(ev.hits.length).toBe(5);
    expect(ev.hits.every((h) => h.skill)).toBe(true);
    // 기절 1초: 위치 변화 없음 (첫 tick에서 이미 0.4 이동한 상태 기준)
    const pos = b.aliveEnemies.map((e) => e.pos);
    for (let t = 0; t < 0.8; t += 0.1) b.tick(0.1);
    expect(b.aliveEnemies.map((e) => e.pos)).toEqual(pos);
    const r2 = b.damageAllEnemies(hero, 60);
    expect(r2.kills).toBe(5);
    expect(b.tick(0.1).goldEarned).toBe(5 * config.baseKillGold);
  });

  it('hitTopHpEnemies: HP 높은 순 n기만', () => {
    const b = new Battle(wave(), enemyTypes, [], config);
    b.tick(0.1);
    const es = b.aliveEnemies;
    es[0].hp = 10; es[1].hp = 20; // 나머지 100
    const r = b.hitTopHpEnemies(hero, 3, 50);
    expect(r.affected).toBe(3);
    expect(es[0].hp).toBe(10);
    expect(es[1].hp).toBe(20);
    expect(es.filter((e) => e.hp === 50).length).toBe(3);
  });

  it('executeHighestHp: 최대 HP 적 즉사, 보스는 %', () => {
    const b = new Battle(wave({ groups: [{ type: 'skeleton', count: 2 }, { type: 'ghoul', count: 1 }] }), enemyTypes, [], config);
    b.tick(0.1);
    const r = b.executeHighestHp(hero, 20);
    expect(r.kills).toBe(1);
    expect(b.aliveEnemies.every((e) => e.type === 'skeleton')).toBe(true); // ghoul(hp 1.1배)이 죽음
    const boss = new Battle(wave({ boss: true, hp: 1000, groups: [{ type: 'bone_golem', count: 1 }] }), enemyTypes, [], config);
    boss.tick(0.1);
    const rb = boss.executeHighestHp(hero, 20);
    expect(rb.kills).toBe(0);
    expect(boss.aliveEnemies[0].hp).toBeCloseTo(boss.aliveEnemies[0].maxHp * 0.8);
  });

  it('freezeEnemies: 지속 동안 이후 스폰 포함 전부 정지', () => {
    const b = new Battle(wave({ spawnInterval: 0.5 }), enemyTypes, [], config);
    b.tick(0.1);
    b.freezeEnemies(3);
    expect(b.freezeRemaining).toBeCloseTo(3);
    const first = b.aliveEnemies[0].pos;
    run(b, 2.8);
    expect(b.aliveEnemies.length).toBe(5); // 방벽 중 스폰된 적 포함
    expect(b.aliveEnemies[0].pos).toBe(first);
    expect(b.aliveEnemies.slice(1).every((e) => e.pos === 0)).toBe(true); // 방벽 중 스폰 → 제자리
    run(b, 1);
    expect(b.aliveEnemies.some((e) => e.pos > first)).toBe(true);
  });

  it('setSanctuary: 성역 중 시간 초과 이탈은 라이프를 안 깎는다', () => {
    const a = new Battle(wave({ timeLimit: 5 }), enemyTypes, [], config);
    const s = new Battle(wave({ timeLimit: 5 }), enemyTypes, [], config);
    s.tick(0.1); s.setSanctuary(8);
    expect(run(a, 6).life).toBe(5);
    expect(run(s, 6).life).toBe(0);
  });

  it('slowAllEnemies: 감속 + 적당 골드 (다음 tick에 지급)', () => {
    const b = new Battle(wave(), enemyTypes, [], config);
    b.tick(0.1);
    const r = b.slowAllEnemies(30, 5, 2);
    expect(r.goldEarned).toBe(10);
    expect(b.tick(0.1).goldEarned).toBe(10);
    expect(b.aliveEnemies.every((e) => e.slowPct === 30)).toBe(true);
  });

  it('addTemporaryUnits: 지속 동안만 공격하고 만료되면 사라진다', () => {
    const turret: DeployedUnit = { def: { ...hero.def, id: 'turret', baseDps: 40, range: 6 }, slot: 12 };
    const b = new Battle(wave({ hp: 1e9 }), enemyTypes, [], config);
    b.tick(0.1);
    b.addTemporaryUnits([turret], 2);
    expect(b.temporaryUnits.length).toBe(1);
    const during = run(b, 1.9);
    expect(during.hits).toBeGreaterThan(0);
    run(b, 0.3);
    expect(b.temporaryUnits.length).toBe(0);
    const after = run(b, 1);
    expect(after.hits).toBe(0);
  });

  it('startStorm: 초당 rate발 낙뢰가 무작위 적에게', () => {
    const b = new Battle(wave({ hp: 1e9 }), enemyTypes, [], config, { rng: () => 0.5 });
    b.tick(0.1);
    b.startStorm(hero, 200, 4, 5);
    const r = run(b, 5.2);
    expect(r.skillHits).toBeGreaterThanOrEqual(19);
    expect(r.skillHits).toBeLessThanOrEqual(21);
    const later = run(b, 2);
    expect(later.skillHits).toBe(0);
  });
});

describe('대공 영웅 — 지상/공중 구분', () => {
  const airWave = (over: Partial<WaveDef> = {}): WaveDef => ({ wave: 8, boss: false, hp: 100, spawnInterval: 0, timeLimit: 30, groups: [{ type: 'cave_bat', count: 3 }, { type: 'skeleton', count: 2 }], ...over });

  it('damageAllEnemies(only air)는 공중만, hitTopHpEnemies(only air)도 공중만', () => {
    const b = new Battle(airWave(), enemyTypes, [], config);
    b.tick(0.1);
    const r = b.damageAllEnemies(hero, 30, 1, 'air');
    expect(r.affected).toBe(3);
    for (const e of b.aliveEnemies) expect(e.hp).toBe(e.movement === 'air' ? 100 * enemyTypes.cave_bat.hpMult - 30 : 100);
    const r2 = b.hitTopHpEnemies(hero, 5, 10, 'air');
    expect(r2.affected).toBe(3);
  });

  it('freezeAirEnemies: 공중만 정지, 지상은 이동', () => {
    const b = new Battle(airWave({ spawnInterval: 0.5 }), enemyTypes, [], config);
    b.tick(0.1);
    b.freezeAirEnemies(3);
    expect(b.freezeAirRemaining).toBeCloseTo(3);
    const before = new Map(b.aliveEnemies.map((e) => [e.id, e.pos]));
    run(b, 2.5);
    for (const e of b.aliveEnemies) {
      if (e.movement === 'air') expect(e.pos).toBe(before.get(e.id) ?? 0); // 스폰된 공중 적도 제자리
      else expect(e.pos).toBeGreaterThan(before.get(e.id) ?? -1);
    }
  });

  it('startStorm(only air): 낙뢰는 공중에게만', () => {
    const b = new Battle(airWave({ hp: 1e9 }), enemyTypes, [], config, { rng: () => 0.5 });
    b.tick(0.1);
    b.startStorm(hero, 200, 4, 3, 'air');
    run(b, 3.2);
    // 고정 rng(0.5)라 공중 중 한 기에 집중되지만, 지상은 절대 맞지 않는다
    expect(b.aliveEnemies.some((e) => e.movement === 'air' && e.hp < e.maxHp)).toBe(true);
    for (const e of b.aliveEnemies) if (e.movement === 'ground') expect(e.hp).toBe(e.maxHp);
  });

  it('airAttackPctBonus는 공중 피해만 올리고, airSpeedPct는 공중만 느리게, airKillGoldMult는 공중 처치 골드만 배율', () => {
    const def = { ...hero.def, range: 6 };
    const plain = new Battle(airWave({ hp: 1e9 }), enemyTypes, [{ def, slot: 12 }], config);
    const boosted = new Battle(airWave({ hp: 1e9 }), enemyTypes, [{ def, slot: 12, airAttackPctBonus: 100 }], config);
    run(plain, 3); run(boosted, 3);
    const dmg = (b: Battle, mv: string) => b.aliveEnemies.filter((e) => e.movement === mv).reduce((s, e) => s + (e.maxHp - e.hp), 0);
    expect(dmg(boosted, 'air')).toBeGreaterThan(dmg(plain, 'air'));
    expect(dmg(boosted, 'ground')).toBeCloseTo(dmg(plain, 'ground'), 3);

    const slow = new Battle(airWave(), enemyTypes, [], config, { battleMods: { airSpeedPct: -50 } });
    const norm = new Battle(airWave(), enemyTypes, [], config);
    run(slow, 2); run(norm, 2);
    const pos = (b: Battle, mv: string) => Math.max(...b.aliveEnemies.filter((e) => e.movement === mv).map((e) => e.pos));
    expect(pos(slow, 'air')).toBeCloseTo(pos(norm, 'air') * 0.5, 1);
    expect(pos(slow, 'ground')).toBeCloseTo(pos(norm, 'ground'), 3);

    const g = new Battle(airWave({ hp: 5 }), enemyTypes, [{ def, slot: 12 }], config, { globalMods: { airKillGoldMult: 3 } });
    const sum = run(g, 20);
    expect(sum.kills).toBe(5);
    expect(sum.gold).toBe(3 * config.baseKillGold * 3 + 2 * config.baseKillGold); // 공중 3기 ×3, 지상 2기 ×1
  });
});

describe('GameLoop.useHeroSkill', () => {
  const baseData = (): GameData => ({
    units, hands: load('hands.json'), synergies: load('synergies.json'), heroes: heroesJson.heroes,
    // 웨이브 1 적 HP를 크게 → 스킬 사용 시점에 적이 살아 있게
    waves: wavesJson.waves.map((w: WaveDef, i: number) => (i === 0 ? { ...w, hp: 5000, spawnInterval: 0 } : w)),
    enemyTypes, battleConfig: config, config: load('config.json'),
    unlockedHeroes: heroesJson.heroes.map((h: { id: string }) => h.id), // 8종 전부
  });
  function seededRng(seed: number) { let s = seed; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; }; }
  /** 영웅을 소환하고 전투 진입 */
  function withHero(heroId: string): GameLoop {
    const g = new GameLoop(baseData(), seededRng(7));
    g.confirmHand();
    (g as unknown as { _shards: number })._shards = 3;
    g.summonHero(heroId);
    g.startCombat();
    for (let t = 0; t < 1.5; t += 0.1) g.tickCombat(0.1); // 적 스폰
    return g;
  }

  it('전투 중이 아니면 throw, 영웅 없으면 throw', () => {
    const g = new GameLoop(baseData(), seededRng(1));
    expect(g.heroSkillReady).toBe(false);
    expect(() => g.useHeroSkill()).toThrow();
    g.confirmHand();
    g.startCombat();
    expect(g.heroSkillReady).toBe(false);
    expect(() => g.useHeroSkill()).toThrow(/No hero/);
  });

  it('사용 후 쿨타임 45초, 전투 시간으로 감소, 웨이브를 넘어 유지', () => {
    const g = withHero('black_archduke');
    expect(g.heroSkillReady).toBe(true);
    g.useHeroSkill();
    expect(g.heroSkillCooldown).toBe(45);
    expect(() => g.useHeroSkill()).toThrow(/cooldown/);
    for (let t = 0; t < 10 && (g.phase as GamePhase) === 'combat'; t += 0.1) g.tickCombat(0.1);
    expect(g.heroSkillCooldown).toBeLessThan(45);
    expect(g.heroSkillCooldown).toBeGreaterThan(0);
  });

  it('대공 영웅: 근접 영웅 유닛은 지상만, 천상 파수꾼은 공중만, 대공포는 모두 공격', () => {
    expect(withHero('black_archduke').hero!.unit.def.targets).toBe('ground');
    expect(withHero('sky_warden').hero!.unit.def.targets).toBe('air');
    expect(withHero('iron_flak').hero!.unit.def.targets).toBe('both');
  });

  it('대공 패시브: 강철 대공포는 전체 유닛 공중 피해 +20%, 공허 매사냥꾼은 ♣만 +35%', () => {
    const g1 = withHero('iron_flak');
    for (const u of g1.units) expect(u.airAttackPctBonus).toBe(20);
    expect(g1.hero!.unit.airAttackPctBonus).toBe(20);
    const g2 = withHero('void_falconer');
    for (const u of g2.units) expect(u.airAttackPctBonus).toBe(u.def.suit === 'C' ? 35 : 0);
  });

  it('12종 전부 오류 없이 실행되고 결과 텍스트를 돌려준다', () => {
    for (const h of heroesJson.heroes as { id: string; active: { id: string } }[]) {
      const g = withHero(h.id);
      const r = g.useHeroSkill();
      expect(r.id).toBe(h.active.id);
      expect(r.text.length).toBeGreaterThan(0);
      expect(g.heroSkillCooldown).toBe(45);
      // 이후 전투가 정상 진행
      for (let t = 0; t < 3 && (g.phase as GamePhase) === 'combat'; t += 0.1) g.tickCombat(0.1);
    }
  });

  it('등급 배율: S급(×1.5) 대지 강타가 A급보다 강하다', () => {
    const dmgAt = (grade: 'S' | 'A'): number => {
      const data = baseData();
      // 등급은 남은 웨이브로 결정 → S/A 모두 웨이브 1에서 소환하되 배율표를 바꿔 비교
      data.config = { ...data.config, hero: { ...data.config.hero, grades: { ...data.config.hero.grades, S: { minRemainingWaves: 20, mult: grade === 'S' ? 1.5 : 1.0 } } } };
      const g = new GameLoop(data, seededRng(7));
      g.confirmHand();
      (g as unknown as { _shards: number })._shards = 3;
      g.summonHero('black_archduke');
      g.startCombat();
      for (let t = 0; t < 1.5; t += 0.1) g.tickCombat(0.1);
      g.useHeroSkill();
      const ev = g.tickCombat(0.1);
      return ev.hits.filter((h) => h.skill).reduce((s, h) => s + h.dmg, 0);
    };
    expect(dmgAt('S')).toBeGreaterThan(dmgAt('A'));
  });

  it('황금 저격수 골든 불릿: 처치 시 골드가 들어온다', () => {
    const g = withHero('golden_sniper');
    const gold = g.gold;
    const r = g.useHeroSkill();
    expect(r.kills).toBe(1);
    g.tickCombat(0.1);
    expect(g.gold).toBeGreaterThan(gold);
  });
});
