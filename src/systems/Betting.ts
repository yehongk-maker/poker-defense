/**
 * Betting — 1:1 레이스의 "판돈 걸기" (GDD 3.9, §10 레이즈 듀얼 간소판). 순수 로직.
 *
 * 초보자용으로 단순화한 규칙:
 *  - 라운드마다 양쪽이 앤티(참가비)를 자동으로 내서 판돈(pot)을 만든다. 골드가 모자라면 하트로 대납.
 *    앤티는 각자 "그 라운드의 카드 선택에 들어갈 때" 낸다 (레이스라 진행 속도가 달라도 앞선 쪽 때문에 먼저 빠지지 않음).
 *  - 카드 선택 중 고를 수 있는 건 둘뿐: 체크(그냥 진행) / 레이즈(정해진 금액을 더 걸기). 레이즈는 라운드당 한 번, 먼저 건 쪽만.
 *  - 레이즈를 받은 쪽은 콜(같은 금액 내기) 또는 폴드(판돈 포기). 응답은 그 라운드에 들어가 자기 패를 본 뒤에 할 수 있고,
 *    라운드 판정 전까지 응답이 없으면 폴드.
 *  - 판정(양쪽 다 그 라운드 전투를 끝냈을 때): 폴드한 쪽 패 → 잃은 하트 적은 쪽 → 빨리 깬 쪽 → 족보 높은 쪽 → 전부 같으면 다음 라운드로 이월.
 *  - 판돈은 승자의 매치 골드로. 골드는 판 밖으로 나가지 않는다.
 */
import type { RoundReport } from './GameLoop.ts';

/** 판돈 시스템이 보는 진행 상태 (GameLoop·네트워크 상대 공통) */
export interface BetProgress { readonly phase: string; readonly wave: number; readonly lastRound: RoundReport | null }

export type BetSide = 'player' | 'opponent';
export type BetAction = 'check' | 'raise' | 'call' | 'fold';
export type BetReason = 'fold' | 'life' | 'time' | 'hand' | 'out' | 'carry';

export interface DuelConfig {
  /** 매치 규칙 (20웨이브 곡선·등급 경계·보스 조각·교환권 상한) — docs/mode-design.md */
  match: { waves: number; wavesFile: string; hero: { grades: Record<'S' | 'A' | 'B', { minRemainingWaves: number; mult: number }>; bossShardAmount: number }; ticketsPerMatch: number };
  ante: { base: number; perWave: number };
  raise: { base: number; perWave: number; roundTo: number; max: number };
  shortfall: { goldPerLife: number };
  comeback: { lifeAtMost: number; anteDiscount: number };
  ai: {
    raiseMinRank: number;
    raiseChance: number;
    bluffChance: number;
    callMinRank: number;
    callChance: number;
    callAnyRankChance: number;
    reserveAntes: number;
    respondSec: [number, number];
  };
}

/** 베팅이 건드리는 지갑 — GameLoop이 그대로 만족한다 */
export interface BetWallet {
  readonly gold: number;
  readonly life: number;
  addGold(n: number): void;
  spendGold(n: number): void;
  loseLife(n: number): void;
}

export interface RoundBetResult {
  wave: number;
  winner: BetSide | 'carry';
  pot: number;
  reason: BetReason;
  /** 쇼다운(양쪽 족보 공개) 여부 — 폴드로 끝나면 false */
  showdown: boolean;
}

export interface RoundBet {
  wave: number;
  pot: number;
  /** 이 라운드의 카드 선택에 들어왔는지 (앤티 납부 완료) */
  entered: Record<BetSide, boolean>;
  ante: Record<BetSide, number>;
  /** 첫 선택 (체크/레이즈). null = 아직 */
  action: Record<BetSide, 'check' | 'raise' | null>;
  /** 레이즈에 대한 응답 (콜/폴드). null = 아직 */
  response: Record<BetSide, 'call' | 'fold' | null>;
  raise: { by: BetSide; amount: number } | null;
  report: Record<BetSide, RoundReport | null>;
  result: RoundBetResult | null;
}

