import Phaser from 'phaser';
import type { Card, HandResult } from '../systems/PokerEvaluator.ts';
import { RANK_TIER, TIER_STYLE, applyTierStyle, fitTextWidth, rainbowColor } from './HandFx.ts';
import { GAME_WIDTH } from '../config.ts';
import { Button } from './Button.ts';
import { COLORS, FONT, HAND_NAME, SUIT_CARD_COLOR, SUIT_SYMBOL, TAP_SLOP, rankLabel } from './theme.ts';

export interface CardHandCallbacks {
  /** 카드 탭 = 그 카드 1장 교환 (가능할 때만 호출됨) */
  onExchange: (index: number) => void;
  onConfirm: () => void;
}

const CARD_W = 176;
const CARD_H = 250;
const GAP = 24;
const FLIP_MS = 160;      // 반 바퀴(앞→옆, 옆→앞) 시간
const DEAL_STAGGER = 220; // 배분 시 카드 간 오픈 간격

interface CardView {
  root: Phaser.GameObjects.Container;
  front: Phaser.GameObjects.Container;
  back: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  rank: Phaser.GameObjects.Text;
  suit: Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Text;
  faceUp: boolean;
  /** 현재 앞면에 그려진 카드 (족보 구성 카드 강조용) */
  cardRef?: Card;
}

/**
 * 카드 5장 + 진행 버튼 + 타이머 (카드 페이즈 전용)
 *  - 배분: 뒷면으로 받아 한 장씩 뒤집으며 오픈 (긴장감), 다 열리기 전엔 족보 '???'
 *  - 교환: 카드를 탭하면 그 카드만 뒤집혀 새 카드로 오픈. 카드당 1회(메타 2회), 5장 전부 가능
 */
export class CardHand extends Phaser.GameObjects.Container {
  private cards: CardView[] = [];
  private confirmBtn: Button;
  private timerText: Phaser.GameObjects.Text;
  private hintText: Phaser.GameObjects.Text;
  private rankText: Phaser.GameObjects.Text;
  private rankTier = -1;
  private pulse: Phaser.Tweens.Tween | null = null;
  /** 진행 중인 뒤집기 수 (0이면 입력 가능) */
  private busy = 0;
  private lastResult: HandResult | null = null;
  private exchangeLeft: number[] = [0, 0, 0, 0, 0];

