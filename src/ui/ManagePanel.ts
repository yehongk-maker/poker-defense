import Phaser from 'phaser';
import type { GameLoop } from '../systems/GameLoop.ts';
import { GAME_WIDTH } from '../config.ts';
import { Button } from './Button.ts';
import { COLORS, FONT } from './theme.ts';

export interface ManageCallbacks {
  onMerge: () => void;
  onSell: () => void;
  onOpenUpgrades: () => void;
  onStart: () => void;
}

/** 정비 페이즈 패널: 소환 결과 / 합성 / 판매 / 업그레이드·영웅 화면 열기 / 전투 시작 */
export class ManagePanel extends Phaser.GameObjects.Container {
  private summary: Phaser.GameObjects.Text;
  private mergeBtn: Button;
  private sellBtn: Button;
  private upgradesBtn: Button;
  private startBtn: Button;

  constructor(scene: Phaser.Scene, y: number, cb: ManageCallbacks) {
    super(scene, 0, y);
    this.summary = scene.add.text(GAME_WIDTH / 2, -120, '', { fontSize: '34px', color: COLORS.text, fontFamily: FONT, align: 'center' }).setOrigin(0.5);
    this.add(this.summary);

    const row = 20;
    this.mergeBtn = new Button(scene, GAME_WIDTH / 2 - 340, row, '합성', () => cb.onMerge(), { width: 300, height: 100, fontSize: 32, fill: 0x3b4a66, textColor: COLORS.text });
    this.sellBtn = new Button(scene, GAME_WIDTH / 2, row, '판매', () => cb.onSell(), { width: 300, height: 100, fontSize: 32, fill: 0x6b3b3b, textColor: COLORS.text });
    this.upgradesBtn = new Button(scene, GAME_WIDTH / 2 + 340, row, '업그레이드\n영웅 ▶', () => cb.onOpenUpgrades(), { width: 300, height: 100, fontSize: 28, fill: 0x5a3b8a, textColor: COLORS.text });
    this.startBtn = new Button(scene, GAME_WIDTH / 2, row + 140, '전투 시작', () => cb.onStart(), { width: 640, height: 120, fontSize: 44 });
    this.add([this.mergeBtn, this.sellBtn, this.upgradesBtn, this.startBtn]);
    scene.add.existing(this);
  }

  setSummary(text: string): void {
    this.summary.setText(text);
  }

  refresh(loop: GameLoop, selectedUnit: number, sellRatio: number): void {
    const m = loop.mergeable.length;
    this.mergeBtn.setLabel(m > 0 ? `합성 (${m})` : '합성').setEnabled(m > 0);
    const u = loop.units[selectedUnit];
    if (u) this.sellBtn.setLabel(`판매 +💰${Math.floor(u.def.value * sellRatio)}`).setEnabled(true);
    else this.sellBtn.setLabel('판매 (유닛 탭)').setEnabled(false);
    const hero = loop.canSummonHero ? '영웅 소환 가능!' : '업그레이드';
    this.upgradesBtn.setLabel(`${hero}\n영웅 ▶`);
  }
}
