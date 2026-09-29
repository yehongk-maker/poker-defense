/** 실시간 대전 (C단계): 두 기기가 각자 자기 판을 굴리고 이벤트만 주고받아도 상대 모습·판돈 판정이 일치한다 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GameLoop, type GameData, type GamePhase } from '../src/systems/GameLoop.ts';
import { buildGameData, friendDuel, RANKED_RULES, type ModeSources } from '../src/systems/GameMode.ts';
import { BettingSystem, type BetWallet, type DuelConfig } from '../src/systems/Betting.ts';
import { seededRng, seedStreams } from '../src/systems/Seed.ts';
import { smartExchange, smartManage } from '../src/systems/bots.ts';
import { raceStatus, sideOf } from '../src/systems/Duel.ts';
import { LiveOpponent, LivePublisher, SenderView } from '../src/net/Live.ts';
import { InputRecorder, type RoundInput } from '../src/systems/InputLog.ts';
import { anteMax, raiseOf, verifyBets } from '../src/net/verifyBets.ts';
import type { MatchEvent, MatchTransport, Unsubscribe } from '../src/net/MatchTransport.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
const load = (f: string) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
const w = load('waves.json'), dw = load('duel-waves.json');
const duelCfg: DuelConfig = load('duel.json');
const base = (): GameData => ({ units: load('units.json').units, hands: load('hands.json'), synergies: load('synergies.json'), heroes: load('heroes.json').heroes, waves: w.waves, enemyTypes: w.enemyTypes, battleConfig: w.config, config: load('config.json') });
const sources = (): ModeSources => ({ base: base(), duelWaves: { waves: dw.waves, enemyTypes: dw.enemyTypes, battleConfig: dw.config }, duelMatch: duelCfg.match });
const phaseOf = (g: GameLoop) => g.phase as GamePhase;

/** 지연이 있는 통로: 보낸 이벤트는 lag초 뒤에 (보낸 순서대로) 도착한다. 시간은 테스트가 advance()로 흘린다 */
class LagEnd implements MatchTransport {
  peer!: LagEnd;
  now = 0;
  private queue: { at: number; e: MatchEvent }[] = [];
  private handlers = new Set<(e: MatchEvent) => void>();
  private presence = new Set<(on: boolean) => void>();
  sent: MatchEvent[] = [];
  constructor(private lag: () => number) {}
  static pair(lag: () => number): [LagEnd, LagEnd] { const a = new LagEnd(lag), b = new LagEnd(lag); a.peer = b; b.peer = a; return [a, b]; }
  async connect(): Promise<void> { /* 항상 연결 */ }
  send(e: MatchEvent): void {
    this.sent.push(e);
    const last = this.peer.queue[this.peer.queue.length - 1];
    const at = Math.max(this.now + this.lag(), last ? last.at : 0); // 순서 보장
    this.peer.queue.push({ at, e: JSON.parse(JSON.stringify(e)) });
  }
  on(h: (e: MatchEvent) => void): Unsubscribe { this.handlers.add(h); return () => this.handlers.delete(h); }
  onPresence(h: (on: boolean) => void): Unsubscribe { this.presence.add(h); return () => this.presence.delete(h); }
  setPeerOnline(on: boolean): void { this.presence.forEach((h) => h(on)); }
  close(): void { /* noop */ }
  advance(t: number): void {
    this.now = t;
    while (this.queue.length && this.queue[0].at <= t) { const { e } = this.queue.shift()!; this.handlers.forEach((h) => h(e)); }
  }
}

interface TestNet extends MatchTransport { advance(t: number): void; sent: MatchEvent[] }

