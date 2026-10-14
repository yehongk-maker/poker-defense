/** JSON 데이터 → GameData 조립 (Vite JSON import). 테스트/시뮬은 fs로 읽으므로 이 파일은 씬 전용. */
import unitsJson from './units.json';
import handsJson from './hands.json';
import synergiesJson from './synergies.json';
import heroesJson from './heroes.json';
import wavesJson from './waves.json';
import configJson from './config.json';
import duelJson from './duel.json';
import duelWavesJson from './duel-waves.json';
import type { GameData } from '../systems/GameLoop.ts';
import type { DuelConfig } from '../systems/Betting.ts';
import type { ModeSources, WaveSet } from '../systems/GameMode.ts';
import type { InterstitialConfig, RewardedAdsConfig } from '../systems/Ads.ts';
import type { RankingConfig } from '../systems/Ranking.ts';
import rankingJson from './ranking.json';

/** 모드별 데이터 조립 재료 (GameMode.buildGameData 입력): 캠페인 기본 데이터 + 대전 20웨이브 곡선 + 매치 규칙 */
export function loadModeSources(): ModeSources {
  const duelWaves: WaveSet = {
    waves: duelWavesJson.waves as unknown as WaveSet['waves'],
    enemyTypes: duelWavesJson.enemyTypes as WaveSet['enemyTypes'],
    battleConfig: duelWavesJson.config as WaveSet['battleConfig'],
  };
  return { base: loadGameData(), duelWaves, duelMatch: loadDuelConfig().match };
}

/** 전면 광고 규칙 (config.json monetization.interstitial) */
export function loadInterstitial(): InterstitialConfig {
  return (configJson as unknown as { monetization: { interstitial: InterstitialConfig } }).monetization.interstitial;
}

/** 보상형 광고 수치 (config.json monetization.rewardedAds) */
export function loadRewardedAds(): RewardedAdsConfig {
  return (configJson as unknown as { monetization: { rewardedAds: RewardedAdsConfig } }).monetization.rewardedAds;
}

/** 랭크 티어·리더보드 표시 규칙 (ranking.json) */
export function loadRanking(): RankingConfig {
  return rankingJson as unknown as RankingConfig;
}

/** 1:1 판돈 걸기 설정 (duel.json) */
export function loadDuelConfig(): DuelConfig {
  return duelJson as unknown as DuelConfig;
}

export function loadGameData(): GameData {
  return {
    units: unitsJson.units as unknown as GameData['units'],
    hands: handsJson as unknown as GameData['hands'],
    synergies: synergiesJson as unknown as GameData['synergies'],
    heroes: heroesJson.heroes as unknown as GameData['heroes'],
    waves: wavesJson.waves as unknown as GameData['waves'],
    enemyTypes: wavesJson.enemyTypes as GameData['enemyTypes'],
    battleConfig: wavesJson.config as GameData['battleConfig'],
    config: configJson as unknown as GameData['config'],
  };
}
