import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config.ts';
import { unlockAudioOnFirstInput } from './audio/sfx.ts';
import { initNative } from './native/index.ts';
import { getSettings, onSettings } from './settings.ts';
import { BootScene } from './scenes/BootScene.ts';
import { LobbyScene } from './scenes/LobbyScene.ts';
import { GameScene } from './scenes/GameScene.ts';
import { MetaScene } from './scenes/MetaScene.ts';
import { FriendScene } from './scenes/FriendScene.ts';
import { MatchScene } from './scenes/MatchScene.ts';
import { RankScene } from './scenes/RankScene.ts';
import { SpectateScene } from './scenes/SpectateScene.ts';

unlockAudioOnFirstInput();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0f2450',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  scene: [BootScene, LobbyScene, GameScene, MetaScene, FriendScene, MatchScene, RankScene, SpectateScene],
});

initNative(game);

// 성능 표시 (설정 → 프레임 표시): 비공개 테스트에서 기기별 프레임을 제보받기 위해
const fpsBox = document.createElement('div');
fpsBox.style.cssText = 'position:fixed;left:6px;top:6px;z-index:10;padding:2px 6px;border-radius:6px;background:rgba(0,0,0,.55);color:#fff;font:700 12px monospace;pointer-events:none;display:none';
document.body.append(fpsBox);
const paintFps = (on: boolean) => { fpsBox.style.display = on ? 'block' : 'none'; };
paintFps(getSettings().showFps);
onSettings((s) => paintFps(s.showFps));
setInterval(() => { if (fpsBox.style.display !== 'none') fpsBox.textContent = `${Math.round(game.loop.actualFps)} fps`; }, 500);

// 개발 편의: 브라우저 콘솔/자동화에서 게임 인스턴스 접근 (수동 스텝 등). 프로덕션 빌드에서는 제외.
if (import.meta.env.DEV) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}
