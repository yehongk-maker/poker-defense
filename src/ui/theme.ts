/**
 * 디자인 토큰 — DESIGN.md §1. 모든 UI는 이 파일의 색·폰트·크기만 쓴다 (임의 값 금지).
 * 하위 호환: 기존 코드가 쓰는 COLORS(문자열/숫자 혼합)는 새 팔레트로 매핑해 둔다.
 */
import type { Suit } from '../systems/PokerEvaluator.ts';

export const COLOR = {
  // 월드 배경
  skyTop: 0x54b2f0, skyBottom: 0x2f6fc9,      // 솔로 모드 배경 그라디언트
  duelTop: 0x4a2f8f, duelBottom: 0x1c1242,    // 듀얼 모드 배경 (퍼플 월드)
  navy: 0x17356b, navyDark: 0x0f2450,         // 패널/탭바
  fieldGrass: 0x57a94a, fieldEdge: 0x3f8a35,  // 필드
  trackSand: 0xd9c493, trackEdge: 0xa8895a,   // 트랙(길)

  // 버튼 (역할 고정 — DESIGN §3)
  gold: 0xffc93c, goldDark: 0xc78f12,
  green: 0x63d024, greenDark: 0x3e9410,
  purple: 0x9b5be8, purpleDark: 0x6a35ad,
  red: 0xff5757, redDark: 0xc02c2c,
  gray: 0x8e9bb3, grayDark: 0x525d73,
  blue: 0x4a9de8, blueDark: 0x1d4a97,

  // 수트(종족)
  suitS: 0x46586f, suitH: 0xef476f, suitD: 0xf0a020, suitC: 0x7b4fe0,

  // 텍스트
  textMain: 0xffffff, textSub: 0x9db4dd, textGold: 0xffe45e,
  textOnGold: 0x5b3c00, damageNum: 0xffe45e, critNum: 0xff8f4a,

  // 오버레이
  dim: 0x060c1c,          // alpha 0.72
  hudBg: 0x0a193c,        // alpha 0.55
  modalBorder: 0x5a76b4,  // DESIGN §4 Modal 보더
  starOff: 0x3d5586,      // DESIGN §5-05 미획득 별
  defeatTop: 0x2a3350, defeatBottom: 0x10152a, // DESIGN §5-06 패배 배경
} as const;

export const ALPHA = { dim: 0.72, hudBg: 0.55, emptySlot: 0.14, sub: 0.85 } as const;

export const FONT = {
  display: "'Jua', 'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif", // 타이틀·버튼·큰 숫자
  body: "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif",          // 설명·수치·시스템 텍스트
} as const;

export const SIZE = {
  // 타입 스케일 (1080 기준 px)
  h1: 64, h2: 44, button: 40, buttonSub: 20, body: 28, caption: 22, tiny: 18,
  // 레이아웃
  gutter: 32, radiusPanel: 36, radiusButton: 28, radiusCard: 14,
  btnShadow: 12,
  tabbarH: 150, topbarY: 60,
  cardW: 132, cardH: 184,
  slotSize: 88, foeSize: 56, timerD: 120,
  trackW: 36,        // DESIGN §2 모래 트랙 두께
  btnL: 120, btnM: 96, btnS: 72, // DESIGN §3 버튼 높이
  pressDy: 8,        // 눌림 이동량
} as const;

/** 0xRRGGBB → '#rrggbb' (Phaser Text 색상용) */
export const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** 게임 내 텍스트 기본: 흰색 + 다크 아웃라인 4px (DESIGN §1) */
export const OUTLINE = { stroke: hex(COLOR.navyDark), strokeThickness: 4 } as const;

// ── 하위 호환 팔레트 (기존 UI 코드용) — 전부 위 토큰에서 파생 ──
export const COLORS = {
  bg: COLOR.navyDark,
  panel: COLOR.navy,
  panelLine: COLOR.modalBorder,
  track: COLOR.trackSand,
  trackLine: COLOR.trackEdge,
  cell: COLOR.fieldEdge,
  cellLine: COLOR.fieldGrass,
  gold: COLOR.gold,
  goldLight: COLOR.textGold,
  text: hex(COLOR.textMain),
  textDim: hex(COLOR.textSub),
  textMuted: hex(COLOR.gray),
  textGold: hex(COLOR.textGold),
  danger: COLOR.red,
  disabled: COLOR.grayDark,
} as const;

export const SUIT_COLOR: Record<Suit, number> = { S: COLOR.suitS, H: COLOR.suitH, D: COLOR.suitD, C: COLOR.suitC };
/** 어두운(navy) 배경 위 수트 글자색: ♠ 슬레이트는 대비가 낮아 gray 토큰으로 대체 */
export const SUIT_TEXT_COLOR: Record<Suit, number> = { S: COLOR.gray, H: COLOR.suitH, D: COLOR.suitD, C: COLOR.suitC };
export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME: Record<Suit, string> = { S: '강철', H: '성소', D: '황금', C: '심연' };
/** 카드 글리프 색: 수트색 4색 덱 (DESIGN §4 HandCard) */
export const SUIT_CARD_COLOR: Record<Suit, string> = { S: hex(COLOR.suitS), H: hex(COLOR.suitH), D: hex(COLOR.suitD), C: hex(COLOR.suitC) };

/** 적 색 (placeholder). 공중 적은 퍼플 계열 — 1차 구분은 높이/그림자 (DESIGN §4 Foe) */
export const ENEMY_COLOR: Record<string, number> = {
  skeleton: COLOR.gray, wild_hound: COLOR.trackEdge, bone_knight: COLOR.grayDark, ghoul: COLOR.greenDark, fallen_spearman: COLOR.suitS,
  cave_bat: COLOR.purple, gargoyle: COLOR.purpleDark, wraith: COLOR.suitC, fallen_imp: COLOR.purple,
  bone_golem: COLOR.redDark, fallen_seraphim: COLOR.suitH, skeleton_lord: COLOR.red, specter_dragon: COLOR.purpleDark,
};
/** 유닛 공격 대상 배지 */
export const TARGET_LABEL: Record<string, string> = { ground: '지상', air: '공중', both: '' };

export const RANK_LABEL: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
export const rankLabel = (r: number): string => RANK_LABEL[r] ?? String(r);

/** 탭으로 인정하는 최대 이동 거리(px). 이보다 크면 스와이프로 본다 */
export const TAP_SLOP = 24;

export const RACE_NAME: Record<string, string> = { human: '휴먼', goblin: '고블린', monster: '몬스터', spirit: '정령' };
export const CLASS_NAME: Record<string, string> = { raider: '약탈자', destroyer: '파괴병기', saint: '성령체', arcanist: '술법체', transcendent: '초월체' };

export const HAND_NAME: Record<number, string> = {
  0: '하이카드', 1: '원페어', 2: '투페어', 3: '트리플', 4: '스트레이트',
  5: '플러시', 6: '풀하우스', 7: '포카드', 8: '스트레이트 플러시', 9: '로열 스트레이트 플러시',
};
