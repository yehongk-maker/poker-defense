import Phaser from 'phaser';
import type { DeployedUnit, Enemy, HitEvent } from '../systems/Battle.ts';
import type { GameLoop } from '../systems/GameLoop.ts';
import { auraSlots } from '../systems/SynergySystem.ts';
import { ALPHA, COLOR, ENEMY_COLOR, FONT, OUTLINE, SIZE, SUIT_COLOR, SUIT_SYMBOL, TAP_SLOP, TARGET_LABEL, hex } from './theme.ts';
import { dashedRect, glossTop, starPath } from './draw.ts';

/**
 * 필드 (DESIGN §2·§4): 초록 잔디 라운드 패널 + 모래색 순환 트랙(이중 스트로크) + 유닛 칩(5×5 슬롯) + 적 + 타격/데미지 숫자.
 * 트랙 좌표(pos 0~trackLength)를 사각 링 둘레로 매핑한다. 선택된 유닛은 사거리 원을 표시한다 (배치 유도).
 */
export const FIELD = { x: 70, y: 176, w: 940, h: 940 };
const OUTER = FIELD;
const TRACK_W = 76; // 적 이동 링의 띠 폭(좌표계). 시각 트랙은 SIZE.trackW
const RING = { x: OUTER.x + TRACK_W / 2, y: OUTER.y + TRACK_W / 2, w: OUTER.w - TRACK_W, h: OUTER.h - TRACK_W }; // 중심선
const GRID_N = 5;
const CELL = RING.w / (GRID_N + 1); // Geometry.cellSize와 같은 비율
const GRID_X = OUTER.x + (OUTER.w - GRID_N * CELL) / 2;
const GRID_Y = OUTER.y + (OUTER.h - GRID_N * CELL) / 2;
const SLOT = SIZE.slotSize;
const MAX_DMG_TEXT = 10;

interface HitFx { x1: number; y1: number; x2: number; y2: number; color: number; ttl: number }

export class TrackView {
  private zones: Phaser.GameObjects.Zone[] = [];
  private slotGfx: Phaser.GameObjects.Graphics;
  private unitSprites: Phaser.GameObjects.Container[] = [];
  private enemySprites = new Map<number, Phaser.GameObjects.Container>();
  /** 고정 step 시뮬의 렌더 보간용: 적마다 직전 step 위치와 이번 step 위치 */
  private enemyTrail = new Map<number, { from: number; to: number }>();
  private fx: HitFx[] = [];
  private fxGfx: Phaser.GameObjects.Graphics;
  private rangeGfx: Phaser.GameObjects.Graphics;
  private bingoGfx: Phaser.GameObjects.Graphics;
  private onCellTap: ((slot: number) => void) | null = null;
  private tempSprites: Phaser.GameObjects.Container[] = [];
  private dmgTexts = 0;

