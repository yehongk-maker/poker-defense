/**
 * 입력 로그 — 한 판을 완전히 재현하는 최소 정보 (docs/mode-design.md §2.2). 순수.
 *  - InputRecorder: GameLoop에 붙어 플레이어의 입력을 라운드별로 기록한다 (씬은 호출을 바꾸지 않는다)
 *  - replayMatch: 시드 스트림 + 로그로 GameLoop을 헤드리스로 다시 돌려 라운드 성적이 같은지 확인한다
 * 재현의 전제: 난수는 Seed.seedStreams, 전투는 고정 step(config.simStep). 전투 중 입력은 step 번호로 기록한다.
 * 판돈으로 오간 골드·하트(g/l)는 상대에 따라 달라지는 "외부 입력"이라 로그에 그대로 적는다 —
 * 그 값이 판돈 규칙과 맞는지는 양쪽 로그를 함께 보는 검증(E단계)의 몫이다.
 */
import { GameLoop, type GameData, type RoundReport } from './GameLoop.ts';
import type { RngStreams } from './Seed.ts';

type SuitCode = 'S' | 'H' | 'D' | 'C';

/**
 * 순서가 있는 입력 한 건.
 *  x/xt/xb 카드 교환(기본/교환권/광고 보너스) · c 패 확정 · mv 배치 이동 · sell 판매(유닛 인덱스) · mg 합성 · up 수트 업그레이드
 *  hero 영웅 소환 · go 전투 시작 · sk 영웅 스킬(step) · g 외부 골드 증감 · l 외부 하트 차감 (전투 중이면 step) · rv 부활(캠페인)
 */
export type RoundOp =
  | ['x' | 'xt' | 'xb', number]
  | ['c']
  | ['mv', number, number]
  | ['sell', number]
  | ['mg', string]
  | ['up', SuitCode]
  | ['hero', string]
  | ['go']
  | ['sk', number]
  | ['g' | 'l', number, number?]
  | ['rv', number];

export type BetAction = 'check' | 'raise' | 'call' | 'fold';

export interface RoundInput {
  wave: number;
  /** 교환한 카드 인덱스 순서 (교환권 교환 포함) */
  exchanges: number[];
  /** 그중 교환권으로 한 교환 수 */
  ticketExchanges: number;
  /** 카드 확정 시각 (라운드 시작 후 초) */
  confirmedAt: number;
  manage: { moves: [number, number][]; sells: number[]; merges: string[]; upgrades: SuitCode[]; hero?: string };
  /** 전투 길이(초, 시뮬 시간) */
  combatSec: number;
  /** 영웅 스킬 사용 시각 (전투 시작 후 초) */
  skills: number[];
  /** wave = 이 선택이 걸린 라운드 (밀린 레이즈에 대한 응답은 지금 라운드와 다를 수 있다) */
  bet: { action: BetAction; at: number; wave?: number }[];
  result: { lifeLost: number; clearSec: number; handRank: number; cleared: boolean };
  /** 순서 있는 전체 입력 — 재생은 이것만 본다 (위 필드들은 요약) */
  ops?: RoundOp[];
  /** 전투에서 진행한 step 수 */
  steps?: number;
  /** 라운드가 끝나기 전에 판이 끝났다 (상대가 먼저 클리어 등). result는 비교하지 않는다 */
  partial?: boolean;
}

/** GameLoop이 입력을 알리는 통로 */
export interface LoopListener {
  op(op: RoundOp, wave: number): void;
  roundEnd(report: RoundReport, steps: number): void;
}

const emptyRound = (wave: number): RoundInput => ({
  wave, exchanges: [], ticketExchanges: 0, confirmedAt: 0,
  manage: { moves: [], sells: [], merges: [], upgrades: [] },
  combatSec: 0, skills: [], bet: [],
  result: { lifeLost: 0, clearSec: 0, handRank: 0, cleared: false },
  ops: [], steps: 0, partial: true,
});

export class InputRecorder implements LoopListener {
  private list: RoundInput[] = [];
  private readonly step: number;

