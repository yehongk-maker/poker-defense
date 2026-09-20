import Phaser from 'phaser';
import { SCENE, GAME_WIDTH, GAME_HEIGHT } from '../config.ts';

/** 로비 — GDD 4: [게임 시작] [메타 업그레이드] [상점] [설정]. Phase 0에서는 게임 시작만 동작. */
export class LobbyScene extends Phaser.Scene {
  constructor() {
    super(SCENE.Lobby);
  }

  create(): void {
    this.add
      .text(GAME_WIDTH / 2, 420, '포커디펜스', { fontSize: '120px', color: '#e8e2d0', fontStyle: 'bold' })
      .setOrigin(0.5);
    this.add
      .text(GAME_WIDTH / 2, 540, '족보로 소환하고, 시너지로 버텨라', { fontSize: '40px', color: '#8f98a8' })
      .setOrigin(0.5);

    const buttons: { label: string; enabled: boolean; onClick?: () => void }[] = [
      { label: '게임 시작', enabled: true, onClick: () => this.scene.start(SCENE.Game) },
      { label: '메타 업그레이드', enabled: false },
      { label: '상점', enabled: false },
      { label: '설정', enabled: false },
    ];

    buttons.forEach((b, i) => {
      const y = 900 + i * 170;
      const rect = this.add
        .rectangle(GAME_WIDTH / 2, y, 640, 130, b.enabled ? 0xd4a941 : 0x2a3140)
        .setStrokeStyle(4, b.enabled ? 0xf1d17a : 0x3b4453);
      this.add
        .text(GAME_WIDTH / 2, y, b.label, {
          fontSize: '52px',
          color: b.enabled ? '#1a1608' : '#5c6675',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      if (b.enabled && b.onClick) {
        rect.setInteractive({ useHandCursor: true }).on('pointerdown', b.onClick);
      }
    });

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 80, 'v0.1.0 · Phase 1', { fontSize: '30px', color: '#4a5364' })
      .setOrigin(0.5);
  }
}
