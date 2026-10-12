/**
 * Opponent — 상대 추상화 (docs/mode-design.md §2.1). 순수.
 * UI(상대 바·미니맵·상대 패널)와 판돈·레이스 판정은 OpponentSource만 본다.
 * 구현: AIOpponent(봇 두뇌 — 고스트 대본을 주면 기록을 따라 친다, 대체 매칭·오프라인) / LiveOpponent(네트워크, src/net/Live.ts).
 * 화면에는 어떤 구현인지 드러내지 않는다 — identity(닉·레이팅·아바타)만 보인다.
 */
import type { GameData, GamePhase, RoundReport, RunSnapshot } from './GameLoop.ts';
import { GameLoop } from './GameLoop.ts';
import type { Suit } from './PokerEvaluator.ts';
import type { BetWallet, BettingSystem, BotPreset, DuelConfig } from './Betting.ts';
import { OpponentAI, type OpponentScript } from './Duel.ts';
import { seedStreams } from './Seed.ts';

export interface OpponentIdentity { name: string; rating: number | null; avatar: Suit }

export interface OpponentUnitView { slot: number; suit: Suit; tier: number }
export interface OpponentEnemyView { type: string; movement: 'ground' | 'air'; pos: number; hpPct: number; isBoss: boolean }
export interface OpponentSynergyView { kind: string; key: string; name: string; reached: number }

/** 상대에 대해 공개되는 정보 (GDD §10.6). 손패·아웃·게이지는 없다 */
export interface OpponentView {
  wave: number;
  life: number;
  gold: number;
  phase: GamePhase;
  units: OpponentUnitView[];
  hero: { slot: number; suit: Suit; name: string; grade: string } | null;
  enemies: OpponentEnemyView[];
  synergies: OpponentSynergyView[];
  /** 이번 라운드 교환 장수 (카드 페이즈 중에만 의미) */
  exchangeCount: number;
  lastHandRank: number | null;
}

/** 판돈 시스템이 보는 진행 상태 — GameLoop이 그대로 만족한다 */
export interface BetParticipant {
  readonly phase: GamePhase;
  readonly wave: number;
  readonly lastRound: RoundReport | null;
}

export interface OpponentSource {
  readonly identity: OpponentIdentity;
  /** 실시간 진행. 봇·고스트는 자기 판을 굴리고, 네트워크 상대는 받은 이벤트를 반영한다 */
  tick(dt: number): void;
  readonly view: OpponentView;
  readonly finished: boolean;
  readonly wallet: BetWallet;
  readonly participant: BetParticipant;
  /** 내 판이 먼저 끝났을 때 상대 판을 끝까지 진행 (네트워크 상대는 할 수 없으므로 no-op) */
  fastForward(): void;
}

/** GameLoop → 공개 정보 */
export function viewOfLoop(g: GameLoop, lastHandRank: number | null): OpponentView {
  const b = g.battle;
  return {
    wave: g.wave, life: g.life, gold: g.gold, phase: g.phase,
    units: g.units.map((u) => ({ slot: u.slot, suit: u.def.suit, tier: u.def.tier })),
    hero: g.hero ? { slot: g.hero.unit.slot, suit: g.hero.unit.def.suit, name: g.hero.def.name, grade: g.hero.grade } : null,
    enemies: b ? b.aliveEnemies.map((e) => ({ type: e.type, movement: e.movement, pos: e.pos, hpPct: e.maxHp > 0 ? e.hp / e.maxHp : 0, isBoss: e.isBoss })) : [],
    synergies: g.activeSynergies.map((s) => ({ kind: s.kind, key: s.key, name: s.name, reached: s.reached })),
    exchangeCount: g.cardPhase.exchangesUsed + g.cardPhase.ticketsUsed,
    lastHandRank,
  };
}

/** 봇 상대: 기존 OpponentAI(생각 시간·베팅 성향)를 OpponentSource로 감싼다 */
export class AIOpponent implements OpponentSource {
  readonly loop: GameLoop;
  private ai: OpponentAI;

  /**
   * @param opts.script 고스트 대본. 있으면 그 판의 시드 스트림으로 판을 만들고 대본을 따라 친다 (끝나면 봇 두뇌가 이어 받음).
   *   화면에는 대본 유무가 드러나지 않는다 — 봇과 같은 OpponentSource다.
   */
  constructor(data: GameData, readonly identity: OpponentIdentity, rng: () => number = Math.random, opts: { thinkSec?: [number, number]; manageSec?: [number, number]; script?: OpponentScript; preset?: BotPreset; restore?: RunSnapshot } = {}) {
    const { script, preset, restore, ...given } = opts;
    // 강도 프리셋: 전략 강도 + 생각 시간. 대본이 있으면 대본이 끝난 뒤(이어받기)에만 쓰인다
    const rest = preset ? { thinkSec: preset.thinkSec, manageSec: preset.manageSec, skill: preset, ...given } : given;
    const source = script ? seedStreams(script.seed, { handKey: script.handKey, player: script.player }) : rng;
    // 이어하기: 상대의 마지막 라운드 시작 시점에서 다시
    this.loop = restore ? GameLoop.restore(data, restore, source) : new GameLoop(data, source);
    this.ai = new OpponentAI(data, rng, { ...rest, loop: this.loop, script: script?.rounds });
  }

  /** 대본을 따라 친 라운드 수 (테스트용) */
  get scriptedRounds(): number { return this.ai.scriptedRounds; }

  /** 판돈 시스템 연결 (양쪽 지갑이 만들어진 뒤에 호출) */
  attachBetting(system: BettingSystem, config: DuelConfig): void {
    this.ai.setBetting({ system, config });
  }

  tick(dt: number): void { this.ai.tick(dt); }
  get view(): OpponentView { return viewOfLoop(this.loop, this.ai.lastHandRank); }
  get finished(): boolean { return this.ai.finished; }
  get wallet(): BetWallet { return this.loop; }
  get participant(): BetParticipant { return this.loop; }
  fastForward(): void { this.ai.fastForward(); }
}

/** 대체 상대용 로컬 닉네임 (오프라인일 때. 온라인은 서버 bot_names 풀이 정한다) */
export const LOCAL_BOT_NAMES: readonly string[] = [
  '하트왕', '심연의궁수', '골드러시', '스페이드잭', '클로버킹', '풀하우스장인', '플러시헌터', '레이즈마스터',
  '철벽수비', '황금상단주', '성소기사', '강철군단장', '올인각', '타짜지망생', '디펜스고수', '빙고한줄',
  '퇴근길한판', '점심내기', '월급루팡', '민트초코', '고양이집사', '주말전사', '원페어인생', '로열꿈나무',
];

export function localBotIdentity(myRating: number, rng: () => number = Math.random, avoid: readonly string[] = []): OpponentIdentity {
  const pool = LOCAL_BOT_NAMES.filter((n) => !avoid.includes(n));
  const names = pool.length ? pool : LOCAL_BOT_NAMES;
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  return {
    name: names[Math.min(names.length - 1, Math.floor(rng() * names.length))],
    rating: Math.max(100, myRating + Math.floor(rng() * 161) - 80),
    avatar: suits[Math.min(3, Math.floor(rng() * 4))],
  };
}
