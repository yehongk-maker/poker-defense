import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { Button } from './Button.ts';
import { COLOR, FONT, OUTLINE, SIZE, TAP_SLOP, hex } from './theme.ts';
import { reducedMotion } from '../settings.ts';
import type { TutorialStep } from '../systems/Tutorial.ts';

export interface Rect { x: number; y: number; w: number; h: number }

const PAD = 14;
const CARD_W = GAME_WIDTH - 2 * SIZE.gutter - 40;
/** 위쪽 자리 (HUD 아래, 필드 윗부분) */
const TOP_CARD_Y = 330;

/**
 * 첫 판 가이드 오버레이: 어둡게 + 강조 구멍(골드 테두리) + 말풍선 카드.
 * 어두운 부분은 입력을 막지 않는다 — 가이드는 길잡이일 뿐, 플레이어가 먼저 해 버려도 된다.
 */
export class TutorialOverlay extends Phaser.GameObjects.Container {
  private dim: Phaser.GameObjects.Graphics;
  private ring: Phaser.GameObjects.Graphics;
  private card: Phaser.GameObjects.Container | null = null;
  private pulse: Phaser.Tweens.Tween | null = null;

  constructor(scene: Phaser.Scene, private cb: { onTap: () => void; onSkipStep: () => void; onSkipAll: () => void }) {
    super(scene, 0, 0);
    this.dim = scene.add.graphics();
    this.ring = scene.add.graphics();
    this.add([this.dim, this.ring]);
    this.setDepth(40).setVisible(false);
    scene.add.existing(this);
  }

  show(step: TutorialStep, hole: Rect | null, index: number, total: number): void {
    const s = this.scene;
    this.setVisible(true);
    // 어둡게 (구멍 둘레 네 조각)
    this.dim.clear().fillStyle(COLOR.dim, 0.6);
    if (hole) {
      const x = hole.x - PAD, y = hole.y - PAD, w = hole.w + 2 * PAD, h = hole.h + 2 * PAD;
      this.dim.fillRect(0, 0, GAME_WIDTH, Math.max(0, y));
      this.dim.fillRect(0, y + h, GAME_WIDTH, Math.max(0, GAME_HEIGHT - y - h));
      this.dim.fillRect(0, y, Math.max(0, x), h);
      this.dim.fillRect(x + w, y, Math.max(0, GAME_WIDTH - x - w), h);
      this.ring.clear().lineStyle(6, COLOR.gold).strokeRoundedRect(x, y, w, h, 18);
    } else {
      this.dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      this.ring.clear();
    }
    this.pulse?.remove();
    this.ring.setAlpha(1);
    if (hole && !reducedMotion()) this.pulse = s.tweens.add({ targets: this.ring, alpha: 0.35, duration: 650, yoyo: true, repeat: -1 });

    // 말풍선 카드: 강조 위치가 화면 아래쪽이면 위에, 아니면 아래에
    this.card?.destroy();
    const body = s.add.text(0, 0, step.text, { fontSize: `${SIZE.body + 2}px`, color: hex(COLOR.textMain), fontFamily: FONT.body, fontStyle: '700', lineSpacing: 8, wordWrap: { width: CARD_W - 80 } });
    const ch = 215 + body.height; // 제목 92 + 본문 + 여백 + 버튼 줄
    // 강조가 화면 아래쪽(손패·버튼)이면 카드는 위쪽 필드 자리에 — 손패를 가리지 않게. 위쪽(필드)이면 그 아래에
    const cy = !hole ? GAME_HEIGHT / 2 - ch / 2 : hole.y + hole.h / 2 > GAME_HEIGHT * 0.55 ? Math.min(TOP_CARD_Y, hole.y - PAD - 30 - ch) : Math.min(GAME_HEIGHT - ch - 40, hole.y + hole.h + PAD + 30);
    const cx = GAME_WIDTH / 2;
    const c = s.add.container(cx, cy);
    const g = s.add.graphics();
    g.fillStyle(COLOR.navyDark).fillRoundedRect(-CARD_W / 2, 8, CARD_W, ch, SIZE.radiusPanel);
    g.fillStyle(COLOR.navy).fillRoundedRect(-CARD_W / 2, 0, CARD_W, ch, SIZE.radiusPanel);
    g.lineStyle(4, COLOR.gold).strokeRoundedRect(-CARD_W / 2, 0, CARD_W, ch, SIZE.radiusPanel);
    // 카드 위 입력은 뒤로 새지 않게 (스와이프 오작동 방지)
    const block = s.add.zone(0, ch / 2, CARD_W, ch).setInteractive();
    const title = s.add.text(-CARD_W / 2 + 40, 50, step.title, { fontSize: '42px', color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0, 0.5);
    const count = s.add.text(CARD_W / 2 - 40, 50, `${index + 1} / ${total}`, { fontSize: `${SIZE.caption + 2}px`, color: hex(COLOR.textSub), fontFamily: FONT.body, fontStyle: '700' }).setOrigin(1, 0.5);
    body.setPosition(-CARD_W / 2 + 40, 92);
    const by = ch - 50;
    const items: Phaser.GameObjects.GameObject[] = [g, block, title, count, body];
    if (step.until === 'tap') items.push(new Button(s, CARD_W / 2 - 150, by, '확인', () => this.cb.onTap(), { width: 240, height: SIZE.btnS, fontSize: 36, variant: 'gold' }));
    else if (step.skipLabel) items.push(new Button(s, CARD_W / 2 - 180, by, step.skipLabel, () => this.cb.onSkipStep(), { width: 300, height: SIZE.btnS - 6, fontSize: 30, variant: 'gray' }));
    const skip = s.add.text(-CARD_W / 2 + 40, by, '가이드 건너뛰기', { fontSize: `${SIZE.caption + 4}px`, color: hex(COLOR.textSub), fontFamily: FONT.body, fontStyle: '700' }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    skip.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < TAP_SLOP) this.cb.onSkipAll(); });
    items.push(skip);
    c.add(items);
    c.setAlpha(0);
    s.tweens.add({ targets: c, alpha: 1, duration: 160 });
    this.add(c);
    this.card = c;
  }

  hide(): void {
    this.pulse?.remove();
    this.pulse = null;
    this.card?.destroy();
    this.card = null;
    this.dim.clear();
    this.ring.clear();
    this.setVisible(false);
  }
}
