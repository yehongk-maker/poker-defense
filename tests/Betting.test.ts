/** 판돈 걸기 (GDD 3.9): 앤티·체크/레이즈·콜/폴드·판정·이월·대납 + 상대 AI 연동 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BettingSystem, aiOpening, aiResponse, type BetWallet, type DuelConfig } from '../src/systems/Betting.ts';
import { GameLoop, type GameData, type RoundReport } from '../src/systems/GameLoop.ts';
import { OpponentAI } from '../src/systems/Duel.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
const load = (f: string) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
const cfg: DuelConfig = load('duel.json');
const u = load('units.json'), w = load('waves.json');
const data = (): GameData => ({ units: u.units, hands: load('hands.json'), synergies: load('synergies.json'), heroes: load('heroes.json').heroes, waves: w.waves, enemyTypes: w.enemyTypes, battleConfig: w.config, config: load('config.json') });
function rng(seed: number) { let s = seed; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; }; }

/** 테스트용 지갑 */
class Wallet implements BetWallet {
  constructor(public gold: number, public life = 10) {}
  addGold(n: number) { this.gold += n; }
  spendGold(n: number) { if (this.gold < n) throw new Error('gold'); this.gold -= n; }
  loseLife(n: number) { this.life = Math.max(0, this.life - n); }
}
const rep = (wave: number, p: Partial<RoundReport> = {}): RoundReport => ({ wave, handRank: 0, lifeLost: 0, clearSec: 20, cleared: true, ...p });
const mk = (pg = 100, og = 100) => {
  const P = new Wallet(pg), O = new Wallet(og);
  return { P, O, b: new BettingSystem(cfg, { player: P, opponent: O }) };
};

describe('앤티·판돈', () => {
  it('각자 라운드에 들어갈 때 앤티(base + perWave×라운드)를 내고 판돈이 된다', () => {
    const { P, O, b } = mk();
    const rb = b.enter('player', 3);
    const ante = cfg.ante.base + cfg.ante.perWave * 3;
    expect(rb.ante.player).toBe(ante);
    expect(P.gold).toBe(100 - ante);
    expect(O.gold).toBe(100); // 상대는 아직 3라운드에 안 들어옴 → 앞선 쪽 때문에 골드가 먼저 빠지지 않는다
    expect(rb.pot).toBe(ante);
    expect(b.enter('player', 3)).toBe(rb); // 중복 납부 없음
    expect(P.gold).toBe(100 - ante);
    b.enter('opponent', 3);
    expect(rb.pot).toBe(ante * 2);
  });

  it('레이즈 금액은 라운드에 따라 roundTo 단위로 커지고 max를 넘지 않는다', () => {
    const { b } = mk();
    expect(b.raiseAmount(1) % cfg.raise.roundTo).toBe(0);
    expect(b.raiseAmount(40)).toBeLessThanOrEqual(cfg.raise.max);
    expect(b.raiseAmount(30)).toBeGreaterThanOrEqual(b.raiseAmount(1));
  });

  it('골드가 모자라면 앤티 부족분을 하트로 대납한다 (goldPerLife당 1)', () => {
    const { P, b } = mk(0, 100);
    b.enter('player', 5); // 앤티 10 → 골드 0 → 하트 1
    expect(P.gold).toBe(0);
    expect(P.life).toBe(10 - Math.ceil((cfg.ante.base + cfg.ante.perWave * 5) / cfg.shortfall.goldPerLife));
  });

  it('하트가 lifeAtMost 이하면 앤티가 감면된다 (컴백)', () => {
    const { P, b } = mk();
    P.life = cfg.comeback.lifeAtMost;
    expect(b.anteFor(10, 'player')).toBe(Math.round((cfg.ante.base + cfg.ante.perWave * 10) * (1 - cfg.comeback.anteDiscount)));
    expect(b.anteFor(10, 'opponent')).toBe(cfg.ante.base + cfg.ante.perWave * 10);
  });
});

