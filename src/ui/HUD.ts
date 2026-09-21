import Phaser from 'phaser';
import type { GameLoop } from '../systems/GameLoop.ts';
import { GAME_WIDTH } from '../config.ts';
import { COLORS, FONT } from './theme.ts';
import { TokenBar, TOKEN_BAR_H } from './TokenBar.ts';

/** 상단 HUD: 최상단 고정 토큰 바(하트·골드·영웅 토큰·다이아) + 라운드 / 상대 / 페이즈 + 유닛·시너지 개수·영웅 */
export class HUD {
  private main: Phaser.GameObjects.Text;
  private sub: Phaser.GameObjects.Text;
  private phaseText: Phaser.GameObjects.Text;
  private codexBtn: Phaser.GameObjects.Text;
  private oppText: Phaser.GameObjects.Text;
  private roundText: Phaser.GameObjects.Text;
  readonly tokens: TokenBar;

  constructor(private scene: Phaser.Scene, onOpenCodex?: () => void) {
    scene.add.rectangle(GAME_WIDTH / 2, 90, GAME_WIDTH, 180, COLORS.panel);
    this.tokens = new TokenBar(scene); // 최상단 0~64 고정
    const row1 = TOKEN_BAR_H + 40;   // 104
    const row2 = TOKEN_BAR_H + 90;   // 154
    // 상대 요약 (왼쪽), 현재 라운드 (중앙, 크게), 페이즈 (오른쪽)
    this.main = scene.add.text(40, row1, '', { fontSize: '26px', color: '#e0a0a0', fontFamily: FONT }).setOrigin(0, 0.5);
    this.roundText = scene.add.text(GAME_WIDTH / 2, row1, '', { fontSize: '48px', color: '#f1d17a', fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0.5);
    this.phaseText = scene.add.text(GAME_WIDTH - 40, row1, '', { fontSize: '30px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(1, 0.5);
    this.sub = scene.add.text(40, row2, '', { fontSize: '26px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(0, 0.5);
    // 시너지 도감 열기 (시너지 줄 탭 또는 버튼)
    this.codexBtn = scene.add.text(GAME_WIDTH - 40, row2, '📖 도감', { fontSize: '26px', color: '#8fe3ff', fontFamily: FONT }).setOrigin(1, 0.5);
    this.oppText = this.main; // 상대 요약은 왼쪽 row1
    if (onOpenCodex) {
      this.codexBtn.setInteractive({ useHandCursor: true }).on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 24) onOpenCodex(); });
      this.sub.setInteractive({ useHandCursor: true }).on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 24) onOpenCodex(); });
    }
  }

  /** 상대 요약 (1:1 대결) */
  setOpponent(text: string): void {
    this.oppText.setText(text);
  }

  refresh(loop: GameLoop, totalWaves: number, tokens?: { diamonds: number; heartsMax: number; heroTokensMax: number }): void {
    this.roundText.setText(`라운드 ${loop.wave} / ${totalWaves}`);
    if (tokens) {
      this.tokens.set({ hearts: loop.life, heartsMax: tokens.heartsMax, gold: loop.gold, heroTokens: loop.shards, heroTokensMax: tokens.heroTokensMax, diamonds: tokens.diamonds });
    }
    const phase: Record<string, string> = { card: '카드 선택', manage: '정비', combat: '전투 중', victory: '승리!', defatt: '', defeat: '패배' };
    this.phaseText.setText(phase[loop.phase] ?? loop.phase);

    // 시너지 상세는 왼쪽 칩(SynergyChips)이 보여주므로 여기서는 개수만
    const n = loop.activeSynergies.length;
    const hero = loop.hero ? `   영웅: ${loop.hero.def.name} (${loop.hero.grade})` : '';
    const shards = loop.shards > 0 ? `   영웅 토큰 ${'●'.repeat(loop.shards)}` : '';
    this.sub.setText(`유닛 ${loop.units.length}/25   시너지 ${n}개${hero}${shards}`);
  }
}
