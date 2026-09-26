import Phaser from 'phaser';
import { HandRank } from '../systems/PokerEvaluator.ts';
import { GAME_WIDTH } from '../config.ts';
import { COLOR, FONT, OUTLINE, HAND_NAME, hex } from './theme.ts';

/**
 * 족보 등급별 연출 (GDD Phase 4 "족보 달성 연출 — 플러시 이상은 화려하게").
 *  tier 0 하이카드          : 회색, 연출 없음
 *  tier 1 원페어            : 흰색, 작은 팝
 *  tier 2 투페어·트리플      : 금색 + 맥동, 팝 + 불꽃 소량
 *  tier 3 스트레이트·플러시  : 하늘색 + 광채, 불꽃 + 링 + 흔들림
 *  tier 4 풀하우스·포카드    : 분홍 + 강한 광채, 큰 불꽃 + 플래시
 *  tier 5 스플·로열         : 무지개 색 순환, 이중 링 + 긴 불꽃
 */
export const RANK_TIER: Record<HandRank, number> = {
  [HandRank.HighCard]: 0,
  [HandRank.OnePair]: 1,
  [HandRank.TwoPair]: 2,
  [HandRank.ThreeOfAKind]: 2,
  [HandRank.Straight]: 3,
  [HandRank.Flush]: 3,
  [HandRank.FullHouse]: 4,
  [HandRank.FourOfAKind]: 4,
  [HandRank.StraightFlush]: 5,
  [HandRank.RoyalStraightFlush]: 5,
};

export interface TierStyle {
  color: string;
  fontSize: number;
  stroke?: string;
  strokeWidth?: number;
  glow?: string;
  /** 맥동 주기(ms). 0이면 없음 */
  pulseMs: number;
  /** 불꽃 색상 팔레트 */
  sparks: number[];
}

export const TIER_STYLE: TierStyle[] = [
  // DESIGN 토큰 기반: 흰 글자 + 다크 아웃라인이 기본, 등급이 오를수록 골드 → 블루 광채 → 핑크 → 무지개
  { color: hex(COLOR.textSub), fontSize: 40, stroke: hex(COLOR.navyDark), strokeWidth: 4, pulseMs: 0, sparks: [] },
  { color: hex(COLOR.textMain), fontSize: 46, stroke: hex(COLOR.navyDark), strokeWidth: 5, pulseMs: 0, sparks: [COLOR.textMain] },
  { color: hex(COLOR.textGold), fontSize: 52, stroke: hex(COLOR.goldDark), strokeWidth: 6, pulseMs: 1400, sparks: [COLOR.textGold, COLOR.gold] },
  { color: hex(COLOR.textMain), fontSize: 58, stroke: hex(COLOR.blueDark), strokeWidth: 7, glow: hex(COLOR.blue), pulseMs: 1000, sparks: [COLOR.blue, COLOR.textMain, COLOR.textGold] },
  { color: hex(COLOR.textMain), fontSize: 64, stroke: hex(COLOR.purpleDark), strokeWidth: 8, glow: hex(COLOR.suitH), pulseMs: 700, sparks: [COLOR.suitH, COLOR.purple, COLOR.textGold, COLOR.textMain] },
  { color: hex(COLOR.textMain), fontSize: 72, stroke: hex(COLOR.purpleDark), strokeWidth: 9, glow: hex(COLOR.textMain), pulseMs: 450, sparks: [COLOR.red, COLOR.critNum, COLOR.textGold, COLOR.green, COLOR.blue, COLOR.purple] },
];

const RAINBOW = ['#ff6b6b', '#ffb36b', '#fff36b', '#8dff6b', '#6bf0ff', '#8d6bff', '#ff6bd6'];

/** 등급 스타일을 텍스트에 적용 (라이브 라벨·연출 텍스트 공용) */
export function applyTierStyle(text: Phaser.GameObjects.Text, tier: number, sizeScale = 1): void {
  const st = TIER_STYLE[tier];
  text.setFontSize(Math.round(st.fontSize * sizeScale)).setColor(st.color);
  if (st.stroke) text.setStroke(st.stroke, st.strokeWidth ?? 4);
  else text.setStroke('#000000', 0);
  if (st.glow) text.setShadow(0, 0, st.glow, 16 + tier * 4, true, true);
  else text.setShadow(0, 0, '#000000', 0, false, false);
}

/** 텍스트가 maxWidth를 넘으면 폰트를 줄여 맞춘다 (긴 족보명: "로열 스트레이트 플러시") */
export function fitTextWidth(text: Phaser.GameObjects.Text, maxWidth: number, minSize = 26): void {
  let size = parseInt(String(text.style.fontSize), 10) || 40;
  while (text.width > maxWidth && size > minSize) {
    size -= 2;
    text.setFontSize(size);
  }
}