describe('선택지: 체크/레이즈 → 콜/폴드', () => {
  it('처음엔 체크·레이즈, 레이즈를 받으면 콜·폴드만', () => {
    const { b } = mk();
    b.enter('player', 1); b.enter('opponent', 1);
    expect(b.options('player', 1)).toEqual(['check', 'raise']);
    b.act('player', 1, 'raise');
    expect(b.options('player', 1)).toEqual([]);
    expect(b.options('opponent', 1)).toEqual(['call', 'fold']);
    expect(b.pendingResponse('opponent')?.wave).toBe(1);
    expect(b.pendingResponse('player')).toBeNull();
  });

  it('레이즈는 골드가 모자라면 안 뜨고, 콜도 모자라면 폴드만', () => {
    const { P, O, b } = mk(100, 100);
    b.enter('player', 1); b.enter('opponent', 1);
    P.gold = 3;
    expect(b.options('player', 1)).toEqual(['check']);
    P.gold = 100;
    b.act('player', 1, 'raise');
    O.gold = 2;
    expect(b.options('opponent', 1)).toEqual(['fold']);
    expect(() => b.act('opponent', 1, 'call')).toThrow();
  });

  it('체크한 뒤 상대가 레이즈하면 응답해야 한다', () => {
    const { b } = mk();
    b.enter('player', 1); b.enter('opponent', 1);
    b.act('player', 1, 'check');
    b.act('opponent', 1, 'raise');
    expect(b.options('player', 1)).toEqual(['call', 'fold']);
    expect(b.view('player', 1).pendingRaise).toBe(b.raiseAmount(1));
  });

  it('앞선 쪽의 레이즈는 내가 그 라운드에 들어가야(패를 본 뒤) 응답할 수 있다', () => {
    const { b } = mk();
    b.enter('opponent', 3); // 상대가 먼저 3라운드
    b.act('opponent', 3, 'raise');
    expect(b.pendingResponse('player')).toBeNull();
    expect(b.options('player', 3)).toEqual([]);
    expect(b.view('player', 1).pendingRaise).toBeNull();
    b.enter('player', 3);
    expect(b.pendingResponse('player')?.wave).toBe(3);
    expect(b.options('player', 3)).toEqual(['call', 'fold']);
  });

  it('레이즈+콜은 판돈에 두 배로 쌓인다', () => {
    const { P, O, b } = mk();
    b.enter('player', 1);
    const rb = b.enter('opponent', 1);
    const before = rb.pot;
    b.act('player', 1, 'raise');
    b.act('opponent', 1, 'call');
    const r = b.raiseAmount(1);
    expect(rb.pot).toBe(before + r * 2);
    expect(P.gold).toBe(100 - rb.ante.player - r);
    expect(O.gold).toBe(100 - rb.ante.opponent - r);
  });
});

describe('판정', () => {
  it('폴드한 쪽이 지고 승자가 판돈을 받는다 (쇼다운 없음)', () => {
    const { P, b } = mk();
    b.enter('player', 1);
    const rb = b.enter('opponent', 1);
    b.act('player', 1, 'raise');
    b.act('opponent', 1, 'fold');
    const g = P.gold;
    expect(b.report('player', rep(1))).toBeNull(); // 상대 보고 전
    const res = b.report('opponent', rep(1))!;
    expect(res.winner).toBe('player');
    expect(res.reason).toBe('fold');
    expect(res.showdown).toBe(false);
    expect(P.gold).toBe(g + rb.pot);
    expect(b.won.player).toBe(rb.pot);
  });

  it('잃은 하트가 적은 쪽 → 빠른 쪽 → 족보 순으로 판정한다', () => {
    const { b } = mk();
    b.openRound(1); b.openRound(2); b.openRound(3);
    b.report('player', rep(1, { lifeLost: 1 }));
    expect(b.report('opponent', rep(1, { lifeLost: 0, clearSec: 99 }))!.reason).toBe('life');
    b.report('player', rep(2, { clearSec: 10 }));
    const r2 = b.report('opponent', rep(2, { clearSec: 12, handRank: 5 }))!;
    expect(r2.winner).toBe('player'); expect(r2.reason).toBe('time');
    b.report('player', rep(3, { handRank: 1 }));
    const r3 = b.report('opponent', rep(3, { handRank: 3 }))!;
    expect(r3.winner).toBe('opponent'); expect(r3.reason).toBe('hand');
  });

  it('완전 동률이면 판돈이 다음 라운드로 이월된다', () => {
    const { b } = mk();
    b.enter('player', 1);
    const rb1 = b.enter('opponent', 1);
    b.report('player', rep(1)); b.report('opponent', rep(1));
    expect(b.history[0].winner).toBe('carry');
    expect(b.carry).toBe(rb1.pot);
    b.enter('player', 2);
    const rb2 = b.enter('opponent', 2);
    expect(rb2.pot).toBe(rb1.pot + rb2.ante.player + rb2.ante.opponent);
    expect(b.carry).toBe(0);
  });

  it('응답 없는 레이즈는 판정 시 폴드 처리된다', () => {
    const { b } = mk();
    b.enter('player', 1); b.enter('opponent', 1);
    b.act('opponent', 1, 'raise');
    b.report('player', rep(1, { lifeLost: 0 }));
    const r = b.report('opponent', rep(1, { lifeLost: 5 }))!; // 방어는 내가 더 잘했지만 미응답 = 폴드
    expect(r.winner).toBe('opponent');
    expect(r.reason).toBe('fold');
  });

  it('탈락한 쪽은 그 뒤 라운드를 자동으로 진다', () => {
    const { O, b } = mk();
    b.enter('player', 4);
    b.markOut('opponent');
    const r = b.report('player', rep(4))!;
    expect(r.winner).toBe('player');
    expect(r.reason).toBe('out');
    b.enter('opponent', 5);
    expect(b.round(5)!.ante.opponent).toBe(0); // 탈락한 쪽은 앤티 없음
    expect(O.gold).toBe(100);
  });
});

