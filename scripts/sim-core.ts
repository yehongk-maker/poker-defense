/**
 * 헤드리스 밸런스 시뮬레이터 코어 — GDD Phase 2 "자동 시뮬레이터".
 * CLI는 simulate.ts, 회귀 테스트는 tests/Balance.test.ts가 이 모듈을 사용한다.
 *
 * 봇 전략:
 *  - highcard : 매 라운드 하이카드처럼 T1 1기만 소환(최악 케이스). 교환·영웅 없음, 골드는 다수 수트 업그레이드.
 *               → GDD 7 "하이카드/원페어로도 15웨이브는 버틴다" 검증용.
 *  - naive    : 즉시 확정, 합성, 골드 300 이상이면 ♠ 업그레이드 (GameLoop.test와 동일).
 *  - smart    : 족보 구성 카드 유지 + 나머지 한 장씩 교환, 합성, 영웅 즉시 소환·액티브 사용, 골드 전부 다수 수트 업그레이드.
 *               → GDD 9.5 "봇 기준 웨이브 21 저지선" 검증용.
 *
 * 출력: 전략별 승률·평균 도달 웨이브·웨이브 도달률(10/15/21/30/40)·패배 웨이브 히스토그램.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GameLoop, type GameData, type GamePhase } from '../src/systems/GameLoop.ts';


const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
const load = (f: string) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
const unitsJson = load('units.json');
const wavesJson = load('waves.json');
const handsJson = load('hands.json');

export type Mode = 'campaign' | 'duel';
const duelJson = load('duel.json');

/** 모드별 데이터: duel은 duel.json match 섹션(20웨이브 곡선·등급 경계·보스 조각 수)을 덮어쓴다 */
export function baseData(highcardOnly = false, mode: Mode = 'campaign'): GameData {
  const hands = structuredClone(handsJson);
  if (highcardOnly) {
    // 모든 족보를 하이카드 결과로 강제 (T1 1기, 조각 0)
    for (const k of Object.keys(hands)) {
      if (k === 'comment') continue;
      // TwoPair는 SummonMapper가 2슬롯을 요구하므로 [1,1] (4.75% 라운드만 2기 — 근사 허용)
      hands[k] = { summonTiers: k === 'TwoPair' ? [1, 1] : [1], shards: {}, heroSummon: false };
    }
  }
  const config = load('config.json');
  let wv = wavesJson;
  if (mode === 'duel') {
    const m = duelJson.match;
    wv = load(m.wavesFile);
    config.totalWaves = m.waves;
    config.hero = { ...config.hero, grades: m.hero.grades, bossShards: { ...config.hero.bossShards, amount: m.hero.bossShardAmount } };
  }
  return {
    units: unitsJson.units,
    hands,
    synergies: load('synergies.json'),
    heroes: load('heroes.json').heroes,
    waves: wv.waves,
    enemyTypes: wv.enemyTypes,
    battleConfig: wv.config,
    config,
  };
}

export function seededRng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

export type Bot = 'highcard' | 'naive' | 'smart';
import { dominantSuit, spendAllOnUpgrades, smartCardPhase, readyHero } from '../src/systems/bots.ts';

export function playGame(bot: Bot, seed: number, mode: Mode = 'campaign'): GameLoop {
  const g = new GameLoop(baseData(bot === 'highcard', mode), seededRng(seed));
  let guard = 0;
  while (g.phase === 'card' || g.phase === 'manage') {
    if (++guard > 200) throw new Error('loop guard');
    if (g.phase === 'card') {
      if (bot === 'smart') smartCardPhase(g);
      else g.confirmHand();
    }
    // 합성: T2 DPS(17.6) < T1×3(24)이므로 합성은 슬롯 압박 해소용. smart는 슬롯이 찰 때만 합성.
    const shouldMerge = bot !== 'smart' || g.units.length >= 23;
    if (shouldMerge) for (const id of g.mergeable) { try { g.mergeUnits(id); } catch { /* 경합 무시 */ } }
    if (bot === 'naive') {
      const h = readyHero(g);
      if (h) g.summonHero(h);
      while (g.gold > 300 && g.upgradeCost('S') !== null && g.upgradeCost('S')! < g.gold - 300) g.buyUpgrade('S');
    } else {
      if (bot === 'smart') {
        const h = readyHero(g);
        if (h) g.summonHero(h);
      }
      spendAllOnUpgrades(g, dominantSuit(g));
    }
    g.startCombat();
    const inCombat = () => (g.phase as GamePhase) === 'combat'; // getter 좁힘 회피
    for (let t = 0; t < 600 && inCombat(); t += 0.1) {
      // smart: 영웅 액티브는 쿨이 돌면 적이 3기 이상 있을 때 사용
      if (bot === 'smart' && g.heroSkillReady && g.battle && g.battle.aliveEnemies.length >= 3) g.useHeroSkill();
      g.tickCombat(0.1);
    }
    if (inCombat()) break; // 600초 교착 → 중단
  }
  return g;
}

export interface Stat { games: number; wins: number; waves: number[]; stalls: number; total: number }

export function run(bot: Bot, games: number, seed0: number, mode: Mode = 'campaign'): Stat {
  const total = baseData(false, mode).config.totalWaves;
  const st: Stat = { games, wins: 0, waves: [], stalls: 0, total };
  for (let i = 0; i < games; i++) {
    const g = playGame(bot, seed0 + i, mode);
    if (g.phase === 'victory') st.wins++;
    if (g.phase === 'combat') st.stalls++;
    st.waves.push(g.phase === 'victory' ? total + 1 : g.wave);
  }
  return st;
}

export function report(bot: Bot, st: Stat, csv: boolean): void {
  const n = st.games;
  const T = st.total;
  const marks = T === 40 ? [10, 15, 21, 30] : [Math.round(T * 0.25), Math.round(T * 0.4), Math.round(T * 0.55), Math.round(T * 0.75)];
  const reach = (w: number) => (st.waves.filter((x) => x >= w).length / n * 100).toFixed(0) + '%';
  const avg = (st.waves.reduce((a, b) => a + Math.min(b, T), 0) / n).toFixed(1);
  const sorted = [...st.waves].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];
  if (csv) {
    console.log([bot, n, st.wins, avg, median, ...marks.map(reach), reach(T + 1)].join(','));
    return;
  }
  console.log(`\n[${bot}]  games=${n}  total=${T}  win=${(st.wins / n * 100).toFixed(1)}%  avgWave=${avg}  median=${median === T + 1 ? 'WIN' : median}  stalls=${st.stalls}`);
  console.log(`  reach ${marks.map((m) => `≥${m}: ${reach(m)}`).join('   ')}   clear: ${reach(T + 1)}`);
  const hist = new Map<number, number>();
  for (const w of st.waves) hist.set(w, (hist.get(w) ?? 0) + 1);
  const line = [...hist.entries()].sort((a, b) => a[0] - b[0])
    .map(([w, c]) => `${w === T + 1 ? 'WIN' : 'w' + w}:${c}`).join(' ');
  console.log(`  ended at: ${line}`);
}

