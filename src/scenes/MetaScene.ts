import Phaser from 'phaser';
import { SCENE, GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { getMeta } from '../meta.ts';
import heroesJson from '../data/heroes.json';
import { Button } from '../ui/Button.ts';
import { COLORS, FONT, SUIT_COLOR, SUIT_SYMBOL } from '../ui/theme.ts';
import type { Suit } from '../systems/PokerEvaluator.ts';

/**
 * 메타 업그레이드 화면 (로비 → ) — GDD 3.4 / 9.4
 *  다이아로 영구 업그레이드 3종 구매, 메타 영웅 4종 해금. 전부 localStorage에 저장.
 */
export class MetaScene extends Phaser.Scene {
  private gemText!: Phaser.GameObjects.Text;
  private upgradeBtns = new Map<string, { btn: Button; lv: Phaser.GameObjects.Text }>();
  private heroBtns = new Map<string, { btn: Button; status: Phaser.GameObjects.Text }>();
  private toast!: Phaser.GameObjects.Text;

  constructor() {
    super(SCENE.Meta);
  }

  create(): void {
    const meta = getMeta();
    this.upgradeBtns.clear();
    this.heroBtns.clear();

    this.add.rectangle(GAME_WIDTH / 2, 90, GAME_WIDTH, 180, COLORS.panel);
    this.add.text(40, 70, '메타 업그레이드', { fontSize: '46px', color: COLORS.text, fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.gemText = this.add.text(40, 130, '', { fontSize: '30px', color: '#8fe3ff', fontFamily: FONT }).setOrigin(0, 0.5);
    new Button(this, GAME_WIDTH - 150, 90, '◀ 로비', () => this.scene.start(SCENE.Lobby), { width: 220, height: 90, fontSize: 30, fill: 0x3b4a66, textColor: COLORS.text });

    // 1) 영구 업그레이드
    this.section(250, '영구 업그레이드', '편의 강화만 — 유닛 공격력은 판매하지 않는다 (GDD §9.1)');
    meta.upgradeDefs.forEach((def, i) => {
      const y = 340 + i * 130;
      this.add.rectangle(GAME_WIDTH / 2, y, GAME_WIDTH - 80, 110, COLORS.panel).setStrokeStyle(2, COLORS.panelLine);
      this.add.text(60, y - 22, def.name, { fontSize: '32px', color: COLORS.text, fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0, 0.5);
      this.add.text(60, y + 22, def.desc, { fontSize: '24px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(0, 0.5);
      const lv = this.add.text(GAME_WIDTH - 330, y, '', { fontSize: '28px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(1, 0.5);
      const btn = new Button(this, GAME_WIDTH - 170, y, '', () => this.safe(() => { meta.buyUpgrade(def.id); this.showToast(`${def.name} 구매!`); }), { width: 260, height: 84, fontSize: 28 });
      this.upgradeBtns.set(def.id, { btn, lv });
    });

    // 2) 메타 영웅 해금
    const heroY = 340 + meta.upgradeDefs.length * 130 + 40;
    this.section(heroY, '메타 영웅 해금', `영웅당 다이아 💎${meta.heroUnlockCost} · 해금하면 판 안에서 영웅 토큰 3개로 선택 소환 가능`);
    const metaHeroes = (heroesJson.heroes as { id: string; name: string; suit: string; unlock: string; passive: Record<string, unknown> }[]).filter((h) => h.unlock === 'meta');
    const cw = 500, ch = 150, gapX = 40, gapY = 20;
    const cx0 = (GAME_WIDTH - (2 * cw + gapX)) / 2 + cw / 2;
    metaHeroes.forEach((h, i) => {
      const x = cx0 + (i % 2) * (cw + gapX);
      const y = heroY + 90 + ch / 2 + Math.floor(i / 2) * (ch + gapY);
      const color = SUIT_COLOR[h.suit as Suit];
      this.add.rectangle(x, y, cw, ch, COLORS.panel).setStrokeStyle(3, color);
      this.add.text(x - cw / 2 + 20, y - ch / 2 + 18, `${SUIT_SYMBOL[h.suit as Suit]} ${h.name}`, { fontSize: '32px', color: `#${color.toString(16).padStart(6, '0')}`, fontFamily: FONT, fontStyle: 'bold' });
      const status = this.add.text(x - cw / 2 + 20, y + ch / 2 - 34, '', { fontSize: '22px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(0, 0.5);
      const btn = new Button(this, x + cw / 2 - 110, y + ch / 2 - 44, '', () => this.safe(() => { meta.unlockHero(h.id); this.showToast(`${h.name} 해금!`); }), { width: 190, height: 64, fontSize: 26 });
      this.heroBtns.set(h.id, { btn, status });
    });

    // 3) 기록 / 초기화
    const st = meta.stats;
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 150, `기록: ${st.runs}판 · 승리 ${st.wins} · 최고 웨이브 ${st.bestWave} · 누적 다이아 ${st.totalGemsEarned}`, { fontSize: '26px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 110, '다이아 획득: 웨이브 10/20/30/40 최초 도달 시 20/30/50/100 · 판당 5 · 승리 50', { fontSize: '22px', color: COLORS.textMuted, fontFamily: FONT }).setOrigin(0.5);
    new Button(this, GAME_WIDTH / 2, GAME_HEIGHT - 50, '저장 초기화', () => this.safe(() => { meta.reset(); this.showToast('저장을 초기화했습니다'); }), { width: 260, height: 60, fontSize: 22, fill: 0x6b3b3b, textColor: COLORS.text });

    this.toast = this.add.text(GAME_WIDTH / 2, 200, '', { fontSize: '30px', color: '#f1d17a', fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0.5).setAlpha(0).setDepth(5);
    this.refresh();
  }

  private refresh(): void {
    const meta = getMeta();
    this.gemText.setText(`💎 ${meta.gems}`);
    for (const def of meta.upgradeDefs) {
      const { btn, lv } = this.upgradeBtns.get(def.id)!;
      const cost = meta.upgradeCost(def.id);
      lv.setText(`${meta.level(def.id)} / ${def.max}`);
      if (cost === null) btn.setLabel('MAX').setEnabled(false);
      else btn.setLabel(`💎 ${cost} 구매`).setEnabled(meta.canBuy(def.id));
    }
    for (const [id, { btn, status }] of this.heroBtns) {
      if (meta.isHeroUnlocked(id)) { status.setText('해금됨').setColor('#5fcf7a'); btn.setLabel('해금됨').setEnabled(false); }
      else { status.setText(meta.canUnlockHero(id) ? '해금 가능' : `💎 ${meta.heroUnlockCost} 필요`).setColor(COLORS.textDim); btn.setLabel(`💎 ${meta.heroUnlockCost} 해금`).setEnabled(meta.canUnlockHero(id)); }
    }
  }

  private section(y: number, title: string, sub: string): void {
    this.add.text(40, y, title, { fontSize: '34px', color: COLORS.text, fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.add.text(40, y + 40, sub, { fontSize: '22px', color: COLORS.textMuted, fontFamily: FONT }).setOrigin(0, 0.5);
  }

  private safe(fn: () => void): void {
    try { fn(); } catch (e) { this.showToast(String((e as Error).message)); }
    this.refresh();
  }

  private showToast(msg: string): void {
    this.toast.setText(msg).setAlpha(1);
    this.tweens.killTweensOf(this.toast);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 1400, duration: 400 });
  }
}
