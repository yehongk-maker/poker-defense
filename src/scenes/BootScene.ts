import Phaser from 'phaser';
import { SCENE, GAME_WIDTH, GAME_HEIGHT } from '../config.ts';

/** 에셋 로드 + 초기화. Phase 0에서는 로드할 에셋이 없으므로 바로 로비로. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENE.Boot);
  }

  preload(): void {
    // Phase 4에서 스프라이트/사운드 로드. 지금은 도형 placeholder만 사용.
  }

  create(): void {
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'POKER DEFENSE', {
        fontSize: '72px',
        color: '#e8e2d0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.time.delayedCall(400, () => this.scene.start(SCENE.Lobby));
  }
}
