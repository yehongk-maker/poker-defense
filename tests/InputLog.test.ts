/** 결정론 입력 로그 (docs/mode-design.md §2.2): 시드 스트림, 고정 step, 기록 → 재생 = 같은 성적 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GameLoop, type GameData, type GamePhase } from '../src/systems/GameLoop.ts';
import { buildGameData, rankedDuel, friendDuel, RANKED_RULES, CAMPAIGN, type ModeSources } from '../src/systems/GameMode.ts';
import { hashSeed, seededRng, seedStreams, randomSeed } from '../src/systems/Seed.ts';
import { InputRecorder, replayMatch, logChecksum, type RoundInput } from '../src/systems/InputLog.ts';
import { smartExchange, smartManage } from '../src/systems/bots.ts';
import { verifyMatchLog } from '../src/net/verifyMatch.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
const load = (f: string) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
const w = load('waves.json'), dw = load('duel-waves.json');
const base = (): GameData => ({ units: load('units.json').units, hands: load('hands.json'), synergies: load('synergies.json'), heroes: load('heroes.json').heroes, waves: w.waves, enemyTypes: w.enemyTypes, battleConfig: w.config, config: load('config.json') });
const sources = (): ModeSources => ({ base: base(), duelWaves: { waves: dw.waves, enemyTypes: dw.enemyTypes, battleConfig: dw.config }, duelMatch: load('duel.json').match });
const duelData = () => buildGameData(sources(), rankedDuel('live', 's'), null);
const phaseOf = (g: GameLoop) => g.phase as GamePhase;

/**
 * 사람처럼 들쭉날쭉한 프레임으로 한 판을 친다: smart 봇 + 교환권 + 판돈 흉내(외부 골드·하트) + 영웅 스킬.
 * frame은 프레임 길이 난수 — 재생에는 쓰이지 않는다.
 */
function play(seed: string, player: string, frameSeed: number, opt: { stopAtWave?: number; stopAfterSteps?: number } = {}) {
  const data = duelData();
  const loop = new GameLoop(data, seedStreams(seed, { player }));
  const rec = new InputRecorder(loop, data.config.simStep);
  const frame = seededRng(frameSeed);
  let guard = 0;
  while ((phaseOf(loop) === 'card' || phaseOf(loop) === 'manage') && ++guard < 100) {
    if (opt.stopAtWave === loop.wave && opt.stopAfterSteps === undefined) break;
    // 판돈 흉내: 앤티를 내고, 가끔 하트로 대납
    const ante = 5 + loop.wave;
    if (loop.gold >= ante) loop.spendGold(ante); else loop.loseLife(1);
    if (phaseOf(loop) === 'defeat') break;
    smartExchange(loop);
    if (frame() < 0.3 && loop.ticketsLeftRun > 0) loop.exchangeWithTicket(Math.floor(frame() * 5));
    if (frame() < 0.5) rec.bet(frame() < 0.5 ? 'check' : 'raise');
    loop.confirmHand();
    const fresh = loop.unplacedUnits[0];
    if (fresh && loop.freeSlots.length > 0 && frame() < 0.5) loop.moveUnit(fresh.slot, loop.freeSlots[Math.floor(frame() * loop.freeSlots.length)]);
    if (loop.units.length > 6 && frame() < 0.2) loop.sellUnit(Math.floor(frame() * loop.units.length));
    smartManage(loop);
    loop.startCombat();
    let frames = 0;
    while (phaseOf(loop) === 'combat' && ++frames < 100000) {
      if (opt.stopAtWave === loop.wave && opt.stopAfterSteps !== undefined && loop.combatSteps >= opt.stopAfterSteps) return { loop, rec, data };
      if (loop.heroSkillReady && loop.battle!.aliveEnemies.length >= 3) loop.useHeroSkill();
      if (frame() < 0.01) loop.addGold(7); // 전투 중에 팟을 받는 경우
      loop.tickCombat(0.004 + frame() * 0.05); // 4~54ms 프레임
    }
  }
  return { loop, rec, data };
}
const finalOf = (g: GameLoop, total: number) => ({ reached: g.phase === 'victory' ? total + 1 : g.wave, life: g.life, gold: g.gold, phase: g.phase });