/** UI가 그리는 데 필요한 한 라운드의 요약 */
export interface BetView {
  wave: number;
  pot: number;
  ante: number;
  raiseAmount: number;
  /** 지금 이 쪽이 고를 수 있는 것 */
  options: BetAction[];
  /** 내가 응답해야 하는 상대 레이즈 금액 (없으면 null) */
  pendingRaise: number | null;
  mine: BetAction | null;
  theirs: BetAction | null;
  result: RoundBetResult | null;
}

export const other = (s: BetSide): BetSide => (s === 'player' ? 'opponent' : 'player');

const roundTo = (v: number, unit: number): number => Math.round(v / unit) * unit;

export class BettingSystem {
  private rounds = new Map<number, RoundBet>();
  /** 이월된 판돈 (동률) */
  carry = 0;
  /** 판 밖 정산용 누적 (승자에게 준 판돈 합) */
  readonly won: Record<BetSide, number> = { player: 0, opponent: 0 };
  readonly history: RoundBetResult[] = [];
  private out: Record<BetSide, boolean> = { player: false, opponent: false };

  constructor(private cfg: DuelConfig, private wallets: Record<BetSide, BetWallet>) {}

  // ── 금액 ──
  anteFor(wave: number, side: BetSide): number {
    const base = this.cfg.ante.base + this.cfg.ante.perWave * wave;
    const discount = this.wallets[side].life <= this.cfg.comeback.lifeAtMost ? this.cfg.comeback.anteDiscount : 0;
    return Math.max(1, Math.round(base * (1 - discount)));
  }

  raiseAmount(wave: number): number {
    const r = this.cfg.raise;
    return Math.min(r.max, Math.max(r.roundTo, roundTo(r.base + r.perWave * wave, r.roundTo)));
  }

  // ── 라운드 ──
  round(wave: number): RoundBet | null { return this.rounds.get(wave) ?? null; }

  /** 라운드 개설 (한 번만, 이월 판돈 포함). 앤티는 enter()에서 */
  openRound(wave: number): RoundBet {
    const existing = this.rounds.get(wave);
    if (existing) return existing;
    const rb: RoundBet = {
      wave, pot: this.carry, entered: { player: false, opponent: false }, ante: { player: 0, opponent: 0 },
      action: { player: null, opponent: null }, response: { player: null, opponent: null },
      raise: null, report: { player: null, opponent: null }, result: null,
    };
    this.carry = 0;
    this.rounds.set(wave, rb);
    return rb;
  }

  /** 이 쪽이 라운드의 카드 선택에 들어감: 앤티를 내고 판돈에 넣는다 (한 번만) — 골드 부족분은 하트로 대납 */
  enter(side: BetSide, wave: number): RoundBet {
    const rb = this.openRound(wave);
    if (rb.entered[side] || this.out[side]) return rb;
    const ante = this.anteFor(wave, side);
    this.pay(side, ante);
    rb.entered[side] = true;
    rb.ante[side] = ante;
    rb.pot += ante;
    return rb;
  }

  /** 골드로 내고, 모자라면 하트로 대납 */
  private pay(side: BetSide, amount: number): void {
    const w = this.wallets[side];
    const gold = Math.min(amount, Math.floor(w.gold));
    if (gold > 0) w.spendGold(gold);
    const short = amount - gold;
    if (short > 0) w.loseLife(Math.ceil(short / this.cfg.shortfall.goldPerLife));
  }

  /** 이 쪽이 지금 고를 수 있는 선택지 */
  options(side: BetSide, wave: number): BetAction[] {
    const rb = this.rounds.get(wave);
    if (!rb || rb.result || this.out[side] || !rb.entered[side]) return [];
    const me = side, them = other(side);
    if (rb.raise && rb.raise.by === them && rb.response[me] === null) {
      return Math.floor(this.wallets[me].gold) >= rb.raise.amount ? ['call', 'fold'] : ['fold'];
    }
    if (rb.action[me] === null && !rb.raise) {
      const canRaise = !this.out[them] && Math.floor(this.wallets[me].gold) >= this.raiseAmount(wave);
      return canRaise ? ['check', 'raise'] : ['check'];
    }
    return [];
  }

