import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.ts';

export type PanelSide = 'left' | 'right' | 'bottom';

/**
 * 3방향 스와이프 내비게이션 (GDD 4, v1.5):
 *  - 오른쪽으로 스와이프 → 왼쪽 패널(상점·영웅)이 왼쪽에서 들어옴
 *  - 왼쪽으로 스와이프  → 오른쪽 패널(족보·시너지 정보)이 오른쪽에서 들어옴
 *  - 위로 스와이프     → 아래 패널(상대 진행 상황)이 아래에서 올라옴
 *  열린 패널은 반대 방향 스와이프(또는 close)로 닫는다. 드래그를 따라오고 뗄 때 스냅.
 */
export class SwipeNav {
  private startX = 0;
  private startY = 0;
  private dragging = false;
  private axis: 'h' | 'v' | null = null;
  private target: PanelSide | null = null;
  private targetStart = 0;
  private opened: PanelSide | null = null;

  constructor(private scene: Phaser.Scene, private panels: Record<PanelSide, Phaser.GameObjects.Container>, private onChange?: (side: PanelSide | null) => void) {
    panels.left.setX(-GAME_WIDTH);
    panels.right.setX(GAME_WIDTH);
    panels.bottom.setY(GAME_HEIGHT);
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

  get openSide(): PanelSide | null { return this.opened; }

  open(side: PanelSide): void {
    if (this.opened && this.opened !== side) this.snap(this.opened, false);
    this.snap(side, true);
  }

  close(): void {
    if (this.opened) this.snap(this.opened, false);
  }

  private closedPos(side: PanelSide): number { return side === 'left' ? -GAME_WIDTH : side === 'right' ? GAME_WIDTH : GAME_HEIGHT; }
  private getPos(side: PanelSide): number { return side === 'bottom' ? this.panels[side].y : this.panels[side].x; }
  private setPos(side: PanelSide, v: number): void {
    const p = this.panels[side];
    const closed = this.closedPos(side);
    const clamped = closed < 0 ? Phaser.Math.Clamp(v, closed, 0) : Phaser.Math.Clamp(v, 0, closed);
    if (side === 'bottom') p.setY(clamped); else p.setX(clamped);
  }

  private onDown(p: Phaser.Input.Pointer): void {
    this.startX = p.x; this.startY = p.y;
    this.dragging = true; this.axis = null; this.target = null;
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (!this.dragging || !p.isDown) return;
    const dx = p.x - this.startX, dy = p.y - this.startY;
    if (!this.axis) {
      if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
      this.axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      // 어떤 패널을 움직일지 결정
      if (this.opened) {
        const closing = (this.opened === 'left' && this.axis === 'h' && dx < 0) || (this.opened === 'right' && this.axis === 'h' && dx > 0) || (this.opened === 'bottom' && this.axis === 'v' && dy > 0);
        this.target = closing ? this.opened : null;
      } else {
        this.target = this.axis === 'h' ? (dx > 0 ? 'left' : 'right') : dy < 0 ? 'bottom' : null;
      }
      if (this.target) { this.targetStart = this.getPos(this.target); this.scene.tweens.killTweensOf(this.panels[this.target]); }
    }
    if (!this.target) return;
    this.setPos(this.target, this.targetStart + (this.target === 'bottom' ? dy : dx));
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (!this.target) return;
    const side = this.target;
    const d = side === 'bottom' ? p.y - this.startY : p.x - this.startX;
    const size = side === 'bottom' ? GAME_HEIGHT : GAME_WIDTH;
    const flick = Math.abs(d) > 120;
    let open: boolean;
    if (flick) {
      // 플릭 방향: 패널이 화면 쪽으로 오면 열기
      open = side === 'left' ? d > 0 : side === 'right' ? d < 0 : d < 0;
    } else {
      open = Math.abs(this.getPos(side)) < size / 2;
    }
    this.snap(side, open);
  }

  private snap(side: PanelSide, open: boolean): void {
    const p = this.panels[side];
    this.scene.tweens.killTweensOf(p);
    const to = open ? 0 : this.closedPos(side);
    this.scene.tweens.add({ targets: p, [side === 'bottom' ? 'y' : 'x']: to, duration: 220, ease: 'Cubic.easeOut' });
    this.opened = open ? side : this.opened === side ? null : this.opened;
    this.onChange?.(this.opened);
  }
}
