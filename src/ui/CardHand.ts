import Phaser from 'phaser';
import type { Card, HandResult } from '../systems/PokerEvaluator.ts';
import { RANK_TIER, TIER_STYLE, applyTierStyle, fitTextWidth, rainbowColor } from './HandFx.ts';
import { GAME_WIDTH } from '../config.ts';
import { Button } from './Button.ts';
import { COLORS, FONT, HAND_NAME, SUIT_CARD_COLOR, SUIT_SYMBOL, TAP_SLOP, rankLabel } from './theme.ts';

export interface CardHandCallbacks {
  onToggle: (index: number) => void;
  onExchange: () => void;
  onConfirm: () => void;
}

const CARD_W = 176;
const CARD_H = 250;
const GAP = 24;

/** 카드 5장 + 교환/진행 버튼 + 타이머 (카드 페이즈 전용) */
export class CardHand extends Phaser.GameObjects.Container {
  private cards: Phaser.GameObjects.Container[] = [];
  private exchangeBtn: Button;
  private confirmBtn: Button;
  private timerText: Phaser.GameObjects.Text;
  private hintText: Phaser.GameObjects.Text;
  /** 현재 패의 족보 라벨 (카드 바로 위) */
  private rankText: Phaser.GameObjects.Text;
  private rankTier = -1;
  private pulse: Phaser.Tweens.Tween | null = null;

  constructor(scene: Phaser.Scene, y: number, private cb: CardHandCallbacks) {
    super(scene, 0, y);
    const totalW = 5 * CARD_W + 4 * GAP;
    const x0 = (GAME_WIDTH - totalW) / 2 + CARD_W / 2;
    for (let i = 0; i < 5; i++) {
      const c = scene.add.container(x0 + i * (CARD_W + GAP), 0);
      const bg = scene.add.rectangle(0, 0, CARD_W, CARD_H, 0xf4efe2).setStrokeStyle(4, 0xd8d0bd);
      const rank = scene.add.text(-CARD_W / 2 + 16, -CARD_H / 2 + 12, '', { fontSize: '52px', fontFamily: FONT, fontStyle: 'bold' });
      const suit = scene.add.text(0, 14, '', { fontSize: '96px', fontFamily: FONT }).setOrigin(0.5);
      c.add([bg, rank, suit]);
      c.setSize(CARD_W, CARD_H).setInteractive({ useHandCursor: true });
      c.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < TAP_SLOP) this.cb.onToggle(i); });
      this.cards.push(c);
      this.add(c);
    }
    this.rankText = scene.add.text(GAME_WIDTH / 2, -CARD_H / 2 - 48, '', { fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0.5);
    this.add(this.rankText);

    const by = CARD_H / 2 + 90;
    this.exchangeBtn = new Button(scene, GAME_WIDTH / 2 - 230, by, '교환 (1)', () => this.cb.onExchange(), { width: 380, height: 110, fill: 0x3b4a66, textColor: COLORS.text });
    this.confirmBtn = new Button(scene, GAME_WIDTH / 2 + 230, by, '진행', () => this.cb.onConfirm(), { width: 380, height: 110 });
    this.timerText = scene.add.text(GAME_WIDTH - 60, by, '⏱ 30', { fontSize: '40px', color: COLORS.text, fontFamily: FONT }).setOrigin(1, 0.5);
    this.hintText = scene.add.text(GAME_WIDTH / 2, by + 88, '교환할 카드를 탭하세요', { fontSize: '28px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(0.5);
    this.add([this.exchangeBtn, this.confirmBtn, this.timerText, this.hintText]);
    scene.add.existing(this);
  }

  /**
   * @param result 현재 패의 족보 (씬이 evaluateHand로 계산). coreCards에 든 카드는 살짝 금색 배경으로 강조.
   */
  setHand(hand: readonly Card[], selected: readonly number[], exchangesRemaining: number, result: HandResult): void {
    const core = new Set(result.coreCards);
    hand.forEach((card, i) => {
      const c = this.cards[i];
      const [bg, rank, suit] = c.list as [Phaser.GameObjects.Rectangle, Phaser.GameObjects.Text, Phaser.GameObjects.Text];
      const color = SUIT_CARD_COLOR[card.suit];
      rank.setText(rankLabel(card.rank)).setColor(color);
      suit.setText(SUIT_SYMBOL[card.suit]).setColor(color);
      const isSel = selected.includes(i);
      const isCore = core.has(card) && result.rank > 0;
      c.setY(isSel ? -36 : 0);
      bg.setFillStyle(isCore ? 0xfff1c2 : 0xf4efe2);
      bg.setStrokeStyle(isSel ? 6 : 4, isSel ? COLORS.goldLight : isCore ? 0xd4a941 : 0xd8d0bd);
    });
    this.setRank(result);
    this.exchangeBtn.setLabel(`교환 (${exchangesRemaining})`).setEnabled(exchangesRemaining > 0 && selected.length > 0);
    this.hintText.setText(exchangesRemaining > 0 ? '교환할 카드를 탭하세요 (1회)' : '교환 완료 — 진행하세요');
  }

  /** 족보 라벨 갱신: 등급이 오를수록 색·크기·맥동이 강해진다 */
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
    const st = TIER_STYLE[tier];
    if (st.pulseMs > 0) {
      this.pulse = this.scene.tweens.add({ targets: this.rankText, scale: 1 + tier * 0.03, duration: st.pulseMs / 2, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  /** 매 프레임 (tier 5 무지개 순환) */
  update(timeMs: number): void {
    if (this.rankTier >= 5 && this.visible) this.rankText.setColor(rainbowColor(timeMs));
  }

  /** 족보 라벨의 씬 좌표 (연출 위치용) */
  get rankLabelPosition(): { x: number; y: number } {
    return { x: this.x + this.rankText.x, y: this.y + this.rankText.y };
  }

  setTimer(sec: number): void {
    this.timerText.setText(`⏱ ${Math.ceil(sec)}`).setColor(sec <= 5 ? '#e0473f' : COLORS.text);
  }
}
