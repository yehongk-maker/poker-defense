/**
 * Battle — 한 웨이브의 전투 시뮬레이션 (적 순환 트랙 이동 + 유닛 자동 공격)
 *
 * GDD 3.5 (개정) 근거:
 *  - 적은 외곽 순환 트랙을 제한 시간(timeLimit) 동안 계속 돈다. 시간 안에 못 잡은 적 1기당 하트 차감
 *    (lifePerLeak, 보스는 bossLifePerLeak). 바퀴 수는 라이프에 영향 없음.
 *  - 적 타입: normal / fast(이속↑) / armored(물리저항, 마법은 관통) / regen(초당 회복) / boss
 *  - 유닛은 자기 슬롯에서 사거리(range, 셀 단위) 안의 적만 공격 (최전방 우선) → 배치가 중요
 *  - 사거리별 공격 배율 rangeDamageMult: 근접(짧은 사거리)일수록 강하다. 시너지로 사거리 +N(rangeBonus)·배율 덮어쓰기·제한 시간 +초·적 이속·시작 기절 주입
 *  - 공격 쿨타임 = attackInterval / 공속 배율
 *
 * 순수 로직: Phaser 의존 없음. 씬은 tick(dt)의 이벤트로 연출만 그린다.
 * 시너지/업그레이드는 DeployedUnit의 보너스 필드로 주입된다 (SynergySystem이 채움).
 */

import { type UnitDef } from './SummonMapper.ts';
import { inRange, type TrackGeometry } from './Geometry.ts';

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
  /** 제한 시간(초). 초과 시 남은 적은 이탈 → 하트 차감 */
  timeLimit: number;
  groups: WaveGroup[];
}

export interface BattleConfig {
  trackLength: number;
  /** 유닛 슬롯 격자 한 변 (5 → 25칸) */
  gridSize: number;
  baseEnemySpeed: number;
  baseKillGold: number;
  bossKillGold: number;
  clearGoldBase: number;
  clearGoldPerWave: number;
  /** 시간 초과 이탈 적 1기당 하트 차감 */
  lifePerLeak: number;
  bossLifePerLeak: number;
  /** 사거리(셀) → 공격 배율. 근접일수록 크다 (예: {"2":1.35,"3":1.0,"4":0.75}) */
  rangeDamageMult: Record<string, number>;
}

/** 필드에 배치된 유닛. 보너스 필드는 SynergySystem이 채운다 (기본 0/false). */
export interface DeployedUnit {
  def: UnitDef;
  /** 격자 슬롯 (0 ~ gridSize²-1). 사거리 판정의 기준점 */
  slot: number;
  /**
   * 배치 확정 여부. 소환(합성·영웅 포함) 직후 false → 정비에서 빈 칸으로 1회 이동 가능.
   * 이동하거나 전투가 시작되면 true가 되어 더는 못 움직인다 (판매는 항상 가능).
   */
  placed?: boolean;
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
  /** 사거리 +N 셀 (휴먼 7 / 전열 6 시너지) */
  rangeBonus?: number;
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

/** 연출용 타격 기록 (씬이 발사체/피격 이펙트를 그리는 데 사용) */
export interface HitEvent {
  unit: DeployedUnit;
  enemyId: number;
  dmg: number;
  killed: boolean;
  /** 영웅 액티브 스킬에 의한 타격 (연출 구분) */
  skill?: boolean;
}

/** 영웅 액티브 스킬 1회 사용 결과 */
export interface SkillOutcome {
  /** 영향받은 적 수 */
  affected: number;
  kills: number;
  goldEarned: number;
}

export interface BattleTickEvents {
  /** 이번 tick의 타격 목록 (연출용) */
  hits: HitEvent[];
  /** 이번 tick에 처치한 적 수 */
  kills: number;
  /** 이번 tick에 획득한 골드 (처치 + 효과) */
  goldEarned: number;
  /** 이번 tick에 잃은 라이프 (적 완주) */
  lifeLost: number;
  /** 이번 tick에 제한 시간이 끝났는가 */
  timeUp: boolean;
  /** 시간 초과로 이탈한 적 수 */
  leaked: number;
  /** 이번 tick 종료 기준 웨이브 종료 여부 (전멸 또는 시간 초과) */
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
  /** 전투 규칙 시너지 (SynergySystem.global에서 전달) */
  battleMods?: {
    /** 제한 시간 +초 (정령) */
    timeLimitBonus?: number;
    /** 적 이동 속도 % (몬스터 4: -8) */
    enemySpeedPct?: number;
    /** 웨이브 시작 시 적 기절 초 (몬스터 6) */
    waveStartStunSec?: number;
    /** 사거리별 공격 배율 덮어쓰기 (후열 6) */
    rangeMultOverride?: Record<string, number>;
  };
}

/** 광역 radius 1당 트랙 거리 */
const AOE_UNIT = 3;

export class Battle {
  private enemies: Enemy[] = [];
  private spawnQueue: { type: string; at: number }[] = [];
  private elapsed = 0;
  private timeUp = false;
  private nextEnemyId = 1;
  readonly geometry: TrackGeometry;
  // ── 영웅 액티브 스킬 상태 ──
  /** tick 밖(스킬 사용)에서 발생한 이벤트 — 다음 tick 결과에 합산 */
  private pending: BattleTickEvents = Battle.emptyEvents();
  /** 암석 방벽: 이 시각까지 모든 적 정지 (스폰되는 적 포함) */
  private freezeUntil = 0;
  /** 성역: 이 시각까지 시간 초과 이탈 하트 피해 무효 */
  private sanctuaryUntil = 0;
  /** 천둥 폭풍: 무작위 낙뢰 */
  private storm: { until: number; boltDmg: number; rate: number; acc: number; source: DeployedUnit } | null = null;
  /** 심연 소환: 임시 포탑 */
  private tempUnits: { unit: DeployedUnit; until: number }[] = [];
  private getGold: () => number;
  private rng: () => number;
  private globalMods: { killGoldBonus: number; killGoldPct: number; bonusGoldChancePct: number; bonusGoldAmount: number };
  private battleMods: { timeLimitBonus: number; enemySpeedPct: number; waveStartStunSec: number };
  private rangeMult: Record<string, number>;

