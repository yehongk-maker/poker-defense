/**
 * Ads — 보상형 광고 자리 (GDD §9.2). 순수 인터페이스 + 스텁.
 * 실제 SDK(AdMob)는 Phase 5에 AdService 구현만 바꿔 끼운다. 모든 자리는 opt-in(버튼을 눌러야 재생), 대전 모드에서는 쓰지 않는다.
 */
export type AdPlacement = 'extra_exchange' | 'revive' | 'double_reward';

export interface AdService {
  /** 광고를 끝까지 봤으면 true (보상 지급), 닫았거나 실패면 false */
  show(placement: AdPlacement): Promise<boolean>;
  /** 전면 광고 (게임오버 뒤에만 — InterstitialPolicy가 정한다). 보여 줬으면 true */
  showInterstitial(): Promise<boolean>;
  /** 광고 제거 구매자: 광고 없이 보상 자동 지급 (§9.3) */
  readonly autoGrant: boolean;
}

/** 개발용 스텁: 항상 시청 완료. 기록을 남겨 테스트에서 확인할 수 있다 */
export class StubAdService implements AdService {
  readonly shown: AdPlacement[] = [];
  constructor(readonly autoGrant = false, private result = true) {}
  readonly interstitials: number[] = [];
  show(placement: AdPlacement): Promise<boolean> {
    this.shown.push(placement);
    return Promise.resolve(this.result);
  }
  showInterstitial(): Promise<boolean> {
    this.interstitials.push(Date.now());
    return Promise.resolve(true);
  }
}

export interface InterstitialConfig { onlyAfterGameOver: boolean; capPerRuns: number }

/**
 * 전면 광고 규칙 (GDD §9.2, 순수): 캠페인 게임오버 뒤에만, capPerRuns판에 한 번. 대전·광고 제거 구매자는 없음.
 * 판 수는 호출 측이 저장한다 (runsSince).
 */
export function interstitialDecision(cfg: InterstitialConfig, e: { mode: 'campaign' | 'duel'; gameOver: boolean; adFree: boolean; runsSince: number }): { show: boolean; runsSince: number } {
  if (e.mode !== 'campaign' || e.adFree) return { show: false, runsSince: e.runsSince };
  if (cfg.onlyAfterGameOver && !e.gameOver) return { show: false, runsSince: e.runsSince };
  const n = e.runsSince + 1;
  if (n >= Math.max(1, cfg.capPerRuns)) return { show: true, runsSince: 0 };
  return { show: false, runsSince: n };
}

export interface RewardedAdsConfig {
  extraExchange: { enabled: boolean; grantExchanges: number };
  revive: { enabled: boolean; restoreLife: number; maxPerRun: number };
  doubleClearGold: { enabled: boolean; multiplier: number };
}

/** Google 공개 테스트 광고 단위 (테스트 광고만 나온다) */
export const TEST_AD_UNITS = { rewarded: 'ca-app-pub-3940256099942544/5224354917', interstitial: 'ca-app-pub-3940256099942544/1033173712' } as const;

export interface AdUnitIds { rewarded: string; interstitial: string; production: boolean }

/**
 * 빌드 환경 변수 → 광고 단위 ID. VITE_ADMOB_PRODUCTION=1 이고 ID가 있을 때만 실제 ID, 아니면 테스트 ID.
 * (개발 중 실제 광고를 보거나 누르면 AdMob 계정이 정지될 수 있다)
 */
export function adUnitIds(env: Record<string, string | undefined>): AdUnitIds {
  const production = env.VITE_ADMOB_PRODUCTION === '1';
  const rewarded = production ? env.VITE_ADMOB_REWARDED_ID?.trim() : '';
  const interstitial = production ? env.VITE_ADMOB_INTERSTITIAL_ID?.trim() : '';
  return {
    rewarded: rewarded || TEST_AD_UNITS.rewarded,
    interstitial: interstitial || TEST_AD_UNITS.interstitial,
    production: production && !!rewarded && !!interstitial,
  };
}
