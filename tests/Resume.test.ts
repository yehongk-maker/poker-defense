/** 대전 이어하기 (재접속): 저장 → 복원한 판이 끊기지 않은 판과 같다 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GameLoop, type GameData, type GamePhase } from '../src/systems/GameLoop.ts';
import { buildGameData, rankedDuel, type ModeSources } from '../src/systems/GameMode.ts';
import { BettingSystem, type BetWallet, type DuelConfig } from '../src/systems/Betting.ts';
import { seededRng, seedStreams } from '../src/systems/Seed.ts';
import { InputRecorder, replayMatch, type RoundInput } from '../src/systems/InputLog.ts';
import { isSavedMatch, resumeLoop, resumedClock, type SavedMatch } from '../src/systems/MatchResume.ts';
import { AIOpponent } from '../src/systems/Opponent.ts';
import { smartExchange, smartManage } from '../src/systems/bots.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
const load = (f: string) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
const w = load('waves.json'), dw = load('duel-waves.json');
const duelCfg: DuelConfig = load('duel.json');
const base = (): GameData => ({ units: load('units.json').units, hands: load('hands.json'), synergies: load('synergies.json'), heroes: load('heroes.json').heroes, waves: w.waves, enemyTypes: w.enemyTypes, battleConfig: w.config, config: load('config.json') });
const sources = (): ModeSources => ({ base: base(), duelWaves: { waves: dw.waves, enemyTypes: dw.enemyTypes, battleConfig: dw.config }, duelMatch: duelCfg.match });
const MODE = rankedDuel('live', 'resume-seed');
const data = () => buildGameData(sources(), MODE, null);
const phaseOf = (g: GameLoop) => g.phase as GamePhase;
const wire = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** 입력을 주는 "사람": 같은 상태면 같은 선택을 한다 (난수 없이 상태로만 결정) */
function playUntil(loop: GameLoop, stop: (g: GameLoop) => boolean): void {
  let guard = 0;
  while (!stop(loop) && ++guard < 200000) {
    const ph = phaseOf(loop);
    if (ph === 'card') {
      if (loop.gold >= 6) loop.spendGold(5 + loop.wave); // 앤티 흉내
      smartExchange(loop);
      if (loop.wave % 3 === 0 && loop.ticketsLeftRun > 0) loop.exchangeWithTicket(loop.wave % 5);
      loop.confirmHand();
    } else if (ph === 'manage') {
      smartManage(loop);
      loop.startCombat();
    } else if (ph === 'combat') {
      if (loop.heroSkillReady && loop.battle!.aliveEnemies.length >= 3) loop.useHeroSkill();
      loop.stepCombat();
    } else break;
  }
}
const stateOf = (g: GameLoop) => ({ wave: g.wave, phase: g.phase, life: g.life, gold: g.gold, steps: g.phase === 'combat' ? g.combatSteps : 0, units: g.units.map((u) => `${u.def.id}@${u.slot}`).sort(), hand: g.phase === 'card' ? g.cardPhase.hand.map((c) => `${c.rank}${c.suit}`) : [] });
const HAND = 'k:resume-secret';
const saved = (rounds: RoundInput[], cardElapsed = 0): Pick<SavedMatch, 'seed' | 'handKey' | 'mode' | 'rounds' | 'cardElapsed'> => wire({ seed: 'resume-seed', handKey: HAND, mode: MODE, rounds, cardElapsed });

function fresh() {
  const d = data();
  const loop = new GameLoop(d, seedStreams('resume-seed', { handKey: HAND }));
  const rec = new InputRecorder(loop, d.config.simStep);
  return { d, loop, rec };
}

