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

describe('대전 모드(20웨이브) 밸런스 목표 (봇 60판, docs/mode-design.md §8)', () => {
  it('하이카드 봇 저지선 7~10, 무전략 11~14, 최선 15~19에 승리 20% 이하', () => {
    const hc = run('highcard', GAMES, 4000, 'duel');
    expect(hc.stalls).toBe(0);
    expect(median(hc.waves)).toBeGreaterThanOrEqual(7);
    expect(median(hc.waves)).toBeLessThanOrEqual(10);
    const nv = run('naive', GAMES, 5000, 'duel');
    expect(median(nv.waves)).toBeGreaterThanOrEqual(11);
    expect(median(nv.waves)).toBeLessThanOrEqual(14);
    const sm = run('smart', GAMES, 6000, 'duel');
    expect(median(sm.waves)).toBeGreaterThanOrEqual(15);
    expect(median(sm.waves)).toBeLessThanOrEqual(19);
    expect(sm.wins / GAMES).toBeLessThanOrEqual(0.2);
  });
}, 120000);
