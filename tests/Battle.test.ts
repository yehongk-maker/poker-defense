import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  Battle,
  type WaveDef,
  type BattleConfig,
  type EnemyTypeDef,
  type DeployedUnit,
} from '../src/systems/Battle.ts';
import { type UnitDef } from '../src/systems/SummonMapper.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
const wavesJson = JSON.parse(readFileSync(join(dataDir, 'waves.json'), 'utf8'));
const unitsJson = JSON.parse(readFileSync(join(dataDir, 'units.json'), 'utf8'));
const units: UnitDef[] = unitsJson.units;
const config: BattleConfig = wavesJson.config;
const enemyTypes: Record<string, EnemyTypeDef> = wavesJson.enemyTypes;
const waves: WaveDef[] = wavesJson.waves;

const unit = (id: string): UnitDef => {
  const u = units.find((u) => u.id === id);
  if (!u) throw new Error(`no unit ${id}`);
  return u;
};
const deploy = (...ids: string[]): DeployedUnit[] => ids.map((id) => ({ def: unit(id) }));

/** dt 0.1초씩 seconds 동안 tick, 이벤트 합산 */
function run(b: Battle, seconds: number) {
  const sum = { kills: 0, goldEarned: 0, lifeLost: 0, cleared: false };
  for (let t = 0; t < seconds; t += 0.1) {
    const ev = b.tick(0.1);
    sum.kills += ev.kills;
    sum.goldEarned += ev.goldEarned;
    sum.lifeLost += ev.lifeLost;
    sum.cleared = ev.cleared;
    if (sum.cleared) break;
  }
  return sum;
}

const wave1: WaveDef = { wave: 1, boss: false, hp: 24, spawnInterval: 0.5, groups: [{ type: 'normal', count: 5 }] };

describe('waves.json 데이터 무결성 — GDD 3.5', () => {
  it('40웨이브, 보스는 10/20/30/40', () => {
    expect(waves.length).toBe(40);
    for (const w of waves) {
      expect(w.boss).toBe(w.wave % 10 === 0);
    }
  });

  it('hp = hpBase×hpGrowth^wave 공식 준수 (formula 필드 기준)', () => {
    const f = wavesJson.formula as { hpBase: number; hpGrowth: number };
    for (const w of waves) {
      const expected = f.hpBase * Math.pow(f.hpGrowth, w.wave);
      expect(Math.abs(w.hp - expected) < 1).toBe(true);
    }
  });

  it('일반 웨이브 마릿수 = countBase + countPerWave×wave (최대 countMax), 웨이브 1은 6마리 이하', () => {
    const f = wavesJson.formula as { countBase: number; countPerWave: number; countMax: number };
    for (const w of waves.filter((w) => !w.boss)) {
      const n = w.groups.reduce((s, g) => s + g.count, 0);
      expect(n).toBe(Math.min(f.countMax, Math.round(f.countBase + f.countPerWave * w.wave)));
    }
    // 하이카드(T1 1기)로 웨이브 1을 넘길 수 있어야 한다 (시뮬 근거: 6마리 초과 시 라이프 손실 급증)
    const w1 = waves[0].groups.reduce((s, g) => s + g.count, 0);
    expect(w1 <= 6).toBe(true);
  });

  it('적 타입 5종 모두 등장', () => {
    const used = new Set(waves.flatMap((w) => w.groups.map((g) => g.type)));
    for (const t of ['normal', 'fast', 'armored', 'regen', 'boss']) {
      expect(used.has(t)).toBe(true);
    }
  });
});

describe('적 이동과 완주 → 라이프 차감', () => {
  it('유닛 없으면 한 바퀴(트랙 40 / 속도 4 = 10초)마다 적 1기당 라이프 -1', () => {
    const b = new Battle(wave1, enemyTypes, [], config);
    // 5기 스폰(0~2초) 후 각자 10초에 첫 완주 → 12.5초까지 5회 완주
    const sum = run(b, 12.5);
    expect(sum.lifeLost).toBe(5);
    expect(sum.kills).toBe(0);
    expect(b.cleared).toBe(false); // 적이 살아있으면 클리어 아님
  });

  it('fast 타입은 1.6배 빨리 완주', () => {
    const w: WaveDef = { ...wave1, groups: [{ type: 'fast', count: 1 }] };
    const b = new Battle(w, enemyTypes, [], config);
    const sum = run(b, 6.5); // 10/1.6 = 6.25초에 완주
    expect(sum.lifeLost).toBe(1);
  });
});