describe('GameLoop 연동 (sync)', () => {
  it('GameLoop이 지갑이 되고, 카드 페이즈에서 라운드가 열리며 전투가 끝나면 성적이 보고된다', () => {
    const P = new GameLoop(data(), rng(1)), O = new GameLoop(data(), rng(2));
    const b = new BettingSystem(cfg, { player: P, opponent: O });
    b.sync('player', P);
    expect(b.round(1)).not.toBeNull();
    expect(P.gold).toBe(100 - b.anteFor(1, 'player'));
    expect(P.lastRound).toBeNull();
    P.confirmHand(); P.startCombat();
    for (let t = 0; t < 120 && P.phase === 'combat'; t += 0.1) P.tickCombat(0.1);
    expect(P.lastRound?.wave).toBe(1);
    expect(P.lastRound?.clearSec).toBeGreaterThan(0);
    b.sync('player', P);
    expect(b.round(1)!.report.player).not.toBeNull();
    O.confirmHand(); O.startCombat();
    for (let t = 0; t < 120 && O.phase === 'combat'; t += 0.1) O.tickCombat(0.1);
    const res = b.sync('opponent', O);
    expect(res.length).toBe(1);
    expect(b.history.length).toBe(1);
    // 같은 성적을 다시 sync해도 중복 판정 없음
    expect(b.sync('opponent', O).length).toBe(0);
  });

  it('loseLife로 하트가 0이 되면 탈락한다', () => {
    const P = new GameLoop(data(), rng(1));
    P.loseLife(10);
    expect(P.phase).toBe('defeat');
    expect(P.life).toBe(0);
  });
});

describe('상대 AI 베팅', () => {
  it('좋은 족보·넉넉한 골드면 레이즈, 골드가 예비분보다 적으면 체크', () => {
    expect(aiOpening(cfg, 5, 500, 1, 10, () => 0)).toBe('raise');
    expect(aiOpening(cfg, 5, 5, 1, 10, () => 0)).toBe('check');
    expect(aiOpening(cfg, 0, 500, 1, 10, () => 0.99)).toBe('check');
  });
  it('콜 금액이 없으면 폴드', () => {
    expect(aiResponse(cfg, 5, 3, 1, 10, () => 0)).toBe('fold');
    expect(aiResponse(cfg, 5, 500, 1, 10, () => 0)).toBe('call');
  });

  it('OpponentAI는 카드 확정 시 체크/레이즈를 고르고, 플레이어 레이즈엔 잠시 뒤 응답한다', () => {
    const O = new GameLoop(data(), rng(7));
    const P = new GameLoop(data(), rng(8));
    const b = new BettingSystem(cfg, { player: P, opponent: O });
    const ai = new OpponentAI(data(), rng(9), { thinkSec: [1, 1], manageSec: [0.5, 0.5], betting: { system: b, config: cfg }, loop: O });
    b.sync('player', P);
    b.act('player', 1, 'raise');
    for (let t = 0; t < 3; t += 0.1) { b.sync('opponent', O); ai.tick(0.1); }
    const rb = b.round(1)!;
    expect(rb.response.opponent).not.toBeNull(); // 콜 또는 폴드
    expect(O.phase).not.toBe('card');
    // 2라운드에서 상대가 먼저 선택
    for (let t = 0; t < 200 && !(O.wave >= 2 && O.phase !== 'card'); t += 0.1) { b.sync('opponent', O); ai.tick(0.1); }
    if (O.wave >= 2) expect(b.round(2)!.action.opponent).not.toBeNull();
  });
});
