import Phaser from 'phaser';
import type { GameLoop } from '../systems/GameLoop.ts';
import type { Suit } from '../systems/PokerEvaluator.ts';
import { GAME_WIDTH } from '../config.ts';
import { Button } from './Button.ts';
import { COLORS, FONT, SUIT_NAME, SUIT_SYMBOL } from './theme.ts';

export interface ManageCallbacks {
  onUpgrade: (suit: Suit) => void;
  onMerge: () => void;
  onHero: () => void;
  onSell: () => void;
  onStart: () => void;
}

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

/** 정비 페이즈 패널: 소환 결과 / 수트 업그레이드 4종 / 합성 / 영웅 / 판매 / 전투 시작 */
export class ManagePanel extends Phaser.GameObjects.Container {
  private summary: Phaser.GameObjects.Text;
  private upgradeBtns: Record<Suit, Button>;
  private mergeBtn: Button;
  private heroBtn: Button;
  private sellBtn: Button;
  private startBtn: Button;

  constructor(scene: Phaser.Scene, y: number, cb: ManageCallbacks) {
    super(scene, 0, y);
    this.summary = scene.add.text(GAME_WIDTH / 2, -150, '', { fontSize: '34px', color: COLORS.text, fontFamily: FONT, align: 'center' }).setOrigin(0.5);
    this.add(this.summary);

    const bw = 236;
    const x0 = (GAME_WIDTH - (4 * bw + 3 * 16)) / 2 + bw / 2;
    this.upgradeBtns = {} as Record<Suit, Button>;
    SUITS.forEach((s, i) => {
      const b = new Button(scene, x0 + i * (bw + 16), -40, '', () => cb.onUpgrade(s), { width: bw, height: 110, fontSize: 28, fill: 0x3b4a66, textColor: COLORS.text });
      this.upgradeBtns[s] = b;
      this.add(b);
    });

    const row2 = 90;
    this.mergeBtn = new Button(scene, GAME_WIDTH / 2 - 340, row2, '합성', () => cb.onMerge(), { width: 300, height: 100, fontSize: 32, fill: 0x3b4a66, textColor: COLORS.text });
    this.heroBtn = new Button(scene, GAME_WIDTH / 2, row2, '영웅 소환', () => cb.onHero(), { width: 300, height: 100, fontSize: 32, fill: 0x5a3b8a, textColor: COLORS.text });
    this.sellBtn = new Button(scene, GAME_WIDTH / 2 + 340, row2, '판매', () => cb.onSell(), { width: 300, height: 100, fontSize: 32, fill: 0x6b3b3b, textColor: COLORS.text });
    this.startBtn = new Button(scene, GAME_WIDTH / 2, row2 + 135, '전투 시작', () => cb.onStart(), { width: 640, height: 120, fontSize: 44 });
    this.add([this.mergeBtn, this.heroBtn, this.sellBtn, this.startBtn]);
    scene.add.existing(this);
  }

  setSummary(text: string): void {
    this.summary.setText(text);
  }

  refresh(loop: GameLoop, selectedUnit: number, sellRatio: number): void {
    for (const s of SUITS) {
      const cost = loop.upgradeCost(s);
      const lv = loop.upgrades[s];
      const b = this.upgradeBtns[s];
      if (cost === null) b.setLabel(`${SUIT_SYMBOL[s]}${SUIT_NAME[s]} MAX`).setEnabled(false);
      else b.setLabel(`${SUIT_SYMBOL[s]}${SUIT_NAME[s]} Lv${lv}\n💰${cost}`).setEnabled(loop.gold >= cost);
    }
    const m = loop.mergeable.length;
    this.mergeBtn.setLabel(m > 0 ? `합성 (${m})` : '합성').setEnabled(m > 0);
    this.heroBtn.setEnabled(loop.canSummonHero);
    const u = loop.units[selectedUnit];
    if (u) this.sellBtn.setLabel(`판매 +💰${Math.floor(u.def.value * sellRatio)}`).setEnabled(true);
    else this.sellBtn.setLabel('판매 (유닛 탭)').setEnabled(false);
  }
}
