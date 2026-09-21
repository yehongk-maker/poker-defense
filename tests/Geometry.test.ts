import { describe, it, expect } from 'vitest';
import { trackPoint, slotPoint, cellSize, ringSide, inRange, coverage, isEdgeSlot, type TrackGeometry } from '../src/systems/Geometry.ts';

const g: TrackGeometry = { trackLength: 40, gridSize: 5 };

describe('Geometry — 트랙/슬롯 좌표계', () => {
  it('링 한 변 10, 셀 크기 10/6', () => {
    expect(ringSide(g)).toBe(10);
    expect(cellSize(g)).toBeCloseTo(10 / 6);
  });

  it('트랙 pos → 링 둘레 시계 방향 (0=좌상, 10=우상, 20=우하, 30=좌하)', () => {
    expect(trackPoint(g, 0)).toEqual({ x: -5, y: -5 });
    expect(trackPoint(g, 10)).toEqual({ x: 5, y: -5 });
    expect(trackPoint(g, 20)).toEqual({ x: 5, y: 5 });
    expect(trackPoint(g, 30)).toEqual({ x: -5, y: 5 });
    expect(trackPoint(g, 40)).toEqual(trackPoint(g, 0)); // 랩어라운드
  });

  it('슬롯 12(중앙)은 원점, 슬롯 0은 좌상단 셀', () => {
    expect(slotPoint(g, 12)).toEqual({ x: 0, y: 0 });
    const p = slotPoint(g, 0);
    expect(p.x).toBeCloseTo(-2 * cellSize(g));
    expect(p.y).toBeCloseTo(-2 * cellSize(g));
  });

  it('가장자리 셀은 트랙까지 1셀, 중앙은 3셀 → 사거리 2는 가장자리에서만, 사거리 3은 중앙에서 한 점만', () => {
    expect(inRange(g, 0, 2, 2 * cellSize(g))).toBe(true);   // 셀 0 바로 위 트랙 점 (x=-3.33)
    expect(inRange(g, 12, 2, 5)).toBe(false);               // 중앙에서 위쪽 변 중점 (거리 5 > 3.33)
    expect(inRange(g, 12, 3, 5)).toBe(true);                // 사거리 3 = 5.0 → 딱 닿음
    expect(coverage(g, 12, 2)).toBe(0);
    expect(coverage(g, 12, 4)).toBeGreaterThan(coverage(g, 0, 4));
    expect(coverage(g, 0, 2)).toBeGreaterThan(0.1);
  });

  it('가장자리 판정: 16칸 가장자리, 9칸 안쪽', () => {
    const edges = Array.from({ length: 25 }, (_, i) => i).filter((i) => isEdgeSlot(g, i));
    expect(edges.length).toBe(16);
  });
});
