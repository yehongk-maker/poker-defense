import Phaser from 'phaser';
import type { DeployedUnit, Enemy, HitEvent } from '../systems/Battle.ts';
import type { GameLoop } from '../systems/GameLoop.ts';
import { auraSlots } from '../systems/SynergySystem.ts';
import { COLORS, ENEMY_COLOR, FONT, SUIT_COLOR, SUIT_SYMBOL, TAP_SLOP } from './theme.ts';

/**
 * 순환 트랙 + 유닛 슬롯(5×5) + 적 + 타격 연출.
 * 트랙 좌표(pos 0~trackLength)를 사각 링 둘레로 매핑한다.
 * 유닛은 슬롯 위치에 그리고, 선택된 유닛은 사거리 원을 표시한다 (배치 유도).
 */
const OUTER = { x: 50, y: 200, w: 980, h: 980 };
const TRACK_W = 80;
const RING = { x: OUTER.x + TRACK_W / 2, y: OUTER.y + TRACK_W / 2, w: OUTER.w - TRACK_W, h: OUTER.h - TRACK_W }; // 중심선
const GRID_N = 5;
const CELL = 150; // = RING.w / (GRID_N + 1) — Geometry.cellSize와 동일 비율
const GRID_X = OUTER.x + (OUTER.w - GRID_N * CELL) / 2;
const GRID_Y = OUTER.y + (OUTER.h - GRID_N * CELL) / 2;

interface HitFx { x1: number; y1: number; x2: number; y2: number; color: number; ttl: number }

export class TrackView {
  private cells: Phaser.GameObjects.Rectangle[] = [];
  private unitSprites: Phaser.GameObjects.Container[] = [];
  private enemySprites = new Map<number, Phaser.GameObjects.Container>();
  private fx: HitFx[] = [];
  private fxGfx: Phaser.GameObjects.Graphics;
  private rangeGfx: Phaser.GameObjects.Graphics;
  private bingoGfx: Phaser.GameObjects.Graphics;
  private onCellTap: ((slot: number) => void) | null = null;
  private tempSprites: Phaser.GameObjects.Container[] = [];

