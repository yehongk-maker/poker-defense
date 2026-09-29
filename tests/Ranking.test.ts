/** 시즌·랭킹 표시 규칙 (F단계) */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nextTier, recordText, remainingText, rewardProgress, softReset, tierOf, type RankingConfig } from '../src/systems/Ranking.ts';
import { RATING } from '../src/systems/Rating.ts';

const cfg: RankingConfig = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/data/ranking.json'), 'utf8'));
const REWARDS = [{ minPoints: 100, diamonds: 50 }, { minPoints: 300, diamonds: 150 }, { minPoints: 600, diamonds: 300 }];

describe('티어', () => {
  it('레이팅 구간으로 정해진다. 시작 레이팅은 실버', () => {
    expect(tierOf(cfg, RATING.start).id).toBe('silver');
    expect(tierOf(cfg, 100).id).toBe('bronze');
    expect(tierOf(cfg, 899).id).toBe('bronze');
    expect(tierOf(cfg, 900).id).toBe('silver');
    expect(tierOf(cfg, 1050).id).toBe('gold');
    expect(tierOf(cfg, 1399).id).toBe('platinum');
    expect(tierOf(cfg, 2400).id).toBe('diamond');
  });

  it('다음 티어까지 남은 레이팅', () => {
    expect(nextTier(cfg, 1000)).toMatchObject({ tier: { id: 'gold' }, need: 50 });
    expect(nextTier(cfg, 1400)).toBeNull();
  });

  it('구간은 겹치지 않고 0부터 시작한다', () => {
    const mins = cfg.tiers.map((t) => t.minRating);
    expect(Math.min(...mins)).toBe(0);
    expect(new Set(mins).size).toBe(mins.length);
  });
});

describe('시즌 보상 진행도', () => {
  it('도달한 구간 중 가장 큰 보상, 다음 구간까지의 비율', () => {
    expect(rewardProgress(REWARDS, 0)).toEqual({ diamonds: 0, next: REWARDS[0], ratio: 0 });
    expect(rewardProgress(REWARDS, 50)).toMatchObject({ diamonds: 0, ratio: 0.5 });
    expect(rewardProgress(REWARDS, 100)).toMatchObject({ diamonds: 50, next: REWARDS[1], ratio: 0 });
    expect(rewardProgress(REWARDS, 200)).toMatchObject({ diamonds: 50, ratio: 0.5 });
    expect(rewardProgress(REWARDS, 600)).toEqual({ diamonds: 300, next: null, ratio: 1 });
    expect(rewardProgress(REWARDS, 5000).diamonds).toBe(300);
  });

  it('구간 순서가 섞여 와도 같다, 보상이 없으면 0', () => {
    expect(rewardProgress([...REWARDS].reverse(), 350).diamonds).toBe(150);
    expect(rewardProgress([], 999)).toEqual({ diamonds: 0, next: null, ratio: 1 });
  });
});

describe('시즌 넘김·표시', () => {
  it('레이팅은 1000 쪽으로 절반 당겨진다 (서버와 같은 식)', () => {
    expect(softReset(cfg, 1200)).toBe(1100);
    expect(softReset(cfg, 800)).toBe(900);
    expect(softReset(cfg, 1001)).toBe(1000);
    expect(softReset(cfg, 999)).toBe(1000);
    expect(softReset(cfg, 1000)).toBe(1000);
  });

  it('남은 기간', () => {
    const now = Date.UTC(2026, 8, 29);
    expect(remainingText(now + 12.5 * 86400e3, now)).toBe('12일 남음');
    expect(remainingText(now + 5.2 * 3600e3, now)).toBe('5시간 남음');
    expect(remainingText(now + 10 * 60e3, now)).toBe('1시간 미만');
    expect(remainingText(now - 1, now)).toBe('곧 종료');
    expect(remainingText('nonsense', now)).toBe('곧 종료');
  });

  it('전적 한 줄', () => {
    expect(recordText(12, 3)).toBe('12승 3패');
    expect(recordText(1, 0, 2)).toBe('1승 0패 2무');
  });
});
