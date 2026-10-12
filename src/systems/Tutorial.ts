/**
 * Tutorial — 첫 판 가이드 단계 진행 (순수). 문구·조건은 src/data/tutorial.json.
 * 강제하지 않는다: 플레이어가 먼저 해 버린 단계(다음 페이즈·다음 웨이브로 넘어감)는 건너뛰고, 언제든 전부 건너뛸 수 있다.
 */
export type TutorialPhase = 'card' | 'manage' | 'combat';
export type TutorialEvent = 'exchange' | 'confirm' | 'move' | 'combat' | 'tap' | 'skip';
export type TutorialTrack = 'campaign' | 'duel';

export interface TutorialStep {
  id: string;
  phase: TutorialPhase;
  /** 없으면 이 가이드를 처음 본 웨이브 */
  wave?: number;
  anchor: string;
  until: TutorialEvent;
  pause: boolean;
  title: string;
  text: string;
  /** "이 단계만 넘기기" 버튼 문구 (until이 tap이 아닌 단계) */
  skipLabel?: string;
  /** 이 조건이 켜진 판에서만 (예: betting) */
  needs?: string;
}

export interface TutorialState { phase: string; wave: number }

const ORDER: Record<TutorialPhase, number> = { card: 0, manage: 1, combat: 2 };

export class Tutorial {
  private steps: TutorialStep[];
  private i = 0;
  private startWave: number | null = null;
  private _skipped = false;

  constructor(steps: readonly TutorialStep[], flags: Record<string, boolean> = {}) {
    this.steps = steps.filter((s) => !s.needs || flags[s.needs]);
  }

  get done(): boolean { return this._skipped || this.i >= this.steps.length; }
  get skipped(): boolean { return this._skipped; }
  get index(): number { return this.i; }
  get total(): number { return this.steps.length; }

  private waveOf(s: TutorialStep, now: number): number {
    if (s.wave !== undefined) return s.wave;
    if (this.startWave === null) this.startWave = now;
    return this.startWave;
  }

  /** 지금 보여 줄 단계 (없으면 null). 이미 지나간 단계는 여기서 건너뛴다 */
  current(state: TutorialState): TutorialStep | null {
    if (this._skipped) return null;
    const phase = state.phase as TutorialPhase;
    if (!(phase in ORDER)) return null; // 승리·패배 등
    while (this.i < this.steps.length) {
      const s = this.steps[this.i];
      const w = this.waveOf(s, state.wave);
      const past = state.wave > w || (state.wave === w && ORDER[phase] > ORDER[s.phase]);
      if (past) { this.i++; continue; }
      return state.wave === w && phase === s.phase ? s : null;
    }
    return null;
  }

  /** 사건 알림. 지금 단계가 기다리던 사건이면(또는 skip) 다음 단계로 — 넘어갔으면 true */
  on(event: TutorialEvent, state: TutorialState): boolean {
    const s = this.current(state);
    if (!s) return false;
    if (event === 'skip' || event === s.until || (event === 'tap' && s.until === 'tap')) {
      this.i++;
      return true;
    }
    return false;
  }

  /** 전부 건너뛰기 */
  skipAll(): void { this._skipped = true; }

  /** 지금 단계가 게임을 멈추는가 */
  pausing(state: TutorialState): boolean {
    return this.current(state)?.pause ?? false;
  }
}
