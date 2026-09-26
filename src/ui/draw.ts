/**
 * 공용 도형 그리기 (DESIGN §4·§9) — 컴포넌트 내부에서만 쓴다. 씬은 컴포넌트를 조립만 한다.
 * 이모지 대신 쓰는 도형 아이콘(동전·하트·젬·영웅 토큰·교환권·별)도 여기.
 */
import Phaser from 'phaser';
import { COLOR } from './theme.ts';

type G = Phaser.GameObjects.Graphics;

/** 라운드 패널: 채움 + 선택 보더 */
export function roundPanel(g: G, x: number, y: number, w: number, h: number, r: number, fill: number, alpha = 1, stroke?: { w: number; color: number; alpha?: number }): void {
  g.fillStyle(fill, alpha).fillRoundedRect(x - w / 2, y - h / 2, w, h, Math.min(r, h / 2, w / 2));
  if (stroke) g.lineStyle(stroke.w, stroke.color, stroke.alpha ?? 1).strokeRoundedRect(x - w / 2, y - h / 2, w, h, Math.min(r, h / 2, w / 2));
}

/** 세로 그라디언트 느낌: 위쪽 절반에 흰 하이라이트를 얹는다 (라운드 도형 공용) */
export function glossTop(g: G, x: number, y: number, w: number, h: number, r: number, alpha = 0.22): void {
  const rr = Math.min(r, h / 2, w / 2);
  g.fillStyle(0xffffff, alpha).fillRoundedRect(x - w / 2, y - h / 2, w, h / 2, { tl: rr, tr: rr, bl: 0, br: 0 });
}

/** 대시 보더 사각형 (빈 슬롯) */
export function dashedRect(g: G, x: number, y: number, w: number, h: number, color: number, alpha: number, dash = 10, gap = 8, lineW = 3): void {
  g.lineStyle(lineW, color, alpha);
  const seg = (x1: number, y1: number, x2: number, y2: number) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(len, d + dash);
      g.lineBetween(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e);
    }
  };
  const l = x - w / 2, t = y - h / 2, rgt = x + w / 2, b = y + h / 2;
  seg(l, t, rgt, t); seg(rgt, t, rgt, b); seg(rgt, b, l, b); seg(l, b, l, t);
}

// ── 아이콘 (size = 지름 기준) ──
/** 골드 동전: 방사형 그라디언트 느낌 (DESIGN §4 ResourcePill) */
export function coinIcon(g: G, x: number, y: number, size: number): void {
  const r = size / 2;
  g.fillStyle(COLOR.goldDark).fillCircle(x, y + r * 0.08, r);
  g.fillStyle(COLOR.gold).fillCircle(x, y, r * 0.92);
  g.fillStyle(COLOR.textGold).fillCircle(x - r * 0.18, y - r * 0.18, r * 0.5);
  g.lineStyle(Math.max(2, r * 0.12), COLOR.goldDark, 0.8).strokeCircle(x, y, r * 0.62);
}

/** 하트 (라이프) */
export function heartIcon(g: G, x: number, y: number, size: number, color: number = COLOR.red): void {
  const r = size * 0.27;
  g.fillStyle(color);
  g.fillCircle(x - r * 0.9, y - r * 0.35, r);
  g.fillCircle(x + r * 0.9, y - r * 0.35, r);
  g.fillTriangle(x - r * 1.85, y - r * 0.1, x + r * 1.85, y - r * 0.1, x, y + size * 0.45);
  g.fillStyle(0xffffff, 0.45).fillCircle(x - r * 1.05, y - r * 0.6, r * 0.35);
}

/** 다이아(젬): 퍼플 오각 클립 (DESIGN §4) */
export function gemIcon(g: G, x: number, y: number, size: number): void {
  const r = size / 2;
  const pts = [
    new Phaser.Math.Vector2(x - r * 0.95, y - r * 0.3), new Phaser.Math.Vector2(x - r * 0.55, y - r * 0.85),
    new Phaser.Math.Vector2(x + r * 0.55, y - r * 0.85), new Phaser.Math.Vector2(x + r * 0.95, y - r * 0.3),
    new Phaser.Math.Vector2(x, y + r * 0.95),
  ];
  g.fillStyle(COLOR.purpleDark).fillPoints(pts, true);
  g.fillStyle(COLOR.purple).fillTriangle(x - r * 0.95, y - r * 0.3, x + r * 0.95, y - r * 0.3, x, y + r * 0.95);
  g.fillStyle(0xffffff, 0.35).fillTriangle(x - r * 0.55, y - r * 0.85, x, y - r * 0.3, x - r * 0.95, y - r * 0.3);
}

/** 영웅 토큰: 퍼플 원 + 골드 별 */
export function tokenIcon(g: G, x: number, y: number, size: number, filled = true): void {
  const r = size / 2;
  g.fillStyle(filled ? COLOR.purpleDark : COLOR.grayDark).fillCircle(x, y, r);
  g.fillStyle(filled ? COLOR.purple : COLOR.gray).fillCircle(x, y - r * 0.06, r * 0.84);
  starPath(g, x, y, r * 0.55, r * 0.24, filled ? COLOR.textGold : COLOR.grayDark);
}

/** 카드 교환권: 블루 티켓 + 노치 */
export function ticketIcon(g: G, x: number, y: number, size: number): void {
  const w = size * 1.2, h = size * 0.78;
  g.fillStyle(COLOR.blueDark).fillRoundedRect(x - w / 2, y - h / 2 + 3, w, h, 6);
  g.fillStyle(COLOR.blue).fillRoundedRect(x - w / 2, y - h / 2, w, h, 6);
  g.fillStyle(COLOR.navyDark).fillCircle(x - w / 2, y, h * 0.2).fillCircle(x + w / 2, y, h * 0.2);
  g.lineStyle(2, 0xffffff, 0.7).lineBetween(x - w * 0.18, y - h * 0.3, x - w * 0.18, y + h * 0.3);
}

/** 별 (채움) */
export function starPath(g: G, x: number, y: number, outer: number, inner: number, color: number, points = 5): void {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 === 0 ? outer : inner;
    pts.push(new Phaser.Math.Vector2(x + Math.cos(a) * r, y + Math.sin(a) * r));
  }
  g.fillStyle(color).fillPoints(pts, true);
}