  constructor(
    private waveDef: WaveDef,
    private enemyTypes: Record<string, EnemyTypeDef>,
    private units: DeployedUnit[],
    private config: BattleConfig,
    options: BattleOptions = {}
  ) {
    this.geometry = { trackLength: config.trackLength, gridSize: config.gridSize };
    const maxSlot = config.gridSize * config.gridSize;
    for (const u of units) {
      if (!Number.isInteger(u.slot) || u.slot < 0 || u.slot >= maxSlot) throw new Error(`Invalid slot ${u.slot} for ${u.def.id}`);
    }
    this.getGold = options.getGold ?? (() => 0);
    this.rng = options.rng ?? Math.random;
    this.globalMods = {
      killGoldBonus: options.globalMods?.killGoldBonus ?? 0,
      killGoldPct: options.globalMods?.killGoldPct ?? 0,
      bonusGoldChancePct: options.globalMods?.bonusGoldChancePct ?? 0,
      bonusGoldAmount: options.globalMods?.bonusGoldAmount ?? 0,
    };
    this.battleMods = {
      timeLimitBonus: options.battleMods?.timeLimitBonus ?? 0,
      enemySpeedPct: options.battleMods?.enemySpeedPct ?? 0,
      waveStartStunSec: options.battleMods?.waveStartStunSec ?? 0,
    };
    this.rangeMult = { ...config.rangeDamageMult, ...(options.battleMods?.rangeMultOverride ?? {}) };

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

  /** 전투 경과 시간(초) */
  get time(): number {
    return this.elapsed;
  }

  get aliveEnemies(): readonly Enemy[] {
    return this.enemies.filter((e) => e.alive);
  }

  /** 스킬로 소환된 임시 유닛 (UI 표시용) */
  get temporaryUnits(): readonly DeployedUnit[] {
    return this.tempUnits.map((t) => t.unit);
  }

  /** 성역 남은 시간(초) */
  get sanctuaryRemaining(): number {
    return Math.max(0, this.sanctuaryUntil - this.elapsed);
  }

  /** 방벽 남은 시간(초) */
  get freezeRemaining(): number {
    return Math.max(0, this.freezeUntil - this.elapsed);
  }

  private static emptyEvents(): BattleTickEvents {
    return { hits: [], kills: 0, goldEarned: 0, lifeLost: 0, timeUp: false, leaked: 0, cleared: false };
  }

  get allSpawned(): boolean {
    return this.spawnQueue.length === 0;
  }

  get cleared(): boolean {
    return this.timeUp || (this.allSpawned && this.enemies.every((e) => !e.alive));
  }

  /** 남은 제한 시간(초) */
  get timeRemaining(): number {
    return Math.max(0, this.timeLimit - this.elapsed);
  }

  /** 제한 시간 (웨이브 값 + 정령 시너지 보너스) */
  get timeLimit(): number {
    return this.waveDef.timeLimit + this.battleMods.timeLimitBonus;
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
    const ev: BattleTickEvents = Battle.emptyEvents();
    if (this.timeUp) { ev.cleared = true; return ev; }
    // 0) 스킬 사용으로 쌓인 이벤트 합산
    if (this.pending.hits.length > 0 || this.pending.kills > 0 || this.pending.goldEarned > 0) {
      ev.hits.push(...this.pending.hits);
      ev.kills += this.pending.kills;
      ev.goldEarned += this.pending.goldEarned;
      this.pending = Battle.emptyEvents();
    }

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
      if (this.elapsed < e.stunUntil || this.elapsed < this.freezeUntil) continue; // 기절/방벽: 이동 정지
      const slow = this.elapsed < e.slowUntil ? e.slowPct / 100 : 0;
      const speed = this.config.baseEnemySpeed * t.speedMult * (1 - slow) * (1 + this.battleMods.enemySpeedPct / 100);
      e.pos += speed * dt;
      while (e.pos >= this.config.trackLength) {
        e.pos -= this.config.trackLength;
        e.laps++; // 바퀴 수는 표시용. 라이프는 시간 초과 시에만 차감
      }
    }

    // 2.5) 천둥 폭풍: 무작위 적에게 낙뢰
    if (this.storm) {
      if (this.elapsed >= this.storm.until) this.storm = null;
      else {
        this.storm.acc += this.storm.rate * dt;
        while (this.storm.acc >= 1) {
          this.storm.acc -= 1;
          const alive = this.aliveEnemies;
          if (alive.length === 0) break;
          const target = alive[Math.min(alive.length - 1, Math.floor(this.rng() * alive.length))];
          this.hit(this.storm.source, target, this.storm.boltDmg, ev, true);
        }
      }
    }
    // 2.6) 임시 포탑 만료
    this.tempUnits = this.tempUnits.filter((t) => this.elapsed < t.until);

    // 3) 유닛 공격: 자기 사거리 안의 최전방 적만 (임시 포탑 포함)
    for (const u of [...this.units, ...this.tempUnits.map((t) => t.unit)]) {
      u._cooldown = (u._cooldown ?? 0) - dt;
      const interval = u.def.attackInterval / (1 + (u.attackSpeedPctBonus ?? 0) / 100);
      while (u._cooldown! <= 0) {
        const target = this.frontmostInRange(u);
        if (!target) break;
        this.attack(u, target, ev);
        u._cooldown! += interval;
      }
      if (u._cooldown! < 0) u._cooldown = 0; // 사거리 안에 적이 없으면 즉시 발사 대기
    }

    // 4) 제한 시간 종료: 남은 적 이탈 → 하트 차감
    if (this.elapsed >= this.timeLimit) {
      this.timeUp = true;
      ev.timeUp = true;
      const sanctuary = this.elapsed < this.sanctuaryUntil; // 성역: 하트 피해 무효
      for (const e of this.enemies) {
        if (!e.alive) continue;
        e.alive = false;
        ev.leaked++;
        if (!sanctuary) ev.lifeLost += e.isBoss ? this.config.bossLifePerLeak : this.config.lifePerLeak;
      }
    }

    ev.cleared = this.cleared;
    return ev;
  }