/** 한 기기: 내 판 + 판돈 + 보내는 쪽 + 받는 쪽 + 사람 흉내 */
class Device {
  loop: GameLoop;
  betting: BettingSystem | null;
  pub: LivePublisher;
  opp: LiveOpponent;
  rec: InputRecorder;
  private wait = 0;
  ended = false;
  constructor(readonly data: GameData, seed: string, player: string, readonly net: TestNet, private brain: () => number, betting: boolean, private pace: number) {
    this.loop = new GameLoop(data, seedStreams(seed, { player }));
    this.rec = new InputRecorder(this.loop, data.config.simStep);
    this.opp = new LiveOpponent({ name: 'x', rating: null, avatar: 'S' }, net, data);
    this.betting = betting ? new BettingSystem(duelCfg, { player: this.loop, opponent: this.opp.wallet }, { remote: 'opponent' }) : null;
    if (this.betting) this.opp.attachBetting(this.betting);
    this.pub = new LivePublisher(net, this.loop, data, this.betting);
  }
  private act(a: 'check' | 'raise' | 'call' | 'fold', wave: number): void {
    const rb = this.betting!.act('player', wave, a);
    this.rec.bet(a, wave);
    this.pub.bet(wave, a, a === 'raise' ? rb.raise!.amount : undefined);
  }
  step(t: number, dt: number): void {
    this.net.advance(t);
    const g = this.loop, b = this.betting;
    if (!this.ended) {
      b?.sync('player', g);
      b?.sync('opponent', this.opp.participant);
      // 상대 레이즈에 응답 (어느 페이즈에서든)
      const pend = b?.pendingResponse('player');
      if (pend && this.brain() < 0.2) {
        const o = b!.options('player', pend.wave);
        if (o.length) this.act(o.includes('call') && this.brain() < 0.6 ? 'call' : 'fold', pend.wave);
      }
      this.wait -= dt;
      if (phaseOf(g) === 'card' && this.wait <= 0) {
        smartExchange(g);
        if (b) {
          const o = b.options('player', g.wave);
          if (o.includes('raise') && this.brain() < 0.4) this.act('raise', g.wave);
          else if (o.includes('check')) this.act('check', g.wave);
        }
        g.confirmHand();
        smartManage(g);
        g.startCombat();
      } else if (phaseOf(g) === 'combat') {
        g.tickCombat(dt);
        if (phaseOf(g) === 'card') this.wait = this.pace * (0.5 + this.brain());
      }
      b?.sync('player', g);
    }
    this.opp.tick(dt);
    this.pub.tick(dt);
  }
  get over(): boolean { return this.loop.phase === 'victory' || this.loop.phase === 'defeat'; }
}

function match(seed: string, opt: { betting?: boolean; lag?: number; paceA?: number; paceB?: number } = {}) {
  const rules = { ...RANKED_RULES, betting: opt.betting ?? true };
  const data = buildGameData(sources(), friendDuel(rules, seed), null);
  const jitter = seededRng(77);
  const [na, nb] = LagEnd.pair(() => (opt.lag ?? 0.15) * (0.5 + jitter()));
  const A = new Device(data, seed, 'a', na, seededRng(11), rules.betting, opt.paceA ?? 2);
  const B = new Device(data, seed, 'b', nb, seededRng(22), rules.betting, opt.paceB ?? 3);
  const total = data.config.totalWaves;
  let t = 0;
  const dt = 0.1;
  // 둘 다 끝나고, 마지막 이벤트가 도착할 때까지
  for (let i = 0; i < 40000; i++) {
    t += dt;
    A.step(t, dt); B.step(t, dt);
    for (const d of [A, B]) if (!d.ended && raceStatus(sideOf(d.loop), sideOf(d.opp.view), total)) d.ended = true;
    if (A.ended && B.ended) break;
    if (A.over && B.over) break;
  }
  for (let i = 0; i < 50; i++) { t += dt; A.step(t, dt); B.step(t, dt); } // 남은 이벤트 배달
  return { A, B, data, total };
}

