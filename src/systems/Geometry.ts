/**
 * Geometry — 트랙/슬롯 좌표계 (순수 함수, Phaser 의존 없음)
 *
 * 좌표 단위 = "트랙 단위". 트랙은 한 변이 trackLength/4 인 정사각 링(중심선)이고,
 * 그 안에 gridSize×gridSize 유닛 슬롯이 놓인다. 슬롯 격자는 링 안쪽을 (gridSize+1)등분한 크기
 * (= 화면 레이아웃: 링 900px 안에 150px 셀 5개 + 양쪽 여백 75px).
 *
 *  - 트랙 pos(0~trackLength) → 링 위 좌표: 좌상단 모서리에서 시계 방향
 *  - 슬롯 i(0~gridSize²-1) → 셀 중심 좌표 (행 우선)
 *  - 사거리(range)는 "셀" 단위. 유닛은 자기 셀 중심에서 range×cell 안의 적만 공격
 */

export interface Point { x: number; y: number }

export interface TrackGeometry {
  trackLength: number;
  gridSize: number;
}

/** 링 한 변 길이 (트랙 단위) */
export const ringSide = (g: TrackGeometry): number => g.trackLength / 4;
/** 셀 한 변 길이 (트랙 단위) */
export const cellSize = (g: TrackGeometry): number => ringSide(g) / (g.gridSize + 1);

/** 트랙 위치 → 좌표 (링 중심이 원점, 좌상단 모서리가 pos 0, 시계 방향) */
export function trackPoint(g: TrackGeometry, pos: number): Point {
  const L = ringSide(g);
  const h = L / 2;
  let d = ((pos % g.trackLength) + g.trackLength) % g.trackLength;
  if (d < L) return { x: -h + d, y: -h };
  d -= L;
  if (d < L) return { x: h, y: -h + d };
  d -= L;
  if (d < L) return { x: h - d, y: h };
  d -= L;
  return { x: -h, y: h - d };
}

/** 슬롯 인덱스 → 셀 중심 좌표 */
export function slotPoint(g: TrackGeometry, slot: number): Point {
  const c = cellSize(g);
  const col = slot % g.gridSize;
  const row = Math.floor(slot / g.gridSize);
  const off = (g.gridSize - 1) / 2;
  return { x: (col - off) * c, y: (row - off) * c };
}

export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** 슬롯에서 range(셀)로 트랙 위치 pos에 닿는가 */
export function inRange(g: TrackGeometry, slot: number, rangeCells: number, pos: number): boolean {
  return dist(slotPoint(g, slot), trackPoint(g, pos)) <= rangeCells * cellSize(g);
}

/**
 * 슬롯의 트랙 커버리지(0~1): range 안에 들어오는 트랙 길이 비율.
 * 자동 배치가 "이 유닛에게 가장 좋은 빈 칸"을 고를 때 사용 (근접=가장자리, 원거리=안쪽이 자연 발생).
 */
export function coverage(g: TrackGeometry, slot: number, rangeCells: number, samples = 200): number {
  const p = slotPoint(g, slot);
  const r = rangeCells * cellSize(g);
  let hit = 0;
  for (let i = 0; i < samples; i++) {
    const pos = (i / samples) * g.trackLength;
    if (dist(p, trackPoint(g, pos)) <= r) hit++;
  }
  return hit / samples;
}

/** 슬롯이 격자 가장자리 칸인가 (근접 유닛 배치 힌트용) */
export function isEdgeSlot(g: TrackGeometry, slot: number): boolean {
  const n = g.gridSize;
  const col = slot % n;
  const row = Math.floor(slot / n);
  return col === 0 || row === 0 || col === n - 1 || row === n - 1;
}
