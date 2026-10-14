/**
 * Android 앱(Capacitor)일 때만 켜지는 것들: AdMob 광고, 뒤로 가기 버튼.
 * 웹(개발·브라우저)에서는 아무것도 하지 않는다.
 */
import type Phaser from 'phaser';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { setAds } from '../ads.ts';
import { AdMobAdService } from './admob.ts';
import { adUnitIds } from '../systems/Ads.ts';
import { SCENE } from '../config.ts';

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/** 씬이 뒤로 가기를 직접 처리하면 true를 돌려준다 */
export interface BackHandler { onBack(): boolean }

export function initNative(game: Phaser.Game): void {
  if (!isNativeApp()) return;
  setAds(new AdMobAdService(adUnitIds((import.meta as unknown as { env: Record<string, string | undefined> }).env)));
  let lastBackAt = 0;
  void App.addListener('backButton', () => {
    const active = game.scene.getScenes(true);
    const top = active[active.length - 1] as (Phaser.Scene & Partial<BackHandler>) | undefined;
    if (top?.onBack?.()) return;
    // 로비에서는 두 번 눌러 종료, 그 밖의 화면은 로비로
    if (!top || top.scene.key === SCENE.Lobby) {
      const now = Date.now();
      if (now - lastBackAt < 2500) void App.exitApp();
      else { lastBackAt = now; (top as { showToast?: (m: string) => void } | undefined)?.showToast?.('한 번 더 누르면 종료돼요'); }
      return;
    }
    game.scene.getScenes(true).forEach((s) => game.scene.stop(s.scene.key));
    game.scene.start(SCENE.Lobby);
  });
}