  constructor(private scene: Phaser.Scene) {
    const g = scene.add.graphics();
    // 잔디 패널 + inset 스트로크
    g.fillStyle(COLOR.fieldEdge).fillRoundedRect(OUTER.x, OUTER.y + 8, OUTER.w, OUTER.h, SIZE.radiusPanel);
    g.fillStyle(COLOR.fieldGrass).fillRoundedRect(OUTER.x, OUTER.y, OUTER.w, OUTER.h, SIZE.radiusPanel);
    g.lineStyle(4, COLOR.fieldEdge).strokeRoundedRect(OUTER.x + 6, OUTER.y + 6, OUTER.w - 12, OUTER.h - 12, SIZE.radiusPanel - 6);
    // 잔디 결 (옅은 줄무늬)
    for (let i = 1; i < 10; i++) g.fillStyle(0xffffff, 0.035).fillRect(OUTER.x + 10, OUTER.y + i * (OUTER.h / 10) - 20, OUTER.w - 20, 40);
    // 모래 트랙: 바깥 트랙 테두리 → 모래 → 안쪽 결
    const tr = 26;
    g.lineStyle(SIZE.trackW + 10, COLOR.trackEdge).strokeRoundedRect(RING.x, RING.y, RING.w, RING.h, tr);
    g.lineStyle(SIZE.trackW, COLOR.trackSand).strokeRoundedRect(RING.x, RING.y, RING.w, RING.h, tr);
    g.lineStyle(2, COLOR.trackEdge, 0.45).strokeRoundedRect(RING.x, RING.y, RING.w, RING.h, tr);
    // 스폰 깃발 (좌상단 시작점)
    g.fillStyle(COLOR.navyDark).fillRect(RING.x - 3, RING.y - 46, 6, 46);
    g.fillStyle(COLOR.red).fillTriangle(RING.x + 3, RING.y - 46, RING.x + 3, RING.y - 22, RING.x + 34, RING.y - 34);
    scene.add.text(RING.x + 40, RING.y - 34, '스폰', { fontSize: `${SIZE.tiny}px`, color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0, 0.5);

    this.slotGfx = scene.add.graphics();
    this.rangeGfx = scene.add.graphics();
    this.bingoGfx = scene.add.graphics().setDepth(3);
    for (let i = 0; i < GRID_N * GRID_N; i++) {
      const { x, y } = this.cellCenter(i);
      const z = scene.add.zone(x, y, CELL, CELL).setInteractive({ useHandCursor: true });
      z.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < TAP_SLOP) this.onCellTap?.(i); });
      this.zones.push(z);
    }
    this.fxGfx = scene.add.graphics().setDepth(4);
    this.drawSlots(new Set(), -1, null);
  }

  setCellTapHandler(fn: ((slot: number) => void) | null): void {
    this.onCellTap = fn;
  }

  /** 빈 슬롯 = 흰 14% + 대시 보더. 선택 칸 = 골드 아웃라인. 미확정 유닛 선택 중이면 빈 칸을 커버리지로 틴트 */
  private drawSlots(occupied: Set<number>, selectedSlot: number, cov: number[] | null): void {
    const g = this.slotGfx.clear();
    for (let i = 0; i < GRID_N * GRID_N; i++) {
      const { x, y } = this.cellCenter(i);
      if (!occupied.has(i)) {
        const v = cov ? cov[i] : -1;
        g.fillStyle(v > 0 ? COLOR.textGold : 0xffffff, v > 0 ? 0.12 + v * 0.45 : ALPHA.emptySlot).fillRoundedRect(x - SLOT / 2, y - SLOT / 2, SLOT, SLOT, SIZE.radiusCard);
        if (v === 0) g.fillStyle(COLOR.redDark, 0.25).fillRoundedRect(x - SLOT / 2, y - SLOT / 2, SLOT, SLOT, SIZE.radiusCard);
        dashedRect(g, x, y, SLOT - 4, SLOT - 4, 0xffffff, 0.55, 12, 8, 3);
      }
      if (i === selectedSlot) g.lineStyle(5, COLOR.gold).strokeRoundedRect(x - SLOT / 2 - 8, y - SLOT / 2 - 8, SLOT + 16, SLOT + 16, SIZE.radiusCard + 4);
    }
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
    const occupied = new Set<number>(loop.units.map((u) => u.slot));
    if (loop.hero) occupied.add(loop.hero.unit.slot);
    this.drawSlots(occupied, selectedSlot, cov);

    for (const u of loop.units) this.unitSprites.push(this.unitChip(u, false));
    if (loop.hero) this.unitSprites.push(this.unitChip(loop.hero.unit, true));

    // 빙고 줄: 완성된 줄을 수트 색 굵은 선으로 관통 표시
    this.bingoGfx.clear();
    for (const line of loop.bingoLines) {
      const a = this.cellCenter(line.cells[0]);
      const b = this.cellCenter(line.cells[line.cells.length - 1]);
      const color = SUIT_COLOR[line.key as keyof typeof SUIT_COLOR] ?? COLOR.textGold;
      this.bingoGfx.lineStyle(16, color, 0.35).lineBetween(a.x, a.y, b.x, b.y);
      this.bingoGfx.lineStyle(5, COLOR.textGold, 0.95).lineBetween(a.x, a.y, b.x, b.y);
    }

    // 미확정 유닛은 사거리 원을 항상 표시 (어디에 두면 트랙에 닿는지 바로 보이게)
    for (const u of loop.unplacedUnits) {
      if (u === selected) continue;
      const { x, y } = this.cellCenter(u.slot);
      const r = (u.def.range + (u.rangeBonus ?? 0)) * CELL;
      this.rangeGfx.fillStyle(0xffffff, 0.06).fillCircle(x, y, r);
      this.rangeGfx.lineStyle(3, 0xffffff, 0.5).strokeCircle(x, y, r);
    }

    if (selected) {
      const { x, y } = this.cellCenter(selected.slot);
      const r = (selected.def.range + (selected.rangeBonus ?? 0)) * CELL;
      this.rangeGfx.fillStyle(0xffffff, 0.12).fillCircle(x, y, r);
      this.rangeGfx.lineStyle(4, COLOR.textGold, 0.95).strokeCircle(x, y, r);
      // 오라 유닛: 버프가 닿는 칸 테두리 표시 (인접/상하좌우/전체)
      const eff = selected.def.effect;
      if (eff && String(eff.type).startsWith('aura_')) {
        for (const sl of auraSlots(selected.slot, String(eff.area ?? 'global'), loop.geometry)) {
          const c = this.cellCenter(sl);
          this.rangeGfx.lineStyle(3, COLOR.textGold, 0.9).strokeRoundedRect(c.x - SLOT / 2 - 4, c.y - SLOT / 2 - 4, SLOT + 8, SLOT + 8, SIZE.radiusCard);
        }
      }
    }
  }

  /** 유닛 칩 (DESIGN §4 UnitChip): 수트색 라운드 + 수트 글리프 + 우하단 티어. 역할 실루엣은 좌상단 미니 아이콘 */
  private unitChip(u: DeployedUnit, isHero: boolean): Phaser.GameObjects.Container {
    const { x, y } = this.cellCenter(u.slot);
    const c = this.scene.add.container(x, y);
    const g = this.scene.add.graphics();
    const color = SUIT_COLOR[u.def.suit];
    const s = SLOT;
    g.fillStyle(0x000000, 0.25).fillRoundedRect(-s / 2, -s / 2 + 7, s, s, SIZE.radiusCard);
    g.fillStyle(color).fillRoundedRect(-s / 2, -s / 2, s, s, SIZE.radiusCard);
    glossTop(g, 0, 0, s, s, SIZE.radiusCard, 0.25);
    g.lineStyle(isHero ? 5 : 3, isHero ? COLOR.gold : 0xffffff, isHero ? 1 : 0.7).strokeRoundedRect(-s / 2, -s / 2, s, s, SIZE.radiusCard);
    // 역할 실루엣 (GDD 3.2.1): 근접=사각, 원거리=삼각, 마법=원
    const ix = -s / 2 + 15, iy = -s / 2 + 15;
    g.fillStyle(0xffffff, 0.9);
    if (u.def.attackType === 'melee') g.fillRect(ix - 7, iy - 7, 14, 14);
    else if (u.def.attackType === 'ranged') g.fillTriangle(ix - 8, iy + 7, ix + 8, iy + 7, ix, iy - 8);
    else g.fillCircle(ix, iy, 8);
    if (isHero) starPath(g, s / 2 - 14, -s / 2 + 14, 13, 6, COLOR.gold);
    const glyph = this.scene.add.text(0, -2, SUIT_SYMBOL[u.def.suit], { fontSize: '48px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5);
    const tier = this.scene.add.text(s / 2 - 6, s / 2 - 4, isHero ? '영웅' : `T${u.def.tier}`, { fontSize: '24px', color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE }).setOrigin(1, 1);
    const name = this.scene.add.text(0, s / 2 + 14, u.def.name, { fontSize: `${SIZE.tiny}px`, color: hex(isHero ? COLOR.textGold : COLOR.textMain), fontFamily: FONT.body, fontStyle: '700', ...OUTLINE, strokeThickness: 3 }).setOrigin(0.5);
    if (name.width > CELL - 6) name.setScale((CELL - 6) / name.width);
    c.add([g, glyph, tier, name]);
    // 공격 대상 배지: 지상만/공중만 (모두면 없음)
    const tl = TARGET_LABEL[u.def.targets] ?? '';
    if (tl) {
      const bx = s / 2 - 2, by = -s / 2 - 2;
      const bg = this.scene.add.graphics();
      bg.fillStyle(u.def.targets === 'air' ? COLOR.purple : COLOR.trackEdge).fillRoundedRect(bx - 44, by - 12, 50, 24, 12);
      const t = this.scene.add.text(bx - 19, by, tl, { fontSize: '16px', color: hex(COLOR.textMain), fontFamily: FONT.body, fontStyle: '700' }).setOrigin(0.5);
      c.add([bg, t]);
    }
    if (!u.placed) {
      // 미확정(소환 직후, 1회 이동 가능): 반투명 + 골드 점선 링 + "배치" 태그. 배치하지 않아도 전투 시작 시 이 자리로 확정
      c.setAlpha(0.6);
      const ring = this.scene.add.graphics();
      dashedRect(ring, 0, 0, s + 14, s + 14, COLOR.gold, 1, 10, 7, 4);
      const tagBg = this.scene.add.graphics();
      tagBg.fillStyle(COLOR.gold).fillRoundedRect(-s / 2 - 4, -s / 2 - 20, 54, 26, 13);
      const tag = this.scene.add.text(-s / 2 + 23, -s / 2 - 7, '배치', { fontSize: '17px', color: hex(COLOR.textOnGold), fontFamily: FONT.display }).setOrigin(0.5);
      c.addAt(ring, 0);
      c.add([tagBg, tag]);
    }
    return c;
  }

  /** 적 스프라이트 동기화 (DESIGN §4 Foe: 지상=바닥 밀착+섀도, 공중=y-20 부양+분리된 그림자) */
  /**
   * @param alpha 고정 step 사이 진행 비율(0~1, GameLoop.combatAlpha). 직전 위치 → 현재 위치를 이만큼 보간해 그린다. 1이면 현재 위치 그대로
   */
  updateEnemies(enemies: readonly Enemy[], trackLength: number, alpha = 1): void {
    const alive = new Set<number>();
    for (const e of enemies) {
      alive.add(e.id);
      let s = this.enemySprites.get(e.id);
      const r = e.isBoss ? 44 : SIZE.foeSize / 2;
      const air = e.movement === 'air';
      const lift = air ? 20 : 0;
      if (!s) {
        const color = ENEMY_COLOR[e.type] ?? COLOR.gray;
        const g = this.scene.add.graphics();
        // 그림자: 지상은 발밑에 붙고 진하게, 공중은 떨어져서 작고 옅게
        g.fillStyle(0x000000, air ? 0.16 : 0.28).fillEllipse(0, r * 0.75, r * (air ? 1.3 : 1.9), r * (air ? 0.34 : 0.5));
        g.fillStyle(COLOR.navyDark).fillCircle(0, -lift, r + 3);
        g.fillStyle(color).fillCircle(0, -lift, r);
        g.fillStyle(0xffffff, 0.3).fillCircle(-r * 0.3, -lift - r * 0.3, r * 0.35);
        // 눈 (캐주얼 표정)
        g.fillStyle(0xffffff).fillCircle(-r * 0.3, -lift - r * 0.05, r * 0.2).fillCircle(r * 0.3, -lift - r * 0.05, r * 0.2);
        g.fillStyle(COLOR.navyDark).fillCircle(-r * 0.27, -lift, r * 0.1).fillCircle(r * 0.33, -lift, r * 0.1);
        if (air) {
          // 날개
          g.fillStyle(COLOR.textMain, 0.85);
          g.fillTriangle(-r * 0.8, -lift - r * 0.1, -r * 1.7, -lift - r * 0.7, -r * 1.2, -lift + r * 0.25);
          g.fillTriangle(r * 0.8, -lift - r * 0.1, r * 1.7, -lift - r * 0.7, r * 1.2, -lift + r * 0.25);
        }
        if (e.isBoss) starPath(g, 0, -lift - r - 20, 12, 5, COLOR.gold);
        const barBg = this.scene.add.rectangle(0, -lift - r - 8, r * 2, 6, COLOR.navyDark).setOrigin(0.5);
        const bar = this.scene.add.rectangle(-r, -lift - r - 8, r * 2, 4, COLOR.green).setOrigin(0, 0.5);
        s = this.scene.add.container(0, 0, [g, barBg, bar]).setDepth(2);
        this.enemySprites.set(e.id, s);
      }
      let tr = this.enemyTrail.get(e.id);
      if (!tr) { tr = { from: e.pos, to: e.pos }; this.enemyTrail.set(e.id, tr); }
      else if (tr.to !== e.pos) { tr.from = tr.to; tr.to = e.pos; }
      let d = tr.to - tr.from;
      if (d < -trackLength / 2) d += trackLength; // 한 바퀴 넘어감
      const shown = alpha >= 1 ? e.pos : (tr.from + d * alpha + trackLength) % trackLength;
      const { x, y } = this.trackPoint(shown / trackLength);
      s.setPosition(x, y);
      const bar = s.list[s.list.length - 1] as Phaser.GameObjects.Rectangle;
      const f = Math.max(0, e.hp / e.maxHp);
      bar.width = f * r * 2;
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.ValueToColor(COLOR.red), Phaser.Display.Color.ValueToColor(COLOR.green), 100, Math.round(f * 100));
      bar.setFillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
    }
    for (const [id, s] of this.enemySprites) {
      if (!alive.has(id)) { s.destroy(); this.enemySprites.delete(id); this.enemyTrail.delete(id); }
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
      const g = this.scene.add.graphics();
      g.fillStyle(SUIT_COLOR[u.def.suit], 0.7).fillCircle(0, 0, 18);
      g.lineStyle(3, COLOR.textGold).strokeCircle(0, 0, 18);
      g.fillStyle(0xffffff).fillCircle(-5, -2, 4).fillCircle(5, -2, 4);
      c.add(g);
      this.tempSprites.push(c);
    });
  }

  /** 스킬 사용 연출: 칸에서 퍼지는 링 */
  pulseCell(slot: number): void {
    const { x, y } = this.cellCenter(slot);
    const ring = this.scene.add.circle(x, y, 30).setStrokeStyle(6, COLOR.textGold).setDepth(5);
    ring.setFillStyle(COLOR.textGold, 0);
    this.scene.tweens.add({ targets: ring, scale: 9, alpha: 0, duration: 600, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  }

  clearEnemies(): void {
    for (const s of this.enemySprites.values()) s.destroy();
    this.enemySprites.clear();
    this.enemyTrail.clear();
    for (const s of this.tempSprites) s.destroy();
    this.tempSprites = [];
    this.fx = [];
    this.fxGfx.clear();
  }

  /** 타격 이벤트 → 유닛 칸에서 적으로 선 연출 + 데미지 숫자 */
  addHits(hits: readonly HitEvent[], enemies: readonly Enemy[], trackLength: number): void {
    if (hits.length === 0) return;
    const byId = new Map(enemies.map((e) => [e.id, e]));
    for (const h of hits) {
      const e = byId.get(h.enemyId);
      const from = this.cellCenter(h.unit.slot);
      const to = e ? this.trackPoint(e.pos / trackLength) : this.enemySprites.get(h.enemyId) ?? null;
      if (!to) continue;
      const lift = e?.movement === 'air' ? 20 : 0;
      this.fx.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y - lift, color: h.skill ? COLOR.textGold : SUIT_COLOR[h.unit.def.suit], ttl: h.skill ? 0.3 : h.killed ? 0.25 : 0.12 });
      this.damageNumber(to.x, to.y - lift - 30, h.dmg, !!h.skill || h.killed);
    }
  }

  /** 데미지 숫자 (DESIGN §4): Jua, 일반 28px / 크리티컬 40px + "!", 위로 40px 떠오르며 페이드 600ms. 동시 최대 10개 */
  private damageNumber(x: number, y: number, dmg: number, crit: boolean): void {
    if (this.dmgTexts >= MAX_DMG_TEXT && !crit) return;
    this.dmgTexts++;
    const t = this.scene.add.text(x + Phaser.Math.Between(-10, 10), y, `${Math.round(dmg)}${crit ? '!' : ''}`, {
      fontSize: `${crit ? 40 : 28}px`, color: hex(crit ? COLOR.critNum : COLOR.damageNum), fontFamily: FONT.display, ...OUTLINE,
    }).setOrigin(0.5).setDepth(6);
    this.scene.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 600, ease: 'Cubic.easeOut', onComplete: () => { t.destroy(); this.dmgTexts--; } });
  }

  /** 매 프레임: 타격선 페이드 */
  update(dt: number): void {
    this.fxGfx.clear();
    this.fx = this.fx.filter((f) => (f.ttl -= dt) > 0);
    for (const f of this.fx) {
      this.fxGfx.lineStyle(4, f.color, Math.min(1, f.ttl * 8));
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
}
