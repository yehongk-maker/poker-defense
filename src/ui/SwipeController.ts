import Phaser from 'phaser';
import { GAME_WIDTH } from '../config.ts';

/**
 * 좌우 스와이프로 패널을 열고 닫는다 (GDD 4: 메인 ← 스와이프 → 업그레이드 화면).
 * 패널은 x=GAME_WIDTH(닫힘) ~ 0(열림) 사이를 드래그에 따라 따라오고, 뗄 때 가까운 쪽으로 스냅.
 */
export class SwipeController {
  private startX = 0;
  private startY = 0;
  private panelStartX = 0;
  private dragging = false;
  private horizontal = false;
  private opened = false;

  constructor(private scene: Phaser.Scene, private panel: Phaser.GameObjects.Container, private onChange?: (open: boolean) => void) {
    panel.setX(GAME_WIDTH);
    scene.input.on('pointerdown', this.onDown, this);
    scene.input.on('pointermove', this.onMove, this);
    scene.input.on('pointerup', this.onUp, this);
    scene.input.on('pointerupoutside', this.onUp, this);
    scene.events.once('shutdown', () => {
      scene.input.off('pointerdown', this.onDown, this);
      scene.input.off('pointermove', this.onMove, this);
      scene.input.off('pointerup', this.onUp, this);
      scene.input.off('pointerupoutside', this.onUp, this);
    });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void { this.snap(true); }
  close(): void { this.snap(false); }
  toggle(): void { this.snap(!this.opened); }

  private onDown(p: Phaser.Input.Pointer): void {
    this.startX = p.x;
    this.startY = p.y;
    this.panelStartX = this.panel.x;
    this.dragging = true;
    this.horizontal = false;
    this.scene.tweens.killTweensOf(this.panel);
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (!this.dragging || !p.isDown) return;
    const dx = p.x - this.startX;
    const dy = p.y - this.startY;
    if (!this.horizontal) {
      if (Math.abs(dx) < 20 || Math.abs(dx) < Math.abs(dy)) return; // 아직 방향 미확정 / 세로 스크롤
      this.horizontal = true;
    }
    this.panel.setX(Phaser.Math.Clamp(this.panelStartX + dx, 0, GAME_WIDTH));
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (!this.horizontal) return;
    const dx = p.x - this.startX;
    // 빠른 플릭은 방향으로, 아니면 절반 기준으로 스냅
    const flick = Math.abs(dx) > 120;
    const open = flick ? dx < 0 : this.panel.x < GAME_WIDTH / 2;
    this.snap(open);
  }

  private snap(open: boolean): void {
    this.opened = open;
    this.scene.tweens.killTweensOf(this.panel);
    this.scene.tweens.add({ targets: this.panel, x: open ? 0 : GAME_WIDTH, duration: 220, ease: 'Cubic.easeOut' });
    this.onChange?.(open);
  }
}