describe('내 판 복원', () => {
  it.each([
    ['전투 중', (g: GameLoop) => g.wave === 5 && phaseOf(g) === 'combat' && g.combatSteps >= 17],
    ['정비 중', (g: GameLoop) => g.wave === 4 && phaseOf(g) === 'manage'],
    ['카드 선택 중(막 받은 패)', (g: GameLoop) => g.wave === 6 && phaseOf(g) === 'card'],
  ])('%s에 끊겨도 같은 상태로 돌아온다', (_n, stop) => {
    const a = fresh();
    playUntil(a.loop, stop);
    const r = resumeLoop(a.d, saved(a.rec.rounds));
    expect(stateOf(r.loop)).toEqual(stateOf(a.loop));
  });

  it('이어서 끝까지 치면 끊기지 않은 판과 결과가 같고, 합쳐진 로그는 서버 재생 검증을 통과한다', () => {
    const whole = fresh();
    playUntil(whole.loop, () => false);

    const a = fresh();
    playUntil(a.loop, (g) => g.wave === 7 && phaseOf(g) === 'combat' && g.combatSteps >= 30);
    const r = resumeLoop(a.d, saved(a.rec.rounds));
    playUntil(r.loop, () => false);
    expect(stateOf(r.loop)).toEqual(stateOf(whole.loop));
    expect(wire(r.recorder.rounds)).toEqual(wire(whole.rec.rounds));
    const re = replayMatch(data(), seedStreams('resume-seed', { handKey: HAND }), wire(r.recorder.rounds));
    expect(re.issues).toEqual([]);
    expect(re.final.gold).toBe(whole.loop.gold);
  });

  it('두 번 끊겨도 된다', () => {
    const whole = fresh();
    playUntil(whole.loop, () => false);
    const a = fresh();
    playUntil(a.loop, (g) => g.wave === 3 && phaseOf(g) === 'combat' && g.combatSteps >= 5);
    const b = resumeLoop(a.d, saved(a.rec.rounds));
    playUntil(b.loop, (g) => g.wave === 9 && phaseOf(g) === 'manage');
    const c = resumeLoop(a.d, saved(b.recorder.rounds));
    playUntil(c.loop, () => false);
    expect(stateOf(c.loop)).toEqual(stateOf(whole.loop));
  });

  it('카드 선택에 쓴 시간은 되돌아오지 않는다 (새로고침으로 제한 시간을 늘릴 수 없다)', () => {
    const a = fresh();
    playUntil(a.loop, (g) => g.wave === 2 && phaseOf(g) === 'card');
    const full = a.loop.cardPhase.timerSeconds;
    expect(resumeLoop(a.d, saved(a.rec.rounds, 12)).loop.cardPhase.timeRemaining).toBeCloseTo(full - 12);
    // 시간을 다 썼어도 복원 직후 자동 확정되지는 않는다 (씬이 1초 뒤 확정)
    const late = resumeLoop(a.d, saved(a.rec.rounds, 999)).loop;
    expect(late.phase).toBe('card');
    expect(late.cardPhase.timeRemaining).toBeLessThanOrEqual(1.01);
  });

  it('고친 저장(없는 골드로 한 업그레이드)은 복원되지 않는다', () => {
    const a = fresh();
    playUntil(a.loop, (g) => g.wave === 3 && phaseOf(g) === 'manage');
    const rounds = wire(a.rec.rounds);
    rounds[1].ops = [...rounds[1].ops!.filter((o) => o[0] !== 'go'), ...Array.from({ length: 30 }, () => ['up', 'S'] as ['up', 'S']), ['go']];
    expect(() => resumeLoop(a.d, saved(rounds))).toThrow(/resume_failed/);
  });

  it('저장 형식 검사와 매치 시계', () => {
    expect(isSavedMatch(null)).toBe(false);
    expect(isSavedMatch({ version: 1 })).toBe(false);
    const s: SavedMatch = { version: 1, kind: 'online', matchId: 'm', roomCode: null, me: 'me', opponentId: null, identity: { name: 'x', rating: 1000, avatar: 'S' }, mode: MODE, playerId: 'me', seed: 's', handKey: HAND, rounds: [], cardElapsed: 0, betting: null, opponent: null, clock: 100, savedAt: 1_000_000, bestRank: -1 };
    expect(isSavedMatch(wire(s))).toBe(true);
    expect(isSavedMatch({ ...wire(s), handKey: undefined })).toBe(false); // 손패 키 없는 옛 저장은 버린다
    expect(resumedClock(s, 1_020_000)).toBe(120);
    expect(resumedClock(s, 999_000)).toBe(100);
  });
});

