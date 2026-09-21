/**
 * MetaProgress — 판을 넘어 유지되는 성장 (GDD 3.4 영구 메타 업그레이드, 9.4 젬 이코노미)
 *
 *  - 젬: 웨이브 마일스톤 최초 도달(10/20/30/40), 판당 소량, 승리 보너스로 획득
 *  - 메타 업그레이드: 교환 +1회 / 타이머 +10초 / 시작 골드 +100×N — "편의"까지만 (유닛 데미지 판매 금지)
 *  - 메타 영웅 해금: 젬으로 4종
 *  - 저장: SaveStore(localStorage 등)에 JSON. 버전 필드로 마이그레이션 대비
 *
 * 순수 로직: 저장소는 주입(DI). 브라우저에서는 storage.ts의 localStorage 어댑터를 쓴다.
 */

import type { GameData } from './GameLoop.ts';

export interface MetaUpgradeDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
  max: number;
}

export interface MetaConfig {
  saveKey: string;
  upgrades: MetaUpgradeDef[];
  heroUnlockCost: number;
  gemRewards: {
    waveMilestones: { wave: number; gems: number }[];
    perRun: number;
    victory: number;
  };
}

export interface MetaState {
  version: 1;
  gems: number;
  /** 업그레이드 id → 구매 단계 */
  upgrades: Record<string, number>;
  /** 젬으로 해금한 메타 영웅 id */
  unlockedHeroes: string[];
  /** 젬을 받은 마일스톤 웨이브 */
  claimedMilestones: number[];
  stats: { runs: number; wins: number; bestWave: number; totalGemsEarned: number };
}

export interface SaveStore {
  load(): string | null;
  save(json: string): void;
  clear(): void;
}

/** 테스트/시뮬용 메모리 저장소 */
export class MemoryStore implements SaveStore {
  private data: string | null = null;
  load(): string | null { return this.data; }
  save(json: string): void { this.data = json; }
  clear(): void { this.data = null; }
}

export interface RunResult {
  /** 종료 시점 웨이브 (패배 시 그 웨이브, 승리 시 totalWaves) */
  wave: number;
  victory: boolean;
}

export interface RunReward {
  gemsGained: number;
  /** 이번에 처음 달성한 마일스톤 웨이브 */
  newMilestones: number[];
  newBest: boolean;
}

export function emptyMetaState(): MetaState {
  return { version: 1, gems: 0, upgrades: {}, unlockedHeroes: [], claimedMilestones: [], stats: { runs: 0, wins: 0, bestWave: 0, totalGemsEarned: 0 } };
}

export class MetaProgress {
  private state: MetaState;

  constructor(private config: MetaConfig, private store: SaveStore, private heroIds: { id: string; unlock: 'basic' | 'meta' }[]) {
    this.state = MetaProgress.parse(store.load());
  }

  /** 저장 문자열 → 상태 (손상/구버전이면 초기 상태) */
  static parse(json: string | null): MetaState {
    if (!json) return emptyMetaState();
    try {
      const raw = JSON.parse(json) as Partial<MetaState>;
      if (raw.version !== 1) return emptyMetaState();
      const base = emptyMetaState();
      return {
        version: 1,
        gems: Math.max(0, Number(raw.gems) || 0),
        upgrades: { ...(raw.upgrades ?? {}) },
        unlockedHeroes: [...(raw.unlockedHeroes ?? [])],
        claimedMilestones: [...(raw.claimedMilestones ?? [])],
        stats: { ...base.stats, ...(raw.stats ?? {}) },
      };
    } catch {
      return emptyMetaState();
    }
  }

