/**
 * Duel — 1:1 대결 (플레이어 vs 상대 AI). 순수 로직.
 *
 * 규칙 (GDD 3.7, v1.5):
 *  - 양쪽이 같은 웨이브 테이블을 각자 진행한다 (상호 간섭 없음, 진행 속도 독립).
 *  - 상대는 봇 전략(bots.ts smart)으로 카드·정비·전투를 수행하며, 사람처럼 생각 시간을 둔다.
 *  - 승패는 플레이어의 판이 끝날 때 판정: 상대가 아직 진행 중이면 헤드리스로 끝까지 돌린 뒤
 *    도달 웨이브(승리=41) → 라이프 → 골드 순으로 비교. 전부 같으면 무승부.
 */
import { GameLoop, type GameData } from './GameLoop.ts';
import { smartCardPhase, smartExchange, smartManage, smartCombatTick } from './bots.ts';
import { aiOpening, aiResponse, type BettingSystem, type DuelConfig } from './Betting.ts';
import { evaluateHand } from './PokerEvaluator.ts';

export interface OpponentOptions {
  /** 카드 페이즈 생각 시간(초) 범위 */
  thinkSec?: [number, number];
  /** 정비 시간(초) 범위 */
  manageSec?: [number, number];
  /** 판돈 걸기 (있으면 카드 확정 시 체크/레이즈, 상대 레이즈엔 잠시 뒤 콜/폴드) */
  betting?: { system: BettingSystem; config: DuelConfig };
  /** 미리 만든 GameLoop을 쓴다 (베팅 지갑과 같은 인스턴스를 공유할 때) */
  loop?: GameLoop;
}

/** 상대 AI: GameLoop 하나를 실시간으로 굴린다 */
export class OpponentAI {
  readonly loop: GameLoop;
  private timer = 0;
  private wait = 0;
  private lastPhase: string | null = null;
  private thinkSec: [number, number];
  private manageSec: [number, number];
  /** 마지막 확정 족보명 (UI 표시용) */
  lastHandRank: number | null = null;
  private betting: OpponentOptions['betting'];
  private respondTimer = 0;
  private respondWait = 0;

  constructor(data: GameData, private rng: () => number = Math.random, opts: OpponentOptions = {}) {
    this.loop = opts.loop ?? new GameLoop(data, rng);
    this.thinkSec = opts.thinkSec ?? [1.5, 4];
    this.manageSec = opts.manageSec ?? [0.8, 1.8];
    this.betting = opts.betting;
  }

  get finished(): boolean {
    return this.loop.phase === 'victory' || this.loop.phase === 'defeat';
  }

  /** 실시간 진행 (씬 update에서 호출) */
  tick(dt: number): void {
    const g = this.loop;
    if (this.finished) return;
    this.tickBetResponse(dt);
    if (g.phase !== this.lastPhase) {
      this.lastPhase = g.phase;
      this.timer = 0;
      this.wait = g.phase === 'card' ? this.pick(this.thinkSec) : g.phase === 'manage' ? this.pick(this.manageSec) : 0;
    }
    switch (g.phase) {
      case 'card': {
        const r = g.cardPhase.tick(dt);
        this.timer += dt;
        if (r.autoConfirmed || this.timer >= this.wait) {
          if (r.autoConfirmed) { this.betOpening('check'); g.confirmHand(); }
          else if (this.betting) { smartExchange(g); this.betOpening(null); g.confirmHand(); }
          else smartCardPhase(g);
          this.lastHandRank = g.cardPhase.handResult?.rank ?? null;
        }
        break;
      }
      case 'manage':
        this.timer += dt;
        if (this.timer >= this.wait) {
          smartManage(g);
          g.startCombat();
        }
        break;
      case 'combat':
        smartCombatTick(g, dt);
        break;
    }
  }

  /** 남은 판을 즉시 끝까지 진행 (플레이어가 먼저 끝났을 때 판정용). 생각 시간 없음 */
  fastForward(maxRounds = 200): void {
    const g = this.loop;
    let guard = 0;
    while (!this.finished && ++guard <= maxRounds) {
      if (g.phase === 'card') { smartCardPhase(g); this.lastHandRank = g.cardPhase.handResult?.rank ?? null; }
      if (g.phase === 'manage') { smartManage(g); g.startCombat(); }
      for (let t = 0; t < 600 && g.phase === 'combat'; t += 0.1) smartCombatTick(g, 0.1);
      if (g.phase === 'combat') break; // 교착 방지
    }
  }

  private pick([a, b]: [number, number]): number {
    return a + (b - a) * this.rng();
  }