describe('유닛 공격과 처치', () => {
  it('강한 유닛은 웨이브를 클리어하고 처치 골드를 얻는다', () => {
    const b = new Battle(wave1, enemyTypes, deploy('blacksteel_knight'), config);
    const sum = run(b, 30);
    expect(sum.cleared).toBe(true);
    expect(sum.kills).toBe(5);
    expect(sum.goldEarned).toBe(5 * config.baseKillGold);
    expect(sum.lifeLost).toBe(0); // 완주 전에 전멸
  });

  it('공격력 보너스(attackPctBonus)만큼 더 빨리 잡는다', () => {
    const weak: DeployedUnit[] = [{ def: unit('spear_striker') }];
    const buffed: DeployedUnit[] = [{ def: unit('spear_striker'), attackPctBonus: 100 }];
    const w: WaveDef = { ...wave1, groups: [{ type: 'normal', count: 3 }] };
    const t1 = run(new Battle(w, enemyTypes, weak, config), 60);
    const t2 = run(new Battle(w, enemyTypes, buffed, config), 60);
    expect(t2.kills >= t1.kills).toBe(true);
    expect(t2.cleared).toBe(true);
  });
});

describe('적 타입 상성 — GDD "적 웨이브 타입이 각 역할을 카운터"', () => {
  const armoredWave: WaveDef = { wave: 8, boss: false, hp: 300, spawnInterval: 0.5, groups: [{ type: 'armored', count: 1 }] };

  it('중갑: 물리 공격은 50% 감소, 마법은 관통', () => {
    // 물리(창격병 dps 8) vs 마법(임프 dps 8) — 같은 dps로 중갑 1기 공격
    const phys = run(new Battle(armoredWave, enemyTypes, deploy('spear_striker'), config), 20);
    const magic = run(new Battle(armoredWave, enemyTypes, deploy('imp'), config), 20);
    // 20초: 물리 8×0.5=4dps×20=80뎀 < 360hp, 마법 8×20=160뎀 — 킬은 안 나도 마법이 더 깎음
    const bPhys = new Battle(armoredWave, enemyTypes, deploy('spear_striker'), config);
    const bMagic = new Battle(armoredWave, enemyTypes, deploy('imp'), config);
    run(bPhys, 20); run(bMagic, 20);
    const hpPhys = bPhys.aliveEnemies[0].hp;
    const hpMagic = bMagic.aliveEnemies[0].hp;
    expect(hpMagic < hpPhys).toBe(true);
    expect(phys.kills).toBe(0);
    expect(magic.kills).toBe(0);
  });

  it('armor_pierce(파쇄 기수)는 물리인데도 저항 무시', () => {
    const bPierce = new Battle(armoredWave, enemyTypes, deploy('crusher_rider'), config);
    run(bPierce, 10);
    // 관통 dps 38.7 → 10초 387뎀 ≥ 360hp → 처치
    expect(bPierce.cleared).toBe(true);
  });

  it('regen 타입은 회복한다 (약한 유닛으론 오래 걸림)', () => {
    const regenWave: WaveDef = { wave: 12, boss: false, hp: 100, spawnInterval: 0.5, groups: [{ type: 'regen', count: 1 }] };
    const b = new Battle(regenWave, enemyTypes, [], config);
    b.tick(0.1); // 스폰
    const e = b.aliveEnemies[0];
    e.hp = e.maxHp * 0.5;
    run(b, 5);
    expect(e.hp > e.maxHp * 0.5).toBe(true); // 회복됨
  });
});

describe('보스', () => {
  it('보스 웨이브: hpMult 25배, 처치 시 보스 골드', () => {
    const bossWave = waves.find((w) => w.wave === 10)!;
    const strong: DeployedUnit[] = [{ def: unit('abyss_dragon') }, { def: unit('abyss_dragon') }];
    const b = new Battle(bossWave, enemyTypes, strong, config);
    const sum = run(b, 120);
    expect(sum.cleared).toBe(true);
    expect(sum.goldEarned).toBe(config.bossKillGold);
  });

  it('bonus_vs_boss(흑철 기사)는 보스를 더 빨리 깎는다', () => {
    const bossWave = waves.find((w) => w.wave === 10)!;
    const mk = (id: string) => {
      const b = new Battle(bossWave, enemyTypes, deploy(id), config);
      run(b, 10);
      return b.aliveEnemies[0].hp;
    };
    // 흑철(dps 85.2, 보스+30%, 물리저항 30% 적용) vs 뇌전 군주(dps 85.2 마법, 저항 무시)
    // 흑철: 85.2×1.3×0.7=77.5dps / 뇌전: 85.2dps — 흑철이 보너스 없으면 59.6dps였을 것
    const knight = mk('blacksteel_knight');
    const plain = mk('cathedral_knight'); // dps 85.2×0.7=59.6 물리, 보너스 없음 → ×0.7 저항 = 41.8
    expect(knight < plain).toBe(true);
  });
});