  // ── 조회 ──
  get gems(): number { return this.state.gems; }
  get stats(): Readonly<MetaState['stats']> { return this.state.stats; }
  get snapshot(): MetaState { return JSON.parse(JSON.stringify(this.state)); }
  get upgradeDefs(): readonly MetaUpgradeDef[] { return this.config.upgrades; }
  level(id: string): number { return this.state.upgrades[id] ?? 0; }
  /** 다음 단계 비용 (최대면 null) */
  upgradeCost(id: string): number | null {
    const def = this.config.upgrades.find((u) => u.id === id);
    if (!def) throw new Error(`Unknown meta upgrade: ${id}`);
    return this.level(id) >= def.max ? null : def.cost;
  }
  canBuy(id: string): boolean {
    const c = this.upgradeCost(id);
    return c !== null && this.state.gems >= c;
  }
  get heroUnlockCost(): number { return this.config.heroUnlockCost; }
  isHeroUnlocked(id: string): boolean {
    const h = this.heroIds.find((h) => h.id === id);
    return !!h && (h.unlock === 'basic' || this.state.unlockedHeroes.includes(id));
  }
  get unlockedHeroIds(): string[] {
    return this.heroIds.filter((h) => this.isHeroUnlocked(h.id)).map((h) => h.id);
  }
  canUnlockHero(id: string): boolean {
    const h = this.heroIds.find((h) => h.id === id);
    return !!h && h.unlock === 'meta' && !this.isHeroUnlocked(id) && this.state.gems >= this.config.heroUnlockCost;
  }
  hasClaimed(wave: number): boolean { return this.state.claimedMilestones.includes(wave); }

  // ── 변경 (전부 저장) ──
  buyUpgrade(id: string): void {
    const cost = this.upgradeCost(id);
    if (cost === null) throw new Error(`${id} is maxed`);
    if (this.state.gems < cost) throw new Error(`Not enough gems: need ${cost}, have ${this.state.gems}`);
    this.state.gems -= cost;
    this.state.upgrades[id] = this.level(id) + 1;
    this.persist();
  }

  unlockHero(id: string): void {
    const h = this.heroIds.find((h) => h.id === id);
    if (!h) throw new Error(`Unknown hero: ${id}`);
    if (h.unlock !== 'meta') throw new Error(`${id} is a basic hero`);
    if (this.isHeroUnlocked(id)) throw new Error(`${id} already unlocked`);
    if (this.state.gems < this.config.heroUnlockCost) throw new Error(`Not enough gems: need ${this.config.heroUnlockCost}, have ${this.state.gems}`);
    this.state.gems -= this.config.heroUnlockCost;
    this.state.unlockedHeroes.push(id);
    this.persist();
  }

  /** 젬 직접 지급 (스타터팩·일일 미션 등 외부 지급용) */
  addGems(n: number): void {
    if (n <= 0) return;
    this.state.gems += n;
    this.state.stats.totalGemsEarned += n;
    this.persist();
  }

  /** 한 판 종료 → 마일스톤·판당·승리 젬 지급, 통계 갱신, 저장 */
  recordRun(result: RunResult): RunReward {
    const r = this.config.gemRewards;
    const newMilestones: number[] = [];
    let gained = r.perRun;
    for (const m of r.waveMilestones) {
      if (result.wave >= m.wave && !this.hasClaimed(m.wave)) {
        this.state.claimedMilestones.push(m.wave);
        newMilestones.push(m.wave);
        gained += m.gems;
      }
    }
    if (result.victory) gained += r.victory;
    this.state.gems += gained;
    this.state.stats.totalGemsEarned += gained;
    this.state.stats.runs++;
    if (result.victory) this.state.stats.wins++;
    const newBest = result.wave > this.state.stats.bestWave;
    if (newBest) this.state.stats.bestWave = result.wave;
    this.persist();
    return { gemsGained: gained, newMilestones, newBest };
  }

  reset(): void {
    this.state = emptyMetaState();
    this.store.clear();
  }

  /** 메타 효과를 GameData에 반영한 복사본 (원본 불변) */
  applyTo(data: GameData): GameData {
    const exchangeLimit = 1 + this.level('exchange_plus1');
    const timerSeconds = 30 + 10 * this.level('timer_plus10');
    const startGold = data.config.startGold + 100 * this.level('start_gold_plus100');
    return {
      ...data,
      config: { ...data.config, startGold },
      cardPhase: { ...(data.cardPhase ?? {}), exchangeLimit, timerSeconds },
      unlockedHeroes: this.unlockedHeroIds,
    };
  }

  private persist(): void {
    this.store.save(JSON.stringify(this.state));
  }
}