  /**
   * @param earlier 이어하기: 이미 기록된 라운드들 (그 로그로 loop를 되돌린 뒤에 붙인다)
   */
  constructor(private loop: GameLoop, simStep = 0.1, earlier: readonly RoundInput[] = []) {
    this.step = simStep;
    this.list = earlier.map((r) => ({ ...r, ops: [...(r.ops ?? [])], bet: [...r.bet], manage: { ...r.manage, moves: [...r.manage.moves], sells: [...r.manage.sells], merges: [...r.manage.merges], upgrades: [...r.manage.upgrades] }, skills: [...r.skills], exchanges: [...r.exchanges] }));
    loop.listener = this;
    this.round(loop.wave);
  }

  private round(wave: number): RoundInput {
    let r = this.list[this.list.length - 1];
    if (!r || r.wave !== wave) {
      r = emptyRound(wave);
      this.list.push(r);
    }
    return r;
  }

  private cardElapsed(): number {
    const c = this.loop.cardPhase;
    return Math.round((c.timerSeconds - c.timeRemaining) * 100) / 100;
  }

  op(op: RoundOp, wave: number): void {
    const r = this.round(wave);
    r.ops!.push(op);
    switch (op[0]) {
      case 'x': case 'xb': r.exchanges.push(op[1]); break;
      case 'xt': r.exchanges.push(op[1]); r.ticketExchanges++; break;
      case 'c': r.confirmedAt = this.cardElapsed(); break;
      case 'mv': r.manage.moves.push([op[1], op[2]]); break;
      case 'sell': r.manage.sells.push(op[1]); break;
      case 'mg': r.manage.merges.push(op[1]); break;
      case 'up': r.manage.upgrades.push(op[1]); break;
      case 'hero': r.manage.hero = op[1]; break;
      case 'sk': r.skills.push(Math.round(op[1] * this.step * 100) / 100); break;
      default: break;
    }
  }

  roundEnd(report: RoundReport, steps: number): void {
    const r = this.round(report.wave);
    r.steps = steps;
    r.combatSec = report.clearSec;
    r.result = { lifeLost: report.lifeLost, clearSec: report.clearSec, handRank: report.handRank, cleared: report.cleared };
    r.partial = false;
  }

  /** 판돈 액션 기록 (씬이 BettingSystem.act 직후 호출) */
  bet(action: BetAction, wave?: number): void {
    const r = this.round(this.loop.wave);
    const at = this.loop.phase === 'card' ? this.cardElapsed() : r.confirmedAt + this.loop.combatSteps * this.step;
    r.bet.push(wave === undefined || wave === r.wave ? { action, at: Math.round(at * 100) / 100 } : { action, at: Math.round(at * 100) / 100, wave });
  }

  /** 지금까지의 로그 (복사본). 진행 중인 라운드는 partial로 남고 그때까지의 전투 step 수를 담는다 */
  get rounds(): RoundInput[] {
    const out = this.list.map((r) => ({ ...r, ops: [...(r.ops ?? [])] }));
    const last = out[out.length - 1];
    if (last?.partial) {
      // 입력이 하나도 없는 마지막 라운드(막 받은 패)는 빈 채로 남긴다 — 재생에 영향 없음
      last.steps = this.loop.phase === 'combat' && this.loop.wave === last.wave ? this.loop.combatSteps : last.steps;
      last.combatSec = (last.steps ?? 0) * this.step;
      last.result = { ...last.result, clearSec: last.combatSec };
    }
    return out;
  }

  checksum(): string {
    return logChecksum(this.rounds);
  }
}