  constructor(scene: Phaser.Scene, y: number, private cb: CardHandCallbacks) {
    super(scene, 0, y);
    const totalW = 5 * CARD_W + 4 * GAP;
    const x0 = (GAME_WIDTH - totalW) / 2 + CARD_W / 2;
    for (let i = 0; i < 5; i++) {
      const root = scene.add.container(x0 + i * (CARD_W + GAP), 0);
      // 앞면
      const bg = scene.add.rectangle(0, 0, CARD_W, CARD_H, 0xf4efe2).setStrokeStyle(4, 0xd8d0bd);
      const rank = scene.add.text(-CARD_W / 2 + 16, -CARD_H / 2 + 12, '', { fontSize: '52px', fontFamily: FONT, fontStyle: 'bold' });
      const suit = scene.add.text(0, 14, '', { fontSize: '96px', fontFamily: FONT }).setOrigin(0.5);
      const badge = scene.add.text(CARD_W / 2 - 10, CARD_H / 2 - 8, '', { fontSize: '20px', color: '#7a5a12', fontFamily: FONT, fontStyle: 'bold' }).setOrigin(1, 1);
      const front = scene.add.container(0, 0, [bg, rank, suit, badge]);
      // 뒷면: 남색 + 금 테두리 + 다이아 패턴 느낌
      const backBg = scene.add.rectangle(0, 0, CARD_W, CARD_H, 0x1f2a4a).setStrokeStyle(4, 0xd4a941);
      const inner = scene.add.rectangle(0, 0, CARD_W - 28, CARD_H - 28).setStrokeStyle(2, 0xd4a941, 0.7);
      const mark = scene.add.text(0, 0, '♠♥\n♦♣', { fontSize: '40px', color: '#d4a941', fontFamily: FONT, align: 'center' }).setOrigin(0.5).setAlpha(0.8);
      const back = scene.add.container(0, 0, [backBg, inner, mark]);
      root.add([back, front]);
      root.setSize(CARD_W, CARD_H).setInteractive({ useHandCursor: true });
      root.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (p.getDistance() < TAP_SLOP && this.busy === 0 && this.exchangeLeft[i] > 0) this.cb.onExchange(i);
      });
      this.cards.push({ root, front, back, bg, rank, suit, badge, faceUp: true });
      this.add(root);
    }
    this.rankText = scene.add.text(GAME_WIDTH / 2, -CARD_H / 2 - 48, '', { fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0.5);
    this.add(this.rankText);

    const by = CARD_H / 2 + 90;
    this.confirmBtn = new Button(scene, GAME_WIDTH / 2, by, '진행', () => { if (this.busy === 0) this.cb.onConfirm(); }, { width: 520, height: 110 });
    this.timerText = scene.add.text(GAME_WIDTH - 60, by, '⏱ 30', { fontSize: '40px', color: COLORS.text, fontFamily: FONT }).setOrigin(1, 0.5);
    this.hintText = scene.add.text(GAME_WIDTH / 2, by + 88, '', { fontSize: '28px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(0.5);
    this.add([this.confirmBtn, this.timerText, this.hintText]);
    scene.add.existing(this);
  }

  /** 새 라운드 배분: 전부 뒷면으로 놓고 한 장씩 오픈 */
  deal(hand: readonly Card[], exchangeLeft: readonly number[], result: HandResult): void {
    this.lastResult = result;
    this.exchangeLeft = [...exchangeLeft];
    this.rankTier = -1;
    this.pulse?.remove(); this.pulse = null;
    this.rankText.setText('? ? ?').setScale(1);
    applyTierStyle(this.rankText, 0);
    this.confirmBtn.setEnabled(false);
    this.hintText.setText('카드를 오픈하는 중…');
    hand.forEach((card, i) => {
      const v = this.cards[i];
      this.setFace(v, card, false);
      this.showSide(v, false);
      v.faceUp = false;
    });
    this.busy = hand.length;
    hand.forEach((_, i) => {
      this.scene.time.delayedCall(200 + i * DEAL_STAGGER, () => this.flip(this.cards[i], true, () => {
        this.busy--;
        if (this.busy === 0) this.afterReveal();
      }));
    });
  }

  /** 교환 결과 반영: 해당 카드만 뒤집어 새 카드로 오픈 */
  exchangeCard(index: number, card: Card, exchangeLeft: readonly number[], result: HandResult): void {
    this.exchangeLeft = [...exchangeLeft];
    this.lastResult = result;
    const v = this.cards[index];
    this.busy++;
    this.confirmBtn.setEnabled(false);
    this.rankText.setText('? ? ?');
    applyTierStyle(this.rankText, 0);
    this.rankTier = -1;
    this.flip(v, false, () => {
      this.setFace(v, card, false);
      this.flip(v, true, () => {
        this.busy--;
        if (this.busy === 0) this.afterReveal();
      });
    });
  }

  /** 애니메이션 없이 즉시 갱신 (교환 횟수 표시 등) */
  refreshStatic(hand: readonly Card[], exchangeLeft: readonly number[], result: HandResult): void {
    this.exchangeLeft = [...exchangeLeft];
    this.lastResult = result;
    if (this.busy > 0) return;
    hand.forEach((card, i) => this.setFace(this.cards[i], card, true));
    this.afterReveal();
  }

  get isAnimating(): boolean { return this.busy > 0; }

  setTimer(sec: number): void {
    this.timerText.setText(`⏱ ${Math.ceil(sec)}`).setColor(sec <= 5 ? '#e0473f' : COLORS.text);
  }

  /** 매 프레임 (tier 5 무지개 순환) */
  update(timeMs: number): void {
    if (this.rankTier >= 5 && this.visible) this.rankText.setColor(rainbowColor(timeMs));
  }

  /** 족보 라벨의 씬 좌표 (연출 위치용) */
  get rankLabelPosition(): { x: number; y: number } {
    return { x: this.x + this.rankText.x, y: this.y + this.rankText.y };
  }

  // ── 내부 ──
  private afterReveal(): void {
    if (!this.lastResult) return;
    const result = this.lastResult;
    const core = new Set(result.coreCards);
    this.cards.forEach((v, i) => {
      const isCore = v.faceUp && core.has(v.cardRef!) && result.rank > 0;
      v.bg.setFillStyle(isCore ? 0xfff1c2 : 0xf4efe2);
      v.bg.setStrokeStyle(4, isCore ? 0xd4a941 : 0xd8d0bd);
      const left = this.exchangeLeft[i];
      v.badge.setText(left > 0 ? `교환 ${left}` : '').setColor(left > 0 ? '#7a5a12' : '#b0a890');
      v.root.setAlpha(1);
    });
    this.setRank(result);
    const total = this.exchangeLeft.reduce((a, b) => a + b, 0);
    this.hintText.setText(total > 0 ? `카드를 탭하면 그 카드만 교환 (카드당 ${Math.max(...this.exchangeLeft)}회 · 남은 교환 ${total})` : '교환 완료 — 진행하세요');
    this.confirmBtn.setEnabled(true);
  }

  private setFace(v: CardView, card: Card, keepRef: boolean): void {
    const color = SUIT_CARD_COLOR[card.suit];
    v.rank.setText(rankLabel(card.rank)).setColor(color);
    v.suit.setText(SUIT_SYMBOL[card.suit]).setColor(color);
    v.cardRef = card;
    if (!keepRef) v.badge.setText('');
  }

  private showSide(v: CardView, faceUp: boolean): void {
    v.front.setVisible(faceUp);
    v.back.setVisible(!faceUp);
    v.faceUp = faceUp;
  }

  /** 뒤집기: scaleX 1→0 (옆면) → 면 교체 → 0→1 */
  private flip(v: CardView, toFaceUp: boolean, onDone: () => void): void {
    this.scene.tweens.add({
      targets: v.root, scaleX: 0, duration: FLIP_MS, ease: 'Sine.easeIn',
      onComplete: () => {
        this.showSide(v, toFaceUp);
        this.scene.tweens.add({ targets: v.root, scaleX: 1, duration: FLIP_MS, ease: 'Sine.easeOut', onComplete: onDone });
      },
    });
  }

  private setRank(result: HandResult): void {
    const tier = RANK_TIER[result.rank];
    const stars = tier >= 3 ? ' ' + '✦'.repeat(tier - 2) : '';
    this.rankText.setText(`${stars}${HAND_NAME[result.rank]}${stars}`);
    if (tier === this.rankTier) { fitTextWidth(this.rankText, GAME_WIDTH - 100); return; }
    this.rankTier = tier;
    applyTierStyle(this.rankText, tier);
    fitTextWidth(this.rankText, GAME_WIDTH - 100);
    this.pulse?.remove();
    this.pulse = null;
    this.rankText.setScale(1);
    // 오픈 완료 팝
    this.scene.tweens.add({ targets: this.rankText, scale: { from: 0.6, to: 1 }, duration: 220, ease: 'Back.easeOut' });
    const st = TIER_STYLE[tier];
    if (st.pulseMs > 0) {
      this.scene.time.delayedCall(240, () => {
        if (this.rankTier !== tier) return;
        this.pulse = this.scene.tweens.add({ targets: this.rankText, scale: 1 + tier * 0.03, duration: st.pulseMs / 2, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      });
    }
  }
}
