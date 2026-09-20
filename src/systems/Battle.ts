/**
 * Battle — 한 웨이브의 전투 시뮬레이션 (적 순환 트랙 이동 + 유닛 자동 공격)
 *
 * GDD 3.5 근거:
 *  - 적은 외곽 순환 트랙을 돌고, 한 바퀴 돌 때마다 라이프 -1 (적은 죽을 때까지 계속 돈다)
 *  - 적 타입: normal / fast(이속↑) / armored(물리저항, 마법은 관통) / regen(초당 회복) / boss
 *  - 유닛은 자동 타겟팅(최전방 우선), 공격 쿨타임 = attackInterval / 공속 배율
 *
 * 순수 로직: Phaser 의존 없음. 씬은 tick(dt)의 이벤트로 연출만 그린다.
 * 시너지/업그레이드는 DeployedUnit의 보너스 필드로 주입된다 (SynergySystem이 채움).
 */

import { type UnitDef } from './SummonMapper.ts';

export interface EnemyTypeDef {
  speedMult: number;
  physicalResist: number;
  regenPctPerSec: number;
  hpMult: number;
}

export interface WaveGroup {
  type: string;
  count: number;
}

export interface WaveDef {
  wave: number;
  boss: boolean;
  hp: number;
  spawnInterval: number;
  groups: WaveGroup[];
}

export interface BattleConfig {
  trackLength: number;
  baseEnemySpeed: number;
  baseKillGold: number;
  bossKillGold: number;
  clearGoldBase: number;
  clearGoldPerWave: number;
}

/** 필드에 배치된 유닛. 보너스 필드는 SynergySystem이 채운다 (기본 0/false). */
export interface DeployedUnit {
  def: UnitDef;
  /** 공격력 +% (수트 시너지, 오라, 라운드 업그레이드 등) */
  attackPctBonus?: number;
  /** 공속 +% */
  attackSpeedPctBonus?: number;
  /** 단일 피해 +% (파괴병기 시너지) */
  singleTargetPctBonus?: number;
  /** 광역 반경 +% (초월체/♣6 시너지) */
  aoeRadiusPctBonus?: number;
  /** true면 물리 저항 무시 (♠6 시너지) */
  armorPierce?: boolean;
  /** 디버프 지속 +% (술법체 시너지) */
  debuffDurationPctBonus?: number;
  /** 감속 추가 -% (술법체 4시너지) */
  extraSlowPct?: number;
  /** 체인 라이트닝 연쇄 대상 +N (뇌운 폭군 패시브) */
  chainTargetsBonus?: number;
  /** 내부 상태: 남은 쿨타임 */
  _cooldown?: number;
}

export interface Enemy {
  id: number;
  type: string;
  hp: number;
  maxHp: number;
  /** 트랙 위 위치 (0 ~ trackLength) */
  pos: number;
  /** 완주한 바퀴 수 */
  laps: number;
  slowPct: number;
  slowUntil: number;
  stunUntil: number;
  alive: boolean;
  isBoss: boolean;
}

export interface BattleTickEvents {
  /** 이번 tick에 처치한 적 수 */
  kills: number;
  /** 이번 tick에 획득한 골드 (처치 + 효과) */
  goldEarned: number;
  /** 이번 tick에 잃은 라이프 (적 완주) */
  lifeLost: number;
  /** 이번 tick 종료 기준 웨이브 클리어 여부 */
  cleared: boolean;
}

interface BattleOptions {
  /** 황금 비룡(gold_scaling_damage)용: 현재 보유 골드 조회 */
  getGold?: () => number;
  rng?: () => number;
  /** 경제 시너지 (SynergySystem.global에서 전달) */
  globalMods?: {
    /** 처치 골드 +N (약탈자 4시너지) */
    killGoldBonus?: number;
    /** 처치 골드 +% (황금 저격수 패시브) */
    killGoldPct?: number;
    /** 처치 시 확률 보너스 골드 (♦6 시너지) */
    bonusGoldChancePct?: number;
    bonusGoldAmount?: number;
  };
}

/** 광역 radius 1당 트랙 거리 */
const AOE_UNIT = 3;

export class Battle {
  private enemies: Enemy[] = [];
  private spawnQueue: { type: string; at: number }[] = [];
  private elapsed = 0;
  private nextEnemyId = 1;
  private getGold: () => number;
  private rng: () => number;
  private globalMods: { killGoldBonus: number; killGoldPct: number; bonusGoldChancePct: number; bonusGoldAmount: number };

