/**
 * Rating — ELO-lite와 시즌 포인트 (docs/mode-design.md §2.6). 순수 함수.
 * 서버(supabase/migrations …functions.sql 의 elo_delta·finalize_match)와 같은 식이어야 한다 — 결과 화면 예상치 표시용.
 */
export const RATING = {
  start: 1000,
  floor: 100,
  k: 32,
  kPlacement: 64,        // 배치 10판
  placementGames: 10,
  substituteKFactor: 0.5, // 대체 상대(고스트·봇) 판은 K 절반
  season: { win: 20, loss: -8, draw: 5 },
} as const;

/** 기대 승률 */
export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

/** score: 1 승 / 0.5 무 / 0 패 */
export function eloDelta(ra: number, rb: number, score: number, k: number): number {
  return Math.round(k * (score - expectedScore(ra, rb)));
}

export function kFactor(placementLeft: number, substitute: boolean): number {
  const k = placementLeft > 0 ? RATING.kPlacement : RATING.k;
  return substitute ? Math.floor(k * RATING.substituteKFactor) : k;
}

export interface RatingChange { rating: number; delta: number; seasonPoints: number }

export function applyResult(
  me: { rating: number; seasonPoints: number; placementLeft: number },
  opponentRating: number,
  outcome: 'win' | 'loss' | 'draw',
  substitute = false,
): RatingChange {
  const score = outcome === 'win' ? 1 : outcome === 'loss' ? 0 : 0.5;
  const delta = eloDelta(me.rating, opponentRating, score, kFactor(me.placementLeft, substitute));
  const sp = RATING.season[outcome];
  return { rating: Math.max(RATING.floor, me.rating + delta), delta, seasonPoints: Math.max(0, me.seasonPoints + sp) };
}

/** 매칭 범위: 처음 ±100, 10초마다 +50, 최대 ±400 */
export function matchSpan(waitedSec: number): number {
  return Math.min(400, 100 + 50 * Math.floor(Math.max(0, waitedSec) / 10));
}
