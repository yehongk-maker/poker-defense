import Phaser from 'phaser';
import type { GameLoop } from '../systems/GameLoop.ts';
import type { HandsTable } from '../systems/SummonMapper.ts';
import { HandRank } from '../systems/PokerEvaluator.ts';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { Button } from './Button.ts';
import { SynergyCodex } from './SynergyCodex.ts';
import { COLORS, FONT, OUTLINE, HAND_NAME } from './theme.ts';
import { RANK_TIER, TIER_STYLE } from './HandFx.ts';

/** GDD 3.1 5장 기준 확률 (표시용) */
const HAND_PROB: Record<number, string> = {
  0: '50.1%', 1: '42.3%', 2: '4.75%', 3: '2.11%', 4: '0.39%', 5: '0.20%', 6: '0.14%', 7: '0.024%', 8: '0.0014%', 9: '0.00015%',
};
const TIER_NAME: Record<number, string> = { 1: '일반(T1)', 2: '고급(T2)', 3: '희귀(T3)', 4: '전설(T4)', 5: '신화(T5)' };

/**
 * 정보 패널 (왼쪽으로 스와이프 → 오른쪽에서 들어옴): 족보 표 + 시너지 도감
 */
export class InfoPanel extends Phaser.GameObjects.Container {
  private tabHands: Button;
  private tabSynergy: Button;
  private handsView: Phaser.GameObjects.Container;
  private codex: SynergyCodex;
  private loopRef: GameLoop | null = null;

  constructor(scene: Phaser.Scene, hands: HandsTable, onClose: () => void) {
    super(scene, GAME_WIDTH, 0);
    const bg = scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bg).setInteractive();
    const line = scene.add.rectangle(2, GAME_HEIGHT / 2, 4, GAME_HEIGHT, COLORS.panelLine);
    this.add([bg, line]);
    this.add(scene.add.rectangle(GAME_WIDTH / 2, 90, GAME_WIDTH, 180, COLORS.panel));
    this.add(scene.add.text(40, 70, '족보 & 시너지', { fontSize: '46px', color: COLORS.text, fontFamily: FONT.display, ...OUTLINE }).setOrigin(0, 0.5));
    this.add(scene.add.text(40, 130, '족보 → 소환 결과 · 시너지 4축 발동 조건', { fontSize: '26px', color: COLORS.textDim, fontFamily: FONT.body }).setOrigin(0, 0.5));
    this.add(new Button(scene, GAME_WIDTH - 170, 90, '◀ 게임 화면', () => onClose(), { width: 260, height: 90, fontSize: 32, variant: 'gray' }));

    this.tabHands = new Button(scene, GAME_WIDTH / 2 - 200, 240, '족보', () => this.show('hands'), { width: 360, height: 84, fontSize: 34, variant: 'blue' });
    this.tabSynergy = new Button(scene, GAME_WIDTH / 2 + 200, 240, '시너지', () => this.show('synergy'), { width: 360, height: 84, fontSize: 34, variant: 'blue' });
    this.add([this.tabHands, this.tabSynergy]);

    // 족보 표
    this.handsView = scene.add.container(0, 320);
    this.add(this.handsView);
    const ranks = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const rowH = 118;
    ranks.forEach((rank, i) => {
      const y = i * rowH;
      const key = HandRank[rank] as keyof HandsTable;
      const def = hands[key];
      const tier = RANK_TIER[rank as HandRank];
      const st = TIER_STYLE[tier];
      const box = scene.add.rectangle(GAME_WIDTH / 2, y + rowH / 2 - 6, GAME_WIDTH - 60, rowH - 12, COLORS.panel).setStrokeStyle(2, COLORS.panelLine);
      const name = scene.add.text(50, y + 30, HAND_NAME[rank], { fontSize: '30px', color: st.color, fontFamily: FONT.display, ...OUTLINE }).setOrigin(0, 0.5);
      const prob = scene.add.text(GAME_WIDTH - 50, y + 30, `확률 ${HAND_PROB[rank]}`, { fontSize: '24px', color: COLORS.textDim, fontFamily: FONT.body }).setOrigin(1, 0.5);
      const summon = def.heroSummon ? '영웅 즉시 소환 (토큰 없이 선택)'
        : def.summonTiers.map((t) => TIER_NAME[t]).join(' + ') + ' 유닛' + (def.jokerShards ? ` + 영웅 토큰 ${'●'.repeat(def.jokerShards)}` : '');
      const res = scene.add.text(50, y + 74, `소환: ${summon}`, { fontSize: '24px', color: COLORS.text, fontFamily: FONT.body }).setOrigin(0, 0.5);
      this.handsView.add([box, name, prob, res]);
    });
    this.handsView.add(scene.add.text(GAME_WIDTH / 2, ranks.length * rowH + 30, '수트 = 종족. 혼합 족보는 구성 카드의 다수 수트 (동수면 무작위)', { fontSize: '22px', color: COLORS.textMuted, fontFamily: FONT.body }).setOrigin(0.5));

    // 시너지 도감 (임베드)
    this.codex = new SynergyCodex(scene, () => {}, { embedded: true, top: 340 });
    this.add(this.codex);
    this.add(scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 36, '오른쪽으로 스와이프하면 게임 화면 ▶', { fontSize: '24px', color: COLORS.textMuted, fontFamily: FONT.body }).setOrigin(0.5));
    this.show('hands');
    scene.add.existing(this);
  }

  show(tab: 'hands' | 'synergy'): void {
    this.handsView.setVisible(tab === 'hands');
    this.codex.setVisible(tab === 'synergy');
    this.tabHands.setEnabled(tab !== 'hands');
    this.tabSynergy.setEnabled(tab !== 'synergy');
    if (tab === 'synergy' && this.loopRef) this.codex.open(this.loopRef);
  }

  refresh(loop: GameLoop): void {
    this.loopRef = loop;
    if (this.codex.visible) this.codex.refresh(loop);
  }
}
