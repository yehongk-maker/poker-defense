import Phaser from 'phaser';
import { COLOR, FONT, OUTLINE, hex } from './theme.ts';

/**
 * 경고 배너 (DESIGN §4 WaveBanner): 중앙 알약(navy + 밝은 보더). 공중 웨이브 예고는 날개 아이콘 + 골드 텍스트.
 * 위에서 떨어지며 등장 → 잠시 머문 뒤 사라짐.
 */
export class WaveBanner extends Phaser.GameObjects.Container {
  private g: Phaser.GameObjects.Graphics;
  private text: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, x: number, private baseY: number) {
    super(scene, x, baseY);
    this.g = scene.add.graphics();
    this.text = scene.add.text(0, 0, '', { fontSize: '36px', fontFamily: FONT.display, color: hex(COLOR.textGold), ...OUTLINE }).setOrigin(0.5);
    this.add([this.g, this.text]);
    this.setAlpha(0).setDepth(14);
    scene.add.existing(this);
  }

  show(msg: string, opts: { wings?: boolean; danger?: boolean; holdMs?: number } = {}): void {
    this.text.setText(msg).setColor(opts.danger ? hex(COLOR.textMain) : hex(COLOR.textGold));
    const wingW = opts.wings ? 64 : 0;
    const w = this.text.width + 72 + wingW * 2, h = 76;
    const g = this.g.clear();
    g.fillStyle(opts.danger ? COLOR.redDark : COLOR.navyDark).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    g.fillStyle(opts.danger ? COLOR.red : COLOR.navy).fillRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, h / 2, { tl: h / 2 - 4, tr: h / 2 - 4, bl: 0, br: 0 });
    g.lineStyle(3, opts.danger ? COLOR.textGold : COLOR.modalBorder).strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    if (opts.wings) {
      // 날개: 양쪽에 겹친 삼각 깃털 3장
      const wing = (sx: number) => {
        const x0 = sx * (this.text.width / 2 + 20);
        for (let i = 0; i < 3; i++) {
          g.fillStyle(COLOR.textGold, 1 - i * 0.25);
          g.fillTriangle(x0, -6 + i * 8, x0 + sx * (46 - i * 10), -20 + i * 10, x0 + sx * (40 - i * 10), 2 + i * 8);
        }
      };
      wing(-1); wing(1);
    }
    this.scene.tweens.killTweensOf(this);
    this.setAlpha(0).setY(this.baseY - 60);
    this.scene.tweens.add({ targets: this, alpha: 1, y: this.baseY, duration: 260, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: this, alpha: 0, delay: opts.holdMs ?? 1800, duration: 300 });
  }
}
