/**
 * 실시간 대전의 두 끝 (docs/mode-design.md §2.3 릴레이 모델). Phaser 의존 없음.
 *  - LivePublisher: 내 판(GameLoop)의 공개 정보를 상대에게 보낸다 (손패·아웃·게이지는 보내지 않는다)
 *  - LiveOpponent: 받은 이벤트로 상대 모습을 만든다 → OpponentSource (UI·판돈·레이스 판정이 그대로 쓴다)
 * 각자 자기 보드만 시뮬하고, 판돈은 양쪽 기기가 같은 사실(앤티·선택·라운드 성적)로 같은 판정을 낸다 (BettingSystem remote 모드).
 */
import type { GameData, GamePhase, RoundReport } from '../systems/GameLoop.ts';
import type { GameLoop } from '../systems/GameLoop.ts';
import type { BetAction, BetWallet, BettingSystem } from '../systems/Betting.ts';
import type { BetParticipant, OpponentIdentity, OpponentSource, OpponentView } from '../systems/Opponent.ts';
import type { MatchEvent, MatchTransport, Unsubscribe } from './MatchTransport.ts';
import type { MatchReport } from './types.ts';

/** 진행 중인 실시간 매치 (GameScene에 넘긴다) */
export interface LiveContext {
  matchId: string;
  /** 친구 대전 방 코드 (랭크는 없음) */
  roomCode: string | null;
  me: string;
  opponentId: string | null;
  transport: MatchTransport;
}

/** 스냅샷의 위치 눈금 (트랙 한 바퀴 = 1000) */
const POS_SCALE = 1000;
const enemyTypeList = (data: GameData): string[] => Object.keys(data.enemyTypes).sort();

export interface LiveTuning {
  /** 전투 스냅샷 간격(초) */
  snapshotSec: number;
  /** 필드 변경을 묶어 보내는 최소 간격(초) */
  fieldSec: number;
}
export const LIVE_TUNING: LiveTuning = { snapshotSec: 0.5, fieldSec: 0.4 };

export class LivePublisher {
  private types: string[];
  private lastWave = 0;
  private lastPhase: GamePhase | null = null;
  private enteredWave = 0;
  private confirmedWave = 0;
  private lastExchange = 0;
  private lastField = '';
  private fieldWait = 0;
  private snapWait = 0;
  private reportedWave = 0;
  private finishSent = false;
  private elapsed = 0;
  private clearedSec: number | null = null;
  /** 판정에 필요한 이벤트(진입·확정·판돈·성적·종료)의 기록 — 상대가 (다시) 접속하면 처음부터 다시 보낸다. 받는 쪽은 중복을 무시한다 */
  private critical: MatchEvent[] = [];
  private peerOnline = false;
  private offPresence: Unsubscribe;

  constructor(
    private transport: MatchTransport,
    private loop: GameLoop,
    private data: GameData,
    private betting: BettingSystem | null,
    private tuning: LiveTuning = LIVE_TUNING,
  ) {
    this.types = enemyTypeList(data);
    // Realtime broadcast는 지나간 이벤트를 다시 주지 않는다 → 상대가 채널에 붙는 순간 밀린 것을 재전송
    this.offPresence = transport.onPresence((on) => {
      if (on && !this.peerOnline) this.resend();
      this.peerOnline = on;
    });
  }

  private static readonly CRITICAL: ReadonlySet<MatchEvent['t']> = new Set(['enter', 'confirm', 'bet', 'report', 'finish']);

  private emit(e: MatchEvent): void {
    if (LivePublisher.CRITICAL.has(e.t)) this.critical.push(e);
    this.transport.send(e);
  }

  private resend(): void {
    for (const e of this.critical) this.transport.send(e);
    this.lastField = ''; // 필드도 다음 tick에 다시
    this.fieldWait = 0;
  }

  close(): void { this.offPresence(); }

  /** 매치 시작 후 흐른 시간(초, 벽시계) */
  get matchSec(): number { return this.elapsed; }

