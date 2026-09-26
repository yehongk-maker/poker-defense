import Phaser from 'phaser';
import type { GameLoop } from '../systems/GameLoop.ts';
import type { ActiveSynergy } from '../systems/SynergySystem.ts';
import type { Suit } from '../systems/PokerEvaluator.ts';
import { ALPHA, COLOR, FONT, OUTLINE, SIZE, SUIT_COLOR, SUIT_SYMBOL, SUIT_TEXT_COLOR, TAP_SLOP, hex } from './theme.ts';
import { FIELD } from './TrackView.ts';

const X = 14;         // 왼쪽 가장자리
const TOP = FIELD.y + 24;
const S = 84;         // DESIGN §4 SynergyBadge 84×84
const GAP = 8;
const MAX = 10;
const KIND_ORDER = { suit: 0, class: 1, race: 2, formation: 3 } as const;
const KIND_COLOR: Record<ActiveSynergy['kind'], number> = { suit: COLOR.navy, class: COLOR.purple, race: COLOR.green, formation: COLOR.gold };
const KIND_GLYPH: Record<ActiveSynergy['kind'], string> = { suit: '', class: '⚔', race: '☗', formation: '▦' };

/**
 * 시너지 뱃지 세로 스택 (DESIGN §4 SynergyBadge): 84×84 hudBg 라운드 + 수트/축 아이콘 + 이름 + 우하단 골드 숫자 뱃지(발동 단계).
 * 필드 왼쪽 위에 겹쳐 쌓고, 탭하면 시너지 도감.
 */
export class SynergyChips {
  private root: Phaser.GameObjects.Container;

  constructor(private scene: Phaser.Scene, private onTap: () => void) {
    this.root = scene.add.container(0, 0).setDepth(4);
  }

  refresh(loop: GameLoop): void {
    this.root.removeAll(true);
    const list = [...loop.activeSynergies].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.reached - a.reached);
    const shown = list.slice(0, MAX);
    shown.forEach((s, i) => {
      const cx = X + S / 2, cy = TOP + i * (S + GAP) + S / 2;
      const g = this.scene.add.graphics();
      const isSuit = s.kind === 'suit';
      g.fillStyle(COLOR.hudBg, ALPHA.hudBg + 0.2).fillRoundedRect(cx - S / 2, cy - S / 2, S, S, 18);
      g.lineStyle(3, isSuit ? SUIT_COLOR[s.key as Suit] : KIND_COLOR[s.kind]).strokeRoundedRect(cx - S / 2, cy - S / 2, S, S, 18);
      // 단계 뱃지 (우하단 골드 원)
      g.fillStyle(COLOR.goldDark).fillCircle(cx + S / 2 - 8, cy + S / 2 - 6, 15);
      g.fillStyle(COLOR.gold).fillCircle(cx + S / 2 - 8, cy + S / 2 - 8, 14);
      const icon = this.scene.add.text(cx, cy - 12, isSuit ? SUIT_SYMBOL[s.key as Suit] : KIND_GLYPH[s.kind], {
        fontSize: '38px', color: isSuit ? hex(SUIT_TEXT_COLOR[s.key as Suit]) : hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE,
      }).setOrigin(0.5);
      const name = this.scene.add.text(cx, cy + 24, s.name, { fontSize: `${SIZE.tiny - 2}px`, color: hex(COLOR.textMain), fontFamily: FONT.body, fontStyle: '700' }).setOrigin(0.5);
      if (name.width > S - 8) name.setScale((S - 8) / name.width);
      const lv = this.scene.add.text(cx + S / 2 - 8, cy + S / 2 - 8, `${s.reached}`, { fontSize: '20px', color: hex(COLOR.textOnGold), fontFamily: FONT.display }).setOrigin(0.5);
      const z = this.scene.add.zone(cx, cy, S, S).setInteractive({ useHandCursor: true });
      z.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < TAP_SLOP) this.onTap(); });
      this.root.add([g, icon, name, lv, z]);
    });
    if (list.length > MAX) {
      const y = TOP + MAX * (S + GAP) + 16;
      this.root.add(this.scene.add.text(X + S / 2, y, `+${list.length - MAX}`, { fontSize: '26px', color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5));
    }
  }
}
