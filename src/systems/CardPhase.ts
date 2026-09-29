/**
 * CardPhase — 라운드 시작 시 카드 배분/교환(카드별 제한 횟수)/타이머/확정 상태머신
 *
 * GDD 3.0/3.4 (v1.4 개정) 근거:
 *  - 라운드마다 52장 덱 리셋 → 5장 배분 (뒷면으로 받아 UI가 순차 오픈)
 *  - 카드는 **한 장씩** 교환한다. 각 카드는 exchangeLimit번(기본 1, 메타 업그레이드로 2)까지 교환 가능 → 5장 전부 바꿀 수 있다
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
import { OUT_KINDS, countOuts, kindAchieved, outSpec, pickIndex, pityMultOf, targetsOf, type DrawAssistConfig, type OutKind, type OutWeights } from './DrawAssist.ts';

export type CardPhaseState = 'idle' | 'choosing' | 'done';

export interface CardPhaseConfig {
  /** 배분 장수 (기본 5) */
  handSize?: number;
  /** 카드 1장당 교환 가능 횟수 (기본 1, 메타 업그레이드 시 2). 총 교환 가능 = handSize × exchangeLimit */
  exchangeLimit?: number;
  /** 제한 시간 초 (기본 30, 메타 업그레이드 시 40) */
  timerSeconds?: number;
  /** 행운 드로우 (GDD §3.1.1). 없거나 outWeight 0이면 순수 확률(덱 순서대로) */
  drawAssist?: DrawAssistConfig;
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
  /** 아웃 가중치 보너스 (0 = 보정 없음) */
  readonly outWeight: number;
  /** 행운 게이지 설정 (없으면 꺼짐) */
  readonly pity: { mult: number | Partial<Record<OutKind, number>>; maxLevel: number };
  /** 행운 게이지 레벨 (종류별, 라운드를 넘어 유지) */
  private pityLevel: Record<OutKind, number> = { rank: 0, flush: 0, straight: 0 };
  /** 이번 라운드에 교환하며 노린 종류 */
  private attempted = new Set<OutKind>();

  private rng: () => number;
  private deck: Card[] = [];
  private handCards: Card[] = [];
  /** 카드 위치별 교환 횟수 (기본 교환) */
  private exchangedCount: number[] = [];
  /** 이번 라운드 교환권으로 교환한 횟수 (카드별) */
  private ticketCount: number[] = [];
  /** 이번 라운드에 받은 보너스 교환(광고 보상) 잔여 */
  private bonus = 0;
  private bonusUsedCount = 0;
  private remainingTime = 0;
  private phaseState: CardPhaseState = 'idle';
  private result: HandResult | null = null;
  /** 교환이 성공할 때마다 불린다 (입력 로그용) */
  onExchange: ((index: number, kind: 'normal' | 'ticket' | 'bonus') => void) | null = null;

  constructor(config: CardPhaseConfig = {}, rng: () => number = Math.random) {
    this.handSize = config.handSize ?? 5;
    this.exchangeLimit = config.exchangeLimit ?? 1;
    this.timerSeconds = config.timerSeconds ?? 30;
    this.outWeight = config.drawAssist?.outWeight ?? 0;
    this.pity = config.drawAssist?.pity ?? { mult: 1, maxLevel: 0 };
    this.rng = rng;
  }

  /** 라운드 시작: 새 52장 덱 셔플 → handSize장 배분, 타이머 리셋 */
  start(): readonly Card[] {
    this.deck = this.shuffle(createDeck());
    this.handCards = this.deck.splice(0, this.handSize);
    this.exchangedCount = new Array(this.handSize).fill(0);
    this.ticketCount = new Array(this.handSize).fill(0);
    this.bonus = 0;
    this.bonusUsedCount = 0;
    this.remainingTime = this.timerSeconds;
    this.phaseState = 'choosing';
    this.result = null;
    this.attempted.clear();
    return this.hand;
  }

  // ── 행운 게이지 (GDD 3.1.1) ──
  /** 종류별 게이지 레벨 (0 = 보정 기본값) */
  get pityLevels(): Readonly<Record<OutKind, number>> { return this.pityLevel; }
  /** 종류별 현재 배율 (아웃 보너스가 기본의 몇 배인지): mult^level */
  pityMultiplier(kind: OutKind): number { return Math.pow(pityMultOf(this.pity.mult, kind), this.pityLevel[kind]); }
  /** 이번 라운드에 교환하며 노린 종류 */
  get attemptedTargets(): OutKind[] { return [...this.attempted]; }
  /** 지금 적용되는 종류별 아웃 보너스 */
  get outWeights(): OutWeights {
    return { rank: this.outWeight * this.pityMultiplier('rank'), flush: this.outWeight * this.pityMultiplier('flush'), straight: this.outWeight * this.pityMultiplier('straight') };
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

  /** 남은 총 교환 가능 횟수 (카드별 남은 횟수 합) */
  get exchangesRemaining(): number {
    return this.exchangedCount.reduce((s, n) => s + (this.exchangeLimit - n), 0);
  }

  /** 총 교환 가능 횟수 (handSize × exchangeLimit) — "교환 N/M" 표시용 */
  get exchangesTotal(): number {
    return this.handSize * this.exchangeLimit;
  }

  /** 사용한 기본 교환 횟수 */
  get exchangesUsed(): number {
    return this.exchangedCount.reduce((s, n) => s + n, 0);
  }

  /** 기본 교환을 전부 썼는가 (교환권만 남은 상태) */
  get exchangesDone(): boolean {
    return this.exchangesRemaining === 0;
  }

  /** 이번 라운드 교환권 사용 횟수 */
  get ticketsUsed(): number {
    return this.ticketCount.reduce((s, n) => s + n, 0);
  }
  ticketsUsedFor(index: number): number {
    this.assertIndex(index);
    return this.ticketCount[index];
  }

  /** 보너스 교환(광고 보상) 잔여 — 기본 교환을 다 쓴 카드에 쓴다. 라운드가 바뀌면 사라진다 */
  get bonusExchanges(): number { return this.bonus; }
  get bonusUsed(): number { return this.bonusUsedCount; }
  grantBonusExchange(n = 1): void {
    this.assertChoosing();
    this.bonus += Math.max(0, Math.floor(n));
  }
  /** 보너스 교환 1회 사용: 횟수 제한과 무관하게 이 카드를 바꾼다 */
  exchangeWithBonus(index: number): Card {
    this.assertChoosing();
    this.assertIndex(index);
    if (this.bonus <= 0) throw new Error('No bonus exchanges left');
    const next = this.draw(index);
    this.handCards[index] = next;
    this.bonus--;
    this.bonusUsedCount++;
    this.onExchange?.(index, 'bonus');
    return next;
  }

  /** 행운 게이지 복원 (이어하기) */
  restorePity(levels: Partial<Record<OutKind, number>>): void {
    for (const k of OUT_KINDS) this.pityLevel[k] = Math.max(0, Math.min(this.pity.maxLevel, Math.floor(levels[k] ?? 0)));
  }

  /** 교환권으로 이 카드를 교환할 수 있는가 (횟수 제한 무시, 상태·덱만 확인) */
  canExchangeWithTicket(index: number): boolean {
    return this.phaseState === 'choosing' && Number.isInteger(index) && index >= 0 && index < this.handCards.length && this.deck.length > 0;
  }

  /** 이 카드를 바꿀 때 남는 카드(나머지 4장)와 어울리는 카드가 덱에 몇 장인지 — 행운 드로우 UI용 */
  outsFor(index: number): number {
    this.assertIndex(index);
    return countOuts(this.handCards.filter((_, i) => i !== index), this.deck);
  }

  /** 특정 카드의 남은 교환 횟수 */
  exchangesRemainingFor(index: number): number {
    this.assertIndex(index);
    return this.exchangeLimit - this.exchangedCount[index];
  }

  /** 이 카드를 교환할 수 있는가 (choosing 상태 + 횟수 남음 + 덱 잔여) */
  canExchange(index: number): boolean {
    return this.phaseState === 'choosing' && Number.isInteger(index) && index >= 0 && index < this.handCards.length
      && this.exchangedCount[index] < this.exchangeLimit && this.deck.length > 0;
  }

  get timeRemaining(): number {
    return this.remainingTime;
  }

  /** 확정된 족보 결과 (done 상태에서만 non-null) */
  get handResult(): HandResult | null {
    return this.result;
  }

  /**
   * 카드 1장 교환: 해당 위치의 카드를 덱의 새 카드로 바꾼다. 버린 카드는 덱으로 돌아가지 않는다.
   * @returns 새 카드
   */
  exchangeCard(index: number): Card {
    this.assertChoosing();
    this.assertIndex(index);
    if (this.exchangedCount[index] >= this.exchangeLimit) throw new Error(`Card ${index} has no exchanges left`);
    const next = this.draw(index);
    this.handCards[index] = next;
    this.exchangedCount[index]++;
    this.onExchange?.(index, 'normal');
    return next;
  }

  /**
   * 카드 교환권 사용: 기본 교환 횟수와 무관하게 이 카드를 새 카드로 바꾼다.
   * 교환권 재고(계정 보유)는 호출 측(MetaProgress)이 차감한다.
   */
  exchangeWithTicket(index: number): Card {
    this.assertChoosing();
    this.assertIndex(index);
    const next = this.draw(index);
    this.handCards[index] = next;
    this.ticketCount[index]++;
    this.onExchange?.(index, 'ticket');
    return next;
  }

  /** 덱에서 한 장 뽑기: 보정이 켜져 있으면 남긴 카드(index 제외) 기준 아웃 가중 추첨, 아니면 덱 맨 위 */
  private draw(index: number): Card {
    if (this.deck.length === 0) throw new Error('Not enough cards in deck');
    if (this.outWeight <= 0) return this.deck.shift()!;
    const kept = this.handCards.filter((_, i) => i !== index);
    for (const k of targetsOf(outSpec(kept))) this.attempted.add(k); // 남긴 카드가 말해주는 "노린 족보"
    const at = pickIndex(kept, this.deck, this.outWeights, this.rng);
    return this.deck.splice(at, 1)[0];
  }

  /** "진행" 버튼: 족보 확정. 타이머 만료 시에도 내부적으로 호출된다. */
  confirm(): HandResult {
    this.assertChoosing();
    this.result = evaluateHand(this.handCards, this.rng);
    this.phaseState = 'done';
    // 행운 게이지: 노린 종류가 안 나왔으면 레벨 +1(상한), 나왔으면 0
    if (this.pity.maxLevel > 0) {
      for (const k of OUT_KINDS) {
        if (!this.attempted.has(k)) continue;
        this.pityLevel[k] = kindAchieved(k, this.result.rank) ? 0 : Math.min(this.pity.maxLevel, this.pityLevel[k] + 1);
      }
    }
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

  private assertIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.handCards.length) {
      throw new Error(`Invalid card index: ${index}`);
    }
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
