/** 모드 분리 (docs/mode-design.md §2.1): GameMode 프리셋·데이터 조립, 상대 추상화, 부활, 이어하기, 광고 보상 교환 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CAMPAIGN, RANKED_RULES, buildGameData, friendDuel, isDuel, rankedDuel, type MetaEffects, type ModeSources } from '../src/systems/GameMode.ts';
import { GameLoop, type GameData } from '../src/systems/GameLoop.ts';
import { AIOpponent, localBotIdentity, LOCAL_BOT_NAMES } from '../src/systems/Opponent.ts';
import { BettingSystem, type DuelConfig } from '../src/systems/Betting.ts';
import { raceStatus, sideOf } from '../src/systems/Duel.ts';
import { CardPhase } from '../src/systems/CardPhase.ts';
import { StubAdService } from '../src/systems/Ads.ts';
import { parseHand } from '../src/systems/PokerEvaluator.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
const load = (f: string) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
const w = load('waves.json'), dw = load('duel-waves.json');
const duelCfg: DuelConfig = load('duel.json');
const base = (): GameData => ({ units: load('units.json').units, hands: load('hands.json'), synergies: load('synergies.json'), heroes: load('heroes.json').heroes, waves: w.waves, enemyTypes: w.enemyTypes, battleConfig: w.config, config: load('config.json') });
const sources = (): ModeSources => ({ base: base(), duelWaves: { waves: dw.waves, enemyTypes: dw.enemyTypes, battleConfig: dw.config }, duelMatch: duelCfg.match });
const META: MetaEffects = { exchangeLimit: 2, timerSeconds: 40, startGoldBonus: 200, unlockedHeroes: ['black_archduke', 'steel_annihilator'] };
function rng(seed: number) { let s = seed; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; }; }

describe('GameMode 프리셋', () => {
  it('캠페인: 40웨이브·상대 없음·판돈 없음·광고·메타 적용·이어하기', () => {
    expect(CAMPAIGN).toMatchObject({ waves: 40, opponent: 'none', betting: false, ads: true, applyMeta: true, resumable: true, world: 'solo', maxSpeed: 3, tickets: -1 });
    expect(isDuel(CAMPAIGN)).toBe(false);
  });

  it('랭크 대전: 20웨이브·판돈·광고 없음·메타 미적용·영웅 전부·배속 고정·교환권 3회', () => {
    const m = rankedDuel('ai', 'seed1');
    expect(m).toMatchObject({ id: 'ranked_duel', waves: 20, betting: true, ads: false, applyMeta: false, allHeroes: true, maxSpeed: 1, tickets: 3, world: 'duel', rewards: 'ranked', resumable: false, seed: 'seed1' });
    expect(isDuel(m)).toBe(true);
  });

  it('친구 대전: 방장 규칙을 따르고, 기본과 다르면 custom', () => {
    expect(friendDuel(RANKED_RULES).custom).toBe(false);
    const m = friendDuel({ ...RANKED_RULES, waves: 40, betting: false, speed: 2, tickets: -1, applyMeta: true, allHeroes: false });
    expect(m).toMatchObject({ id: 'friend_duel', waves: 40, betting: false, maxSpeed: 2, tickets: -1, applyMeta: true, allHeroes: false, rewards: 'friendly', custom: true, opponent: 'live' });
  });
});

describe('buildGameData — 모드 규칙을 데이터로', () => {
  it('캠페인: 40웨이브 + 메타(교환 2회·타이머 40초·시작 골드 +200·해금 영웅), 교환권 무제한', () => {
    const d = buildGameData(sources(), CAMPAIGN, META);
    expect(d.waves.length).toBe(40);
    expect(d.config.totalWaves).toBe(40);
    expect(d.config.startGold).toBe(300);
    expect(d.cardPhase).toEqual({ exchangeLimit: 2, timerSeconds: 40 });
    expect(d.unlockedHeroes).toEqual(META.unlockedHeroes);
    expect(d.config.ticketsPerRun).toBeUndefined();
    expect(d.config.hero.grades.S.minRemainingWaves).toBe(20);
    const g = new GameLoop(d, rng(1));
    expect(g.gold).toBe(300);
    expect(g.cardPhase.exchangeLimit).toBe(2);
  });

  it('랭크: 20웨이브 곡선 + 등급 경계 S10/A5 + 보스 조각 + 교환권 3회, 메타는 무시되고 영웅 전부 개방', () => {
    const d = buildGameData(sources(), rankedDuel('ai'), META);
    expect(d.waves.length).toBe(20);
    expect(d.waves.filter((x) => x.boss).map((x) => x.wave)).toEqual([5, 10, 15, 20]);
    expect(d.config.totalWaves).toBe(20);
    expect(d.config.startGold).toBe(100);
    expect(d.cardPhase).toEqual({});
    expect(d.config.ticketsPerRun).toBe(3);
    expect(d.config.hero.grades.S.minRemainingWaves).toBe(duelCfg.match.hero.grades.S.minRemainingWaves);
    expect(d.config.hero.bossShards!.amount).toBe(duelCfg.match.hero.bossShardAmount);
    expect(d.unlockedHeroes!.length).toBe(base().heroes.length);
    const g = new GameLoop(d, rng(2));
    expect(g.heroGradeNow).toBe('S');
    expect(g.heroGradeDrop).toEqual({ until: 11, next: 'A' });
  });

  it('원본 데이터는 바뀌지 않는다', () => {
    const src = sources();
    buildGameData(src, rankedDuel('ai'), META);
    expect(src.base.config.totalWaves).toBe(40);
    expect(src.base.config.startGold).toBe(100);
    expect(src.base.config.hero.grades.S.minRemainingWaves).toBe(20);
  });

  it('상대(봇)는 메타 없이 같은 규칙으로 만든다', () => {
    const d = buildGameData(sources(), rankedDuel('ai'), null);
    expect(d.config.startGold).toBe(100);
    expect(d.unlockedHeroes!.length).toBe(base().heroes.length);
  });
});

describe('상대 추상화 (AIOpponent)', () => {
  it('공개 정보(view)만 내보낸다: 손패·아웃·게이지 없음', () => {
    const d = buildGameData(sources(), rankedDuel('ai'), null);
    const o = new AIOpponent(d, { name: '하트왕', rating: 1010, avatar: 'H' }, rng(5), { thinkSec: [0.5, 0.5], manageSec: [0.2, 0.2] });
    for (let t = 0; t < 3; t += 0.1) o.tick(0.1);
    const v = o.view;
    expect(v.phase).toBe('combat');
    expect(v.units.length).toBeGreaterThan(0);
    expect(v.units[0]).toHaveProperty('slot');
    expect(v.lastHandRank).not.toBeNull();
    expect(JSON.stringify(v)).not.toMatch(/hand"|outs|pity|deck/);
    expect(o.identity.name).toBe('하트왕');
  });

  it('판돈·레이스 판정에 그대로 쓸 수 있다', () => {
    const d = buildGameData(sources(), rankedDuel('ai'), null);
    const me = new GameLoop(buildGameData(sources(), rankedDuel('ai'), META), rng(6));
    const o = new AIOpponent(d, { name: 'x봇', rating: 1000, avatar: 'S' }, rng(7), { thinkSec: [0.3, 0.3], manageSec: [0.1, 0.1] });
    const bet = new BettingSystem(duelCfg, { player: me, opponent: o.wallet });
    o.attachBetting(bet, duelCfg);
    bet.sync('player', me);
    for (let t = 0; t < 2; t += 0.1) { bet.sync('opponent', o.participant); o.tick(0.1); }
    expect(bet.round(1)!.action.opponent).not.toBeNull();
    expect(raceStatus(sideOf(me), sideOf(o.view), 20)).toBeNull();
    o.fastForward();
    expect(o.finished).toBe(true);
  });

  it('로컬 대체 상대 닉: 최근 닉은 피하고 레이팅은 ±80', () => {
    const avoid = LOCAL_BOT_NAMES.slice(1);
    const id = localBotIdentity(1200, rng(9), avoid);
    expect(id.name).toBe(LOCAL_BOT_NAMES[0]);
    for (let i = 1; i < 50; i++) {
      const x = localBotIdentity(1200, rng(i));
      expect(Math.abs(x.rating! - 1200)).toBeLessThanOrEqual(80);
      expect(['S', 'H', 'D', 'C']).toContain(x.avatar);
    }
  });
});

describe('부활 (캠페인 광고 보상)', () => {
  const dead = () => {
    const g = new GameLoop(buildGameData(sources(), CAMPAIGN, null), rng(11));
    g.confirmHand();
    g.startCombat();
    for (let t = 0; t < 3; t += 0.1) g.tickCombat(0.1);
    g.loseLife(99); // 전투 중 하트 0 → 탈락
    return g;
  };

  it('탈락 후 부활: 하트 3, 같은 웨이브의 카드 페이즈부터', () => {
    const g = dead();
    expect(g.phase).toBe('defeat');
    const wave = g.wave;
    g.revive(3, 1);
    expect(g.phase).toBe('card');
    expect(g.life).toBe(3);
    expect(g.wave).toBe(wave);
    expect(g.cardPhase.state).toBe('choosing');
    expect(g.revivesUsed).toBe(1);
  });

  it('판당 한 번만, 탈락 상태가 아니면 불가', () => {
    const g = dead();
    g.revive(3, 1);
    expect(() => g.revive(3, 1)).toThrow(/Invalid phase/);
    g.loseLife(99);
    expect(g.phase).toBe('defeat');
    expect(() => g.revive(3, 1)).toThrow(/한 번/);
  });
});

describe('이어하기 (snapshot / restore)', () => {
  it('유닛·영웅·골드·하트·조각·업그레이드·게이지·사용 횟수를 복원하고 카드 페이즈로 시작한다', () => {
    const data = buildGameData(sources(), CAMPAIGN, META);
    const g = new GameLoop(data, rng(21));
    (g.cardPhase as unknown as { handCards: unknown[] }).handCards = parseHand('7S 7H 7D 7C KS'); // 포카드 → 와일드 3
    g.confirmHand();
    g.buyUpgrade('S');
    g.summonHero('black_archduke');
    g.startCombat();
    for (let t = 0; t < 120 && g.phase === 'combat'; t += 0.1) g.tickCombat(0.1);
    expect(g.phase).toBe('card');
    g.cardPhase.restorePity({ straight: 2 });
    g.exchangeWithTicket(0);

    const snap = JSON.parse(JSON.stringify(g.snapshot()));
    const r = GameLoop.restore(data, snap, rng(22));
    expect(r.phase).toBe('card');
    expect(r.wave).toBe(g.wave);
    expect(r.gold).toBe(g.gold);
    expect(r.life).toBe(g.life);
    expect(r.shards).toEqual(g.shards);
    expect(r.units.map((u) => [u.def.id, u.slot, u.placed])).toEqual(g.units.map((u) => [u.def.id, u.slot, true]));
    expect(r.hero!.def.id).toBe('black_archduke');
    expect(r.hero!.grade).toBe(g.hero!.grade);
    expect(r.hero!.unit.def.baseDps).toBe(g.hero!.unit.def.baseDps);
    expect(r.upgrades).toEqual(g.upgrades);
    expect(r.cardPhase.pityLevels.straight).toBe(2);
    expect(r.ticketsUsedRun).toBe(1);
    expect(r.activeSynergies.map((s) => s.key)).toEqual(g.activeSynergies.map((s) => s.key));
    // 복원한 판은 그대로 진행된다
    r.confirmHand(); r.startCombat();
    for (let t = 0; t < 120 && r.phase === 'combat'; t += 0.1) r.tickCombat(0.1);
    expect(['card', 'defeat']).toContain(r.phase);
  });

  it('맞지 않는 저장(웨이브 범위 밖·없는 유닛·겹친 슬롯)은 거절한다', () => {
    const data = buildGameData(sources(), CAMPAIGN, null);
    const snap = new GameLoop(data, rng(23)).snapshot();
    expect(() => GameLoop.restore(data, { ...snap, wave: 99 })).toThrow();
    expect(() => GameLoop.restore(data, { ...snap, units: [{ id: 'no_such_unit', slot: 0 }] })).toThrow();
    expect(() => GameLoop.restore(data, { ...snap, units: [{ id: 'imp', slot: 3 }, { id: 'imp', slot: 3 }] })).toThrow();
    expect(() => GameLoop.restore(buildGameData(sources(), rankedDuel('ai'), null), { ...snap, wave: 30 })).toThrow(); // 20웨이브 모드에 30
  });
});

describe('광고 보상 교환 (보너스)', () => {
  it('보너스는 기본 교환을 다 쓴 카드도 바꾸고, 라운드가 바뀌면 사라진다', () => {
    const p = new CardPhase({}, rng(31));
    p.start();
    p.exchangeCard(0);
    expect(p.canExchange(0)).toBe(false);
    expect(() => p.exchangeWithBonus(0)).toThrow(/No bonus/);
    p.grantBonusExchange(1);
    expect(p.bonusExchanges).toBe(1);
    p.exchangeWithBonus(0);
    expect(p.bonusExchanges).toBe(0);
    expect(p.bonusUsed).toBe(1);
    expect(p.exchangesUsed).toBe(1); // 기본 교환 카운터는 그대로
    p.grantBonusExchange(2);
    p.confirm();
    p.start();
    expect(p.bonusExchanges).toBe(0);
  });

  it('StubAdService: 시청 완료를 돌려주고 기록을 남긴다', async () => {
    const ads = new StubAdService();
    expect(await ads.show('revive')).toBe(true);
    expect(ads.shown).toEqual(['revive']);
    expect(await new StubAdService(false, false).show('extra_exchange')).toBe(false);
  });
});
