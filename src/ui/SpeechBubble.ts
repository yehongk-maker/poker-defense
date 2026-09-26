import Phaser from 'phaser';
import { COLOR, FONT, hex } from './theme.ts';

/**
 * 말풍선 (DESIGN §4): 흰 배경 + 꼬리. 상대 베팅 액션 표시용. 강조어는 red.
 * show() 할 때마다 팝 → 1.8초 뒤 페이드.
 */
export class SpeechBubble extends Phaser.GameObjects.Container {
  private g: Phaser.GameObjects.Graphics;
  private text: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);
    this.g = scene.add.graphics();
    this.text = scene.add.text(0, 0, '', { fontSize: '28px', fontFamily: FONT.display, color: hex(COLOR.navyDark) }).setOrigin(0, 0.5);
    this.add([this.g, this.text]);
    this.setAlpha(0);
    scene.add.existing(this);
  }

  /** @param emphasis true면 강조색(red) 글자 */
  show(msg: string, emphasis = false): void {
    this.text.setText(msg).setColor(emphasis ? hex(COLOR.red) : hex(COLOR.navyDark));
    const w = this.text.width + 36, h = this.text.height + 20;
    this.text.setPosition(18, 0);
    const g = this.g.clear();
    g.fillStyle(0x000000, 0.18).fillRoundedRect(0, -h / 2 + 5, w, h, h / 2);
    g.fillStyle(0xffffff).fillRoundedRect(0, -h / 2, w, h, h / 2);
    g.fillTriangle(22, -h / 2 + 2, 44, -h / 2 + 2, 20, -h / 2 - 16); // 꼬리 (위쪽: 상대 바를 가리킴)
    this.scene.tweens.killTweensOf(this);
    this.setAlpha(1).setScale(0.6);
    this.scene.tweens.add({ targets: this, scale: 1, duration: 220, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: this, alpha: 0, delay: 1800, duration: 300 });
  }
}