describe('Seed — 시드 난수와 스트림', () => {
  it('같은 글자 시드는 같은 수열, 다른 시드는 다른 수열', () => {
    const a = seededRng(hashSeed('abc')), b = seededRng(hashSeed('abc')), c = seededRng(hashSeed('abd'));
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('전투 스트림은 양쪽이 같고, 손패 스트림은 플레이어마다 다르다', () => {
    const p1 = seedStreams('m1', { player: 'a' }), p2 = seedStreams('m1', { player: 'b' });
    expect(p1.combat(3)()).toBe(p2.combat(3)());
    expect(p1.hand(3)()).not.toBe(p2.hand(3)());
    expect(p1.hand(3)()).not.toBe(p1.hand(4)());
  });

  it('동일 손패 규칙: 앞 라운드에서 교환을 다르게 해도 다음 라운드에 같은 5장을 받는다', () => {
    const data = buildGameData(sources(), friendDuel({ ...RANKED_RULES, sharedHand: true }, 'm2'), null);
    const a = new GameLoop(data, seedStreams('m2', { player: 'a', sharedHand: true }));
    const b = new GameLoop(data, seedStreams('m2', { player: 'b', sharedHand: true }));
    expect(a.cardPhase.hand).toEqual(b.cardPhase.hand);
    a.cardPhase.exchangeCard(0); a.cardPhase.exchangeCard(1); // a만 교환
    for (const g of [a, b]) {
      g.confirmHand(); g.startCombat();
      while (phaseOf(g) === 'combat') g.stepCombat();
    }
    expect(a.wave).toBe(2);
    expect(b.wave).toBe(2);
    expect(a.cardPhase.hand).toEqual(b.cardPhase.hand);
  });

  it('손패 규칙이 "각자"면 첫 패부터 다르다', () => {
    const data = duelData();
    const a = new GameLoop(data, seedStreams('m3', { player: 'a' }));
    const b = new GameLoop(data, seedStreams('m3', { player: 'b' }));
    expect(a.cardPhase.hand).not.toEqual(b.cardPhase.hand);
  });

  it('무작위 시드는 16진 16자', () => {
    expect(randomSeed(seededRng(1))).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('고정 step 전투', () => {
  it('대전 모드는 simStep이 있고 캠페인은 없다', () => {
    expect(duelData().config.simStep).toBe(0.1);
    expect(buildGameData(sources(), CAMPAIGN, null).config.simStep).toBeUndefined();
  });

  it('프레임 길이가 달라도 결과가 같다', () => {
    const run = (dt: () => number) => {
      const g = new GameLoop(duelData(), seedStreams('fx', { player: 'a' }));
      for (let r = 0; r < 4 && phaseOf(g) === 'card'; r++) {
        g.confirmHand(); g.startCombat();
        while (phaseOf(g) === 'combat') g.tickCombat(dt());
      }
      return { wave: g.wave, gold: g.gold, life: g.life, last: g.lastRound };
    };
    const f = seededRng(9);
    const a = run(() => 0.1), b = run(() => 1 / 60), c = run(() => 0.003 + f() * 0.2);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('step이 안 찼으면 진행하지 않고, 보간 비율을 알려준다', () => {
    const g = new GameLoop(duelData(), seedStreams('fx', { player: 'a' }));
    g.confirmHand(); g.startCombat();
    g.tickCombat(0.04);
    expect(g.combatSteps).toBe(0);
    expect(g.combatAlpha).toBeCloseTo(0.4);
    g.tickCombat(0.27);
    expect(g.combatSteps).toBe(3);
    expect(g.battle!.time).toBeCloseTo(0.3);
  });
});

describe('입력 로그 기록 → 재생', () => {
  it('100판: 재생한 라운드 성적·최종 성적이 원본과 100% 일치', () => {
    let rounds = 0, skills = 0, tickets = 0;
    for (let i = 0; i < 100; i++) {
      const seed = `match-${i}`;
      const { loop, rec, data } = play(seed, 'me', 1000 + i);
      const log = rec.rounds;
      const re = replayMatch(data, seedStreams(seed, { player: 'me' }), log);
      expect(re.issues, `seed ${seed}`).toEqual([]);
      expect(re.final).toEqual(finalOf(loop, data.config.totalWaves));
      rounds += re.reports.length;
      skills += log.reduce((s, r) => s + r.skills.length, 0);
      tickets += log.reduce((s, r) => s + r.ticketExchanges, 0);
    }
    // 테스트가 실제로 여러 입력을 거쳤는지
    expect(rounds).toBeGreaterThan(500);
    expect(skills).toBeGreaterThan(0);
    expect(tickets).toBeGreaterThan(100);
  });

  it('로그는 JSON으로 보냈다 받아도 그대로 재생된다', () => {
    const { loop, rec, data } = play('json', 'me', 5);
    const wire = JSON.parse(JSON.stringify(rec.rounds)) as RoundInput[];
    const re = replayMatch(data, seedStreams('json', { player: 'me' }), wire);
    expect(re.ok).toBe(true);
    expect(re.final.gold).toBe(loop.gold);
    expect(logChecksum(wire)).toBe(rec.checksum());
  });

  it('요약 필드가 ops와 맞는다', () => {
    const { rec } = play('sum', 'me', 6);
    for (const r of rec.rounds) {
      const ops = r.ops!;
      expect(r.exchanges.length).toBe(ops.filter((o) => o[0] === 'x' || o[0] === 'xt').length);
      expect(r.ticketExchanges).toBe(ops.filter((o) => o[0] === 'xt').length);
      expect(r.manage.upgrades.length).toBe(ops.filter((o) => o[0] === 'up').length);
      expect(r.skills.length).toBe(ops.filter((o) => o[0] === 'sk').length);
      if (!r.partial) expect(r.combatSec).toBeCloseTo(r.steps! * 0.1, 6);
    }
  });

  it('다른 시드·다른 플레이어 키로는 재생이 맞지 않는다', () => {
    const { rec, data } = play('right', 'me', 7);
    expect(replayMatch(data, seedStreams('wrong', { player: 'me' }), rec.rounds).ok).toBe(false);
    expect(replayMatch(data, seedStreams('right', { player: 'you' }), rec.rounds).ok).toBe(false);
  });

  it('성적을 고치면 잡힌다', () => {
    const { rec, data } = play('cheat', 'me', 8);
    const log = rec.rounds;
    const i = log.findIndex((r) => !r.partial && r.result.lifeLost > 0);
    expect(i).toBeGreaterThanOrEqual(0);
    log[i] = { ...log[i], result: { ...log[i].result, lifeLost: 0 } };
    const re = replayMatch(data, seedStreams('cheat', { player: 'me' }), log);
    expect(re.issues).toContain(`r${i + 1}:life_mismatch`);
  });

  it('없는 골드로 한 업그레이드·상한을 넘는 교환권은 실행 단계에서 막힌다', () => {
    const { rec, data } = play('gold', 'me', 9);
    const log = rec.rounds;
    const ups = Array.from({ length: 30 }, () => ['up', 'S'] as ['up', 'S']);
    const at = log[0].ops!.findIndex((o) => o[0] === 'go');
    const a = [{ ...log[0], ops: [...log[0].ops!.slice(0, at), ...ups, ...log[0].ops!.slice(at)] }, ...log.slice(1)];
    expect(replayMatch(data, seedStreams('gold', { player: 'me' }), a).issues).toContain('r1:op_failed:up');

    const xt = Array.from({ length: 4 }, () => ['xt', 0] as ['xt', number]);
    const b = [{ ...log[0], ops: [...xt, ...log[0].ops!] }, ...log.slice(1)];
    expect(replayMatch(data, seedStreams('gold', { player: 'me' }), b).issues).toContain('r1:op_failed:xt');
  });

  it('ops가 없는 옛 로그는 재생할 수 없다고 알린다', () => {
    const { rec, data } = play('old', 'me', 10);
    const log = rec.rounds.map(({ ops: _ops, ...r }) => r);
    expect(replayMatch(data, seedStreams('old', { player: 'me' }), log).issues).toEqual(['r1:ops_missing']);
  });

  it('판이 중간에 끝난 라운드(상대가 먼저 클리어)는 partial로 남고 그 지점까지 재생된다', () => {
    const { loop, rec, data } = play('part', 'me', 11, { stopAtWave: 4, stopAfterSteps: 25 });
    expect(loop.phase).toBe('combat');
    const log = rec.rounds;
    const last = log[log.length - 1];
    expect(last).toMatchObject({ wave: 4, partial: true });
    expect(last.steps).toBeGreaterThanOrEqual(25);
    const re = replayMatch(data, seedStreams('part', { player: 'me' }), log);
    expect(re.issues).toEqual([]);
    expect(re.reports.length).toBe(3);
    expect(re.final).toEqual({ reached: 4, life: loop.life, gold: loop.gold, phase: 'combat' });
  });

  it('기록기를 붙이지 않은 판은 평소와 똑같이 돈다 (기록이 결과를 바꾸지 않는다)', () => {
    const data = duelData();
    const plain = new GameLoop(data, seedStreams('same', { player: 'me' }));
    const taped = new GameLoop(data, seedStreams('same', { player: 'me' }));
    new InputRecorder(taped, data.config.simStep);
    for (const g of [plain, taped]) {
      for (let r = 0; r < 5 && phaseOf(g) === 'card'; r++) {
        smartExchange(g); g.confirmHand(); smartManage(g); g.startCombat();
        while (phaseOf(g) === 'combat') g.stepCombat();
      }
    }
    expect({ w: taped.wave, g: taped.gold, l: taped.life }).toEqual({ w: plain.wave, g: plain.gold, l: plain.life });
  });
});

describe('매치 검증 (개연성 + 재생) — verify-match 함수와 같은 코드', () => {
  const input = (loop: GameLoop, seed: string, total: number) => ({
    seed, playerId: 'me', waveCount: total, rules: RANKED_RULES,
    report: { reached: loop.phase === 'victory' ? total + 1 : loop.wave, life: loop.life, gold: Math.floor(loop.gold), clearedSec: null },
    wallSec: 3600,
  });
  // 검증 대상 판: 판돈 흉내·교환권 없이(개연성 검사의 베팅·교환 규칙과 무관하게) 재생만 본다
  function cleanGame(seed: string) {
    const data = duelData();
    const loop = new GameLoop(data, seedStreams(seed, { player: 'me' }));
    const rec = new InputRecorder(loop, data.config.simStep);
    while (phaseOf(loop) === 'card') {
      smartExchange(loop); loop.confirmHand(); smartManage(loop); loop.startCombat();
      while (phaseOf(loop) === 'combat') loop.tickCombat(1 / 60);
    }
    return { loop, rec, data };
  }

  it('정상 로그는 통과하고 재생까지 한다', () => {
    const { loop, rec, data } = cleanGame('v1');
    const r = verifyMatchLog(sources(), JSON.parse(JSON.stringify(rec.rounds)), input(loop, 'v1', data.config.totalWaves));
    expect(r).toEqual({ ok: true, issues: [], replayed: true });
  });

  it('보고한 성적이 재생 결과와 다르면 잡힌다', () => {
    const { loop, rec, data } = cleanGame('v2');
    const m = input(loop, 'v2', data.config.totalWaves);
    const r = verifyMatchLog(sources(), rec.rounds, { ...m, report: { ...m.report, life: m.report.life + 1, gold: m.report.gold + 500 } });
    expect(r.issues).toEqual(expect.arrayContaining(['replay:life', 'replay:gold']));
  });

  it('메타 적용 방은 재생하지 않는다 (서버가 메타를 모른다)', () => {
    const { loop, rec, data } = cleanGame('v3');
    const m = input(loop, 'v3', data.config.totalWaves);
    const r = verifyMatchLog(sources(), rec.rounds, { ...m, rules: { ...RANKED_RULES, applyMeta: true } });
    expect(r.replayed).toBe(false);
  });

  it('ops 없는 로그는 통과하지 못한다', () => {
    const { loop, rec, data } = cleanGame('v4');
    const stripped = rec.rounds.map(({ ops: _ops, ...r }) => r);
    const r = verifyMatchLog(sources(), stripped, input(loop, 'v4', data.config.totalWaves));
    expect(r.ok).toBe(false);
    expect(r.issues).toContain('replay:r1:ops_missing');
  });
});
