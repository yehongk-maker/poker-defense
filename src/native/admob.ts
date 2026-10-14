/**
 * AdMob 광고 (Android 앱 전용). systems/Ads의 AdService 구현.
 * 광고 단위 ID는 빌드 환경 변수(VITE_ADMOB_*)로 받고, 없으면 Google 공개 테스트 ID — 테스트 광고만 나온다.
 * 실제 ID로 바꾸기 전에는 VITE_ADMOB_PRODUCTION을 켜지 않는다 (자기 광고를 누르면 계정 정지 위험).
 */
import { AdMob, AdmobConsentStatus, RewardAdPluginEvents, InterstitialAdPluginEvents } from '@capacitor-community/admob';
import type { PluginListenerHandle } from '@capacitor/core';
import type { AdPlacement, AdService, AdUnitIds } from '../systems/Ads.ts';

/** 한 광고를 기다리는 최대 시간(ms) — 넘으면 실패로 보고 보상 없이 돌아온다 */
const SHOW_TIMEOUT = 120_000;
/** 광고 불러오기 최대 시간(ms). SDK 기본은 60초 이상 — 플레이어가 그만큼 기다리게 두지 않는다 */
const LOAD_TIMEOUT = 15_000;
/** 미리 불러오기에 실패하면 이만큼 기다렸다 다시 (초) — 계속 실패하면 마지막 값으로 */
const RETRY_SEC = [10, 30, 60, 120];

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ad_load_timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}


/**
 * 광고는 미리 불러 둔다 (preload): 버튼을 누르면 바로 재생되고, 다 본 뒤에는 다음 광고를 다시 불러 둔다.
 * 아직 못 불렀으면 LOAD_TIMEOUT까지만 기다리고 실패로 돌아온다.
 */
export class AdMobAdService implements AdService {
  readonly autoGrant = false;
  private ready: Promise<boolean>;
  private rewarded: Promise<boolean> | null = null;
  private interstitial: Promise<boolean> | null = null;
  private retries = { rewarded: 0, interstitial: 0 };
  private retryTimer: Record<'rewarded' | 'interstitial', ReturnType<typeof setTimeout> | null> = { rewarded: null, interstitial: null };
  /** 마지막 실패 이유 (화면 안내용) */
  lastError: string | null = null;

  constructor(private ids: AdUnitIds) {
    this.ready = this.init();
    void this.ready.then((ok) => { if (ok) { this.preloadRewarded(); this.preloadInterstitial(); } });
  }

  /** SDK 초기화 + 동의(UMP): 동의가 필요한 지역이면 동의 창을 띄운다 */
  private async init(): Promise<boolean> {
    try {
      await AdMob.initialize({ initializeForTesting: !this.ids.production });
      const info = await AdMob.requestConsentInfo();
      if (info.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) {
        const after = await AdMob.showConsentForm();
        return after.canRequestAds;
      }
      return info.canRequestAds;
    } catch (e) {
      this.lastError = String((e as Error)?.message ?? e);
      return false;
    }
  }

  private preloadRewarded(): void {
    this.rewarded = AdMob.prepareRewardVideoAd({ adId: this.ids.rewarded, isTesting: !this.ids.production })
      .then(() => { this.retries.rewarded = 0; return true; }, (e) => { this.lastError = String((e as Error)?.message ?? e); this.rewarded = null; this.retryLater('rewarded'); return false; });
  }

  private preloadInterstitial(): void {
    this.interstitial = AdMob.prepareInterstitial({ adId: this.ids.interstitial, isTesting: !this.ids.production })
      .then(() => { this.retries.interstitial = 0; return true; }, () => { this.interstitial = null; this.retryLater('interstitial'); return false; });
  }

  /** 불러오기 실패: 점점 길게 기다렸다 다시 불러 둔다 (네트워크가 잠깐 끊긴 경우) */
  private retryLater(kind: 'rewarded' | 'interstitial'): void {
    if (this.retryTimer[kind]) return;
    const sec = RETRY_SEC[Math.min(this.retries[kind], RETRY_SEC.length - 1)];
    this.retries[kind]++;
    this.retryTimer[kind] = setTimeout(() => {
      this.retryTimer[kind] = null;
      if ((kind === 'rewarded' ? this.rewarded : this.interstitial) === null) {
        if (kind === 'rewarded') this.preloadRewarded(); else this.preloadInterstitial();
      }
    }, sec * 1000);
  }

  /** 미리 불러 둔 광고를 LOAD_TIMEOUT까지 기다린다. 없거나 실패했으면 새로 부른다 */
  private async loaded(kind: 'rewarded' | 'interstitial'): Promise<boolean> {
    if (!(await this.ready)) return false;
    if (kind === 'rewarded' ? !this.rewarded : !this.interstitial) {
      if (kind === 'rewarded') this.preloadRewarded(); else this.preloadInterstitial();
    }
    const p = kind === 'rewarded' ? this.rewarded! : this.interstitial!;
    try { return await withTimeout(p, LOAD_TIMEOUT); } catch { return false; }
  }

  async show(_placement: AdPlacement): Promise<boolean> {
    if (!(await this.loaded('rewarded'))) return false;
    this.rewarded = null; // 한 번 보여 준 광고는 다시 쓸 수 없다
    // 보상은 Rewarded 이벤트로만 준다 — 끝까지 보지 않고 닫으면 Dismissed만 온다
    const result = await new Promise<boolean>((resolve) => {
      let earned = false;
      const subs: Promise<PluginListenerHandle>[] = [];
      const done = (v: boolean) => { clearTimeout(timer); subs.forEach((s) => void s.then((h) => h.remove())); resolve(v); };
      const timer = setTimeout(() => done(earned), SHOW_TIMEOUT);
      subs.push(AdMob.addListener(RewardAdPluginEvents.Rewarded, () => { earned = true; }));
      subs.push(AdMob.addListener(RewardAdPluginEvents.Dismissed, () => done(earned)));
      subs.push(AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => done(false)));
      AdMob.showRewardVideoAd().then(() => { earned = true; }).catch(() => done(false));
    });
    this.preloadRewarded();
    return result;
  }

  async showInterstitial(): Promise<boolean> {
    if (!(await this.loaded('interstitial'))) return false;
    this.interstitial = null;
    const result = await new Promise<boolean>((resolve) => {
      const subs: Promise<PluginListenerHandle>[] = [];
      const done = (v: boolean) => { clearTimeout(timer); subs.forEach((s) => void s.then((h) => h.remove())); resolve(v); };
      const timer = setTimeout(() => done(false), SHOW_TIMEOUT);
      subs.push(AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => done(true)));
      subs.push(AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, () => done(false)));
      AdMob.showInterstitial().catch(() => done(false));
    });
    this.preloadInterstitial();
    return result;
  }
}
