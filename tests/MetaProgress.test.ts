/**
 * MetaProgress — 젬·영구 업그레이드·영웅 해금·마일스톤·저장/복원 (GDD 3.4 / 9.4)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MetaProgress, MemoryStore, emptyMetaState, type MetaConfig } from '../src/systems/MetaProgress.ts';
import { GameLoop, type GameData } from '../src/systems/GameLoop.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
const load = (f: string) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
const cfg: MetaConfig = load('config.json').meta;
const heroes = load('heroes.json').heroes as { id: string; unlock: 'basic' | 'meta' }[];
const wavesJson = load('waves.json');
const mk = (store = new MemoryStore()) => new MetaProgress(cfg, store, heroes);

describe('초기 상태와 설정', () => {
  it('젬 0, 업그레이드 0단계, 기본 영웅 4종만 해금', () => {
    const m = mk();
    expect(m.gems).toBe(0);
    expect(m.level('exchange_plus1')).toBe(0);
    expect(m.unlockedHeroIds.length).toBe(4);
    expect(m.unlockedHeroIds.every((id) => heroes.find((h) => h.id === id)!.unlock === 'basic')).toBe(true);
  });
  it('config.meta: 업그레이드 3종 + 영웅 해금 비용 + 젬 보상 정의', () => {
    expect(cfg.upgrades.map((u) => u.id)).toEqual(['exchange_plus1', 'timer_plus10', 'start_gold_plus100']);
    expect(cfg.heroUnlockCost).toBe(300);
    expect(cfg.gemRewards.waveMilestones.map((m) => m.wave)).toEqual([10, 20, 30, 40]);
  });
});

describe('구매와 해금', () => {
  it('젬 부족이면 throw, 충분하면 차감 + 단계 상승, max에서 null', () => {
    const m = mk();
    expect(m.canBuy('timer_plus10')).toBe(false);
    expect(() => m.buyUpgrade('timer_plus10')).toThrow(/Not enough/);
    m.addGems(1000);
    m.buyUpgrade('timer_plus10');
    expect(m.gems).toBe(700);
    expect(m.level('timer_plus10')).toBe(1);
    expect(m.upgradeCost('timer_plus10')).toBeNull();
    expect(() => m.buyUpgrade('timer_plus10')).toThrow(/maxed/);
    m.buyUpgrade('start_gold_plus100'); m.buyUpgrade('start_gold_plus100'); m.buyUpgrade('start_gold_plus100');
    expect(m.level('start_gold_plus100')).toBe(3);
    expect(m.upgradeCost('start_gold_plus100')).toBeNull();
    expect(() => m.buyUpgrade('nope')).toThrow(/Unknown/);
  });
  it('메타 영웅 해금: 젬 300, 기본 영웅/중복은 throw', () => {
    const m = mk();
    m.addGems(300);
    expect(m.canUnlockHero('steel_annihilator')).toBe(true);
    m.unlockHero('steel_annihilator');
    expect(m.gems).toBe(0);
    expect(m.isHeroUnlocked('steel_annihilator')).toBe(true);
    expect(m.unlockedHeroIds.length).toBe(5);
    expect(() => m.unlockHero('steel_annihilator')).toThrow(/already/);
    expect(() => m.unlockHero('black_archduke')).toThrow(/basic/);
    expect(() => m.unlockHero('tomb_king')).toThrow(/Not enough/);
  });
});

describe('판 종료 보상', () => {
  it('마일스톤은 최초 1회만, 판당 5, 승리 50, 최고 기록 갱신', () => {
    const m = mk();
    const r1 = m.recordRun({ wave: 12, victory: false });
    expect(r1.gemsGained).toBe(5 + 20);
    expect(r1.newMilestones).toEqual([10]);
    expect(r1.newBest).toBe(true);
    const r2 = m.recordRun({ wave: 11, victory: false });
    expect(r2.gemsGained).toBe(5); // 10 마일스톤은 이미 받음
    expect(r2.newBest).toBe(false);
    const r3 = m.recordRun({ wave: 40, victory: true });
    expect(r3.newMilestones).toEqual([20, 30, 40]);
    expect(r3.gemsGained).toBe(5 + 30 + 50 + 100 + 50);
    expect(m.stats).toEqual({ runs: 3, wins: 1, bestWave: 40, totalGemsEarned: 25 + 5 + 235 });
  });
});

describe('저장/복원', () => {
  it('같은 저장소로 다시 만들면 상태가 복원된다', () => {
    const store = new MemoryStore();
    const a = mk(store);
    a.addGems(800);
    a.buyUpgrade('exchange_plus1');
    a.unlockHero('tomb_king');
    a.recordRun({ wave: 21, victory: false });
    const b = mk(store);
    expect(b.snapshot).toEqual(a.snapshot);
    expect(b.level('exchange_plus1')).toBe(1);
    expect(b.isHeroUnlocked('tomb_king')).toBe(true);
    expect(b.stats.bestWave).toBe(21);
  });
  it('손상된/구버전 저장은 초기 상태로', () => {
    expect(MetaProgress.parse('not json')).toEqual(emptyMetaState());
    expect(MetaProgress.parse(JSON.stringify({ version: 0, gems: 999 }))).toEqual(emptyMetaState());
    expect(MetaProgress.parse(JSON.stringify({ version: 1, gems: -5 })).gems).toBe(0);
  });
  it('reset은 저장소도 비운다', () => {
    const store = new MemoryStore();
    const m = mk(store);
    m.addGems(10);
    expect(store.load()).not.toBeNull();
    m.reset();
    expect(store.load()).toBeNull();
    expect(m.gems).toBe(0);
  });
});

describe('GameData 반영', () => {
  const base = (): GameData => {
    const u = load('units.json');
    return { units: u.units, hands: load('hands.json'), synergies: load('synergies.json'), heroes: load('heroes.json').heroes,
      waves: wavesJson.waves, enemyTypes: wavesJson.enemyTypes, battleConfig: wavesJson.config, config: load('config.json') };
  };
  it('교환 2회·타이머 40초·시작 골드 +300·해금 영웅이 GameLoop에 들어간다 (원본 불변)', () => {
    const m = mk();
    m.addGems(2000);
    m.buyUpgrade('exchange_plus1'); m.buyUpgrade('timer_plus10');
    for (let i = 0; i < 3; i++) m.buyUpgrade('start_gold_plus100');
    m.unlockHero('storm_tyrant');
    const data = base();
    const applied = m.applyTo(data);
    expect(data.config.startGold).toBe(100);
    expect(applied.config.startGold).toBe(400);
    const g = new GameLoop(applied, () => 0.5);
    expect(g.gold).toBe(400);
    expect(g.cardPhase.exchangeLimit).toBe(2);
    expect(g.cardPhase.timerSeconds).toBe(40);
    expect(g.unlockedHeroes.map((h) => h.id)).toContain('storm_tyrant');
    expect(g.unlockedHeroes.length).toBe(5);
  });
  it('업그레이드 없으면 기본값 그대로', () => {
    const g = new GameLoop(mk().applyTo(base()), () => 0.5);
    expect(g.gold).toBe(100);
    expect(g.cardPhase.exchangeLimit).toBe(1);
    expect(g.cardPhase.timerSeconds).toBe(30);
    expect(g.unlockedHeroes.length).toBe(4);
  });
});
