import type { Suit } from '../systems/PokerEvaluator.ts';

export const COLORS = {
  bg: 0x0b0e14,
  panel: 0x141924,
  panelLine: 0x2a3140,
  track: 0x1c2331,
  trackLine: 0x34405a,
  cell: 0x10151f,
  cellLine: 0x232b3a,
  gold: 0xd4a941,
  goldLight: 0xf1d17a,
  text: '#e8e2d0',
  textDim: '#8f98a8',
  textMuted: '#4a5364',
  danger: 0xe0473f,
  disabled: 0x2a3140,
} as const;

export const SUIT_COLOR: Record<Suit, number> = {
  S: 0x9aa5b8, // 강철 군단
  H: 0xe56b7a, // 성소 교단
  D: 0xe8c34a, // 황금 상단
  C: 0x9b6be5, // 심연 마족
};
export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME: Record<Suit, string> = { S: '강철', H: '성소', D: '황금', C: '심연' };
/** 카드 표기: 하트/다이아는 빨강 */
export const SUIT_CARD_COLOR: Record<Suit, string> = { S: '#1b1f2a', H: '#c9303a', D: '#c9303a', C: '#1b1f2a' };

export const ENEMY_COLOR: Record<string, number> = {
  normal: 0x8a93a3,
  fast: 0x4fd1e0,
  armored: 0xb08050,
  regen: 0x5fcf7a,
  boss: 0xe0473f,
};

export const RANK_LABEL: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
export const rankLabel = (r: number): string => RANK_LABEL[r] ?? String(r);

/** 탭으로 인정하는 최대 이동 거리(px). 이보다 크면 스와이프로 본다 */
export const TAP_SLOP = 24;

export const CLASS_NAME: Record<string, string> = { raider: '약탈자', destroyer: '파괴병기', saint: '성령체', arcanist: '술법체', transcendent: '초월체' };

export const FONT = 'Helvetica Neue, Apple SD Gothic Neo, Noto Sans KR, sans-serif';

export const HAND_NAME: Record<number, string> = {
  0: '하이카드', 1: '원페어', 2: '투페어', 3: '트리플', 4: '스트레이트',
  5: '플러시', 6: '풀하우스', 7: '포카드', 8: '스트레이트 플러시', 9: '로열 스트레이트 플러시',
};
