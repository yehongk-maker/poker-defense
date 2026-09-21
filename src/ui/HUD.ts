import Phaser from 'phaser';
import type { GameLoop } from '../systems/GameLoop.ts';
import { GAME_WIDTH } from '../config.ts';
import { COLORS, FONT, SUIT_SYMBOL } from './theme.ts';
import type { Suit } from '../systems/PokerEvaluator.ts';

/** 상단 HUD: 웨이브 / 라이프 / 골드 / 페이즈 + 활성 시너지 + 영웅 */
export class HUD {
  private main: Phaser.GameObjects.Text;
  private sub: Phaser.GameObjects.Text;
  private phaseText: Phaser.GameObjects.Text;
  private codexBtn: Phaser.GameObjects.Text;

  constructor(private scene: Phaser.Scene, onOpenCodex?: () => void) {
    scene.add.rectangle(GAME_WIDTH / 2, 90, GAME_WIDTH, 180, COLORS.panel);
    this.main = scene.add.text(40, 58, '', { fontSize: '46px', color: COLORS.text, fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.phaseText = scene.add.text(GAME_WIDTH - 40, 58, '', { fontSize: '34px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(1, 0.5);
    this.sub = scene.add.text(40, 128, '', { fontSize: '28px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(0, 0.5);
    // 시너지 도감 열기 (시너지 줄 탭 또는 버튼)
    this.codexBtn = scene.add.text(GAME_WIDTH - 40, 128, '📖 도감', { fontSize: '28px', color: '#8fe3ff', fontFamily: FONT }).setOrigin(1, 0.5);
    if (onOpenCodex) {
      this.codexBtn.setInteractive({ useHandCursor: true }).on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 24) onOpenCodex(); });
      this.sub.setInteractive({ useHandCursor: true }).on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 24) onOpenCodex(); });
    }
  }

  refresh(loop: GameLoop, totalWaves: number): void {
    this.main.setText(`웨이브 ${loop.wave}/${totalWaves}    ♥ ${loop.life}    💰 ${Math.floor(loop.gold)}`);
    const phase: Record<string, string> = { card: '카드 선택', manage: '정비', combat: '전투 중', victory: '승리!', defatt: '', defeat: '패배' };
    this.phaseText.setText(phase[loop.phase] ?? loop.phase);

    const syn = loop.activeSynergies
      .map((s) => (s.kind === 'suit' ? `${SUIT_SYMBOL[s.key as Suit]}${s.reached}` : s.reached === 1 ? s.name : `${s.name}${s.reached}`))
      .join('  ');
    const hero = loop.hero ? `   영웅: ${loop.hero.def.name} (${loop.hero.grade})` : '';
    const shards = loop.shards > 0 ? `   조각 ${'●'.repeat(loop.shards)}` : '';
    this.sub.setText(`유닛 ${loop.units.length}/25   시너지: ${syn || '없음'}${hero}${shards}`);
    // 도감 버튼과 겹치지 않게 폭 제한
    this.sub.setWordWrapWidth(GAME_WIDTH - 260).setFontSize(this.sub.text.length > 60 ? 22 : 28);
  }
}