  /** 내 최종 성적 (서버 보고용) */
  get report(): MatchReport {
    const g = this.loop;
    const total = this.data.config.totalWaves;
    return { reached: g.phase === 'victory' ? total + 1 : g.wave, life: g.life, gold: Math.floor(g.gold), clearedSec: g.phase === 'victory' ? this.clearedSec ?? this.elapsed : null };
  }

  /**
   * 매 프레임, 내 판과 판돈(sync)을 갱신한 뒤에 호출한다.
   * @param wallDt 실제로 흐른 시간(초) — 배속과 무관
   */
  tick(wallDt: number): void {
    this.elapsed += wallDt;
    const g = this.loop;
    const send = (e: MatchEvent) => this.emit(e);

    // 라운드 성적 (라운드 진입보다 먼저 — 받는 쪽이 순서대로 처리한다)
    const lr = g.lastRound;
    if (lr && lr.wave > this.reportedWave) {
      this.reportedWave = lr.wave;
      send({ t: 'report', wave: lr.wave, lifeLost: lr.lifeLost, clearSec: lr.clearSec, handRank: lr.handRank, cleared: lr.cleared });
    }

    this.flushEnter();
    if (g.phase === 'card' && this.enteredWave === g.wave) {
      const n = g.cardPhase.exchangesUsed + g.cardPhase.ticketsUsed;
      if (n !== this.lastExchange) { this.lastExchange = n; send({ t: 'exchange', wave: g.wave, count: n }); }
    }

    const changed = g.phase !== this.lastPhase || g.wave !== this.lastWave;
    if (changed) {
      // 확정과 전투 시작이 한 프레임에 겹쳐도 확정(족보 등급)을 빠뜨리지 않는다
      if ((g.phase === 'manage' || g.phase === 'combat') && this.confirmedWave !== g.wave) {
        this.confirmedWave = g.wave;
        send({ t: 'confirm', wave: g.wave, handRank: g.cardPhase.handResult?.rank ?? 0 });
      }
      if (g.phase === 'combat') { send({ t: 'combat', wave: g.wave }); this.snapWait = 0; }
      this.lastPhase = g.phase;
      this.lastWave = g.wave;
    }

    // 필드·하트·골드
    this.fieldWait -= wallDt;
    if (changed || this.fieldWait <= 0) {
      const field = this.fieldEvent();
      const sig = JSON.stringify(field);
      if (sig !== this.lastField) { this.lastField = sig; send(field); this.fieldWait = this.tuning.fieldSec; }
    }

    if (g.phase === 'combat' && g.battle) {
      this.snapWait -= wallDt;
      if (this.snapWait <= 0) {
        this.snapWait = this.tuning.snapshotSec;
        const len = this.data.battleConfig.trackLength;
        send({
          t: 'snapshot', wave: g.wave, sec: Math.round(g.battle.time * 10) / 10,
          enemies: g.battle.aliveEnemies.map((e) => [Math.max(0, this.types.indexOf(e.type)), Math.round((e.pos / len) * POS_SCALE), Math.round(e.maxHp > 0 ? (e.hp / e.maxHp) * 100 : 0)] as [number, number, number]),
        });
      }
    }

    for (const f of this.betting?.drainOutbox() ?? []) send({ t: 'bet', wave: f.wave, action: f.action });

    if (!this.finishSent && (g.phase === 'victory' || g.phase === 'defeat')) {
      this.finishSent = true;
      if (g.phase === 'victory') this.clearedSec = Math.round(this.elapsed * 10) / 10;
      send({ t: 'finish', ...this.report });
    }
  }

  /** 라운드 진입(+앤티)을 아직 안 알렸으면 알린다. 같은 프레임에 확정·전투까지 가도, 판돈 선택보다 항상 먼저 나간다 */
  private flushEnter(): void {
    const g = this.loop;
    if (this.enteredWave === g.wave || g.phase === 'victory' || g.phase === 'defeat') return;
    const rb = this.betting?.round(g.wave);
    if (this.betting && !rb?.entered.player) return;
    this.enteredWave = g.wave;
    this.lastExchange = 0;
    this.emit(this.betting ? { t: 'enter', wave: g.wave, ante: rb!.ante.player } : { t: 'enter', wave: g.wave });
  }

