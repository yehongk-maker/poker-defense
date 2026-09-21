import Phaser from 'phaser';
import type { GameLoop } from '../systems/GameLoop.ts';
import type { SynergyGroupDef, SynergyKind } from '../systems/SynergySystem.ts';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { Button } from './Button.ts';
import { COLORS, FONT, SUIT_COLOR } from './theme.ts';
import { KIND_LABEL, countLabel, describeTier, groupCondition, groupTitle, thresholdLabel } from './synergyText.ts';
import type { Suit } from '../systems/PokerEvaluator.ts';

const KINDS: SynergyKind[] = ['suit', 'class', 'race', 'formation'];

/**
 * 시너지 도감 오버레이 — 4축 탭. 각 그룹의 발동 조건·구간별 효과를 synergies.json에서 생성해 보여주고,
 * 현재 필드 카운트와 도달 구간을 강조한다. 어느 페이즈에서든 열람 가능(정보만).
 */
export class SynergyCodex extends Phaser.GameObjects.Container {
  private tabBtns = new Map<SynergyKind, Button>();
  private content: Phaser.GameObjects.Container;
  private kind: SynergyKind = 'suit';
  private loopRef: GameLoop | null = null;

  /**
   * @param opts.embedded true면 배경/헤더/닫기 없이 탭+내용만 (다른 패널 안에 넣을 때). top = 탭의 y
   */
  constructor(scene: Phaser.Scene, private onClose: () => void, opts: { embedded?: boolean; top?: number } = {}) {
    super(scene, 0, 0);
    const embedded = opts.embedded ?? false;
    const top = opts.top ?? 250;
    if (!embedded) {
      const bg = scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bg, 0.97).setInteractive();
      this.add(bg);
      this.add(scene.add.rectangle(GAME_WIDTH / 2, 90, GAME_WIDTH, 180, COLORS.panel));
      this.add(scene.add.text(40, 70, '시너지 도감', { fontSize: '46px', color: COLORS.text, fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0, 0.5));
      this.add(scene.add.text(40, 130, '금색 = 현재 발동 중 · 회색 = 미도달. 상위 구간이 하위 구간을 대체', { fontSize: '24px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(0, 0.5));
      this.add(new Button(scene, GAME_WIDTH - 130, 90, '닫기 ✕', () => this.onClose(), { width: 200, height: 90, fontSize: 30, fill: 0x3b4a66, textColor: COLORS.text }));
    }

    // 탭
    const tw = 240, gap = 16;
    const x0 = (GAME_WIDTH - (4 * tw + 3 * gap)) / 2 + tw / 2;
    KINDS.forEach((k, i) => {
      const b = new Button(scene, x0 + i * (tw + gap), top, KIND_LABEL[k], () => { this.kind = k; this.render(); }, { width: tw, height: 80, fontSize: 30, fill: 0x3b4a66, textColor: COLORS.text });
      this.tabBtns.set(k, b);
      this.add(b);
    });

    this.content = scene.add.container(0, top + 70);
    this.add(this.content);
    if (!embedded) this.setDepth(18).setVisible(false); // 족보 연출(15~16)보다 위, 토스트(20)·종료 오버레이(30)보다 아래
    scene.add.existing(this);
  }

  open(loop: GameLoop, kind?: SynergyKind): void {
    this.loopRef = loop;
    if (kind) this.kind = kind;
    this.setVisible(true);
    this.render();
  }

  /** 열려 있으면 최신 카운트로 다시 그림 */
  refresh(loop: GameLoop): void {
    this.loopRef = loop;
    if (this.visible) this.render();
  }

  private render(): void {
    const loop = this.loopRef;
    if (!loop) return;
    this.content.removeAll(true);
    for (const [k, b] of this.tabBtns) b.setEnabled(k !== this.kind);

    const table = loop.synergyTable;
    const groups: Record<string, SynergyGroupDef> =
      this.kind === 'suit' ? table.suits : this.kind === 'class' ? table.classes : this.kind === 'race' ? table.races ?? {} : table.formation ?? {};
    const counts = loop.synergyCounts;
    const active = new Map(loop.activeSynergies.filter((a) => a.kind === this.kind).map((a) => [a.key, a.reached]));

    let y = 0;
    const scene = this.scene;
    for (const [key, def] of Object.entries(groups)) {
      const count = counts[`${this.kind}:${key}`] ?? 0;
      const reached = active.get(key) ?? 0;
      const rows = def.thresholds.length;
      const h = 74 + rows * 34;
      const color = this.kind === 'suit' ? SUIT_COLOR[key as Suit] : reached ? COLORS.goldLight : COLORS.panelLine;
      const box = scene.add.rectangle(GAME_WIDTH / 2, y + h / 2, GAME_WIDTH - 60, h, COLORS.panel).setStrokeStyle(reached ? 4 : 2, color);
      this.content.add(box);
      const title = scene.add.text(50, y + 22, groupTitle(this.kind, key, def), { fontSize: '30px', color: reached ? '#f1d17a' : COLORS.text, fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0, 0.5);
      const cur = scene.add.text(GAME_WIDTH - 50, y + 22, `현재 ${countLabel(this.kind, def, count)}`, { fontSize: '26px', color: reached ? '#f1d17a' : COLORS.textDim, fontFamily: FONT }).setOrigin(1, 0.5);
      const cond = scene.add.text(50, y + 52, groupCondition(this.kind, key, def), { fontSize: '21px', color: COLORS.textMuted, fontFamily: FONT }).setOrigin(0, 0.5);
      this.content.add([title, cur, cond]);
      def.thresholds.forEach((t, i) => {
        const on = reached === t;
        const passed = reached > t;
        const label = scene.add.text(60, y + 84 + i * 34, thresholdLabel(this.kind, def, t), { fontSize: '23px', color: on ? '#f1d17a' : passed ? COLORS.textDim : COLORS.textMuted, fontFamily: FONT, fontStyle: on ? 'bold' : 'normal' }).setOrigin(0, 0.5);
        const desc = scene.add.text(150, y + 84 + i * 34, describeTier(def.effects[i], this.kind, key), { fontSize: '22px', color: on ? COLORS.text : COLORS.textMuted, fontFamily: FONT, wordWrap: { width: GAME_WIDTH - 220 } }).setOrigin(0, 0.5);
        this.content.add([label, desc]);
      });
      y += h + 14;
    }
  }
}
