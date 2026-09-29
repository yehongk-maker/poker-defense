/** 광고 서비스 싱글턴. 지금은 스텁(항상 시청 완료) — Phase 5에 AdMob 구현으로 교체한다 */
import { StubAdService, type AdService } from './systems/Ads.ts';

let instance: AdService | null = null;
export function getAds(): AdService {
  if (!instance) instance = new StubAdService();
  return instance;
}
export function setAds(a: AdService): void {
  instance = a;
}
