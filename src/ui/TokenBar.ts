import Phaser from 'phaser';
import { GAME_WIDTH } from '../config.ts';
import { SIZE } from './theme.ts';
import { ResourcePill } from './ResourcePill.ts';

export interface TokenValues {
  hearts: number;
  heartsMax: number;
  gold: number;
  heroTokens: number;
  heroTokensMax: number;
  diamonds: number;
}

/** 토큰 바 높이 (상단 세이프에어리어 + 알약) */
export const TOKEN_BAR_H = SIZE.topbarY + 28;

/**
 * 최상단 고정 토큰 바 (GDD 3.8, DESIGN §4 ResourcePill): 하트 · 골드 · 영웅 토큰 · 다이아 알약 4개를 항상 같은 자리에.
 * 값이 바뀌면 해당 알약이 잠깐 커졌다 돌아온다.
 */
const PILL_LAYOUT = (() => {
  const w = 236, gap = 16;
  return { w, gap, x0: (GAME_WIDTH - (4 * w + 3 * gap)) / 2 + w / 2, y: SIZE.topbarY };
})();
/** 골드 알약의 동전 아이콘 위치 (코인 파티클이 날아가는 곳) */
export const GOLD_ICON = { x: PILL_LAYOUT.x0 + (PILL_LAYOUT.w + PILL_LAYOUT.gap) - PILL_LAYOUT.w / 2 + 28, y: PILL_LAYOUT.y };

export class TokenBar {
  private pills: { hearts: ResourcePill; gold: ResourcePill; heroTokens: ResourcePill; diamonds: ResourcePill };

  constructor(scene: Phaser.Scene) {
    const { w, gap, x0, y } = PILL_LAYOUT;
    const mk = (i: number, icon: 'heart' | 'coin' | 'token' | 'gem') => new ResourcePill(scene, x0 + i * (w + gap), y, icon, w, 56).setDepth(6);
    this.pills = { hearts: mk(0, 'heart'), gold: mk(1, 'coin'), heroTokens: mk(2, 'token'), diamonds: mk(3, 'gem') };
  }

  set(v: TokenValues): void {
    this.pills.hearts.setValue(`${v.hearts} / ${v.heartsMax}`, v.hearts).setDanger(v.hearts <= 3);
    this.pills.gold.setValue(`${Math.floor(v.gold)}`, Math.floor(v.gold));
    this.pills.heroTokens.setValue(`${v.heroTokens} / ${v.heroTokensMax}`, v.heroTokens);
    this.pills.diamonds.setValue(`${v.diamonds}`, v.diamonds);
  }
}