  /** 내가 고른 판돈 선택을 알린다 (BettingSystem.act 직후) */
  bet(wave: number, action: BetAction, amount?: number): void {
    this.flushEnter();
    this.emit(amount === undefined ? { t: 'bet', wave, action } : { t: 'bet', wave, action, amount });
  }

  skill(id: string): void {
    const g = this.loop;
    this.transport.send({ t: 'skill', wave: g.wave, sec: Math.round((g.battle?.time ?? 0) * 10) / 10, id });
  }

  rematch(ready: boolean): void { this.transport.send({ t: 'rematch', ready }); }
  leave(): void { this.transport.send({ t: 'leave' }); }

  private fieldEvent(): MatchEvent {
    const g = this.loop;
    return {
      t: 'field',
      units: g.units.map((u) => ({ slot: u.slot, suit: u.def.suit, tier: u.def.tier })),
      hero: g.hero ? { slot: g.hero.unit.slot, suit: g.hero.unit.def.suit, id: g.hero.def.id, grade: g.hero.grade } : null,
      life: g.life, gold: Math.floor(g.gold),
    };
  }
}

/** 상대 지갑의 거울: 값은 상대가 보내 준 그대로. 판돈 시스템은 네트워크 상대의 지갑을 건드리지 않는다 */
class MirrorWallet implements BetWallet {
  gold = 0;
  life = 0;
  addGold(): void { /* 상대 기기가 계산한다 */ }
  spendGold(): void { /* 상대 기기가 계산한다 */ }
  loseLife(): void { /* 상대 기기가 계산한다 */ }
}

export interface LiveOpponentEvents {
  /** 상대가 스킬을 썼다 (말풍선 등 연출용) */
  onSkill?: (heroId: string) => void;
  onRematch?: (ready: boolean) => void;
  onLeave?: () => void;
}

export class LiveOpponent implements OpponentSource {
  private types: string[];
  private mirror = new MirrorWallet();
  private betting: BettingSystem | null = null;
  private early: MatchEvent[] = [];
  private v: OpponentView;
  private last: RoundReport | null = null;
  private done = false;
  private off: Unsubscribe[] = [];
  private _online = true;
  private offlineSec = 0;
  private _left = false;
  private _rematch = false;
  private _final: MatchReport | null = null;
  events: LiveOpponentEvents = {};

  constructor(readonly identity: OpponentIdentity, transport: MatchTransport, private data: GameData) {
    this.types = enemyTypeList(data);
    this.mirror.gold = data.config.startGold;
    this.mirror.life = data.config.startLife;
    this.v = { wave: 1, life: this.mirror.life, gold: this.mirror.gold, phase: 'card', units: [], hero: null, enemies: [], synergies: [], exchangeCount: 0, lastHandRank: null };
    this.off.push(transport.on((e) => this.apply(e)));
    this.off.push(transport.onPresence((on) => { this._online = on; if (on) this.offlineSec = 0; }));
  }

  /** 판돈 시스템 연결. 연결 전에 도착한 상대의 앤티·선택·성적(카운트다운 중에 먼저 시작한 상대)을 이때 반영한다 */
  attachBetting(system: BettingSystem): void {
    this.betting = system;
    const early = this.early;
    this.early = [];
    for (const e of early) this.applyBet(e);
  }

  private applyBet(e: MatchEvent): void {
    const b = this.betting;
    if (!b) { this.early.push(e); return; }
    if (e.t === 'enter') { if (e.ante !== undefined) b.enterRemote(e.wave, e.ante); }
    else if (e.t === 'bet') b.actRemote(e.wave, e.action, e.amount);
    else if (e.t === 'report' && !b.round(e.wave)?.report.opponent) b.report('opponent', { wave: e.wave, lifeLost: e.lifeLost, clearSec: e.clearSec, handRank: e.handRank, cleared: e.cleared });
  }

  /** 상대가 접속해 있는가 / 끊긴 지 몇 초인가 */
  get online(): boolean { return this._online; }
  get offlineFor(): number { return this._online ? 0 : this.offlineSec; }
  /** 상대가 방을 나갔다 */
  get left(): boolean { return this._left; }
  get wantsRematch(): boolean { return this._rematch; }
  /** 상대가 보낸 최종 성적 (판을 마친 뒤) */
  get finalReport(): MatchReport | null { return this._final; }

