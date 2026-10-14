/** 광고 서비스 싱글턴. 웹(개발)은 스텁(항상 시청 완료), Android 앱은 native.ts가 AdMob 구현으로 바꿔 끼운다 */
import { StubAdService, interstitialDecision, type AdService, type InterstitialConfig } from './systems/Ads.ts';

let instance: AdService | null = null;
export function getAds(): AdService {
  if (!instance) instance = new StubAdService();
  return instance;
}
export function setAds(a: AdService): void {
  instance = a;
}

const RUNS_KEY = 'poker-defense.ads.v1';

/** 캠페인 판이 끝났을 때: 규칙에 맞으면 전면 광고를 보여 준다 (판 수는 기기에 저장) */
export async function maybeInterstitial(cfg: InterstitialConfig, e: { mode: 'campaign' | 'duel'; gameOver: boolean; adFree: boolean }): Promise<boolean> {
  let runsSince = 0;
  try { runsSince = Math.max(0, Number(JSON.parse(localStorage.getItem(RUNS_KEY) ?? '{}').runsSince) || 0); } catch { /* 처음 */ }
  const d = interstitialDecision(cfg, { ...e, runsSince });
  try { localStorage.setItem(RUNS_KEY, JSON.stringify({ runsSince: d.runsSince })); } catch { /* 무시 */ }
  if (!d.show) return false;
  return getAds().showInterstitial().catch(() => false);
}