/** tier 5용 무지개 색 순환 — 매 프레임 호출 */
export function rainbowColor(timeMs: number): string {
  return RAINBOW[Math.floor(timeMs / 120) % RAINBOW.length];
}

export class HandFx {
  constructor(private scene: Phaser.Scene, private depth = 15) {}

  /**
   * 족보 확정/향상 연출. big=true면 화면 중앙(트랙 위) 큰 연출, false면 패 위 작은 연출.
   */
  celebrate(rank: HandRank, x: number, y: number, big: boolean): void {
    const tier = RANK_TIER[rank];
    const st = TIER_STYLE[tier];
    const scale = big ? 1.6 : 1;

    // 1) 텍스트 팝 (원페어 이상)
    if (tier >= 1) {
      const label = `${HAND_NAME[rank]}!`;
      const t = this.scene.add.text(x, y, label, { fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5).setDepth(this.depth + 1);
      applyTierStyle(t, tier, scale);
      fitTextWidth(t, GAME_WIDTH - 120);
      t.setScale(0.4).setAlpha(0);
      this.scene.tweens.add({ targets: t, scale: 1.15, alpha: 1, duration: 220, ease: 'Back.easeOut' });
      this.scene.tweens.add({ targets: t, scale: 1, duration: 200, delay: 220 });
      const hold = 500 + tier * 250;
      this.scene.tweens.add({ targets: t, alpha: 0, y: y - 60, duration: 500, delay: hold, onComplete: () => t.destroy() });
      if (tier >= 5) {
        const ev = this.scene.time.addEvent({ delay: 60, loop: true, callback: () => t.active && t.setColor(rainbowColor(this.scene.time.now)) });
        this.scene.time.delayedCall(hold + 500, () => ev.remove());
      }
    }

    // 2) 불꽃 (투페어 이상): 개수·반경·크기가 등급에 비례
    if (tier >= 2) {
      const count = 10 + tier * 10;
      const radius = (60 + tier * 60) * scale;
      this.sparks(x, y, count, radius, st.sparks, 600 + tier * 220, 4 + tier * 2);
    }

    // 3) 링 (스트레이트 이상), 이중 링 (스플 이상)
    if (tier >= 3) {
      this.ring(x, y, st.sparks[0], 220 * scale, 600);
      if (tier >= 5) this.scene.time.delayedCall(180, () => this.ring(x, y, st.sparks[3] ?? 0xffffff, 320 * scale, 800));
    }

    // 4) 카메라: 흔들림 (스트레이트 이상), 플래시 (풀하우스 이상)
    if (big && tier >= 3) this.scene.cameras.main.shake(150 + tier * 60, 0.002 + tier * 0.001);
    if (big && tier >= 4) this.scene.cameras.main.flash(160 + tier * 40, 255, 255, 255);

    // 5) 스플·로열: 늦게 터지는 2차 불꽃
    if (tier >= 5) {
      this.scene.time.delayedCall(300, () => this.sparks(x, y, 48, 420 * scale, st.sparks, 1300, 10));
    }
  }

  private sparks(x: number, y: number, count: number, radius: number, palette: number[], duration: number, size: number): void {
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const dist = radius * (0.6 + Math.random() * 0.6);
      const color = palette[i % palette.length];
      const r = size * (0.5 + Math.random());
      const s = Math.random() < 0.3
        ? this.scene.add.star(x, y, 4, r * 0.5, r, color)
        : this.scene.add.circle(x, y, r, color);
      s.setDepth(this.depth);
      this.scene.tweens.add({
        targets: s,
        x: x + Math.cos(ang) * dist,
        y: y + Math.sin(ang) * dist - 30,
        alpha: 0,
        scale: 0.2,
        angle: 180,
        duration: duration * (0.7 + Math.random() * 0.5),
        ease: 'Cubic.easeOut',
        onComplete: () => s.destroy(),
      });
    }
  }

  private ring(x: number, y: number, color: number, radius: number, duration: number): void {
    const ring = this.scene.add.circle(x, y, 20).setStrokeStyle(6, color).setDepth(this.depth);
    ring.setFillStyle(color, 0);
    this.scene.tweens.add({
      targets: ring,
      scale: radius / 20,
      alpha: 0,
      duration,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }
}

/** 화면 중앙(트랙 영역) 연출 좌표 */
export const FX_CENTER = { x: GAME_WIDTH / 2, y: 690 };
