import Phaser from 'phaser';
import type { GameLoop } from '../systems/GameLoop.ts';
import type { ActiveSynergy } from '../systems/SynergySystem.ts';
import type { Suit } from '../systems/PokerEvaluator.ts';
import { COLORS, FONT, SUIT_COLOR, SUIT_SYMBOL, TAP_SLOP } from './theme.ts';

const X = 8;          // 왼쪽 가장자리
const TOP = 210;      // 트랙 상단 아래
const W = 150;
const H = 42;
const GAP = 6;
const MAX = 18;
const KIND_ORDER = { suit: 0, class: 1, race: 2, formation: 3 } as const;
const KIND_COLOR: Record<ActiveSynergy['kind'], number> = { suit: 0x3b4a66, class: 0x5a3b8a, race: 0x2f6b4f, formation: 0x7a5a12 };
const KIND_TAG: Record<ActiveSynergy['kind'], string> = { suit: '', class: '⚔', race: '☗', formation: '▦' };

/**
 * 화면 왼쪽의 활성 시너지 칩 (GDD 3.2.2 "HUD 좌측에 활성 시너지 아이콘"). 트랙 왼쪽 띠 위에 반투명으로 세로 배치.
 * 탭하면 시너지 도감. 진영=수트 색, 역할 ⚔, 종족 ☗, 진형 ▦.
 */
export class SynergyChips {
  private root: Phaser.GameObjects.Container;
  private title: Phaser.GameObjects.Text;

  constructor(private scene: Phaser.Scene, private onTap: () => void) {
    this.root = scene.add.container(0, 0).setDepth(4);
    this.title = scene.add.text(X + W / 2, TOP - 14, '시너지', { fontSize: '18px', color: COLORS.textMuted, fontFamily: FONT }).setOrigin(0.5).setDepth(4);
  }

  refresh(loop: GameLoop): void {
    this.root.removeAll(true);
    const list = [...loop.activeSynergies].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.reached - a.reached).slice(0, MAX);
    this.title.setVisible(true).setText(list.length ? `시너지 ${list.length}` : '시너지 없음');
    list.forEach((s, i) => {
      const y = TOP + i * (H + GAP) + H / 2;
      const isSuit = s.kind === 'suit';
      const fill = isSuit ? SUIT_COLOR[s.key as Suit] : KIND_COLOR[s.kind];
      const bg = this.scene.add.rectangle(X + W / 2, y, W, H, fill, 0.85).setStrokeStyle(2, 0xf1d17a, isSuit ? 0.6 : 0.35);
      bg.setInteractive({ useHandCursor: true }).on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < TAP_SLOP) this.onTap(); });
      const label = isSuit
        ? `${SUIT_SYMBOL[s.key as Suit]} ${s.name} ${s.reached}`
        : `${KIND_TAG[s.kind]} ${s.name}${s.reached === 1 && s.count === 1 ? '' : ' ' + s.reached}`;
      const txt = this.scene.add.text(X + 10, y, label, { fontSize: '21px', color: isSuit ? '#0b0e14' : COLORS.text, fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0, 0.5);
      if (txt.width > W - 16) txt.setFontSize(17);
      this.root.add([bg, txt]);
    });
  }
}