  tick(dt: number): void {
    if (!this._online) this.offlineSec += dt;
  }

  get view(): OpponentView { return this.v; }
  get finished(): boolean { return this.done; }
  get wallet(): BetWallet { return this.mirror; }
  get participant(): BetParticipant { return { phase: this.v.phase, wave: this.v.wave, lastRound: this.last }; }
  /** 네트워크 상대의 판은 대신 굴릴 수 없다 */
  fastForward(): void { /* no-op */ }

  close(): void {
    for (const f of this.off) f();
    this.off = [];
  }

  private apply(e: MatchEvent): void {
    const total = this.data.config.totalWaves;
    const v = this.v;
    switch (e.t) {
      case 'enter':
        this.applyBet(e);
        if (this.done || e.wave < v.wave || (e.wave === v.wave && v.phase !== 'card')) break; // 재전송된 옛 이벤트
        v.wave = e.wave; v.phase = 'card'; v.exchangeCount = 0; v.enemies = [];
        break;
      case 'exchange':
        v.exchangeCount = e.count;
        break;
      case 'confirm':
        if (this.done || e.wave < v.wave || (e.wave === v.wave && v.phase !== 'card')) break;
        v.phase = 'manage'; v.lastHandRank = e.handRank;
        break;
      case 'field':
        v.units = e.units.map((u) => ({ ...u }));
        v.hero = e.hero ? { slot: e.hero.slot, suit: e.hero.suit, grade: e.hero.grade, name: this.data.heroes.find((h) => h.id === e.hero!.id)?.name ?? '영웅' } : null;
        v.life = e.life; v.gold = e.gold;
        this.mirror.life = e.life; this.mirror.gold = e.gold;
        break;
      case 'combat':
        if (this.done || e.wave < v.wave || (e.wave === v.wave && v.phase !== 'card' && v.phase !== 'manage')) break;
        v.phase = 'combat'; v.wave = e.wave; v.enemies = [];
        break;
      case 'snapshot': {
        if (v.phase !== 'combat' || e.wave !== v.wave) break;
        const len = this.data.battleConfig.trackLength;
        v.enemies = e.enemies.map(([ti, pos, hp]) => {
          const type = this.types[ti] ?? this.types[0];
          const def = this.data.enemyTypes[type];
          return { type, movement: def?.movement ?? 'ground', pos: (pos / POS_SCALE) * len, hpPct: hp / 100, isBoss: !!def?.boss };
        });
        break;
      }
      case 'skill':
        this.events.onSkill?.(e.id);
        break;
      case 'report': {
        const r: RoundReport = { wave: e.wave, lifeLost: e.lifeLost, clearSec: e.clearSec, handRank: e.handRank, cleared: e.cleared };
        // 성적은 받는 즉시 판돈에 보고한다 (프레임 사이에 여러 개가 와도 빠뜨리지 않게)
        this.applyBet(e);
        if (this.last && e.wave <= this.last.wave) break; // 재전송
        this.last = r;
        v.enemies = [];
        if (!e.cleared) v.phase = 'defeat';
        else if (e.wave >= total) v.phase = 'victory';
        else { v.wave = e.wave + 1; v.phase = 'card'; v.exchangeCount = 0; }
        break;
      }
      case 'bet':
        this.applyBet(e);
        break;
      case 'finish':
        if (this.done) break;
        this.done = true;
        this._final = { reached: e.reached, life: e.life, gold: e.gold, clearedSec: e.clearedSec };
        v.life = e.life; v.gold = e.gold;
        this.mirror.life = e.life; this.mirror.gold = e.gold;
        v.phase = e.reached > total ? 'victory' : 'defeat';
        if (e.reached <= total) v.wave = e.reached;
        v.enemies = [];
        break;
      case 'rematch':
        this._rematch = e.ready;
        this.events.onRematch?.(e.ready);
        break;
      case 'leave':
        this._left = true;
        this.events.onLeave?.();
        break;
    }
  }
}