describe('CC 효과', () => {
  it('slow_curse(해골 주술사): 감속으로 완주가 늦어진다', () => {
    const w: WaveDef = { wave: 5, boss: false, hp: 1e9, spawnInterval: 0, groups: [{ type: 'normal', count: 1 }] };
    const free = new Battle(w, enemyTypes, [], config);
    const slowed = new Battle(w, enemyTypes, deploy('skull_shaman'), config);
    const a = run(free, 10.5);
    const c = run(slowed, 10.5);
    expect(a.lifeLost).toBe(1);
    expect(c.lifeLost).toBe(0); // 감속으로 아직 완주 못 함
  });

  it('aoe_stun(강철 거신): 기절 동안 이동 정지', () => {
    const w: WaveDef = { wave: 5, boss: false, hp: 1e9, spawnInterval: 0.2, groups: [{ type: 'normal', count: 3 }] };
    const free = new Battle(w, enemyTypes, [], config);
    const stunned = new Battle(w, enemyTypes, deploy('steel_colossus'), config);
    run(free, 10.5);
    run(stunned, 10.5);
    const maxPosFree = Math.max(...free.aliveEnemies.map((e) => e.laps * 40 + e.pos));
    const maxPosStun = Math.max(...stunned.aliveEnemies.map((e) => e.laps * 40 + e.pos));
    expect(maxPosStun < maxPosFree).toBe(true);
  });
});

describe('다중 타겟', () => {
  it('chain_lightning(뇌전 군주): 한 공격이 최대 3체를 때린다', () => {
    const w: WaveDef = { wave: 5, boss: false, hp: 1e9, spawnInterval: 0.1, groups: [{ type: 'normal', count: 5 }] };
    const b = new Battle(w, enemyTypes, deploy('thunder_lord'), config);
    run(b, 5);
    const damaged = b.aliveEnemies.filter((e) => e.hp < e.maxHp).length;
    expect(damaged >= 3).toBe(true);
  });

  it('splash(화염 술사): 뭉친 적들이 같이 맞는다', () => {
    const w: WaveDef = { wave: 5, boss: false, hp: 1e9, spawnInterval: 0.1, groups: [{ type: 'normal', count: 5 }] };
    const b = new Battle(w, enemyTypes, deploy('flame_caster'), config);
    run(b, 5);
    const damaged = b.aliveEnemies.filter((e) => e.hp < e.maxHp).length;
    expect(damaged >= 2).toBe(true);
  });
});

describe('경제 효과', () => {
  it('gold_on_kill(광부): 처치당 골드 +1', () => {
    const w: WaveDef = { ...wave1, hp: 5, groups: [{ type: 'normal', count: 3 }] };
    const b = new Battle(w, enemyTypes, deploy('miner'), config);
    const sum = run(b, 30);
    expect(sum.cleared).toBe(true);
    expect(sum.goldEarned).toBe(3 * (config.baseKillGold + 1));
  });

  it('kill_gold_multiplier(보석 사수): 처치 골드 ×2', () => {
    const w: WaveDef = { ...wave1, hp: 5, groups: [{ type: 'normal', count: 3 }] };
    const b = new Battle(w, enemyTypes, deploy('gem_shooter'), config);
    const sum = run(b, 30);
    expect(sum.goldEarned).toBe(3 * config.baseKillGold * 2);
  });

  it('wave_gold_pct(금고 골렘): 클리어 골드 +15%', () => {
    const b = new Battle(waves[0], enemyTypes, deploy('vault_golem'), config);
    // wave 1: 30+5 = 35 → ×1.15 = 40.25 → 40
    expect(b.clearGold()).toBe(40);
    const b2 = new Battle(waves[0], enemyTypes, deploy('spear_striker'), config);
    expect(b2.clearGold()).toBe(35);
  });

  it('gold_scaling_damage(황금 비룡): 보유 골드만큼 데미지 증가', () => {
    const w: WaveDef = { wave: 5, boss: false, hp: 1e6, spawnInterval: 0, groups: [{ type: 'normal', count: 1 }] };
    const poor = new Battle(w, enemyTypes, deploy('golden_wyrm'), config, { getGold: () => 0 });
    const rich = new Battle(w, enemyTypes, deploy('golden_wyrm'), config, { getGold: () => 10000 });
    run(poor, 5); run(rich, 5);
    expect(rich.aliveEnemies[0].hp < poor.aliveEnemies[0].hp).toBe(true);
  });
});

describe('통합: 실제 웨이브 진행 시뮬레이션', () => {
  it('T1 유닛 2기로 웨이브 1~3은 클리어 가능 (GDD: 저족보로도 초반은 버틴다)', () => {
    const squad = deploy('spear_striker', 'imp');
    for (const w of waves.slice(0, 3)) {
      const b = new Battle(w, enemyTypes, squad, config);
      const sum = run(b, 120);
      expect(sum.cleared).toBe(true);
    }
  });

  it('같은 부대로 웨이브 20은 클리어 불가 (난이도 상승 확인)', () => {
    const squad = deploy('spear_striker', 'imp');
    const b = new Battle(waves[19], enemyTypes, squad, config);
    const sum = run(b, 180);
    expect(sum.cleared).toBe(false);
    expect(sum.lifeLost > 0).toBe(true);
  });
});
