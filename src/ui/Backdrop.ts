import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { COLOR, FONT, TAP_SLOP, hex } from './theme.ts';

export type WorldMode = 'solo' | 'duel' | 'defeat';

const STOPS: Record<WorldMode, [number, number]> = {
  solo: [COLOR.skyTop, COLOR.skyBottom],   // 솔로 = 블루 하늘
  duel: [COLOR.duelTop, COLOR.duelBottom], // 듀얼 = 퍼플 월드
  defeat: [COLOR.defeatTop, COLOR.defeatBottom],
};

/** 세로 그라디언트 텍스처를 1회 생성해 캐시하고(DESIGN §9) 맨 뒤에 깐다 */
export function addBackdrop(scene: Phaser.Scene, mode: WorldMode, depth = -100): Phaser.GameObjects.Image {
  const key = `backdrop-${mode}`;
  if (!scene.textures.exists(key)) {
    const tex = scene.textures.createCanvas(key, 8, GAME_HEIGHT);
    if (tex) {
      const ctx = tex.getContext();
      const grad = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
      const [a, b] = STOPS[mode];
      grad.addColorStop(0, `#${a.toString(16).padStart(6, '0')}`);
      grad.addColorStop(1, `#${b.toString(16).padStart(6, '0')}`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 8, GAME_HEIGHT);
      tex.refresh();
    }
  }
  return scene.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, key).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(depth);
}

/** 하단 조작 영역 시트: 위쪽만 둥근 hudBg 반투명 판 (엄지 존) */
export function addBottomSheet(scene: Phaser.Scene, top: number, depth = -50): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(depth);
  g.fillStyle(COLOR.hudBg, 0.55).fillRoundedRect(0, top, GAME_WIDTH, GAME_HEIGHT - top + 40, { tl: 36, tr: 36, bl: 0, br: 0 });
  g.lineStyle(3, COLOR.modalBorder, 0.6).beginPath();
  g.arc(36, top + 36, 36, Math.PI, Math.PI * 1.5).lineTo(GAME_WIDTH - 36, top).arc(GAME_WIDTH - 36, top + 36, 36, Math.PI * 1.5, 0).strokePath();
  return g;
}

/** 화면 가장자리 핸들 (스와이프 패널 탭 열기): hudBg 알약 + 세로/가로 라벨 */
export function addEdgeHandle(scene: Phaser.Scene, x: number, y: number, w: number, h: number, label: string, angle: number, onTap: () => void): void {
  const g = scene.add.graphics();
  g.fillStyle(COLOR.hudBg, 0.75).fillRoundedRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) / 2);
  g.lineStyle(2, COLOR.modalBorder, 0.8).strokeRoundedRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) / 2);
  scene.add.text(x, y, label, { fontSize: '20px', color: hex(COLOR.textMain), fontFamily: FONT.body, fontStyle: '700' }).setOrigin(0.5).setAngle(angle);
  const z = scene.add.zone(x, y, Math.max(w, 60), Math.max(h, 60)).setInteractive({ useHandCursor: true });
  z.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < TAP_SLOP) onTap(); });
}