  // ── 판돈 걸기 ──
  /** 카드 확정 직전: 체크/레이즈 (forced가 있으면 그것, 없으면 성향대로) */
  private betOpening(forced: 'check' | null): void {
    if (!this.betting) return;
    const { system, config } = this.betting;
    const g = this.loop;
    system.enter('opponent', g.wave);
    const opts = system.options('opponent', g.wave);
    if (opts.length === 0 || opts.includes('call') || opts.includes('fold')) return; // 응답은 tickBetResponse가
    const rank = evaluateHand([...g.cardPhase.hand], () => 0).rank;
    const choice = forced ?? aiOpening(config, rank, g.gold, g.wave, system.raiseAmount(g.wave), this.rng);
    system.act('opponent', g.wave, opts.includes(choice) ? choice : 'check');
  }

  /** 플레이어 레이즈에 잠시 생각한 뒤 콜/폴드 */
  private tickBetResponse(dt: number): void {
    if (!this.betting) return;
    const { system, config } = this.betting;
    const pending = system.pendingResponse('opponent');
    if (!pending) { this.respondTimer = 0; this.respondWait = 0; return; }
    if (this.respondWait === 0) this.respondWait = this.pick(config.ai.respondSec);
    this.respondTimer += dt;
    if (this.respondTimer < this.respondWait) return;
    const g = this.loop;
    const rank = g.wave === pending.wave && g.phase === 'card' ? evaluateHand([...g.cardPhase.hand], () => 0).rank : (this.lastHandRank ?? 0);
    const opts = system.options('opponent', pending.wave);
    const choice = aiResponse(config, rank, g.gold, pending.wave, pending.raise!.amount, this.rng);
    system.act('opponent', pending.wave, opts.includes(choice) ? choice : 'fold');
    this.respondTimer = 0; this.respondWait = 0;
  }
}

export type DuelWinner = 'player' | 'opponent' | 'draw';

export interface DuelSide {
  phase: string;
  wave: number;
  life: number;
  gold: number;
}

export type DuelReason = 'first_clear' | 'opponent_out' | 'wave' | 'life' | 'gold' | 'draw';

export interface DuelResult {
  winner: DuelWinner;
  /** 판정 근거 */
  reason: DuelReason;
  player: DuelSide;
  opponent: DuelSide;
}

/** 도달 점수: 승리 = totalWaves+1, 패배 = 패배한 웨이브 */
export function reachScore(side: DuelSide, totalWaves: number): number {
  return side.phase === 'victory' ? totalWaves + 1 : side.wave;
}

export function resolveDuel(player: DuelSide, opponent: DuelSide, totalWaves: number): DuelResult {
  const pw = reachScore(player, totalWaves), ow = reachScore(opponent, totalWaves);
  const base = { player, opponent };
  if (pw !== ow) return { winner: pw > ow ? 'player' : 'opponent', reason: 'wave', ...base };
  if (player.life !== opponent.life) return { winner: player.life > opponent.life ? 'player' : 'opponent', reason: 'life', ...base };
  if (Math.floor(player.gold) !== Math.floor(opponent.gold)) return { winner: player.gold > opponent.gold ? 'player' : 'opponent', reason: 'gold', ...base };
  return { winner: 'draw', reason: 'draw', ...base };
}

/**
 * 레이스 진행 중 매 프레임 호출: 이미 승패가 났으면 결과, 아니면 null.
 *  - 40 클리어를 먼저 한 쪽 즉시 승리 (같은 순간이면 라이프 → 골드)
 *  - 한쪽이 탈락했고 다른 쪽이 그보다 앞선 라운드에 있으면 앞선 쪽 승리
 */
export function raceStatus(player: DuelSide, opponent: DuelSide, totalWaves: number): DuelResult | null {
  const base = { player, opponent };
  const pV = player.phase === 'victory', oV = opponent.phase === 'victory';
  if (pV && oV) return resolveDuel(player, opponent, totalWaves);
  if (pV) return { winner: 'player', reason: 'first_clear', ...base };
  if (oV) return { winner: 'opponent', reason: 'first_clear', ...base };
  const pD = player.phase === 'defeat', oD = opponent.phase === 'defeat';
  if (oD && !pD && player.wave > opponent.wave) return { winner: 'player', reason: 'opponent_out', ...base };
  if (pD && !oD && opponent.wave > player.wave) return { winner: 'opponent', reason: 'opponent_out', ...base };
  if (pD && oD) return resolveDuel(player, opponent, totalWaves);
  return null;
}

export const sideOf = (g: GameLoop): DuelSide => ({ phase: g.phase, wave: g.wave, life: g.life, gold: g.gold });
