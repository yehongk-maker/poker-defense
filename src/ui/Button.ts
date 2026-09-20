import Phaser from 'phaser';
import { COLORS, FONT } from './theme.ts';

export interface ButtonOptions {
  width?: number;
  height?: number;
  fontSize?: number;
  fill?: number;
  textColor?: string;
}

/** 사각 버튼. setEnabled(false)면 회색 + 입력 무시 */
export class Button extends Phaser.GameObjects.Container {
  private rect: Phaser.GameObjects.Rectangle;
  private label: Phaser.GameObjects.Text;
  private enabled = true;
  private fill: number;
  private textColor: string;

  constructor(scene: Phaser.Scene, x: number, y: number, text: string, onClick: () => void, opt: ButtonOptions = {}) {
    super(scene, x, y);
    const w = opt.width ?? 300;
    const h = opt.height ?? 100;
    this.fill = opt.fill ?? COLORS.gold;
    this.textColor = opt.textColor ?? '#1a1608';
    this.rect = scene.add.rectangle(0, 0, w, h, this.fill).setStrokeStyle(3, COLORS.goldLight);
    this.label = scene.add
      .text(0, 0, text, { fontSize: `${opt.fontSize ?? 38}px`, color: this.textColor, fontFamily: FONT, fontStyle: 'bold', align: 'center' })
      .setOrigin(0.5);
    this.add([this.rect, this.label]);
    this.setSize(w, h);
    this.setInteractive({ useHandCursor: true });
    this.on('pointerdown', () => { if (this.enabled) onClick(); });
    this.on('pointerover', () => { if (this.enabled) this.rect.setFillStyle(COLORS.goldLight); });
    this.on('pointerout', () => { if (this.enabled) this.rect.setFillStyle(this.fill); });
    scene.add.existing(this);
  }

  setLabel(text: string): this {
    this.label.setText(text);
    return this;
  }

  setEnabled(on: boolean): this {
    this.enabled = on;
    this.rect.setFillStyle(on ? this.fill : COLORS.disabled).setStrokeStyle(3, on ? COLORS.goldLight : COLORS.panelLine);
    this.label.setColor(on ? this.textColor : COLORS.textMuted);
    return this;
  }
}
