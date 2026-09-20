/**
 * 밸런스 회귀 테스트 — GDD 3.5 / 7 / 9.5 목표를 헤드리스 봇으로 고정.
 * 수치(JSON) 변경이 목표를 벗어나면 여기서 잡힌다. 봇 정의는 scripts/sim-core.ts.
 */
import { describe, it, expect } from 'vitest';
import { run } from '../scripts/sim-core.ts';

const GAMES = 60;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const reach = (xs: number[], w: number) => xs.filter((x) => x >= w).length / xs.length;

describe('밸런스 목표 (봇 60판)', () => {
  it('GDD 7: 하이카드(T1 1기)만 소환해도 15웨이브에 90% 이상 도달, 30웨이브는 못 넘는다', () => {
    const st = run('highcard', GAMES, 1000);
    expect(st.stalls).toBe(0);
    expect(reach(st.waves, 15)).toBeGreaterThanOrEqual(0.9);
    expect(reach(st.waves, 30)).toBe(0);
  });

  it('GDD 9.5: 무전략 봇 저지선은 웨이브 18~25 (중앙값)', () => {
    const st = run('naive', GAMES, 2000);
    expect(st.stalls).toBe(0);
    expect(median(st.waves)).toBeGreaterThanOrEqual(18);
    expect(median(st.waves)).toBeLessThanOrEqual(25);
  });

  it('GDD 9.5: 최선 전략 봇은 25~35 구간에서 패배 (중앙값), 승리는 드물다', () => {
    const st = run('smart', GAMES, 3000);
    expect(st.stalls).toBe(0);
    expect(median(st.waves)).toBeGreaterThanOrEqual(25);
    expect(median(st.waves)).toBeLessThanOrEqual(35);
    expect(st.wins / GAMES).toBeLessThanOrEqual(0.2);
  });
}, 60000);
