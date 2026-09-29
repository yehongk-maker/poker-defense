/** 고스트전 (D단계): 다른 사람의 입력 로그를 대본으로 상대가 실시간으로 친다. 화면에는 봇과 구분되지 않는다 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GameLoop, type GameData, type GamePhase } from '../src/systems/GameLoop.ts';
import { buildGameData, rankedDuel, type ModeSources } from '../src/systems/GameMode.ts';
import { BettingSystem, pickPreset, type DuelConfig } from '../src/systems/Betting.ts';
import { seededRng, seedStreams } from '../src/systems/Seed.ts';
import { InputRecorder, type RoundInput } from '../src/systems/InputLog.ts';
import { AIOpponent } from '../src/systems/Opponent.ts';
import { smartExchange, smartManage } from '../src/systems/bots.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
const load = (f: string) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
const w = load('waves.json'), dw = load('duel-waves.json');
const duelCfg: DuelConfig = load('duel.json');
const base = (): GameData => ({ units: load('units.json').units, hands: load('hands.json'), synergies: load('synergies.json'), heroes: load('heroes.json').heroes, waves: w.waves, enemyTypes: w.enemyTypes, battleConfig: w.config, config: load('config.json') });
const sources = (): ModeSources => ({ base: base(), duelWaves: { waves: dw.waves, enemyTypes: dw.enemyTypes, battleConfig: dw.config }, duelMatch: duelCfg.match });
const duelData = () => buildGameData(sources(), rankedDuel('ghost', 's'), null);
const phaseOf = (g: GameLoop) => g.phase as GamePhase;
const ID = { name: '고스트주인', rating: 1040, avatar: 'H' as const };

/** 원본 판: 사람이 친 판을 흉내 (판돈 없이 — 고스트가 똑같이 따라 칠 수 있는 조건) */
function original(seed: string, player: string, frameSeed: number, maxWave = 99) {
  const data = duelData();
  const loop = new GameLoop(data, seedStreams(seed, { player }));
  const rec = new InputRecorder(loop, data.config.simStep);
  const f = seededRng(frameSeed);
  while (phaseOf(loop) === 'card' && loop.wave <= maxWave) {
    loop.cardPhase.tick(2 + f() * 10); // 고민한 시간 → confirmedAt
    smartExchange(loop);
    if (f() < 0.3 && loop.ticketsLeftRun > 0) loop.exchangeWithTicket(Math.floor(f() * 5));
    rec.bet(f() < 0.3 ? 'raise' : 'check');
    loop.confirmHand();
    const fresh = loop.unplacedUnits[0];
    if (fresh && loop.freeSlots.length > 0 && f() < 0.5) loop.moveUnit(fresh.slot, loop.freeSlots[Math.floor(f() * loop.freeSlots.length)]);
    smartManage(loop);
    loop.startCombat();
    while (phaseOf(loop) === 'combat') {
      if (loop.heroSkillReady && loop.battle!.aliveEnemies.length >= 3) loop.useHeroSkill();
      loop.tickCombat(1 / 60);
    }
  }
  return { loop, rounds: JSON.parse(JSON.stringify(rec.rounds)) as RoundInput[], data };
}
const run = (g: AIOpponent, dt: () => number, maxSec = 4000) => { for (let t = 0; t < maxSec && !g.finished;) { const d = dt(); g.tick(d); t += d; } };

