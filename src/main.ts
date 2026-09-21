import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config.ts';
import { BootScene } from './scenes/BootScene.ts';
import { LobbyScene } from './scenes/LobbyScene.ts';
import { GameScene } from './scenes/GameScene.ts';
import { MetaScene } from './scenes/MetaScene.ts';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0b0e14',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  scene: [BootScene, LobbyScene, GameScene, MetaScene],
});

// 개발 편의: 브라우저 콘솔/자동화에서 게임 인스턴스 접근 (수동 스텝 등). 프로덕션 빌드에서는 제외.
if (import.meta.env.DEV) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}
