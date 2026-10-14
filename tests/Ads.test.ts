/** 광고 규칙 (Phase 5): 전면 광고 빈도·자리, 광고 단위 ID 선택 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TEST_AD_UNITS, adUnitIds, interstitialDecision, type InterstitialConfig } from '../src/systems/Ads.ts';

const cfg: InterstitialConfig = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/data/config.json'), 'utf8')).monetization.interstitial;
const run = (runsSince: number, over: Partial<{ mode: 'campaign' | 'duel'; gameOver: boolean; adFree: boolean }> = {}) =>
  interstitialDecision(cfg, { mode: 'campaign', gameOver: true, adFree: false, runsSince, ...over });

describe('전면 광고 (GDD §9.2)', () => {
  it('설정: 게임오버 뒤에만, 3판에 한 번', () => {
    expect(cfg).toEqual({ onlyAfterGameOver: true, capPerRuns: 3 });
  });

  it('캠페인 게임오버 3판마다 한 번 보이고, 보이면 다시 센다', () => {
    let n = 0;
    const shown: boolean[] = [];
    for (let i = 0; i < 9; i++) { const d = run(n); shown.push(d.show); n = d.runsSince; }
    expect(shown).toEqual([false, false, true, false, false, true, false, false, true]);
  });

  it('대전·광고 제거 구매자·게임오버가 아닌 때는 보이지 않고 세지도 않는다', () => {
    expect(run(5, { mode: 'duel' })).toEqual({ show: false, runsSince: 5 });
    expect(run(5, { adFree: true })).toEqual({ show: false, runsSince: 5 });
    expect(run(1, { gameOver: false })).toEqual({ show: false, runsSince: 1 });
  });
});

describe('광고 단위 ID', () => {
  it('기본은 Google 테스트 ID', () => {
    expect(adUnitIds({})).toEqual({ ...TEST_AD_UNITS, production: false });
  });

  it('실제 ID는 production 플래그가 켜져 있고 두 ID가 모두 있을 때만', () => {
    const real = { VITE_ADMOB_REWARDED_ID: 'ca-app-pub-1/2', VITE_ADMOB_INTERSTITIAL_ID: 'ca-app-pub-1/3' };
    expect(adUnitIds(real)).toEqual({ ...TEST_AD_UNITS, production: false }); // 플래그 없음 → 테스트
    expect(adUnitIds({ ...real, VITE_ADMOB_PRODUCTION: '1' })).toEqual({ rewarded: 'ca-app-pub-1/2', interstitial: 'ca-app-pub-1/3', production: true });
    expect(adUnitIds({ VITE_ADMOB_PRODUCTION: '1', VITE_ADMOB_REWARDED_ID: 'ca-app-pub-1/2' }).production).toBe(false); // 하나라도 없으면 테스트 모드
  });
});
