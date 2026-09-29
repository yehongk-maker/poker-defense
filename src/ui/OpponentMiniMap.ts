import Phaser from 'phaser';
import type { OpponentView } from '../systems/Opponent.ts';
import type { Suit } from '../systems/PokerEvaluator.ts';
import { ALPHA, COLOR, ENEMY_COLOR, FONT, OUTLINE, SIZE, SUIT_COLOR, TAP_SLOP, hex } from './theme.ts';
import { starPath } from './draw.ts';

const S = 156;          // 미니맵 한 변
const PAD = 8;
const GRID_N = 5;
const CELL = 22;        // 미니 슬롯 한 칸
const RING_INSET = 7;   // 트랙 링 안쪽 여백

/**
 * 상대 진행 미니맵 (GDD §10.1 "상대 보드는 상단에 축소 표시"): 필드 우상단에 고정.
 *  상대 필드 5×5(수트색 칩·영웅 ★) + 순환 트랙 위 적(지상 원·공중 다이아·보스 크게) + 라운드/하트/페이즈 한 줄.
 *  탭하면 상대 진행 상황 패널. 0.5초마다 refresh.
 */
export class OpponentMiniMap extends Phaser.GameObjects.Container {
  private g: Phaser.GameObjects.Graphics;
  private title: Phaser.GameObjects.Text;
  private heroStar: Phaser.GameObjects.Graphics;
  private lastKey = '';

  constructor(scene: Phaser.Scene, right: number, top: number, onTap: () => void) {
    super(scene, right - S, top);
    const bg = scene.add.graphics();
    bg.fillStyle(COLOR.hudBg, ALPHA.hudBg + 0.3).fillRoundedRect(0, 0, S, S + 30, 14);
    bg.lineStyle(2, COLOR.modalBorder, 0.9).strokeRoundedRect(0, 0, S, S + 30, 14);
    this.title = scene.add.text(S / 2, 16, '상대', { fontSize: `${SIZE.tiny}px`, color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE, strokeThickness: 3 }).setOrigin(0.5);
    this.g = scene.add.graphics();
    this.heroStar = scene.add.graphics();
    const zone = scene.add.zone(S / 2, (S + 30) / 2, S, S + 30).setInteractive({ useHandCursor: true });
    zone.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < TAP_SLOP) onTap(); });
    this.add([bg, this.title, this.g, this.heroStar, zone]);
    this.setDepth(5);
    scene.add.existing(this);
  }

  refresh(o: OpponentView, trackLength: number): void {
    const phase: Record<string, string> = { card: '카드', manage: '정비', combat: '전투', victory: '클리어', defeat: '탈락' };
    this.title.setText(`상대 R${o.wave} ♥${o.life} · ${phase[o.phase] ?? o.phase}`);
    if (this.title.width > S - 12) this.title.setScale((S - 12) / this.title.width); else this.title.setScale(1);

    const enemies = o.enemies;
    // 유닛·적이 바뀌었을 때만 다시 그림 (적은 위치가 계속 변하므로 전투 중엔 매번)
    const key = `${o.units.map((u) => `${u.slot}${u.suit}${u.tier}`).join(',')}|${o.hero ? o.hero.slot : '-'}|${enemies.length ? 'c' + Math.round(enemies.reduce((s, e) => s + e.pos, 0)) : ''}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const g = this.g.clear();
    const top = 30, box = S;
    // 트랙 링 (모래색 얇게)
    const rx = RING_INSET, ry = top + RING_INSET, rw = box - RING_INSET * 2, rh = box - RING_INSET * 2;
    g.lineStyle(6, COLOR.trackSand, 0.9).strokeRoundedRect(rx, ry, rw, rh, 8);
    // 필드 5×5
    const gx = (box - GRID_N * CELL) / 2, gy = top + (box - GRID_N * CELL) / 2;
    const bySlot = new Map<number, { suit: Suit; tier: number; hero: boolean }>();
    for (const u of o.units) bySlot.set(u.slot, { suit: u.suit, tier: u.tier, hero: false });
    if (o.hero) bySlot.set(o.hero.slot, { suit: o.hero.suit, tier: 0, hero: true });
    this.heroStar.clear();
    for (let i = 0; i < GRID_N * GRID_N; i++) {
      const cx = gx + (i % GRID_N) * CELL + CELL / 2, cy = gy + Math.floor(i / GRID_N) * CELL + CELL / 2;
      const u = bySlot.get(i);
      if (u) {
        g.fillStyle(SUIT_COLOR[u.suit]).fillRoundedRect(cx - 9, cy - 9, 18, 18, 4);
        if (u.hero) starPath(this.heroStar, cx, cy, 7, 3, COLOR.gold);
        else if (u.tier >= 3) g.fillStyle(0xffffff, 0.6).fillCircle(cx, cy, u.tier >= 5 ? 4 : 2.5); // 고티어 표시
      } else {
        g.fillStyle(0xffffff, 0.12).fillRect(cx - 8, cy - 8, 16, 16);
      }
    }
    // 적: 트랙 위 점 (지상 원 · 공중 다이아 · 보스 크게)
    for (const e of enemies) {
      const { x, y } = this.trackPoint(e.pos / trackLength, rx, ry, rw, rh);
      const c = ENEMY_COLOR[e.type] ?? COLOR.gray;
      const r = e.isBoss ? 8 : 5;
      g.fillStyle(COLOR.navyDark).fillCircle(x, y, r + 1.5);
      if (e.movement === 'air') {
        g.fillStyle(c).fillTriangle(x, y - r, x + r, y, x, y + r).fillTriangle(x, y - r, x - r, y, x, y + r);
      } else g.fillStyle(c).fillCircle(x, y, r);
    }
  }

  /** t∈[0,1) → 미니 링 둘레 좌표 (좌상단에서 시계 방향, TrackView와 같은 규칙) */
  private trackPoint(t: number, x0: number, y0: number, w: number, h: number): { x: number; y: number } {
    const P = 2 * (w + h);
    let d = ((t % 1) + 1) % 1 * P;
    if (d < w) return { x: x0 + d, y: y0 };
    d -= w;
    if (d < h) return { x: x0 + w, y: y0 + d };
    d -= h;
    if (d < w) return { x: x0 + w - d, y: y0 + h };
    d -= w;
    return { x: x0, y: y0 + h - d };
  }
}

export const OPP_MINI_SIZE = S;
