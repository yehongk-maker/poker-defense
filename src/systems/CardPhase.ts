/**
 * CardPhase — 라운드 시작 시 카드 배분/선택/교환(제한 횟수)/타이머/확정 상태머신
 *
 * GDD 3.0/3.4 근거:
 *  - 라운드마다 52장 덱 리셋 → 5장 배분
 *  - 원하는 카드 선택 후 "교환"(기본 1회, 메타 업그레이드로 최대 2회) 또는 "바로 진행"
 *  - 30초 타이머(메타 업그레이드 +10초), 0초 = 자동 진행
 *
 * 순수 로직: Phaser 의존 없음. 씬은 tick(dt)을 update()에서 호출하고,
 * 반환값/게터로 UI를 그린다. 난수는 rng 주입(기본 Math.random).
 */

import {
  type Card,
  type HandResult,
  createDeck,
  evaluateHand,
} from './PokerEvaluator.ts';

export type CardPhaseState = 'idle' | 'choosing' | 'done';

export interface CardPhaseConfig {
  /** 배분 장수 (기본 5) */
  handSize?: number;
  /** 교환 가능 횟수 (기본 1, 메타 업그레이드 시 2) */
  exchangeLimit?: number;
  /** 제한 시간 초 (기본 30, 메타 업그레이드 시 40) */
  timerSeconds?: number;
}

export interface TickResult {
  /** 남은 시간(초, 0 이상) — UI 표시용 */
  remaining: number;
  /** 이번 tick에서 시간 만료로 자동 확정됐으면 그 결과 */
  autoConfirmed: HandResult | null;
}

export class CardPhase {
  readonly handSize: number;
  readonly exchangeLimit: number;
  readonly timerSeconds: number;

  private rng: () => number;
  private deck: Card[] = [];
  private handCards: Card[] = [];
  private selected = new Set<number>();
  private exchangesUsed = 0;
  private remainingTime = 0;
  private phaseState: CardPhaseState = 'idle';
  private result: HandResult | null = null;

  constructor(config: CardPhaseConfig = {}, rng: () => number = Math.random) {
    this.handSize = config.handSize ?? 5;
    this.exchangeLimit = config.exchangeLimit ?? 1;
    this.timerSeconds = config.timerSeconds ?? 30;
    this.rng = rng;
  }

  /** 라운드 시작: 새 52장 덱 셔플 → handSize장 배분, 타이머 리셋 */
  start(): readonly Card[] {
    this.deck = this.shuffle(createDeck());
    this.handCards = this.deck.splice(0, this.handSize);
    this.selected.clear();
    this.exchangesUsed = 0;
    this.remainingTime = this.timerSeconds;
    this.phaseState = 'choosing';
    this.result = null;
    return this.hand;
  }

  get state(): CardPhaseState {
    return this.phaseState;
  }

  get hand(): readonly Card[] {
    return this.handCards;
  }

  get deckCount(): number {
    return this.deck.length;
  }

  get selectedIndices(): readonly number[] {
    return [...this.selected].sort((a, b) => a - b);
  }

  get exchangesRemaining(): number {
    return this.exchangeLimit - this.exchangesUsed;
  }

  get timeRemaining(): number {
    return this.remainingTime;
  }

  /** 확정된 족보 결과 (done 상태에서만 non-null) */
  get handResult(): HandResult | null {
    return this.result;
  }

  /** 카드 탭: 교환 대상 선택/해제 토글 */
  toggleSelect(index: number): boolean {
    this.assertChoosing();
    if (!Number.isInteger(index) || index < 0 || index >= this.handCards.length) {
      throw new Error(`Invalid card index: ${index}`);
    }
    if (this.exchangesRemaining <= 0) return false; // 교환 소진 시 선택 불가
    if (this.selected.has(index)) this.selected.delete(index);
    else this.selected.add(index);
    return this.selected.has(index);
  }

  /**
   * 선택한 카드를 덱의 새 카드로 교환. 버린 카드는 덱으로 돌아가지 않는다.
   * @returns 교환 후의 손패
   */
  exchange(): readonly Card[] {
    this.assertChoosing();
    if (this.exchangesRemaining <= 0) throw new Error('No exchanges remaining');
    if (this.selected.size === 0) throw new Error('No cards selected for exchange');
    if (this.selected.size > this.deck.length) throw new Error('Not enough cards in deck');

    for (const idx of this.selected) {
      this.handCards[idx] = this.deck.shift()!;
    }
    this.selected.clear();
    this.exchangesUsed++;
    return this.hand;
  }

  /** "진행" 버튼: 족보 확정. 타이머 만료 시에도 내부적으로 호출된다. */
  confirm(): HandResult {
    this.assertChoosing();
    this.result = evaluateHand(this.handCards, this.rng);
    this.phaseState = 'done';
    return this.result;
  }

  /**
   * 씬 update()에서 매 프레임 호출. dt는 초 단위.
   * 시간이 0이 되면 자동 확정(autoConfirmed에 결과 반환).
   */
  tick(dtSeconds: number): TickResult {
    if (this.phaseState !== 'choosing') {
      return { remaining: Math.max(0, this.remainingTime), autoConfirmed: null };
    }
    this.remainingTime = Math.max(0, this.remainingTime - dtSeconds);
    if (this.remainingTime <= 0) {
      return { remaining: 0, autoConfirmed: this.confirm() };
    }
    return { remaining: this.remainingTime, autoConfirmed: null };
  }

  private assertChoosing(): void {
    if (this.phaseState !== 'choosing') {
      throw new Error(`Invalid state: ${this.phaseState} (expected 'choosing')`);
    }
  }

  /** Fisher–Yates 셔플 (rng 주입으로 재현 가능) */
  private shuffle(cards: Card[]): Card[] {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }
}