  constructor(
    private waveDef: WaveDef,
    private enemyTypes: Record<string, EnemyTypeDef>,
    private units: DeployedUnit[],
    private config: BattleConfig,
    options: BattleOptions = {}
  ) {
    this.getGold = options.getGold ?? (() => 0);
    this.rng = options.rng ?? Math.random;
    this.globalMods = {
      killGoldBonus: options.globalMods?.killGoldBonus ?? 0,
      killGoldPct: options.globalMods?.killGoldPct ?? 0,
      bonusGoldChancePct: options.globalMods?.bonusGoldChancePct ?? 0,
      bonusGoldAmount: options.globalMods?.bonusGoldAmount ?? 0,
    };

    let at = 0;
    for (const g of waveDef.groups) {
      if (!enemyTypes[g.type]) throw new Error(`Unknown enemy type: ${g.type}`);
      for (let i = 0; i < g.count; i++) {
        this.spawnQueue.push({ type: g.type, at });
        at += waveDef.spawnInterval;
      }
    }
    for (const u of units) u._cooldown = 0;
  }

  get aliveEnemies(): readonly Enemy[] {
    return this.enemies.filter((e) => e.alive);
  }

  get allSpawned(): boolean {
    return this.spawnQueue.length === 0;
  }

  get cleared(): boolean {
    return this.allSpawned && this.enemies.every((e) => !e.alive);
  }

  /** 웨이브 클리어 골드: 30 + wave×5 (+금고 골렘 wave_gold_pct, 시너지 보정은 인자로) */
  clearGold(extraPct = 0): number {
    const base = this.config.clearGoldBase + this.waveDef.wave * this.config.clearGoldPerWave;
    let pct = extraPct;
    for (const u of this.units) {
      if (u.def.effect?.type === 'wave_gold_pct') pct += u.def.effect.pct as number;
    }
    return Math.round(base * (1 + pct / 100));
  }