describe('LiveOpponent — 받은 이벤트로 만든 상대 모습', () => {
  it('상대의 라운드·하트·골드·유닛이 실제 판과 같다', () => {
    const { A, B } = match('live-1', { betting: false });
    for (const [me, them] of [[A, B], [B, A]] as const) {
      const v = me.opp.view, g = them.loop;
      expect(v.life).toBe(g.life);
      expect(v.gold).toBe(Math.floor(g.gold));
      expect(v.units.length).toBe(g.units.length);
      expect(v.units.map((u) => u.slot).sort()).toEqual(g.units.map((u) => u.slot).sort());
      expect(!!v.hero).toBe(!!g.hero);
    }
  });

  it('판을 마친 상대는 finished + 최종 성적을 남긴다', () => {
    const { A, B, total } = match('live-2', { betting: false });
    const done = [A, B].filter((d) => d.over);
    expect(done.length).toBeGreaterThan(0);
    for (const d of done) {
      const seen = d === A ? B.opp : A.opp;
      expect(seen.finished).toBe(true);
      expect(seen.finalReport).toEqual(d.pub.report);
      expect(seen.view.phase).toBe(d.loop.phase);
      expect(d.pub.report.reached).toBe(d.loop.phase === 'victory' ? total + 1 : d.loop.wave);
    }
  });

  it('손패는 어떤 이벤트에도 실리지 않는다 (공개 정보만)', () => {
    const { A } = match('live-3');
    const text = JSON.stringify(A.net.sent);
    expect(text).not.toMatch(/"rank":|"suit":"[SHDC]","rank"|hand"\s*:/);
    const kinds = new Set(A.net.sent.map((e) => e.t));
    for (const k of ['enter', 'confirm', 'field', 'combat', 'snapshot', 'report', 'bet']) expect(kinds.has(k as MatchEvent['t']), k).toBe(true);
  });

  it('전투 스냅샷으로 상대 필드의 적이 보인다', () => {
    const data = buildGameData(sources(), friendDuel(RANKED_RULES, 's'), null);
    const [na, nb] = LagEnd.pair(() => 0);
    const A = new Device(data, 's', 'a', na, seededRng(1), false, 0);
    const seen = new LiveOpponent({ name: 'a', rating: 1000, avatar: 'H' }, nb, data);
    let t = 0;
    while (phaseOf(A.loop) !== 'combat' || A.loop.battle!.aliveEnemies.length < 2) { t += 0.1; A.step(t, 0.1); nb.advance(t); }
    t += 0.6; A.step(t, 0.6); nb.advance(t);
    expect(seen.view.phase).toBe('combat');
    expect(seen.view.enemies.length).toBeGreaterThan(0);
    const e = seen.view.enemies[0];
    expect(e.pos).toBeGreaterThanOrEqual(0);
    expect(e.pos).toBeLessThanOrEqual(data.battleConfig.trackLength);
    expect(e.hpPct).toBeGreaterThan(0);
  });

  it('접속이 끊기면 끊긴 시간을 센다', () => {
    const data = buildGameData(sources(), friendDuel(RANKED_RULES, 's'), null);
    const [, nb] = LagEnd.pair(() => 0);
    const seen = new LiveOpponent({ name: 'a', rating: 1000, avatar: 'H' }, nb, data);
    nb.setPeerOnline(false);
    seen.tick(10); seen.tick(25);
    expect(seen.online).toBe(false);
    expect(seen.offlineFor).toBe(35);
    nb.setPeerOnline(true);
    expect(seen.offlineFor).toBe(0);
  });
});

describe('네트워크 판돈 — 두 기기의 판정이 같다', () => {
  const mirror = (w: string) => (w === 'player' ? 'opponent' : w === 'opponent' ? 'player' : w);

  it.each([
    ['지연 0.15초', { lag: 0.15 }],
    ['지연 1.5초(이벤트가 엇갈림)', { lag: 1.5 }],
    ['한쪽이 훨씬 빠름', { lag: 0.4, paceA: 0.2, paceB: 6 }],
  ])('%s: 라운드별 승자·판돈·이유가 거울처럼 일치', (_name, opt) => {
    for (const seed of ['bet-1', 'bet-2', 'bet-3', 'bet-4']) {
      const { A, B } = match(seed, opt);
      const ha = A.betting!.history, hb = B.betting!.history;
      const n = Math.min(ha.length, hb.length);
      expect(n, seed).toBeGreaterThan(3);
      // 먼저 끝난 기기는 뒤 라운드를 판정하지 않았을 수 있다 — 양쪽이 판정한 라운드는 모두 같아야 한다
      const byWave = new Map(hb.map((r) => [r.wave, r]));
      let compared = 0;
      for (const r of ha) {
        const o = byWave.get(r.wave);
        if (!o) continue;
        compared++;
        expect({ wave: o.wave, winner: mirror(o.winner), pot: o.pot, reason: o.reason }, `${seed} R${r.wave}`).toEqual({ wave: r.wave, winner: r.winner, pot: r.pot, reason: r.reason });
      }
      expect(compared).toBeGreaterThan(3);
      expect(A.betting!.won.player).toBeGreaterThanOrEqual(0);
    }
  });

  it('레이즈·콜·폴드가 실제로 섞여 나왔다 (테스트가 비어 있지 않다)', () => {
    const { A, B } = match('bet-mix', { lag: 1.0 });
    const all = [...A.net.sent, ...B.net.sent].filter((e) => e.t === 'bet') as Extract<MatchEvent, { t: 'bet' }>[];
    const kinds = new Set(all.map((e) => e.action));
    expect(kinds.has('raise')).toBe(true);
    expect(kinds.has('check')).toBe(true);
    expect(kinds.has('call') || kinds.has('fold')).toBe(true);
  });
});

describe('BettingSystem remote 모드 규칙', () => {
  class Wallet implements BetWallet {
    constructor(public gold: number, public life = 10) {}
    addGold(n: number) { this.gold += n; }
    spendGold(n: number) { if (this.gold < n) throw new Error('gold'); this.gold -= n; }
    loseLife(n: number) { this.life = Math.max(0, this.life - n); }
  }
  const rep = (wave: number, p = {}) => ({ wave, handRank: 0, lifeLost: 0, clearSec: 20, cleared: true, ...p });
  const mk = () => { const P = new Wallet(200), O = new Wallet(200); return { P, O, b: new BettingSystem(duelCfg, { player: P, opponent: O }, { remote: 'opponent' }) }; };

  it('상대 앤티는 받은 금액 그대로, 상대 지갑은 건드리지 않는다', () => {
    const { O, b } = mk();
    b.enter('player', 1);
    const rb = b.enterRemote(1, 3);
    expect(rb.ante.opponent).toBe(3);
    expect(rb.pot).toBe(rb.ante.player + 3);
    expect(O.gold).toBe(200);
    b.enter('opponent', 2); // sync가 불러도 상대 앤티를 만들어 내지 않는다
    expect(b.round(2)!.entered.opponent).toBe(false);
  });

  it('동시에 레이즈하면 늦게 도착한 레이즈를 콜로 본다', () => {
    const { b } = mk();
    b.enter('player', 1); b.enterRemote(1, 6);
    b.act('player', 1, 'raise');
    const amt = b.raiseAmount(1);
    const rb = b.actRemote(1, 'raise', amt);
    expect(rb.raise!.by).toBe('player');
    expect(rb.response.opponent).toBe('call');
    expect(rb.pot).toBe(12 + amt * 2);
    expect(b.options('player', 1)).toEqual([]);
  });

  it('내 레이즈에 대한 상대 응답은 올 때까지 기다린다 (대신 폴드시키지 않는다)', () => {
    const { P, b } = mk();
    b.enter('player', 1); b.enterRemote(1, 6);
    b.act('player', 1, 'raise');
    b.report('player', rep(1)); b.report('opponent', rep(1, { lifeLost: 2 }));
    expect(b.round(1)!.result).toBeNull();
    const gold = P.gold;
    b.actRemote(1, 'call');
    const r = b.round(1)!.result!;
    expect(r).toMatchObject({ winner: 'player', reason: 'life', showdown: true });
    expect(P.gold).toBe(gold + r.pot);
  });

  it('상대 레이즈에 내가 답하지 않은 채 판정되면 폴드로 확정하고 상대에게 알릴 목록에 넣는다', () => {
    const { b } = mk();
    b.enter('player', 1); b.enterRemote(1, 6);
    b.actRemote(1, 'raise', 10);
    b.report('player', rep(1)); b.report('opponent', rep(1));
    expect(b.round(1)!.result).toMatchObject({ winner: 'opponent', reason: 'fold' });
    expect(b.drainOutbox()).toEqual([{ wave: 1, action: 'fold' }]);
    expect(b.drainOutbox()).toEqual([]);
  });

  it('끊긴 상대는 기다리지 않는다', () => {
    const { b } = mk();
    b.enter('player', 1); b.enterRemote(1, 6);
    b.act('player', 1, 'raise');
    b.report('player', rep(1));
    b.markGone();
    expect(b.round(1)!.result).toMatchObject({ winner: 'player' });
  });

  it('번호 순으로만 판정하고, 동률 판돈은 바로 다음 라운드로 간다', () => {
    const { b } = mk();
    b.enter('player', 1); b.enterRemote(1, 6);
    b.act('player', 1, 'raise'); // 상대 응답 대기 → 1라운드 판정 보류
    b.report('player', rep(1)); b.report('opponent', rep(1));
    b.enter('player', 2); b.enterRemote(2, 7);
    b.report('player', rep(2, { lifeLost: 1 })); b.report('opponent', rep(2));
    expect(b.round(2)!.result).toBeNull(); // 1라운드가 먼저
    b.actRemote(1, 'call'); // 1라운드: 완전 동률 → 이월
    const r1 = b.round(1)!.result!, r2 = b.round(2)!.result!;
    expect(r1.winner).toBe('carry');
    expect(r2.winner).toBe('opponent');
    expect(r2.pot).toBe(r1.pot + 7 + 7);
    expect(b.history.map((h) => h.wave)).toEqual([1, 2]);
  });
});

describe('늦게 붙은 상대에게 재전송', () => {
  it('상대가 채널에 붙기 전에 보낸 진입·판돈·성적을 접속 순간 다시 보내고, 받는 쪽은 중복을 무시한다', () => {
    const data = buildGameData(sources(), friendDuel(RANKED_RULES, 'late'), null);
    const [na, nb] = LagEnd.pair(() => 0);
    const A = new Device(data, 'late', 'a', na, seededRng(3), true, 0);
    // A가 3라운드쯤 진행하는 동안 B는 아직 듣지 못했다 (보낸 것을 버린다)
    let t = 0;
    while (A.loop.wave < 4) { t += 0.1; A.step(t, 0.1); }
    (nb as unknown as { queue: unknown[] }).queue.length = 0;

    const wallet = { gold: 0, life: 10, addGold() { /* */ }, spendGold() { /* */ }, loseLife() { /* */ } };
    const seen = new LiveOpponent({ name: 'a', rating: null, avatar: 'S' }, nb, data);
    const bet = new BettingSystem(duelCfg, { player: wallet, opponent: seen.wallet }, { remote: 'opponent' });
    seen.attachBetting(bet);
    na.setPeerOnline(true); // B 접속 → A가 재전송
    nb.advance(t + 1);
    expect(seen.view.wave).toBe(A.loop.wave);
    for (let w = 1; w <= 3; w++) {
      const rb = bet.round(w)!;
      expect(rb.entered.opponent, `R${w}`).toBe(true);
      expect(rb.ante.opponent).toBe(A.betting!.round(w)!.ante.player);
      expect(rb.report.opponent).toEqual(A.betting!.round(w)!.report.player);
    }
    // 한 번 더 재전송돼도 판돈이 두 번 쌓이지 않는다
    const pot = bet.round(1)!.pot;
    na.setPeerOnline(false); na.setPeerOnline(true);
    nb.advance(t + 2);
    expect(bet.round(1)!.pot).toBe(pot);
    expect(seen.view.wave).toBe(A.loop.wave);
  });
});

describe('판돈 시스템 연결 전에 온 이벤트', () => {
  it('카운트다운 중에 먼저 시작한 상대의 앤티·선택·성적을 연결할 때 반영한다', () => {
    const data = buildGameData(sources(), friendDuel(RANKED_RULES, 'early'), null);
    const [na, nb] = LagEnd.pair(() => 0);
    const seen = new LiveOpponent({ name: 'a', rating: null, avatar: 'S' }, nb, data); // 아직 판돈 미연결
    const A = new Device(data, 'early', 'a', na, seededRng(5), true, 0);
    let t = 0;
    while (A.loop.wave < 3) { t += 0.1; A.step(t, 0.1); nb.advance(t); }
    const wallet = { gold: 100, life: 10, addGold() { /* */ }, spendGold() { /* */ }, loseLife() { /* */ } };
    const bet = new BettingSystem(duelCfg, { player: wallet, opponent: seen.wallet }, { remote: 'opponent' });
    seen.attachBetting(bet);
    for (const w of [1, 2]) {
      expect(bet.round(w)!.entered.opponent).toBe(true);
      expect(bet.round(w)!.ante.opponent).toBe(A.betting!.round(w)!.ante.player);
      expect(bet.round(w)!.action.opponent).toBe(A.betting!.round(w)!.action.player);
      expect(bet.round(w)!.report.opponent).toEqual(A.betting!.round(w)!.report.player);
    }
  });
});

describe('판돈 교차 검증 (verify-match)', () => {
  const logs = (seed: string, lag: number) => {
    const { A, B } = match(seed, { lag });
    return { a: JSON.parse(JSON.stringify(A.rec.rounds)) as RoundInput[], b: JSON.parse(JSON.stringify(B.rec.rounds)) as RoundInput[] };
  };

  it('정직한 로그는 지연·엇갈림이 있어도 통과한다 (양쪽 모두, 상대 로그가 있든 없든)', () => {
    for (const lag of [0.15, 1.5]) for (const seed of ['vb-1', 'vb-2', 'vb-3', 'vb-4', 'vb-5']) {
      const { a, b } = logs(seed, lag);
      expect(verifyBets(duelCfg, true, a, b).issues, `${seed} A`).toEqual([]);
      expect(verifyBets(duelCfg, true, b, a).issues, `${seed} B`).toEqual([]);
      expect(verifyBets(duelCfg, true, a, null).issues).toEqual([]);
      const c = verifyBets(duelCfg, true, a, b);
      expect(c.paid).toBeGreaterThan(0);
      expect(c.won).toBeLessThanOrEqual(c.allowed);
    }
  });

  it('없는 판돈을 받았다고 적으면 잡힌다', () => {
    const { a, b } = logs('vb-cheat', 0.3);
    const fat = a.map((r, i) => (i === 2 ? { ...r, ops: [...r.ops!, ['g', 900] as ['g', number]] } : r));
    expect(verifyBets(duelCfg, true, fat, b).issues).toContain('bet:overpaid_winnings');
  });

  it('진 라운드의 판돈은 상한에서 빠지고, 동률 판돈은 다음 라운드 상한에 더해진다', () => {
    const round = (wave: number, clearSec: number, ops: RoundInput['ops'] = [['g', -(5 + wave)], ['c'], ['go']]): RoundInput => ({
      wave, exchanges: [], ticketExchanges: 0, confirmedAt: 3, manage: { moves: [], sells: [], merges: [], upgrades: [] }, combatSec: clearSec, skills: [],
      bet: [{ action: 'check', at: 1 }], result: { lifeLost: 0, clearSec, handRank: 1, cleared: true }, ops, steps: Math.round(clearSec * 10), partial: false,
    });
    const pot = (w: number) => 2 * anteMax(duelCfg, w) + 2 * raiseOf(duelCfg, w);
    const mine = [round(1, 9), round(2, 5), round(3, 7)];
    const faster = [round(1, 5), round(2, 5), round(3, 9)]; // 1: 내가 짐, 2: 동률(이월), 3: 내가 이김
    expect(verifyBets(duelCfg, true, mine, null).allowed).toBe(pot(1) + pot(2) + pot(3));
    expect(verifyBets(duelCfg, true, mine, faster).allowed).toBe(pot(2) + (pot(2) + pot(3)));
    // 3라운드에서 이월분까지 받은 것은 정상, 1라운드 판돈까지 받았다고 하면 넘친다
    const got = (n: number) => mine.map((r, k) => (k === 2 ? { ...r, ops: [...r.ops!, ['g', n] as ['g', number]] } : r));
    expect(verifyBets(duelCfg, true, got(2 * 7 + 2 * 8), faster).issues).toEqual([]);
    expect(verifyBets(duelCfg, true, got(pot(1) + pot(2) + pot(2) + pot(3) + 1), faster).issues).toContain('bet:overpaid_winnings');
  });

  it('앤티를 안 냈으면 잡힌다', () => {
    const { a, b } = logs('vb-free', 0.3);
    const free = a.map((r) => ({ ...r, ops: r.ops!.filter((o) => !(o[0] === 'g' && o[1] < 0) && o[0] !== 'l') }));
    expect(verifyBets(duelCfg, true, free, b).issues).toContain('bet:underpaid');
  });

  it('판돈 없는 방에서 골드가 오갔으면 잡힌다', () => {
    const { a } = logs('vb-off', 0.3);
    expect(verifyBets(duelCfg, false, a, null).issues).toEqual(['bet:wallet_ops_without_betting']);
  });
});

/** 여러 명이 붙는 채널 (실제 Realtime 채널처럼): 보낸 사람 표시, 입장 알림, 구경꾼은 접속 판단에서 빠진다 */
class Hub {
  ends: HubEnd[] = [];
  join(id: string, role: 'player' | 'spectator'): HubEnd {
    const e = new HubEnd(this, id, role);
    const others = [...this.ends];
    this.ends.push(e); // 채널에 붙은 뒤에 입장이 알려진다
    for (const o of others) { o.joined({ id, role }); if (role === 'player') o.presenceOf(true); }
    if (others.some((o) => o.role === 'player')) e.presenceOf(true);
    return e;
  }
}
class HubEnd implements TestNet {
  sent: MatchEvent[] = [];
  private queue: { e: MatchEvent; from: string }[] = [];
  private handlers = new Set<(e: MatchEvent, from?: string) => void>();
  private presence = new Set<(on: boolean) => void>();
  private joins = new Set<(w: { id: string; role: 'player' | 'spectator' }) => void>();
  private on_ = false;
  constructor(private hub: Hub, readonly id: string, readonly role: 'player' | 'spectator') {}
  async connect(): Promise<void> { /* 항상 연결 */ }
  send(e: MatchEvent): void {
    if (this.role === 'spectator') return;
    this.sent.push(e);
    for (const o of this.hub.ends) if (o !== this) o.queue.push({ e: JSON.parse(JSON.stringify(e)), from: this.id });
  }
  on(h: (e: MatchEvent, from?: string) => void): Unsubscribe { this.handlers.add(h); return () => this.handlers.delete(h); }
  onPresence(h: (on: boolean) => void): Unsubscribe { this.presence.add(h); if (this.on_) h(true); return () => this.presence.delete(h); }
  onJoin(h: (w: { id: string; role: 'player' | 'spectator' }) => void): Unsubscribe { this.joins.add(h); return () => this.joins.delete(h); }
  joined(w: { id: string; role: 'player' | 'spectator' }): void { this.joins.forEach((h) => h(w)); }
  presenceOf(on: boolean): void { this.on_ = on; this.presence.forEach((h) => h(on)); }
  close(): void { /* noop */ }
  advance(): void { const q = this.queue; this.queue = []; for (const { e, from } of q) this.handlers.forEach((h) => h(e, from)); }
}

describe('관전 — 구경꾼이 두 사람을 따로 본다', () => {
  function watch(seed: string, joinAtWave: number) {
    const data = buildGameData(sources(), friendDuel(RANKED_RULES, seed), null);
    const hub = new Hub();
    const na = hub.join('a', 'player'), nb = hub.join('b', 'player');
    const A = new Device(data, seed, 'a', na, seededRng(11), true, 1);
    const B = new Device(data, seed, 'b', nb, seededRng(22), true, 2);
    let t = 0;
    const run = (until: () => boolean) => { for (let i = 0; i < 40000 && !until(); i++) { t += 0.1; A.step(t, 0.1); B.step(t, 0.1); } };
    run(() => A.loop.wave >= joinAtWave && B.loop.wave >= joinAtWave - 1);
    const ns = hub.join('s', 'spectator');
    const seeA = new LiveOpponent({ name: 'a', rating: null, avatar: 'S' }, new SenderView(ns, 'a'), data);
    const seeB = new LiveOpponent({ name: 'b', rating: null, avatar: 'H' }, new SenderView(ns, 'b'), data);
    const settle = () => { for (let i = 0; i < 8; i++) { t += 0.1; A.step(t, 0.1); B.step(t, 0.1); ns.advance(); } };
    return { A, B, ns, seeA, seeB, run, settle, data };
  }

  it('대전 도중에 들어와도 두 사람의 지금 상태가 각각 맞게 보인다', () => {
    const w = watch('sp-1', 5);
    w.settle();
    for (const [seen, dev] of [[w.seeA, w.A], [w.seeB, w.B]] as const) {
      expect(seen.view.wave).toBe(dev.loop.wave);
      expect(seen.view.life).toBe(dev.loop.life);
      expect(seen.view.gold).toBe(Math.floor(dev.loop.gold));
      expect(seen.view.units.length).toBe(dev.loop.units.length);
    }
    expect(w.seeA.view.units.map((u) => u.slot).sort()).not.toEqual([]);
  });

  it('계속 따라간다: 끝까지 보고, 누가 끝났는지 안다', () => {
    const w = watch('sp-2', 3);
    w.run(() => { w.ns.advance(); return w.A.over || w.B.over; });
    w.settle();
    const done = w.A.over ? [w.seeA, w.A] as const : [w.seeB, w.B] as const;
    expect(done[0].finished).toBe(true);
    expect(done[0].view.phase).toBe(done[1].loop.phase);
    expect(done[0].finalReport).toEqual(done[1].pub.report);
  });

  it('판돈 선택이 사람별로 보인다', () => {
    const w = watch('sp-3', 2);
    w.run(() => { w.ns.advance(); return w.A.loop.wave >= 6; });
    w.settle();
    expect(w.seeA.lastBet).not.toBeNull();
    expect(w.seeB.lastBet).not.toBeNull();
    const lastA = [...w.A.net.sent].reverse().find((e) => e.t === 'bet') as Extract<MatchEvent, { t: 'bet' }>;
    expect(w.seeA.lastBet).toMatchObject({ wave: lastA.wave, action: lastA.action });
  });

  it('구경꾼은 아무것도 보내지 않고, 두 사람의 대전에 영향을 주지 않는다', () => {
    const solo = match('sp-4', { lag: 0 });
    const w = watch('sp-same', 4);
    const sentBefore = w.ns.sent.length;
    w.run(() => { w.ns.advance(); return w.A.over && w.B.over; });
    expect(w.ns.sent.length).toBe(sentBefore);
    expect(w.ns.sent).toEqual([]);
    // 구경꾼이 있어도 두 기기의 판돈 판정은 서로 일치한다
    const hb = new Map(w.B.betting!.history.map((r) => [r.wave, r]));
    let compared = 0;
    for (const r of w.A.betting!.history) {
      const o = hb.get(r.wave);
      if (!o) continue;
      compared++;
      expect(o.pot).toBe(r.pot);
      expect(o.winner === 'carry' ? 'carry' : o.winner === 'player' ? 'opponent' : 'player').toBe(r.winner);
    }
    expect(compared).toBeGreaterThan(3);
    expect(solo.A.betting!.history.length).toBeGreaterThan(0);
  });

  it('구경꾼이 들어와도 판정용 기록 전체를 다시 보내지 않는다 (상태 한 장 + 필드)', () => {
    const w = watch('sp-5', 6);
    const before = w.A.net.sent.length;
    w.A.step(1e6, 0); // 구경꾼 입장 직후 한 프레임
    const extra = w.A.net.sent.slice(before).map((e) => e.t);
    expect(extra).toContain('field');
    expect(w.A.net.sent.filter((e) => e.t === 'state').length).toBe(1);
    expect(extra.filter((t) => t === 'enter' || t === 'report').length).toBeLessThanOrEqual(1);
  });

  it('손패는 구경꾼에게도 가지 않는다', () => {
    const w = watch('sp-6', 4);
    w.settle();
    expect(JSON.stringify([...w.A.net.sent, ...w.B.net.sent])).not.toMatch(/"rank":|hand"\s*:/);
  });
});
