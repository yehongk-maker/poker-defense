import Phaser from 'phaser';
import { SCENE, GAME_WIDTH, GAME_HEIGHT } from '../config.ts';

/**
 * 게임 씬 — Phase 1에서 GameLoop(src/systems)을 연결한다.
 * Phase 0: 씬 전환 확인용 placeholder (레이아웃 영역만 표시).
 */
export class GameScene extends Phaser.Scene {
  constructor() {
    super(SCENE.Game);
  }

  create(): void {
    // HUD 영역
    this.add.rectangle(GAME_WIDTH / 2, 90, GAME_WIDTH, 180, 0x141924);
    this.add
      .text(60, 90, '웨이브 1/40   ♥10   💰100', { fontSize: '44px', color: '#e8e2d0' })
      .setOrigin(0, 0.5);

    // 순환 트랙 맵 영역 (유닛 슬롯 25)
    this.add
      .rectangle(GAME_WIDTH / 2, 780, 980, 1000, 0x10151f)
      .setStrokeStyle(4, 0x2a3140);
    this.add
      .text(GAME_WIDTH / 2, 780, '순환 트랙 맵\n(Phase 1에서 구현)', {
        fontSize: '40px',
        color: '#4a5364',
        align: 'center',
      })
      .setOrigin(0.5);

    // 카드 영역
    this.add.rectangle(GAME_WIDTH / 2, 1500, GAME_WIDTH, 340, 0x141924);
    this.add
      .text(GAME_WIDTH / 2, 1500, '카드 5장 / 교환 / 진행\n(Phase 1에서 구현)', {
        fontSize: '40px',
        color: '#4a5364',
        align: 'center',
      })
      .setOrigin(0.5);

    // 로비로 돌아가기 (씬 전환 확인용)
    const back = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 120, 400, 110, 0x2a3140)
      .setStrokeStyle(4, 0x3b4453)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 120, '로비로', { fontSize: '44px', color: '#e8e2d0' })
      .setOrigin(0.5);
    back.on('pointerdown', () => this.scene.start(SCENE.Lobby));
  }
}
