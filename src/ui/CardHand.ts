import Phaser from 'phaser';
import type { Card } from '../systems/PokerEvaluator.ts';
import { GAME_WIDTH } from '../config.ts';
import { Button } from './Button.ts';
import { COLORS, FONT, SUIT_CARD_COLOR, SUIT_SYMBOL, rankLabel } from './theme.ts';

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
      c.on('pointerdown', () => this.cb.onToggle(i));
      this.cards.push(c);
      this.add(c);
    }
    this.hintText = scene.add.text(GAME_WIDTH / 2, -CARD_H / 2 - 40, '교환할 카드를 탭하세요', { fontSize: '30px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(0.5);
    this.add(this.hintText);

    const by = CARD_H / 2 + 90;
    this.exchangeBtn = new Button(scene, GAME_WIDTH / 2 - 230, by, '교환 (1)', () => this.cb.onExchange(), { width: 380, height: 110, fill: 0x3b4a66, textColor: COLORS.text });
    this.confirmBtn = new Button(scene, GAME_WIDTH / 2 + 230, by, '진행', () => this.cb.onConfirm(), { width: 380, height: 110 });
    this.timerText = scene.add.text(GAME_WIDTH - 60, by, '⏱ 30', { fontSize: '40px', color: COLORS.text, fontFamily: FONT }).setOrigin(1, 0.5);
    this.add([this.exchangeBtn, this.confirmBtn, this.timerText]);
    scene.add.existing(this);
  }

  setHand(hand: readonly Card[], selected: readonly number[], exchangesRemaining: number): void {
    hand.forEach((card, i) => {
      const c = this.cards[i];
      const [bg, rank, suit] = c.list as [Phaser.GameObjects.Rectangle, Phaser.GameObjects.Text, Phaser.GameObjects.Text];
      const color = SUIT_CARD_COLOR[card.suit];
      rank.setText(rankLabel(card.rank)).setColor(color);
      suit.setText(SUIT_SYMBOL[card.suit]).setColor(color);
      const isSel = selected.includes(i);
      c.setY(isSel ? -36 : 0);
      bg.setStrokeStyle(isSel ? 6 : 4, isSel ? COLORS.goldLight : 0xd8d0bd);
    });
    this.exchangeBtn.setLabel(`교환 (${exchangesRemaining})`).setEnabled(exchangesRemaining > 0 && selected.length > 0);
    this.hintText.setText(exchangesRemaining > 0 ? '교환할 카드를 탭하세요 (1회)' : '교환 완료 — 진행하세요');
  }

  setTimer(sec: number): void {
    this.timerText.setText(`⏱ ${Math.ceil(sec)}`).setColor(sec <= 5 ? '#e0473f' : COLORS.text);
  }
}