describe('고스트 대본 재생', () => {
  it('판돈이 없으면 원래 판과 똑같이 친다 (도달 라운드·하트·골드·유닛)', () => {
    for (const seed of ['g1', 'g2', 'g3']) {
      const o = original(seed, 'owner', 3);
      const ghost = new AIOpponent(o.data, ID, seededRng(9), { script: { seed, player: 'owner', rounds: o.rounds } });
      run(ghost, () => 1 / 60);
      expect(ghost.finished).toBe(true);
      expect({ wave: ghost.loop.wave, phase: ghost.loop.phase, life: ghost.loop.life, gold: ghost.loop.gold }, seed)
        .toEqual({ wave: o.loop.wave, phase: o.loop.phase, life: o.loop.life, gold: o.loop.gold });
      expect(ghost.loop.units.map((u) => `${u.def.id}@${u.slot}`).sort()).toEqual(o.loop.units.map((u) => `${u.def.id}@${u.slot}`).sort());
      expect(ghost.scriptedRounds).toBe(o.rounds.filter((r) => r.ops!.some((op) => op[0] === 'c')).length);
    }
  });

  it('사람처럼 시간을 쓴다: 카드 선택은 그 사람이 고민한 만큼', () => {
    const o = original('pace', 'owner', 4);
    const ghost = new AIOpponent(o.data, ID, seededRng(9), { script: { seed: 'pace', player: 'owner', rounds: o.rounds } });
    let t = 0;
    while (phaseOf(ghost.loop) === 'card' && t < 60) { ghost.tick(0.05); t += 0.05; }
    expect(t).toBeGreaterThanOrEqual(Math.max(0.8, o.rounds[0].confirmedAt) - 0.1);
    expect(t).toBeLessThanOrEqual(o.rounds[0].confirmedAt + 0.2);
  });

  it('fastForward도 대본을 따른다', () => {
    const o = original('ff', 'owner', 5);
    const ghost = new AIOpponent(o.data, ID, seededRng(9), { script: { seed: 'ff', player: 'owner', rounds: o.rounds } });
    ghost.fastForward();
    expect({ wave: ghost.loop.wave, life: ghost.loop.life, gold: ghost.loop.gold }).toEqual({ wave: o.loop.wave, life: o.loop.life, gold: o.loop.gold });
  });

  it('대본이 중간에 끝나면(원래 판이 먼저 끝남) 봇 두뇌가 이어 받아 끝까지 친다', () => {
    const o = original('cut', 'owner', 6, 4); // 4라운드까지만 친 로그
    expect(o.rounds.length).toBeLessThanOrEqual(5);
    const ghost = new AIOpponent(o.data, ID, seededRng(9), { script: { seed: 'cut', player: 'owner', rounds: o.rounds }, thinkSec: [0.1, 0.2], manageSec: [0.1, 0.2] });
    run(ghost, () => 0.1);
    expect(ghost.finished).toBe(true);
    expect(ghost.scriptedRounds).toBe(4);
    expect(ghost.loop.wave).toBeGreaterThan(5);
  });

  it('새 상대와 판돈을 겨뤄 골드가 달라져도 멈추지 않는다 (못 하는 입력은 건너뜀)', () => {
    const o = original('bet', 'owner', 7);
    const ghost = new AIOpponent(o.data, ID, seededRng(9), { script: { seed: 'bet', player: 'owner', rounds: o.rounds } });
    const me = new GameLoop(o.data, seedStreams('bet', { player: 'me' }));
    const betting = new BettingSystem(duelCfg, { player: me, opponent: ghost.wallet });
    ghost.attachBetting(betting, duelCfg);
    // 나는 매 라운드 레이즈해서 고스트의 골드를 흔든다
    for (let t = 0; t < 4000 && !ghost.finished; t += 0.1) {
      betting.sync('player', me); betting.sync('opponent', ghost.participant);
      if (phaseOf(me) === 'card') {
        if (betting.options('player', me.wave).includes('raise')) betting.act('player', me.wave, 'raise');
        me.confirmHand();
        for (const u of [...me.units]) me.sellUnit(0); // 일부러 못 막게 → 매 라운드 하트를 잃는다
        me.startCombat();
      } else if (phaseOf(me) === 'combat') me.tickCombat(0.1);
      ghost.tick(0.1);
    }
    expect(ghost.finished).toBe(true);
    expect(ghost.scriptedRounds).toBeGreaterThan(3);
    expect(betting.history.length).toBeGreaterThan(3);
    // 대본의 옛 판돈 증감(g/l)은 쓰지 않는다: 골드 변화는 이번 판의 판돈에서만
    const responded = betting.history.filter((h) => h.reason === 'fold' || h.showdown).length;
    expect(responded).toBeGreaterThan(0);
  });

  it('대본의 오프닝(체크/레이즈)을 따라 건다', () => {
    const o = original('open', 'owner', 8);
    const ghost = new AIOpponent(o.data, ID, seededRng(9), { script: { seed: 'open', player: 'owner', rounds: o.rounds } });
    const wallet = { gold: 9999, life: 10, addGold() { /* */ }, spendGold() { /* */ }, loseLife() { /* */ } };
    const betting = new BettingSystem(duelCfg, { player: wallet, opponent: ghost.wallet });
    ghost.attachBetting(betting, duelCfg);
    while (ghost.loop.wave < 4 && !ghost.finished) { betting.sync('opponent', ghost.participant); ghost.tick(0.1); }
    for (const w of [1, 2, 3]) {
      const want = o.rounds[w - 1].bet[0].action;
      const got = betting.round(w)!.action.opponent;
      // 골드가 모자라 레이즈를 못 했으면 체크
      expect(got === want || (want === 'raise' && got === 'check'), `R${w} ${want}→${got}`).toBe(true);
    }
    expect([1, 2, 3].some((w) => betting.round(w)!.action.opponent === 'raise') || o.rounds.slice(0, 3).every((r) => r.bet[0].action === 'check')).toBe(true);
  });

  it('공개 정보는 봇 상대와 같은 모양이다 (대본 유무가 드러나지 않는다)', () => {
    const o = original('view', 'owner', 9);
    const ghost = new AIOpponent(o.data, ID, seededRng(9), { script: { seed: 'view', player: 'owner', rounds: o.rounds } });
    const bot = new AIOpponent(o.data, ID, seededRng(9));
    expect(Object.keys(ghost.view).sort()).toEqual(Object.keys(bot.view).sort());
    expect(ghost.identity).toEqual(bot.identity);
  });

  it('ops가 없는 옛 로그는 대본으로 쓰지 않고 봇 두뇌로 친다', () => {
    const o = original('old', 'owner', 10);
    const old = o.rounds.map(({ ops: _o, ...r }) => r) as RoundInput[];
    const ghost = new AIOpponent(o.data, ID, seededRng(9), { script: { seed: 'old', player: 'owner', rounds: old }, thinkSec: [0.1, 0.2], manageSec: [0.1, 0.2] });
    run(ghost, () => 0.1);
    expect(ghost.finished).toBe(true);
    expect(ghost.scriptedRounds).toBe(0);
  });
});