  constructor(private scene: Phaser.Scene) {
    const g = scene.add.graphics();
    g.fillStyle(COLORS.track).fillRect(OUTER.x, OUTER.y, OUTER.w, OUTER.h);
    g.fillStyle(COLORS.bg).fillRect(OUTER.x + TRACK_W, OUTER.y + TRACK_W, OUTER.w - 2 * TRACK_W, OUTER.h - 2 * TRACK_W);
    g.lineStyle(3, COLORS.trackLine).strokeRect(OUTER.x, OUTER.y, OUTER.w, OUTER.h);
    g.strokeRect(OUTER.x + TRACK_W, OUTER.y + TRACK_W, OUTER.w - 2 * TRACK_W, OUTER.h - 2 * TRACK_W);
    scene.add.text(OUTER.x + 12, OUTER.y + 6, '▶ 스폰', { fontSize: '22px', color: COLORS.textMuted, fontFamily: FONT });

    this.rangeGfx = scene.add.graphics();
    this.bingoGfx = scene.add.graphics().setDepth(3);
    for (let i = 0; i < GRID_N * GRID_N; i++) {
      const { x, y } = this.cellCenter(i);
      const r = scene.add.rectangle(x, y, CELL - 8, CELL - 8, COLORS.cell).setStrokeStyle(2, COLORS.cellLine);
      r.setInteractive({ useHandCursor: true }).on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < TAP_SLOP) this.onCellTap?.(i); });
      this.cells.push(r);
    }
    this.fxGfx = scene.add.graphics();
  }

  setCellTapHandler(fn: ((slot: number) => void) | null): void {
    this.onCellTap = fn;
  }

  /**
   * 필드 다시 그리기 (정비/소환/이동 후 호출). 영웅 포함.
   * @param selectedSlot 선택된 슬롯: 테두리 강조 + 사거리 원 + 이동 가능한 빈 칸 표시
   */
  setField(loop: GameLoop, selectedSlot = -1): void {
    for (const s of this.unitSprites) s.destroy();
    this.unitSprites = [];
    this.rangeGfx.clear();

    const selected = selectedSlot >= 0 ? loop.unitAtSlot(selectedSlot) : null;
    // 이동 힌트는 아직 배치를 확정하지 않은(1회 이동 가능) 유닛을 골랐을 때만
    const cov = selected && !selected.placed ? loop.slotCoverage(selected.def.range) : null;
    this.cells.forEach((c, i) => {
      const isSel = i === selectedSlot;
      c.setStrokeStyle(isSel ? 5 : 2, isSel ? COLORS.goldLight : COLORS.cellLine);
      // 미확정 유닛 선택 중: 빈 칸을 이 유닛의 사거리 커버리지(트랙에 닿는 비율)로 색칠 → 어디에 두면 좋은지 힌트
      if (cov && !loop.unitAtSlot(i)) {
        const v = cov[i];
        c.setFillStyle(v <= 0 ? 0x2a1a1a : Phaser.Display.Color.GetColor(16 + v * 40, 21 + v * 120, 31 + v * 60));
      } else {
        c.setFillStyle(COLORS.cell);
      }
    });

    const draw = (u: DeployedUnit, isHero: boolean) => {
      const { x, y } = this.cellCenter(u.slot);
      const c = this.scene.add.container(x, y);
      const size = 44 + Math.min(u.def.tier, 5) * 12;
      const color = SUIT_COLOR[u.def.suit];
      const shape = this.unitShape(u.def.attackType, size, color);
      const badge = this.scene.add.text(0, 2, isHero ? '★' : `${u.def.tier}`, { fontSize: '34px', color: '#0b0e14', fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0.5);
      const name = this.scene.add.text(0, CELL / 2 - 22, `${SUIT_SYMBOL[u.def.suit]}${u.def.name}`, { fontSize: '20px', color: isHero ? '#f1d17a' : COLORS.textDim, fontFamily: FONT }).setOrigin(0.5);
      const range = this.scene.add.text(CELL / 2 - 10, -CELL / 2 + 8, `⌖${u.def.range}`, { fontSize: '20px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(1, 0);
      c.add([shape, badge, name, range]);
      if (!u.placed) {
        // 미확정(소환 직후, 1회 이동 가능): 반투명 + 금색 테두리 + "배치" 표시. 배치하지 않아도 전투 시작 시 이 자리로 확정된다
        c.setAlpha(0.55);
        const ring = this.scene.add.rectangle(0, 0, CELL - 16, CELL - 16).setStrokeStyle(3, COLORS.goldLight, 0.9);
        const tag = this.scene.add.text(-CELL / 2 + 10, -CELL / 2 + 8, '배치', { fontSize: '18px', color: '#f1d17a', fontFamily: FONT, fontStyle: 'bold' });
        c.addAt(ring, 0);
        c.add(tag);
      }
      this.unitSprites.push(c);
    };
    for (const u of loop.units) draw(u, false);
    if (loop.hero) draw(loop.hero.unit, true);

    // 빙고 줄: 완성된 줄을 수트 색 굵은 선으로 관통 표시
    this.bingoGfx.clear();
    for (const line of loop.bingoLines) {
      const a = this.cellCenter(line.cells[0]);
      const b = this.cellCenter(line.cells[line.cells.length - 1]);
      const color = SUIT_COLOR[line.key as keyof typeof SUIT_COLOR] ?? 0xf1d17a;
      this.bingoGfx.lineStyle(14, color, 0.28).lineBetween(a.x, a.y, b.x, b.y);
      this.bingoGfx.lineStyle(4, 0xf1d17a, 0.9).lineBetween(a.x, a.y, b.x, b.y);
    }

    // 미확정 유닛은 사거리 원을 항상 표시 (어디에 두면 트랙에 닿는지 바로 보이게)
    for (const u of loop.unplacedUnits) {
      if (u === selected) continue;
      const { x, y } = this.cellCenter(u.slot);
      const r = (u.def.range + (u.rangeBonus ?? 0)) * CELL;
      this.rangeGfx.fillStyle(SUIT_COLOR[u.def.suit], 0.05).fillCircle(x, y, r);
      this.rangeGfx.lineStyle(2, SUIT_COLOR[u.def.suit], 0.45).strokeCircle(x, y, r);
    }

    if (selected) {
      const { x, y } = this.cellCenter(selected.slot);
      const r = (selected.def.range + (selected.rangeBonus ?? 0)) * CELL;
      this.rangeGfx.fillStyle(SUIT_COLOR[selected.def.suit], 0.10).fillCircle(x, y, r);
      this.rangeGfx.lineStyle(3, SUIT_COLOR[selected.def.suit], 0.8).strokeCircle(x, y, r);
      // 오라 유닛: 버프가 닿는 칸 테두리 표시 (인접/상하좌우/전체)
      const eff = selected.def.effect;
      if (eff && String(eff.type).startsWith('aura_')) {
        for (const sl of auraSlots(selected.slot, String(eff.area ?? 'global'), loop.geometry)) {
          const c = this.cellCenter(sl);
          this.rangeGfx.lineStyle(3, 0xf1d17a, 0.9).strokeRect(c.x - CELL / 2 + 8, c.y - CELL / 2 + 8, CELL - 16, CELL - 16);
        }
      }
    }
  }

  /** 적 스프라이트 동기화 */
  updateEnemies(enemies: readonly Enemy[], trackLength: number): void {
    const alive = new Set<number>();
    for (const e of enemies) {
      alive.add(e.id);
      let s = this.enemySprites.get(e.id);
      const r = e.isBoss ? 40 : 18;
      if (!s) {
        const body = this.scene.add.circle(0, 0, r, ENEMY_COLOR[e.type] ?? 0xffffff).setStrokeStyle(2, 0x0b0e14);
        const bar = this.scene.add.rectangle(0, -r - 10, r * 2, 5, 0x5fcf7a).setOrigin(0.5);
        s = this.scene.add.container(0, 0, [body, bar]);
        this.enemySprites.set(e.id, s);
      }
      const { x, y } = this.trackPoint(e.pos / trackLength);
      s.setPosition(x, y);
      const bar = s.list[1] as Phaser.GameObjects.Rectangle;
      bar.width = Math.max(0, (e.hp / e.maxHp) * r * 2);
      bar.setFillStyle(e.hp / e.maxHp > 0.5 ? 0x5fcf7a : e.hp / e.maxHp > 0.25 ? 0xe8c34a : 0xe0473f);
    }
    for (const [id, s] of this.enemySprites) {
      if (!alive.has(id)) { s.destroy(); this.enemySprites.delete(id); }
    }
  }

  /** 스킬로 소환된 임시 유닛(유령 포탑) 표시 — 영웅 칸 주위에 작은 반투명 원 */
  updateTemporaryUnits(units: readonly DeployedUnit[]): void {
    if (units.length === this.tempSprites.length) return;
    for (const s of this.tempSprites) s.destroy();
    this.tempSprites = [];
    units.forEach((u, i) => {
      const { x, y } = this.cellCenter(u.slot);
      const ang = (Math.PI * 2 * i) / Math.max(1, units.length) - Math.PI / 2;
      const c = this.scene.add.container(x + Math.cos(ang) * 58, y + Math.sin(ang) * 58);
      c.add(this.scene.add.circle(0, 0, 16, SUIT_COLOR[u.def.suit], 0.55).setStrokeStyle(2, 0xf1d17a));
      c.add(this.scene.add.text(0, 0, '👻', { fontSize: '18px' }).setOrigin(0.5));
      this.tempSprites.push(c);
    });
  }

  /** 스킬 사용 연출: 칸에서 퍼지는 링 */
  pulseCell(slot: number): void {
    const { x, y } = this.cellCenter(slot);
    const ring = this.scene.add.circle(x, y, 30).setStrokeStyle(6, 0xf1d17a).setDepth(5);
    ring.setFillStyle(0xf1d17a, 0);
    this.scene.tweens.add({ targets: ring, scale: 9, alpha: 0, duration: 600, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  }

  clearEnemies(): void {
    for (const s of this.enemySprites.values()) s.destroy();
    this.enemySprites.clear();
    for (const s of this.tempSprites) s.destroy();
    this.tempSprites = [];
    this.fx = [];
    this.fxGfx.clear();
  }

  /** 타격 이벤트 → 유닛 칸에서 적으로 선 연출 */
  addHits(hits: readonly HitEvent[], enemies: readonly Enemy[], trackLength: number): void {
    if (hits.length === 0) return;
    const byId = new Map(enemies.map((e) => [e.id, e]));
    for (const h of hits) {
      const e = byId.get(h.enemyId);
      const from = this.cellCenter(h.unit.slot);
      const to = e ? this.trackPoint(e.pos / trackLength) : this.enemySprites.get(h.enemyId) ?? null;
      if (!to) continue;
      this.fx.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, color: h.skill ? 0xf1d17a : SUIT_COLOR[h.unit.def.suit], ttl: h.skill ? 0.3 : h.killed ? 0.25 : 0.12 });
    }
  }

  /** 매 프레임: 타격선 페이드 */
  update(dt: number): void {
    this.fxGfx.clear();
    this.fx = this.fx.filter((f) => (f.ttl -= dt) > 0);
    for (const f of this.fx) {
      this.fxGfx.lineStyle(3, f.color, Math.min(1, f.ttl * 8));
      this.fxGfx.lineBetween(f.x1, f.y1, f.x2, f.y2);
    }
  }

  cellCenter(i: number): { x: number; y: number } {
    return { x: GRID_X + (i % GRID_N) * CELL + CELL / 2, y: GRID_Y + Math.floor(i / GRID_N) * CELL + CELL / 2 };
  }

  /** t∈[0,1) → 링 둘레 좌표 (좌상단에서 시계 방향) — Geometry.trackPoint와 같은 규칙 */
  private trackPoint(t: number): { x: number; y: number } {
    const P = 2 * (RING.w + RING.h);
    let d = ((t % 1) + 1) % 1 * P;
    if (d < RING.w) return { x: RING.x + d, y: RING.y };
    d -= RING.w;
    if (d < RING.h) return { x: RING.x + RING.w, y: RING.y + d };
    d -= RING.h;
    if (d < RING.w) return { x: RING.x + RING.w - d, y: RING.y + RING.h };
    d -= RING.w;
    return { x: RING.x, y: RING.y + RING.h - d };
  }

  /** 역할 실루엣: 근접=사각, 원거리=삼각, 마법=원 (GDD 3.2.1 "실루엣으로 역할이 읽히게") */
  private unitShape(type: 'melee' | 'ranged' | 'magic', size: number, color: number): Phaser.GameObjects.Shape {
    if (type === 'melee') return this.scene.add.rectangle(0, 0, size, size, color).setStrokeStyle(3, 0x0b0e14);
    if (type === 'ranged') return this.scene.add.triangle(0, 4, 0, size, size / 2, 0, size, size, color).setStrokeStyle(3, 0x0b0e14).setOrigin(0.5);
    return this.scene.add.circle(0, 0, size / 2, color).setStrokeStyle(3, 0x0b0e14);
  }
}