  tick(dt: number): BattleTickEvents {
    this.elapsed += dt;
    const ev: BattleTickEvents = { kills: 0, goldEarned: 0, lifeLost: 0, cleared: false };

    // 1) 스폰
    while (this.spawnQueue.length > 0 && this.spawnQueue[0].at <= this.elapsed) {
      this.spawn(this.spawnQueue.shift()!.type);
    }

    // 2) 적 이동/회복/완주
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const t = this.enemyTypes[e.type];
      if (t.regenPctPerSec > 0) {
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * t.regenPctPerSec * dt);
      }
      if (this.elapsed < e.stunUntil) continue; // 기절: 이동 정지
      const slow = this.elapsed < e.slowUntil ? e.slowPct / 100 : 0;
      const speed = this.config.baseEnemySpeed * t.speedMult * (1 - slow);
      e.pos += speed * dt;
      while (e.pos >= this.config.trackLength) {
        e.pos -= this.config.trackLength;
        e.laps++;
        ev.lifeLost++; // GDD: 한 바퀴당 라이프 -1
      }
    }

    // 3) 유닛 공격
    for (const u of this.units) {
      u._cooldown = (u._cooldown ?? 0) - dt;
      const interval = u.def.attackInterval / (1 + (u.attackSpeedPctBonus ?? 0) / 100);
      while (u._cooldown! <= 0) {
        const target = this.frontmost();
        if (!target) break;
        this.attack(u, target, ev);
        u._cooldown! += interval;
      }
      if (u._cooldown! < 0) u._cooldown = 0; // 적이 없으면 즉시 발사 대기
    }

    ev.cleared = this.cleared;
    return ev;
  }

  /** 최전방 적 (누적 이동거리 최대) */
  private frontmost(): Enemy | null {
    let best: Enemy | null = null;
    let bestDist = -1;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.laps * this.config.trackLength + e.pos;
      if (d > bestDist) { bestDist = d; best = e; }
    }
    return best;
  }

  private spawn(type: string): void {
    const t = this.enemyTypes[type];
    const hp = this.waveDef.hp * t.hpMult;
    this.enemies.push({
      id: this.nextEnemyId++,
      type,
      hp,
      maxHp: hp,
      pos: 0,
      laps: 0,
      slowPct: 0,
      slowUntil: 0,
      stunUntil: 0,
      alive: true,
      isBoss: type === 'boss',
    });
  }

  private attack(u: DeployedUnit, target: Enemy, ev: BattleTickEvents): void {
    const eff = u.def.effect;
    const dmg = this.damageOf(u, target);

    // 다중 타겟 효과
    if (eff?.type === 'chain_lightning') {
      const extra = (eff.targets as number) - 1 + (u.chainTargetsBonus ?? 0);
      const targets = this.nearestTo(target, extra);
      this.hit(u, target, dmg, ev);
      let falloff = 1;
      for (const e of targets) {
        falloff *= 1 - (eff.falloffPct as number) / 100;
        this.hit(u, e, this.damageOf(u, e) * falloff, ev);
      }
      return;
    }
    if (eff && ['splash', 'small_aoe', 'breath_aoe', 'aoe_stun'].includes(eff.type as string)) {
      const radius = (eff.radius as number) * AOE_UNIT * (1 + (u.aoeRadiusPctBonus ?? 0) / 100);
      this.hit(u, target, dmg, ev);
      for (const e of this.inRadius(target, radius)) {
        this.hit(u, e, this.damageOf(u, e), ev);
        if (eff.type === 'aoe_stun') {
          e.stunUntil = Math.max(e.stunUntil, this.elapsed + (eff.stunSec as number));
        }
      }
      if (eff.type === 'aoe_stun') {
        target.stunUntil = Math.max(target.stunUntil, this.elapsed + (eff.stunSec as number));
      }
      return;
    }

    // 단일 타겟
    this.hit(u, target, dmg, ev);
    if (eff?.type === 'slow_curse') {
      const pct = (eff.pct as number) + (u.extraSlowPct ?? 0);
      const dur = (eff.durationSec as number) * (1 + (u.debuffDurationPctBonus ?? 0) / 100);
      target.slowPct = Math.max(target.slowPct, pct);
      target.slowUntil = this.elapsed + dur;
    }
    if (eff?.type === 'gold_drop_chance' && this.rng() * 100 < (eff.pct as number)) {
      ev.goldEarned += eff.amount as number;
    }
  }

  /** 유닛 → 적 1회 공격 데미지 (저항/관통/보스 보너스/골드 비례 포함) */
  private damageOf(u: DeployedUnit, e: Enemy): number {
    const d = u.def;
    let dmg = d.baseDps * d.dpsFactor * d.attackInterval;
    dmg *= 1 + (u.attackPctBonus ?? 0) / 100;

    const eff = d.effect;
    const isSingleTarget = !eff || !['splash', 'small_aoe', 'breath_aoe', 'aoe_stun', 'chain_lightning'].includes(eff.type as string);
    if (isSingleTarget) dmg *= 1 + (u.singleTargetPctBonus ?? 0) / 100;

    if (e.isBoss && eff?.type === 'bonus_vs_boss') dmg *= 1 + (eff.pct as number) / 100;
    if (eff?.type === 'gold_scaling_damage') {
      dmg += this.getGold() * ((eff.pctOfGold as number) / 100);
    }

    // 물리 저항: melee/ranged에만 적용, magic·armor_pierce·♠6 시너지는 관통
    const resist = this.enemyTypes[e.type].physicalResist;
    if (resist > 0 && d.attackType !== 'magic' && eff?.type !== 'armor_pierce' && !u.armorPierce) {
      dmg *= 1 - resist;
    }
    return dmg;
  }

  private hit(u: DeployedUnit, e: Enemy, dmg: number, ev: BattleTickEvents): void {
    if (!e.alive) return;
    e.hp -= dmg;
    if (e.hp <= 0) {
      e.alive = false;
      ev.kills++;
      let gold = e.isBoss ? this.config.bossKillGold : this.config.baseKillGold;
      const eff = u.def.effect;
      if (eff?.type === 'kill_gold_multiplier') gold *= eff.mult as number;
      if (eff?.type === 'gold_on_kill') gold += eff.amount as number;
      gold += this.globalMods.killGoldBonus;
      gold *= 1 + this.globalMods.killGoldPct / 100;
      if (this.globalMods.bonusGoldChancePct > 0 && this.rng() * 100 < this.globalMods.bonusGoldChancePct) {
        gold += this.globalMods.bonusGoldAmount;
      }
      ev.goldEarned += gold;
    }
  }

  /** target 기준 원형 트랙 거리 radius 이내의 다른 생존 적 */
  private inRadius(target: Enemy, radius: number): Enemy[] {
    const L = this.config.trackLength;
    return this.enemies.filter((e) => {
      if (!e.alive || e === target) return false;
      const d = Math.abs(e.pos - target.pos);
      return Math.min(d, L - d) <= radius;
    });
  }

  /** target에서 가까운 순으로 n기 (체인 라이트닝) */
  private nearestTo(target: Enemy, n: number): Enemy[] {
    const L = this.config.trackLength;
    return this.enemies
      .filter((e) => e.alive && e !== target)
      .map((e) => {
        const d = Math.abs(e.pos - target.pos);
        return { e, d: Math.min(d, L - d) };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, n)
      .map((x) => x.e);
  }
}