describe('봇 강도 프리셋', () => {
  const presets = duelCfg.ai.presets!;
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const reach = (id: string, games = 40) => {
    const preset = presets.find((p) => p.id === id)!;
    const out: number[] = [];
    for (let i = 0; i < games; i++) {
      const bot = new AIOpponent(duelData(), ID, seededRng(1000 + i), { preset });
      bot.fastForward();
      out.push(bot.loop.phase === 'victory' ? 21 : bot.loop.wave);
    }
    return median(out);
  };

  it('레이팅 구간으로 고른다', () => {
    expect(pickPreset(presets, 800)!.id).toBe('easy');
    expect(pickPreset(presets, 1000)!.id).toBe('normal');
    expect(pickPreset(presets, 1300)!.id).toBe('hard');
    expect(pickPreset(presets, null)).toBeUndefined();
    expect(pickPreset(undefined, 1000)).toBeUndefined();
  });

  it('강할수록 더 멀리 간다 (easy < normal < hard), 가장 약해도 초반에 무너지지 않는다', () => {
    const e = reach('easy'), n = reach('normal'), h = reach('hard');
    expect(e).toBeLessThan(n);
    expect(n).toBeLessThan(h);
    expect(e).toBeGreaterThanOrEqual(6);
  }, 60_000);

  it('약한 봇은 더 오래 고민한다', () => {
    const e = presets.find((p) => p.id === 'easy')!, h = presets.find((p) => p.id === 'hard')!;
    expect(e.thinkSec[0]).toBeGreaterThan(h.thinkSec[0]);
  });
});
