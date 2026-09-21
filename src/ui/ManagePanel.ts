import Phaser from 'phaser';
import type { GameLoop } from '../systems/GameLoop.ts';
import { GAME_WIDTH } from '../config.ts';
import { Button } from './Button.ts';
import { CLASS_NAME, COLORS, FONT, RACE_NAME } from './theme.ts';

export interface ManageCallbacks {
  onMerge: () => void;
  onSell: () => void;
  onOpenUpgrades: () => void;
  onStart: () => void;
}

const AURA_AREA: Record<string, string> = { adjacent: '인접 8칸', adjacent4: '상하좌우 4칸', global: '전체' };
const auraText = (eff: Record<string, unknown> | null): string =>
  eff && String(eff.type).startsWith('aura_') ? ` · 오라 ${AURA_AREA[String(eff.area ?? 'global')] ?? ''}` : '';

/** 정비 페이즈 패널: 소환 결과 / 합성 / 판매 / 업그레이드·영웅 화면 열기 / 전투 시작 */
export class ManagePanel extends Phaser.GameObjects.Container {
  private summary: Phaser.GameObjects.Text;
  private hint: Phaser.GameObjects.Text;
  private mergeBtn: Button;
  private sellBtn: Button;
  private upgradesBtn: Button;
  private startBtn: Button;

  constructor(scene: Phaser.Scene, y: number, cb: ManageCallbacks) {
    super(scene, 0, y);
    this.summary = scene.add.text(GAME_WIDTH / 2, -130, '', { fontSize: '34px', color: COLORS.text, fontFamily: FONT, align: 'center' }).setOrigin(0.5);
    this.hint = scene.add.text(GAME_WIDTH / 2, -62, '새로 소환된 유닛(배치 표시)은 빈 칸 탭으로 1회 이동 · 확정된 유닛은 판매만 가능 · 같은 수트 한 줄 = 빙고', { fontSize: '24px', color: COLORS.textMuted, fontFamily: FONT }).setOrigin(0.5);
    this.add([this.summary, this.hint]);

    const row = 20;
    this.mergeBtn = new Button(scene, GAME_WIDTH / 2 - 340, row, '합성', () => cb.onMerge(), { width: 300, height: 100, fontSize: 32, fill: 0x3b4a66, textColor: COLORS.text });
    this.sellBtn = new Button(scene, GAME_WIDTH / 2, row, '판매', () => cb.onSell(), { width: 300, height: 100, fontSize: 32, fill: 0x6b3b3b, textColor: COLORS.text });
    this.upgradesBtn = new Button(scene, GAME_WIDTH / 2 + 340, row, '업그레이드\n영웅 ▶', () => cb.onOpenUpgrades(), { width: 300, height: 100, fontSize: 28, fill: 0x5a3b8a, textColor: COLORS.text });
    this.startBtn = new Button(scene, GAME_WIDTH / 2, row + 140, '전투 시작', () => cb.onStart(), { width: 640, height: 120, fontSize: 44 });
    this.add([this.mergeBtn, this.sellBtn, this.upgradesBtn, this.startBtn]);
    scene.add.existing(this);
  }

  setSummary(text: string): void {
    this.summary.setText(text);
  }

  refresh(loop: GameLoop, selectedSlot: number, sellRatio: number): void {
    const m = loop.mergeable.length;
    this.mergeBtn.setLabel(m > 0 ? `합성 (${m})` : '합성').setEnabled(m > 0);
    const u = selectedSlot >= 0 ? loop.unitAtSlot(selectedSlot) : null;
    const isHero = !!u && loop.hero?.unit === u;
    if (u && !isHero) this.sellBtn.setLabel(`판매 +💰${Math.floor(u.def.value * sellRatio)}`).setEnabled(true);
    else this.sellBtn.setLabel(isHero ? '영웅은 판매 불가' : '판매 (유닛 탭)').setEnabled(false);
    this.hint.setText(u ? `${u.def.name} · ${RACE_NAME[u.def.race]} · ${CLASS_NAME[u.def.class]} · 사거리 ${u.def.range}칸${auraText(u.def.effect)} — ${u.placed ? '배치 확정 (판매만 가능)' : '빈 칸 탭: 1회 배치'}` : '새로 소환된 유닛(배치 표시)은 빈 칸 탭으로 1회 이동 · 확정된 유닛은 판매만 가능 · 같은 수트 한 줄 = 빙고');
    const hero = loop.canSummonHero ? '영웅 소환 가능!' : '업그레이드';
    this.upgradesBtn.setLabel(`${hero}\n영웅 ▶`);
  }
}
