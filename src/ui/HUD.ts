import Phaser from 'phaser';
import type { GameLoop } from '../systems/GameLoop.ts';
import { GAME_WIDTH } from '../config.ts';
import { ALPHA, COLOR, FONT, OUTLINE, SIZE, SUIT_COLOR, SUIT_SYMBOL, TAP_SLOP, hex } from './theme.ts';
import { TokenBar } from './TokenBar.ts';
import { starPath } from './draw.ts';
import type { Suit } from '../systems/PokerEvaluator.ts';

/** 상대 바·라운드 바 중심 y (토큰 알약 바로 아래) */
export const HUD_ROW_Y = 128;

/**
 * 상단 HUD (DESIGN §5-02/03): 최상단 재화 알약(TokenBar) + hudBg 알약 바 한 줄
 *  [상대 아바타 · 상대 라운드/하트/교환 | 라운드 N/40 (Jua 골드) | 페이즈 · 유닛 수 · 도감]
 */
export class HUD {
  private oppText: Phaser.GameObjects.Text;
  private roundText: Phaser.GameObjects.Text;
  private phaseText: Phaser.GameObjects.Text;
  readonly tokens: TokenBar;
  /** 상대 말풍선 기준점 (씬 좌표) */
  readonly opponentAnchor = { x: SIZE.gutter + 40, y: HUD_ROW_Y + 34 };

  /**
   * @param opponentAvatar 대전이면 상대 아바타 수트, 캠페인(상대 없음)이면 null → 같은 자리에 내 최고 기록
   */
  constructor(scene: Phaser.Scene, onOpenCodex?: () => void, opponentAvatar: Suit | null = null) {
    this.tokens = new TokenBar(scene);
    const y = HUD_ROW_Y, h = 64;
    const g = scene.add.graphics().setDepth(7); // HUD는 트랙 윗줄의 적(보스·공중)보다 위
    g.fillStyle(COLOR.navyDark, 0.92).fillRoundedRect(SIZE.gutter / 2, y - h / 2, GAME_WIDTH - SIZE.gutter, h, h / 2);
    const ax = SIZE.gutter / 2 + h / 2;
    if (opponentAvatar) {
      // 상대 아바타: 수트색 원 + 수트 글리프 (사람·대체 상대 구분 없이 같은 모양)
      g.fillStyle(COLOR.navyDark).fillCircle(ax, y, 29);
      g.fillStyle(SUIT_COLOR[opponentAvatar]).fillCircle(ax, y - 1, 25);
      g.fillStyle(0xffffff, 0.25).fillCircle(ax - 8, y - 10, 9);
      scene.add.text(ax, y, SUIT_SYMBOL[opponentAvatar], { fontSize: '30px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5).setDepth(7);
    } else {
      // 캠페인: 기록 별
      g.fillStyle(COLOR.goldDark).fillCircle(ax, y, 28);
      g.fillStyle(COLOR.gold).fillCircle(ax, y - 2, 24);
      starPath(g, ax, y - 1, 15, 7, COLOR.textOnGold);
    }
    this.oppText = scene.add.text(ax + 38, y, '', { fontSize: `${SIZE.caption}px`, color: hex(COLOR.textMain), fontFamily: FONT.body, fontStyle: '700', ...OUTLINE, strokeThickness: 3 }).setOrigin(0, 0.5).setDepth(7);
    this.roundText = scene.add.text(GAME_WIDTH / 2 + 30, y, '', { fontSize: `${SIZE.h2}px`, color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE, strokeThickness: 5 }).setOrigin(0.5).setDepth(7);
    this.phaseText = scene.add.text(GAME_WIDTH - SIZE.gutter - 104, y, '', { fontSize: `${SIZE.caption}px`, color: hex(COLOR.textSub), fontFamily: FONT.body, fontStyle: '700', align: 'right' }).setOrigin(1, 0.5).setDepth(7);
    // 도감 버튼 (작은 블루 알약)
    const bx = GAME_WIDTH - SIZE.gutter - 50;
    const b = scene.add.graphics().setDepth(7);
    b.fillStyle(COLOR.blueDark).fillRoundedRect(bx - 46, y - 22 + 4, 92, 44, 22);
    b.fillStyle(COLOR.blue).fillRoundedRect(bx - 46, y - 22, 92, 44, 22);
    scene.add.text(bx, y - 1, '도감', { fontSize: '24px', color: hex(COLOR.textMain), fontFamily: FONT.display, stroke: hex(COLOR.blueDark), strokeThickness: 4 }).setOrigin(0.5).setDepth(7);
    if (onOpenCodex) {
      const z = scene.add.zone(bx, y, 110, 64).setDepth(7).setInteractive({ useHandCursor: true });
      z.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < TAP_SLOP) onOpenCodex(); });
    }
  }

  /** 상대 요약 (1:1 대결) */
  setOpponent(text: string): void {
    this.oppText.setText(text);
    const maxW = GAME_WIDTH / 2 - 150 - this.oppText.x + 60;
    this.oppText.setScale(this.oppText.width > maxW ? maxW / this.oppText.width : 1);
  }

  refresh(loop: GameLoop, totalWaves: number, tokens?: { diamonds: number; heartsMax: number; heroTokensMax: number }): void {
    this.roundText.setText(`라운드 ${loop.wave}/${totalWaves}`);
    if (tokens) {
      // 영웅 조각: 가장 가까운 영웅의 진행도 (해당 종류 + 와일드, 무료 소환권이면 만땅)
      const best = loop.hasFreeHeroSummon ? tokens.heroTokensMax : Math.max(0, ...loop.heroProgress.map((p) => Math.min(p.need, p.typed + p.wild)));
      this.tokens.set({ hearts: loop.life, heartsMax: tokens.heartsMax, gold: loop.gold, heroTokens: best, heroTokensMax: tokens.heroTokensMax, diamonds: tokens.diamonds });
    }
    const phase: Record<string, string> = { card: '카드 선택', manage: '정비', combat: '전투 중', victory: '승리!', defeat: '패배' };
    this.phaseText.setText(`${phase[loop.phase] ?? loop.phase}\n유닛 ${loop.units.length}/25`);
  }
}