describe('판돈 상태 저장/복원', () => {
  class Wallet implements BetWallet {
    constructor(public gold: number, public life = 10) {}
    addGold(n: number) { this.gold += n; }
    spendGold(n: number) { if (this.gold < n) throw new Error('gold'); this.gold -= n; }
    loseLife(n: number) { this.life = Math.max(0, this.life - n); }
  }
  const rep = (wave: number, p = {}) => ({ wave, handRank: 0, lifeLost: 0, clearSec: 20, cleared: true, ...p });

  it('복원해도 이미 받은 판돈을 다시 받지 않고, 진행 중이던 라운드는 이어서 판정된다', () => {
    const P = new Wallet(200), O = new Wallet(200);
    const b = new BettingSystem(duelCfg, { player: P, opponent: O }, { remote: 'opponent' });
    b.enter('player', 1); b.enterRemote(1, 6);
    b.act('player', 1, 'check'); b.actRemote(1, 'check');
    b.report('player', rep(1)); b.report('opponent', rep(1, { lifeLost: 1 })); // 1라운드: 내가 이김
    b.enter('player', 2); b.enterRemote(2, 7);
    b.act('player', 2, 'raise');
    b.report('player', rep(2)); // 2라운드: 상대 성적·응답 대기
    const gold = P.gold;
    const snap = wire(b.snapshot());

    const P2 = new Wallet(gold), O2 = new Wallet(200);
    const c = new BettingSystem(duelCfg, { player: P2, opponent: O2 }, { remote: 'opponent' });
    c.restore(snap);
    expect(P2.gold).toBe(gold);
    expect(c.history.map((h) => h.wave)).toEqual([1]);
    expect(c.won.player).toBe(b.won.player);
    // 상대가 다시 보낸 옛 이벤트는 아무것도 바꾸지 않는다
    c.enterRemote(1, 6); c.actRemote(1, 'check'); c.enterRemote(2, 7);
    expect(c.round(2)!.pot).toBe(b.round(2)!.pot);
    expect(P2.gold).toBe(gold);
    // 이어서: 상대 콜 + 성적 → 2라운드 판정
    c.actRemote(2, 'call'); c.report('opponent', rep(2, { lifeLost: 2 }));
    expect(c.round(2)!.result).toMatchObject({ winner: 'player' });
    expect(P2.gold).toBe(gold + c.round(2)!.result!.pot);
    expect(c.options('player', 2)).toEqual([]);
  });

  it('모르는 형식은 거절한다', () => {
    const b = new BettingSystem(duelCfg, { player: new Wallet(1), opponent: new Wallet(1) });
    expect(() => b.restore({ version: 2 } as never)).toThrow();
  });
});

describe('이 기기의 상대 복원', () => {
  it('상대는 마지막 라운드 시작 시점에서 다시 시작하고, 그 라운드의 패는 원래와 같다', () => {
    const d = data();
    const script = { seed: 'resume-seed', player: 'owner', rounds: [] as RoundInput[] };
    const a = new AIOpponent(d, { name: 'x', rating: 1000, avatar: 'S' }, seededRng(3), { script, thinkSec: [0.1, 0.2], manageSec: [0.1, 0.2] });
    while (a.loop.wave < 5) a.tick(0.1);
    const snap = wire(a.loop.snapshot());
    const hand = a.loop.cardPhase.hand.map((c) => `${c.rank}${c.suit}`);
    const units = a.loop.units.length;
    for (let i = 0; i < 40; i++) a.tick(0.1); // 저장 뒤 조금 더 진행
    const b = new AIOpponent(d, a.identity, seededRng(4), { script, restore: snap, thinkSec: [0.1, 0.2], manageSec: [0.1, 0.2] });
    expect(b.loop.wave).toBe(5);
    expect(b.loop.phase).toBe('card');
    expect(b.loop.units.length).toBe(units);
    expect(b.loop.cardPhase.hand.map((c) => `${c.rank}${c.suit}`)).toEqual(hand);
    for (let t = 0; t < 3000 && !b.finished; t += 0.1) b.tick(0.1);
    expect(b.finished).toBe(true);
  });
});
