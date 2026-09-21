import Phaser from 'phaser';
import type { GameLoop } from '../systems/GameLoop.ts';
import { GAME_WIDTH } from '../config.ts';
import { COLORS, FONT } from './theme.ts';

/** 상단 HUD: 웨이브 / 라이프 / 골드 / 페이즈 + 활성 시너지 + 영웅 */
export class HUD {
  private main: Phaser.GameObjects.Text;
  private sub: Phaser.GameObjects.Text;
  private phaseText: Phaser.GameObjects.Text;
  private codexBtn: Phaser.GameObjects.Text;
  private oppText: Phaser.GameObjects.Text;
  private roundText: Phaser.GameObjects.Text;

  constructor(private scene: Phaser.Scene, onOpenCodex?: () => void) {
    scene.add.rectangle(GAME_WIDTH / 2, 90, GAME_WIDTH, 180, COLORS.panel);
    this.main = scene.add.text(40, 58, '', { fontSize: '44px', color: COLORS.text, fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0, 0.5);
    // 현재 라운드 (상단 중앙, 크게)
    this.roundText = scene.add.text(GAME_WIDTH / 2, 58, '', { fontSize: '52px', color: '#f1d17a', fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0.5);
    this.phaseText = scene.add.text(GAME_WIDTH - 40, 72, '', { fontSize: '30px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(1, 0.5);
    this.sub = scene.add.text(40, 128, '', { fontSize: '28px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(0, 0.5);
    // 시너지 도감 열기 (시너지 줄 탭 또는 버튼)
    this.codexBtn = scene.add.text(GAME_WIDTH - 40, 128, '📖 도감', { fontSize: '28px', color: '#8fe3ff', fontFamily: FONT }).setOrigin(1, 0.5);
    this.oppText = scene.add.text(GAME_WIDTH - 40, 22, '', { fontSize: '26px', color: '#e0a0a0', fontFamily: FONT }).setOrigin(1, 0.5);
    if (onOpenCodex) {
      this.codexBtn.setInteractive({ useHandCursor: true }).on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 24) onOpenCodex(); });
      this.sub.setInteractive({ useHandCursor: true }).on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 24) onOpenCodex(); });
    }
  }

  /** 상대 요약 (1:1 대결) */
  setOpponent(text: string): void {
    this.oppText.setText(text);
  }

  refresh(loop: GameLoop, totalWaves: number): void {
    this.main.setText(`♥ ${loop.life}   💰 ${Math.floor(loop.gold)}`);
    this.roundText.setText(`라운드 ${loop.wave} / ${totalWaves}`);
    const phase: Record<string, string> = { card: '카드 선택', manage: '정비', combat: '전투 중', victory: '승리!', defatt: '', defeat: '패배' };
    this.phaseText.setText(phase[loop.phase] ?? loop.phase);

    // 시너지 상세는 왼쪽 칩(SynergyChips)이 보여주므로 여기서는 개수만
    const n = loop.activeSynergies.length;
    const hero = loop.hero ? `   영웅: ${loop.hero.def.name} (${loop.hero.grade})` : '';
    const shards = loop.shards > 0 ? `   영웅 토큰 ${'●'.repeat(loop.shards)}` : '';
    this.sub.setText(`유닛 ${loop.units.length}/25   시너지 ${n}개${hero}${shards}`);
  }
}