  act(side: BetSide, wave: number, action: BetAction): RoundBet {
    const rb = this.rounds.get(wave);
    if (!rb) throw new Error(`라운드 ${wave} 판돈이 아직 없습니다`);
    if (!this.options(side, wave).includes(action)) throw new Error(`지금은 ${label(action)}할 수 없습니다`);
    switch (action) {
      case 'check':
        rb.action[side] = 'check';
        break;
      case 'raise': {
        const amt = this.raiseAmount(wave);
        this.wallets[side].spendGold(amt);
        rb.pot += amt;
        rb.action[side] = 'raise';
        rb.raise = { by: side, amount: amt };
        break;
      }
      case 'call':
        this.wallets[side].spendGold(rb.raise!.amount);
        rb.pot += rb.raise!.amount;
        rb.response[side] = 'call';
        if (rb.action[side] === null) rb.action[side] = 'check';
        break;
      case 'fold':
        rb.response[side] = 'fold';
        if (rb.action[side] === null) rb.action[side] = 'check';
        break;
    }
    this.tryJudge(rb);
    return rb;
  }

  /** 이 쪽이 응답해야 하는 가장 이른 라운드 (상대 레이즈 대기 중) */
  pendingResponse(side: BetSide): RoundBet | null {
    const waves = [...this.rounds.keys()].sort((a, b) => a - b);
    for (const w of waves) {
      const rb = this.rounds.get(w)!;
      if (!rb.result && rb.entered[side] && rb.raise && rb.raise.by !== side && rb.response[side] === null) return rb;
    }
    return null;
  }

  /** 라운드 성적 보고. 양쪽 다 보고되면 판정 */
  report(side: BetSide, r: RoundReport): RoundBetResult | null {
    const rb = this.openRound(r.wave);
    rb.report[side] = r;
    return this.tryJudge(rb);
  }

  /** 한쪽이 판을 마쳤음(승리/탈락) — 이후 라운드는 그쪽이 자동으로 진다 */
  markOut(side: BetSide): void {
    if (this.out[side]) return;
    this.out[side] = true;
    for (const rb of this.rounds.values()) this.tryJudge(rb);
  }

  /**
   * GameLoop 상태를 보고 라운드 개설·성적 보고·종료 처리를 자동으로 한다 (씬 update에서 매 프레임 호출).
   * 반환: 이번 호출로 새로 판정된 결과들
   */
  sync(side: BetSide, loop: BetProgress): RoundBetResult[] {
    const before = this.history.length;
    if (loop.phase === 'card' && !this.out[side]) this.enter(side, loop.wave);
    const lr = loop.lastRound;
    if (lr) {
      const rb = this.rounds.get(lr.wave);
      if (!rb || rb.report[side] === null) this.report(side, lr);
    }
    if (loop.phase === 'victory' || loop.phase === 'defeat') this.markOut(side);
    return this.history.slice(before);
  }

