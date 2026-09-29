/**
 * Ranking — 티어·시즌 보상 진행도·남은 기간 표시 (docs/mode-design.md §2.6). 순수.
 * 수치는 src/data/ranking.json, 보상 구간은 서버가 준 시즌 정보(SeasonReward[]).
 */
export interface TierDef { id: string; name: string; minRating: number; color: 'gray' | 'blue' | 'gold' | 'green' | 'purple' }
export interface RankingConfig {
  tiers: TierDef[];
  leaderboardSize: number;
  seasonSoftReset: { center: number; keep: number };
}
export interface SeasonReward { minPoints: number; diamonds: number }

const sortedTiers = (cfg: RankingConfig): TierDef[] => [...cfg.tiers].sort((a, b) => a.minRating - b.minRating);

export function tierOf(cfg: RankingConfig, rating: number): TierDef {
  const t = sortedTiers(cfg);
  let cur = t[0];
  for (const x of t) if (rating >= x.minRating) cur = x;
  return cur;
}

/** 다음 티어와 거기까지 남은 레이팅. 최고 티어면 null */
export function nextTier(cfg: RankingConfig, rating: number): { tier: TierDef; need: number } | null {
  const n = sortedTiers(cfg).find((x) => x.minRating > rating);
  return n ? { tier: n, need: n.minRating - rating } : null;
}

export interface RewardProgress {
  /** 지금 포인트로 받을 다이아 (시즌 끝에 지급) */
  diamonds: number;
  /** 다음 보상 구간. 마지막 구간을 넘었으면 null */
  next: SeasonReward | null;
  /** 이전 구간 → 다음 구간 사이 진행 비율 0~1 (마지막 구간을 넘었으면 1) */
  ratio: number;
}

export function rewardProgress(rewards: readonly SeasonReward[], points: number): RewardProgress {
  const r = [...rewards].sort((a, b) => a.minPoints - b.minPoints);
  let diamonds = 0, floor = 0;
  for (const x of r) if (points >= x.minPoints) { diamonds = x.diamonds; floor = x.minPoints; }
  const next = r.find((x) => x.minPoints > points) ?? null;
  const ratio = next ? Math.max(0, Math.min(1, (points - floor) / (next.minPoints - floor))) : 1;
  return { diamonds, next, ratio };
}

/** 시즌이 끝나면 레이팅은 기준(1000) 쪽으로 당겨진다 — 서버 ensure_season과 같은 식 (정수 나눗셈은 0 쪽으로 버림) */
export function softReset(cfg: RankingConfig, rating: number): number {
  const { center, keep } = cfg.seasonSoftReset;
  return Math.max(100, center + Math.trunc((rating - center) * keep));
}

/** "12일 남음" / "5시간 남음" / "곧 종료" */
export function remainingText(endsAt: string | number | Date, now: number = Date.now()): string {
  const ms = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return '곧 종료';
  const h = Math.floor(ms / 3600e3);
  if (h >= 24) return `${Math.floor(h / 24)}일 남음`;
  if (h >= 1) return `${h}시간 남음`;
  return '1시간 미만';
}

/** 전적 한 줄: "12승 3패" (무승부가 있으면 뒤에) */
export function recordText(wins: number, losses: number, draws = 0): string {
  return `${wins}승 ${losses}패${draws > 0 ? ` ${draws}무` : ''}`;
}
