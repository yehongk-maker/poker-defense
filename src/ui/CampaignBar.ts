import Phaser from 'phaser';
import { GAME_WIDTH } from '../config.ts';
import { Button } from './Button.ts';
import { ALPHA, COLOR, FONT, OUTLINE, SIZE, hex } from './theme.ts';
import { BET_LAYOUT } from './BetBar.ts';

/**
 * 캠페인 전용 바 (대전의 판돈 행 자리, docs/mode-design.md §1.1):
 *  왼쪽 = 다음 웨이브 예고(공중/보스) + 내 최고 기록, 오른쪽 = [교환 +1 ▶AD] (보상형 광고, 라운드당 1회, 카드 선택 중에만)
 */
export class CampaignBar extends Phaser.GameObjects.Container {
  private title: Phaser.GameObjects.Text;
  private detail: Phaser.GameObjects.Text;
  private adBtn: Button;

  constructor(scene: Phaser.Scene, onAdExchange: () => void, adsEnabled: boolean) {
    super(scene, 0, 0);
    const y = BET_LAYOUT.rowY - 30, h = 150;
    const g = scene.add.graphics();
    g.fillStyle(COLOR.hudBg, ALPHA.hudBg).fillRoundedRect(SIZE.gutter, y - h / 2, GAME_WIDTH - 2 * SIZE.gutter, h, SIZE.radiusButton);
    this.title = scene.add.text(SIZE.gutter + 28, y - 34, '', { fontSize: '32px', color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0, 0.5);
    this.detail = scene.add.text(SIZE.gutter + 28, y + 22, '', { fontSize: `${SIZE.caption}px`, color: hex(COLOR.textMain), fontFamily: FONT.body, fontStyle: '700', wordWrap: { width: 600 } }).setOrigin(0, 0.5).setAlpha(ALPHA.sub);
    this.adBtn = new Button(scene, GAME_WIDTH - SIZE.gutter - 176, y, '교환 +1\n▶ AD 시청', onAdExchange, { width: 300, height: SIZE.btnM + 8, fontSize: 36, variant: 'green' });
    this.adBtn.setVisible(adsEnabled);
    this.add([g, this.title, this.detail, this.adBtn]);
    scene.add.existing(this);
  }

  refresh(o: { wave: number; total: number; preview: string; best: number; canAd: boolean; adUsed: boolean }): void {
    this.title.setText(`라운드 ${o.wave} / ${o.total}${o.best > 0 ? `   ·   내 최고 R${o.best}` : ''}`);
    this.detail.setText(o.preview);
    this.adBtn.setLabel(o.adUsed ? '교환 +1\n이번 라운드 사용함' : '교환 +1\n▶ AD 시청').setEnabled(o.canAd && !o.adUsed);
  }
}
