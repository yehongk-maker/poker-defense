import Phaser from 'phaser';
import { COLOR, FONT, OUTLINE, SIZE, hex } from './theme.ts';

/**
 * 타이머 링 (DESIGN §4): 지름 120, 잔량만큼 골드 호, 중앙 navy 원 + Jua 숫자.
 * 5초 이하 = 링 red + 펄스(scale 1↔1.06).
 */
export class TimerRing extends Phaser.GameObjects.Container {
  private g: Phaser.GameObjects.Graphics;
  private num: Phaser.GameObjects.Text;
  private pulse: Phaser.Tweens.Tween | null = null;
  private lastShown = -1;

  constructor(scene: Phaser.Scene, x: number, y: number, private d: number = SIZE.timerD) {
    super(scene, x, y);
    this.g = scene.add.graphics();
    this.num = scene.add.text(0, 2, '', { fontSize: `${Math.round(d * 0.4)}px`, color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5);
    this.add([this.g, this.num]);
    scene.add.existing(this);
  }

  set(remaining: number, total: number): void {
    const r = this.d / 2;
    const frac = Phaser.Math.Clamp(total > 0 ? remaining / total : 0, 0, 1);
    const low = remaining <= 5;
    const g = this.g.clear();
    g.fillStyle(COLOR.navyDark).fillCircle(0, 0, r);
    g.lineStyle(r * 0.22, COLOR.hudBg, 0.9).strokeCircle(0, 0, r * 0.84);
    if (frac > 0) {
      g.lineStyle(r * 0.22, low ? COLOR.red : COLOR.gold, 1);
      g.beginPath();
      g.arc(0, 0, r * 0.84, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false);
      g.strokePath();
    }
    g.fillStyle(COLOR.navy).fillCircle(0, 0, r * 0.66);
    const shown = Math.ceil(remaining);
    if (shown !== this.lastShown) { this.num.setText(`${shown}`); this.lastShown = shown; }
    this.num.setColor(low ? hex(COLOR.red) : hex(COLOR.textMain));
    if (low && !this.pulse) this.pulse = this.scene.tweens.add({ targets: this, scale: 1.06, duration: 250, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    else if (!low && this.pulse) { this.pulse.remove(); this.pulse = null; this.setScale(1); }
  }
}