  /** 유닛 사거리 안의 최전방 적 (누적 이동거리 최대) */
  private frontmostInRange(u: DeployedUnit): Enemy | null {
    let best: Enemy | null = null;
    let bestDist = -1;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (!inRange(this.geometry, u.slot, u.def.range + (u.rangeBonus ?? 0), e.pos)) continue;
      const d = e.laps * this.config.trackLength + e.pos;
      if (d > bestDist) { bestDist = d; best = e; }
    }
    return best;
  }

  /** 슬롯에서 사거리 안에 있는 생존 적 수 (UI/디버그용) */
  enemiesInRangeOf(slot: number, range: number): number {
    return this.enemies.filter((e) => e.alive && inRange(this.geometry, slot, range, e.pos)).length;
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
      // 몬스터 6 시너지: 웨이브 시작 직후 스폰된 적은 waveStartStunSec까지 기절
      stunUntil: this.elapsed < this.battleMods.waveStartStunSec ? this.battleMods.waveStartStunSec : 0,
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
    dmg *= this.rangeMult[String(d.range)] ?? 1; // 근접일수록 강하게 (후열 6 시너지는 덮어쓰기)
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

  private hit(u: DeployedUnit, e: Enemy, dmg: number, ev: BattleTickEvents, skill = false): void {
    if (!e.alive) return;
    e.hp -= dmg;
    const killed = e.hp <= 0;
    ev.hits.push({ unit: u, enemyId: e.id, dmg, killed, skill });
    if (killed) {
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

  // ── 영웅 액티브 스킬 API (GameLoop.useHeroSkill이 호출) ──────────────

  /** 대지 강타: 생존 적 전체에 dmg + 기절 */
  damageAllEnemies(source: DeployedUnit, dmg: number, stunSec = 0): SkillOutcome {
    return this.skillHits(source, this.aliveEnemies, () => dmg, stunSec);
  }

  /** 처형 검격: 현재 HP가 높은 순 n기에 dmg */
  hitTopHpEnemies(source: DeployedUnit, n: number, dmg: number): SkillOutcome {
    const targets = [...this.aliveEnemies].sort((a, b) => b.hp - a.hp).slice(0, n);
    return this.skillHits(source, targets, () => dmg);
  }

  /** 황금 탄환: 최대 HP가 가장 큰 적 즉사 (보스는 최대 HP의 bossPct%) */
  executeHighestHp(source: DeployedUnit, bossPct: number): SkillOutcome {
    const alive = this.aliveEnemies;
    if (alive.length === 0) return { affected: 0, kills: 0, goldEarned: 0 };
    const target = alive.reduce((a, b) => (b.maxHp > a.maxHp ? b : a));
    return this.skillHits(source, [target], (e) => (e.isBoss ? e.maxHp * bossPct / 100 : e.hp + 1));
  }

  /** 암석 방벽: sec 동안 모든 적 정지 (이후 스폰 포함) */
  freezeEnemies(sec: number): SkillOutcome {
    this.freezeUntil = Math.max(this.freezeUntil, this.elapsed + sec);
    return { affected: this.aliveEnemies.length, kills: 0, goldEarned: 0 };
  }

  /** 성역: sec 동안 시간 초과 이탈 하트 피해 무효 */
  setSanctuary(sec: number): SkillOutcome {
    this.sanctuaryUntil = Math.max(this.sanctuaryUntil, this.elapsed + sec);
    return { affected: 0, kills: 0, goldEarned: 0 };
  }

  /** 대약탈: 생존 적 전체 감속 + 적당 골드 강탈 */
  slowAllEnemies(pct: number, sec: number, goldPerEnemy: number): SkillOutcome {
    const alive = this.aliveEnemies;
    for (const e of alive) {
      e.slowPct = Math.max(e.slowPct, pct);
      e.slowUntil = Math.max(e.slowUntil, this.elapsed + sec);
    }
    const gold = alive.length * goldPerEnemy;
    this.pending.goldEarned += gold;
    return { affected: alive.length, kills: 0, goldEarned: gold };
  }

  /** 심연 소환: sec 동안 유지되는 임시 유닛(유령 포탑) 추가 */
  addTemporaryUnits(units: DeployedUnit[], sec: number): SkillOutcome {
    for (const u of units) {
      u._cooldown = 0;
      this.tempUnits.push({ unit: u, until: this.elapsed + sec });
    }
    return { affected: units.length, kills: 0, goldEarned: 0 };
  }

  /** 천둥 폭풍: sec 동안 초당 rate발 낙뢰(boltDmg)를 무작위 적에게 */
  startStorm(source: DeployedUnit, boltDmg: number, boltsPerSec: number, sec: number): SkillOutcome {
    this.storm = { until: this.elapsed + sec, boltDmg, rate: boltsPerSec, acc: 0, source };
    return { affected: this.aliveEnemies.length, kills: 0, goldEarned: 0 };
  }

  private skillHits(source: DeployedUnit, targets: readonly Enemy[], dmgOf: (e: Enemy) => number, stunSec = 0): SkillOutcome {
    const before = { kills: this.pending.kills, gold: this.pending.goldEarned };
    for (const e of targets) {
      if (!e.alive) continue;
      this.hit(source, e, dmgOf(e), this.pending, true);
      if (stunSec > 0) e.stunUntil = Math.max(e.stunUntil, this.elapsed + stunSec);
    }
    return { affected: targets.length, kills: this.pending.kills - before.kills, goldEarned: this.pending.goldEarned - before.gold };
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