  // ── 판정 ──
  private tryJudge(rb: RoundBet): RoundBetResult | null {
    if (rb.result) return rb.result;
    const ready = (s: BetSide) => rb.report[s] !== null || this.out[s];
    if (!ready('player') || !ready('opponent')) return null;
    // 미응답 레이즈 = 폴드
    if (rb.raise) {
      const r = other(rb.raise.by);
      if (rb.response[r] === null) rb.response[r] = 'fold';
    }
    const folded = (s: BetSide) => rb.response[s] === 'fold';
    let winner: BetSide | 'carry';
    let reason: BetReason;
    let showdown = true;
    const P = rb.report.player, O = rb.report.opponent;
    if (folded('player') || folded('opponent')) {
      showdown = false;
      winner = folded('player') && folded('opponent') ? 'carry' : folded('player') ? 'opponent' : 'player';
      reason = winner === 'carry' ? 'carry' : 'fold';
    } else if (!P || !O) {
      winner = P ? 'player' : 'opponent';
      reason = 'out';
    } else if (P.lifeLost !== O.lifeLost) {
      winner = P.lifeLost < O.lifeLost ? 'player' : 'opponent';
      reason = 'life';
    } else if (P.cleared !== O.cleared) {
      winner = P.cleared ? 'player' : 'opponent';
      reason = 'out';
    } else if (Math.abs(P.clearSec - O.clearSec) >= 0.05) {
      winner = P.clearSec < O.clearSec ? 'player' : 'opponent';
      reason = 'time';
    } else if (P.handRank !== O.handRank) {
      winner = P.handRank > O.handRank ? 'player' : 'opponent';
      reason = 'hand';
    } else {
      winner = 'carry';
      reason = 'carry';
    }
    const result: RoundBetResult = { wave: rb.wave, winner, pot: rb.pot, reason, showdown };
    if (winner === 'carry') this.carry += rb.pot;
    else {
      this.wallets[winner].addGold(rb.pot);
      this.won[winner] += rb.pot;
    }
    rb.result = result;
    this.history.push(result);
    return result;
  }

  /** UI 요약: 응답 대기 라운드가 있으면 그것, 아니면 wave */
  view(side: BetSide, wave: number): BetView {
    const pending = this.pendingResponse(side);
    const rb = pending ?? this.rounds.get(wave) ?? null;
    const w = rb?.wave ?? wave;
    const them = other(side);
    const shown = (s: BetSide): BetAction | null => (rb ? rb.response[s] ?? rb.action[s] : null);
    return {
      wave: w,
      pot: rb?.pot ?? this.carry,
      ante: this.anteFor(w, side),
      raiseAmount: this.raiseAmount(w),
      options: this.options(side, w),
      pendingRaise: pending ? pending.raise!.amount : null,
      mine: shown(side),
      theirs: shown(them),
      result: rb?.result ?? null,
    };
  }
}

/** 상대 AI 베팅 성향 (순수). rank = 이번 라운드 족보 등급 */
export function aiOpening(cfg: DuelConfig, rank: number, gold: number, wave: number, raiseAmount: number, rng: () => number): 'check' | 'raise' {
  const reserve = cfg.ai.reserveAntes * (cfg.ante.base + cfg.ante.perWave * wave);
  if (gold - raiseAmount < reserve) return 'check';
  if (rank >= cfg.ai.raiseMinRank) return rng() < cfg.ai.raiseChance ? 'raise' : 'check';
  return rng() < cfg.ai.bluffChance ? 'raise' : 'check';
}

export function aiResponse(cfg: DuelConfig, rank: number, gold: number, wave: number, callAmount: number, rng: () => number): 'call' | 'fold' {
  const reserve = cfg.ai.reserveAntes * (cfg.ante.base + cfg.ante.perWave * wave);
  if (gold < callAmount) return 'fold';
  if (gold - callAmount < reserve) return rng() < cfg.ai.callAnyRankChance * 0.5 ? 'call' : 'fold';
  if (rank >= cfg.ai.callMinRank) return rng() < cfg.ai.callChance ? 'call' : 'fold';
  return rng() < cfg.ai.callAnyRankChance ? 'call' : 'fold';
}

export function label(a: BetAction): string {
  return { check: '체크', raise: '레이즈', call: '콜', fold: '폴드' }[a];
}

export const REASON_TEXT: Record<BetReason, string> = {
  fold: '상대 폴드',
  life: '하트를 덜 잃음',
  time: '더 빨리 클리어',
  hand: '족보가 더 높음',
  out: '상대 탈락',
  carry: '동률 → 다음 라운드로 이월',
};
