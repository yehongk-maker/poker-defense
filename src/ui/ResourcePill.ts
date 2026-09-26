import Phaser from 'phaser';
import { ALPHA, COLOR, FONT, OUTLINE, hex } from './theme.ts';
import { coinIcon, gemIcon, heartIcon, ticketIcon, tokenIcon } from './draw.ts';

export type PillIcon = 'coin' | 'gem' | 'heart' | 'token' | 'ticket' | 'trophy';

/**
 * 재화 알약 (DESIGN §4 ResourcePill): hudBg 55% 알약 + 도형 아이콘 + Jua 수치.
 * 값이 오르면 하늘색, 내리면 빨강으로 잠깐 반짝이며 팝.
 */
export class ResourcePill extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private text: Phaser.GameObjects.Text;
  private lastNum: number | null = null;
  private danger = false;

  constructor(scene: Phaser.Scene, x: number, y: number, private icon: PillIcon, private pw = 240, private ph = 56) {
    super(scene, x, y);
    this.bg = scene.add.graphics();
    const ic = scene.add.graphics();
    const ix = -pw / 2 + ph / 2 + 2;
    const s = ph * 0.72;
    if (icon === 'coin') coinIcon(ic, ix, 0, s);
    else if (icon === 'gem') gemIcon(ic, ix, 0, s);
    else if (icon === 'heart') heartIcon(ic, ix, 2, s);
    else if (icon === 'token') tokenIcon(ic, ix, 0, s);
    else if (icon === 'ticket') ticketIcon(ic, ix, 0, s * 0.8);
    else { ic.fillStyle(COLOR.gold).fillRoundedRect(ix - s * 0.3, -s * 0.4, s * 0.6, s * 0.45, 6).fillRect(ix - s * 0.07, 0, s * 0.14, s * 0.22).fillRoundedRect(ix - s * 0.25, s * 0.2, s * 0.5, s * 0.14, 4); }
    this.text = scene.add.text(ix + ph / 2 + 4, 0, '-', { fontSize: `${Math.round(ph * 0.56)}px`, color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0, 0.5);
    this.add([this.bg, ic, this.text]);
    this.drawBg();
    scene.add.existing(this);
  }

  /** @param num 증감 연출용 수치 (없으면 연출 없음) */
  setValue(label: string, num?: number): this {
    this.text.setText(label);
    const maxW = this.pw - this.ph - 20;
    this.text.setScale(this.text.width > maxW ? maxW / this.text.width : 1);
    if (num !== undefined) {
      if (this.lastNum !== null && num !== this.lastNum) {
        this.scene.tweens.killTweensOf(this.text);
        const s = this.text.scale;
        this.text.setScale(s * 1.25).setColor(num > this.lastNum ? hex(COLOR.textGold) : hex(COLOR.red));
        this.scene.tweens.add({ targets: this.text, scale: s, duration: 260, ease: 'Back.easeOut' });
        this.scene.time.delayedCall(500, () => this.text.setColor(hex(COLOR.textMain)));
      }
      this.lastNum = num;
    }
    return this;
  }

  /** 위험 강조 (하트 3 이하 등): 붉은 보더 */
  setDanger(on: boolean): this {
    if (on !== this.danger) { this.danger = on; this.drawBg(); }
    return this;
  }

  private drawBg(): void {
    const g = this.bg.clear();
    g.fillStyle(COLOR.hudBg, ALPHA.hudBg).fillRoundedRect(-this.pw / 2, -this.ph / 2, this.pw, this.ph, this.ph / 2);
    if (this.danger) g.lineStyle(3, COLOR.red, 1).strokeRoundedRect(-this.pw / 2, -this.ph / 2, this.pw, this.ph, this.ph / 2);
  }
}
