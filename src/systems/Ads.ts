/**
 * Ads — 보상형 광고 자리 (GDD §9.2). 순수 인터페이스 + 스텁.
 * 실제 SDK(AdMob)는 Phase 5에 AdService 구현만 바꿔 끼운다. 모든 자리는 opt-in(버튼을 눌러야 재생), 대전 모드에서는 쓰지 않는다.
 */
export type AdPlacement = 'extra_exchange' | 'revive' | 'double_reward';

export interface AdService {
  /** 광고를 끝까지 봤으면 true (보상 지급), 닫았거나 실패면 false */
  show(placement: AdPlacement): Promise<boolean>;
  /** 광고 제거 구매자: 광고 없이 보상 자동 지급 (§9.3) */
  readonly autoGrant: boolean;
}

/** 개발용 스텁: 항상 시청 완료. 기록을 남겨 테스트에서 확인할 수 있다 */
export class StubAdService implements AdService {
  readonly shown: AdPlacement[] = [];
  constructor(readonly autoGrant = false, private result = true) {}
  show(placement: AdPlacement): Promise<boolean> {
    this.shown.push(placement);
    return Promise.resolve(this.result);
  }
}

export interface RewardedAdsConfig {
  extraExchange: { enabled: boolean; grantExchanges: number };
  revive: { enabled: boolean; restoreLife: number; maxPerRun: number };
  doubleClearGold: { enabled: boolean; multiplier: number };
}
