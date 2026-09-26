import Phaser from 'phaser';
import { SCENE, GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { addBackdrop } from '../ui/Backdrop.ts';
import { COLOR, FONT, OUTLINE, SIZE, hex } from '../ui/theme.ts';

/** 폰트 프리로드(Jua·Noto Sans KR, DESIGN §9) 후 로비로. 네트워크가 없으면 최대 2.5초 뒤 대체 폰트로 진행 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENE.Boot);
  }

  create(): void {
    addBackdrop(this, 'solo');
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, '포커디펜스', { fontSize: `${SIZE.h1}px`, color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5);
    const fonts = typeof document !== 'undefined' && document.fonts
      ? Promise.all([
        document.fonts.load(`40px ${FONT.display}`, '포커디펜스0123'),
        document.fonts.load(`400 28px ${FONT.body}`, '족보 소환'),
        document.fonts.load(`900 28px ${FONT.body}`, 'AKQJ'),
      ])
      : Promise.resolve();
    const timeout = new Promise((r) => setTimeout(r, 2500));
    Promise.race([fonts, timeout]).catch(() => undefined).then(() => this.scene.start(SCENE.Lobby));
  }
}
