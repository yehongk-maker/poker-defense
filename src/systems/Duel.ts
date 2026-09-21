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
import { smartCardPhase, smartManage, smartCombatTick } from './bots.ts';

export interface OpponentOptions {
  /** 카드 페이즈 생각 시간(초) 범위 */
  thinkSec?: [number, number];
  /** 정비 시간(초) 범위 */
  manageSec?: [number, number];
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

  constructor(data: GameData, private rng: () => number = Math.random, opts: OpponentOptions = {}) {
    this.loop = new GameLoop(data, rng);
    this.thinkSec = opts.thinkSec ?? [2.5, 6];
    this.manageSec = opts.manageSec ?? [1, 2.5];
  }

  get finished(): boolean {
    return this.loop.phase === 'victory' || this.loop.phase === 'defeat';
  }

  /** 실시간 진행 (씬 update에서 호출) */
  tick(dt: number): void {
    const g = this.loop;
    if (this.finished) return;
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
          if (r.autoConfirmed) g.confirmHand();
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
}

export type DuelWinner = 'player' | 'opponent' | 'draw';

export interface DuelSide {
  phase: string;
  wave: number;
  life: number;
  gold: number;
}

export interface DuelResult {
  winner: DuelWinner;
  /** 판정 근거 */
  reason: 'wave' | 'life' | 'gold' | 'draw';
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

export const sideOf = (g: GameLoop): DuelSide => ({ phase: g.phase, wave: g.wave, life: g.life, gold: g.gold });