/** 로그 요약 해시 (전송 중 손상·바꿔치기 확인용, 보안 해시 아님) */
export function logChecksum(rounds: readonly RoundInput[]): string {
  const text = JSON.stringify(rounds.map((r) => [r.wave, r.ops ?? [], r.steps ?? 0, r.result]));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface ReplayResult {
  ok: boolean;
  issues: string[];
  /** 재생으로 얻은 라운드 성적 (끝까지 치른 라운드만) */
  reports: RoundReport[];
  final: { reached: number; life: number; gold: number; phase: string };
}

const EPS = 1e-6;

/**
 * 시드 + 로그로 한 판을 다시 돌린다.
 * @param data 그 판의 GameData (buildGameData 결과, simStep 포함)
 * @param streams 그 플레이어의 시드 스트림 (Seed.seedStreams)
 */
export function replayMatch(data: GameData, streams: RngStreams, rounds: readonly RoundInput[]): ReplayResult {
  const loop = new GameLoop(data, streams);
  const { issues, reports } = replayInto(loop, data, rounds);
  const reached = loop.phase === 'victory' ? data.config.totalWaves + 1 : loop.wave;
  return { ok: issues.length === 0, issues, reports, final: { reached, life: loop.life, gold: loop.gold, phase: loop.phase } };
}

/**
 * 새로 만든 loop에 로그를 재생해 그 시점의 판으로 되돌린다 (검증·재접속 이어하기 공용).
 * 마지막 라운드가 partial이면 그 라운드의 입력과 전투 step까지만 진행한 상태로 남는다.
 */
export function replayInto(loop: GameLoop, data: GameData, rounds: readonly RoundInput[]): { issues: string[]; reports: RoundReport[] } {
  const issues: string[] = [];
  const reports: RoundReport[] = [];
  const over = () => loop.phase === 'victory' || loop.phase === 'defeat';
  const runTo = (step: number) => { while (loop.phase === 'combat' && loop.combatSteps < step) loop.stepCombat(); };

  outer: for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const tag = `r${i + 1}`;
    if (!Array.isArray(r.ops)) { issues.push(`${tag}:ops_missing`); break; }
    const startWave = loop.wave;
    if (r.wave !== startWave) { issues.push(`${tag}:wave_mismatch`); break; }
    const before = loop.lastRound;
    let fought = false;

    for (const op of r.ops) {
      try {
        const timed = (op[0] === 'sk' ? op[1] : op[0] === 'g' || op[0] === 'l' ? op[2] : undefined) as number | undefined;
        if (timed !== undefined) {
          if (!Number.isInteger(timed) || timed < 0) throw new Error('bad step');
          runTo(timed);
        } else if (loop.phase === 'combat' && loop.wave === startWave) {
          // step 없는 입력이 전투 뒤에 있다 = 전투가 끝난 다음의 입력
          runTo(Infinity);
        }
        if (loop.wave !== startWave && op[0] !== 'g' && op[0] !== 'l') throw new Error('round already over');
        apply(loop, op);
        if (op[0] === 'go') fought = true;
      } catch {
        issues.push(`${tag}:op_failed:${op[0]}`);
        break outer;
      }
    }
    if (loop.phase === 'combat' && loop.wave === startWave) runTo(r.partial ? (r.steps ?? 0) : Infinity);

    const done = loop.lastRound;
    const finished = fought && done !== null && done !== before && done.wave === r.wave;
    if (finished) reports.push(done);
    if (r.partial) {
      if (finished) issues.push(`${tag}:partial_but_finished`);
      if (i < rounds.length - 1) issues.push(`${tag}:partial_not_last`);
      continue;
    }
    if (!finished) { issues.push(`${tag}:round_not_finished`); break; }
    const e = r.result;
    if (done.cleared !== e.cleared) issues.push(`${tag}:cleared_mismatch`);
    if (done.lifeLost !== e.lifeLost) issues.push(`${tag}:life_mismatch`);
    if (done.handRank !== e.handRank) issues.push(`${tag}:hand_mismatch`);
    if (Math.abs(done.clearSec - e.clearSec) > EPS) issues.push(`${tag}:time_mismatch`);
    if (r.steps !== undefined && r.steps !== Math.round(done.clearSec / (data.config.simStep ?? 0.1))) issues.push(`${tag}:steps_mismatch`);
    if (over() && i < rounds.length - 1) { issues.push(`${tag}:rounds_after_end`); break; }
  }
  return { issues, reports };
}

function apply(loop: GameLoop, op: RoundOp): void {
  switch (op[0]) {
    case 'x': loop.cardPhase.exchangeCard(op[1]); break;
    case 'xt': loop.exchangeWithTicket(op[1]); break;
    case 'xb': throw new Error('bonus exchange is campaign-only');
    case 'c': loop.confirmHand(); break;
    case 'mv': loop.moveUnit(op[1], op[2]); break;
    case 'sell': loop.sellUnit(op[1]); break;
    case 'mg': loop.mergeUnits(op[1]); break;
    case 'up': loop.buyUpgrade(op[1]); break;
    case 'hero': loop.summonHero(op[1]); break;
    case 'go': loop.startCombat(); break;
    case 'sk': loop.useHeroSkill(); break;
    case 'g': if (op[1] >= 0) loop.addGold(op[1]); else loop.spendGold(-op[1]); break;
    case 'l': loop.loseLife(op[1]); break;
    case 'rv': throw new Error('revive is campaign-only');
  }
}
