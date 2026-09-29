import Phaser from 'phaser';
import { SCENE, GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { getMeta } from '../meta.ts';
import { loadRun } from '../runSave.ts';
import { CAMPAIGN, rankedDuel } from '../systems/GameMode.ts';
import { localBotIdentity } from '../systems/Opponent.ts';
import type { GameSceneInit } from './GameScene.ts';
import { Button } from '../ui/Button.ts';
import { ResourcePill } from '../ui/ResourcePill.ts';
import { addBackdrop } from '../ui/Backdrop.ts';
import { coinIcon, glossTop, starPath, tokenIcon } from '../ui/draw.ts';
import { COLOR, FONT, OUTLINE, SIZE, SUIT_COLOR, SUIT_SYMBOL, TAP_SLOP, hex } from '../ui/theme.ts';
import type { Suit } from '../systems/PokerEvaluator.ts';

type Tab = 'shop' | 'hero' | 'battle' | 'upgrade' | 'rank';

/**
 * 로비 (DESIGN §5-01): 상단 알약(좌 기록 / 우 다이아·교환권) → 로고 + 수트 카드 4장 부채꼴 → 시즌 배너
 * → [전투 시작] gold L(싱글 캠페인, 저장이 있으면 이어하기) + [⚔ 레이즈 듀얼] purple M(랭크/친구 선택 시트) → 하단 탭바 5탭.
 * 메타 강화는 탭바의 영웅·강화 탭. 상점·랭킹 탭은 아직 준비 중 (강제 팝업 없음, 탭 안내만).
 */
export class LobbyScene extends Phaser.Scene {
  private toast!: Phaser.GameObjects.Text;
  private sheet: Phaser.GameObjects.Container | null = null;

  constructor() {
    super(SCENE.Lobby);
  }

  create(): void {
    addBackdrop(this, 'solo');
    const meta = getMeta();
    const st = meta.stats;
    const cx = GAME_WIDTH / 2;

    // 상단 알약
    new ResourcePill(this, SIZE.gutter + 130, SIZE.topbarY, 'trophy', 260, 56).setValue(`최고 R${st.bestWave}`);
    new ResourcePill(this, GAME_WIDTH - SIZE.gutter - 110 - 236, SIZE.topbarY, 'ticket', 200, 56).setValue(`${meta.tickets}`);
    new ResourcePill(this, GAME_WIDTH - SIZE.gutter - 110, SIZE.topbarY, 'gem', 220, 56).setValue(`${meta.gems}`);

    // 로고 ("디펜스"만 골드)
    const l1 = this.add.text(0, 0, '포커', { fontSize: '132px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE, strokeThickness: 10 }).setOrigin(0, 0.5);
    const l2 = this.add.text(0, 0, '디펜스', { fontSize: '132px', color: hex(COLOR.textGold), fontFamily: FONT.display, stroke: hex(COLOR.goldDark), strokeThickness: 10 }).setOrigin(0, 0.5);
    const lw = l1.width + l2.width + 10;
    l1.setPosition(cx - lw / 2, 300); l2.setPosition(cx - lw / 2 + l1.width + 10, 300);
    this.add.text(cx, 400, '족보로 소환하고, 시너지로 버텨라', { fontSize: `${SIZE.body + 4}px`, color: hex(COLOR.textMain), fontFamily: FONT.body, fontStyle: '700', ...OUTLINE }).setOrigin(0.5);

    // 수트 카드 4장 부채꼴 (히어로 아트)
    const suits: Suit[] = ['S', 'H', 'D', 'C'];
    const angles = [-10, -3, 4, 12];
    suits.forEach((s, i) => {
      const c = this.add.container(cx + (i - 1.5) * 150, 690 + Math.abs(i - 1.5) * 18).setAngle(angles[i]);
      const w = SIZE.cardW * 1.35, h = SIZE.cardH * 1.35;
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.25).fillRoundedRect(-w / 2, -h / 2 + 10, w, h, SIZE.radiusCard + 4);
      g.fillStyle(SUIT_COLOR[s]).fillRoundedRect(-w / 2, -h / 2, w, h, SIZE.radiusCard + 4);
      glossTop(g, 0, 0, w, h, SIZE.radiusCard + 4, 0.22);
      g.lineStyle(6, 0xffffff).strokeRoundedRect(-w / 2, -h / 2, w, h, SIZE.radiusCard + 4);
      const a = this.add.text(-w / 2 + 16, -h / 2 + 8, 'A', { fontSize: '48px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0, 0);
      const glyph = this.add.text(0, 14, SUIT_SYMBOL[s], { fontSize: '120px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE, strokeThickness: 6 }).setOrigin(0.5);
      c.add([g, a, glyph]);
      this.tweens.add({ targets: c, y: c.y - 12, duration: 1400 + i * 150, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    });

    // 시즌 배너 (퍼플 그라디언트 + 우측 선물 상자)
    const by = 1000, bw = GAME_WIDTH - 2 * SIZE.gutter, bh = 150;
    const bg = this.add.graphics();
    bg.fillStyle(COLOR.purpleDark).fillRoundedRect(cx - bw / 2, by - bh / 2 + 8, bw, bh, SIZE.radiusPanel);
    bg.fillStyle(COLOR.purple).fillRoundedRect(cx - bw / 2, by - bh / 2, bw, bh, SIZE.radiusPanel);
    bg.fillStyle(COLOR.duelTop, 0.55).fillRoundedRect(cx - bw / 2, by, bw, bh / 2, { tl: 0, tr: 0, bl: SIZE.radiusPanel, br: SIZE.radiusPanel });
    const gx = cx + bw / 2 - 110, gy = by + 6;
    bg.fillStyle(COLOR.redDark).fillRoundedRect(gx - 50, gy - 30, 100, 76, 10);
    bg.fillStyle(COLOR.red).fillRoundedRect(gx - 50, gy - 34, 100, 70, 10);
    bg.fillStyle(COLOR.gold).fillRect(gx - 9, gy - 34, 18, 76).fillRect(gx - 50, gy - 6, 100, 16);
    bg.fillStyle(COLOR.red).fillRoundedRect(gx - 58, gy - 54, 116, 28, 8);
    bg.fillStyle(COLOR.gold).fillRect(gx - 9, gy - 54, 18, 28);
    bg.fillStyle(COLOR.gold).fillTriangle(gx, gy - 54, gx - 34, gy - 78, gx - 26, gy - 50).fillTriangle(gx, gy - 54, gx + 34, gy - 78, gx + 26, gy - 50);
    this.add.text(cx - bw / 2 + 40, by - 28, '시즌 1 · 레이즈 듀얼', { fontSize: '42px', color: hex(COLOR.textMain), fontFamily: FONT.display, stroke: hex(COLOR.purpleDark), strokeThickness: 6 }).setOrigin(0, 0.5);
    this.add.text(cx - bw / 2 + 40, by + 30, '판돈을 걸고 20라운드를 먼저 깨라!', { fontSize: `${SIZE.caption + 2}px`, color: hex(COLOR.textMain), fontFamily: FONT.body, fontStyle: '700' }).setOrigin(0, 0.5).setAlpha(0.9);

    this.add.text(cx, 1130, `${st.runs}판 · 승리 ${st.wins} · 최고 라운드 ${st.bestWave} · 누적 다이아 ${st.totalGemsEarned}`, { fontSize: `${SIZE.caption}px`, color: hex(COLOR.textMain), fontFamily: FONT.body, fontStyle: '700', ...OUTLINE, strokeThickness: 3 }).setOrigin(0.5).setAlpha(0.9);

    // 메인 CTA: 싱글 캠페인 (저장된 판이 있으면 이어하기)
    this.sheet = null;
    const saved = loadRun();
    const startCampaign = (resume: boolean) => this.scene.start(SCENE.Game, { mode: CAMPAIGN, resume } satisfies GameSceneInit);
    new Button(this, cx, 1310, saved ? `이어하기\n싱글 캠페인 · 라운드 ${saved.wave}부터` : '전투 시작\n싱글 캠페인 · 라운드 40', () => startCampaign(!!saved),
      { width: GAME_WIDTH - 2 * SIZE.gutter, height: SIZE.btnL + 16, fontSize: 56, variant: 'gold' });
    new Button(this, cx, 1470, '⚔ 레이즈 듀얼\n1:1 레이스 · 라운드 20 · 판돈 걸기', () => this.openDuelSheet(), { width: GAME_WIDTH - 2 * SIZE.gutter - 120, height: SIZE.btnM + 8, fontSize: 40, variant: 'purple' });
    if (saved) {
      const fresh = this.add.text(cx, 1568, '처음부터 새로 시작', { fontSize: '30px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      fresh.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < TAP_SLOP) startCampaign(false); });
      this.add.rectangle(cx, 1590, fresh.width, 3, COLOR.textMain);
    }

    this.tabBar('battle');

    this.add.text(cx, GAME_HEIGHT - SIZE.tabbarH - 30, 'v0.3.0 · 저장: localStorage', { fontSize: `${SIZE.tiny}px`, color: hex(COLOR.textMain), fontFamily: FONT.body }).setOrigin(0.5).setAlpha(0.6);
    this.toast = this.add.text(cx, 1650, '', { fontSize: '34px', color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5).setAlpha(0);
  }

  /** 하단 탭바 5탭 (DESIGN §5-01): 활성=흰색, 비활성=textSub. 전투 탭은 골드 원형으로 14px 솟음 */
  private tabBar(active: Tab): void {
    const h = SIZE.tabbarH, top = GAME_HEIGHT - h;
    const g = this.add.graphics();
    g.fillStyle(COLOR.navyDark).fillRect(0, top, GAME_WIDTH, h);
    g.fillStyle(COLOR.navy).fillRect(0, top, GAME_WIDTH, 6);
    const tabs: { id: Tab; label: string; go?: () => void }[] = [
      { id: 'shop', label: '상점' },
      { id: 'hero', label: '영웅', go: () => this.scene.start(SCENE.Meta) },
      { id: 'battle', label: '전투', go: () => this.scene.start(SCENE.Game, { mode: CAMPAIGN, resume: !!loadRun() } satisfies GameSceneInit) },
      { id: 'upgrade', label: '강화', go: () => this.scene.start(SCENE.Meta) },
      { id: 'rank', label: '랭킹', go: () => this.scene.start(SCENE.Rank) },
    ];
    const tw = GAME_WIDTH / tabs.length;
    tabs.forEach((t, i) => {
      const x = tw * i + tw / 2;
      const isBattle = t.id === 'battle';
      const iy = top + 56 - (isBattle ? 14 : 0);
      const on = t.id === active;
      if (isBattle) {
        g.fillStyle(COLOR.goldDark).fillCircle(x, iy + 6, 62);
        g.fillStyle(COLOR.gold).fillCircle(x, iy, 62);
        g.fillStyle(0xffffff, 0.25).fillCircle(x - 16, iy - 18, 26);
        // 교차한 검 (도형)
        g.lineStyle(10, COLOR.textOnGold).lineBetween(x - 24, iy + 24, x + 24, iy - 24).lineBetween(x + 24, iy + 24, x - 24, iy - 24);
        g.lineStyle(10, COLOR.textOnGold).lineBetween(x - 30, iy + 12, x - 12, iy + 30).lineBetween(x + 30, iy + 12, x + 12, iy + 30);
      } else if (t.id === 'shop') coinIcon(g, x, iy, 50);
      else if (t.id === 'hero') tokenIcon(g, x, iy, 52);
      else if (t.id === 'upgrade') { g.fillStyle(COLOR.green).fillTriangle(x, iy - 28, x - 26, iy + 2, x + 26, iy + 2).fillRect(x - 11, iy, 22, 26); }
      else starPath(g, x, iy, 28, 12, COLOR.gold);
      const label = this.add.text(x, top + h - 30, t.label, { fontSize: '26px', color: hex(on ? COLOR.textMain : COLOR.textSub), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5);
      if (!t.go) label.setAlpha(0.7);
      const z = this.add.zone(x, top + h / 2 - (isBattle ? 10 : 0), tw, h + (isBattle ? 20 : 0)).setInteractive({ useHandCursor: true });
      z.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (p.getDistance() >= TAP_SLOP) return;
        if (t.go) t.go(); else this.showToast(`${t.label}은 준비 중이에요`);
      });
    });
  }

  /** 레이즈 듀얼 선택 시트 (모달): [랭크 대전] [친구 대전]. 바깥을 누르거나 닫기로 닫는다 */
  private openDuelSheet(): void {
    if (this.sheet) return;
    const cx = GAME_WIDTH / 2, cy = 1180, w = GAME_WIDTH - 2 * SIZE.gutter, h = 640;
    const c = this.add.container(0, 0).setDepth(40);
    const dim = this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLOR.dim, 0.72).setInteractive();
    dim.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < TAP_SLOP && Math.abs(p.y - cy) > h / 2) this.closeDuelSheet(); });
    const g = this.add.graphics();
    g.fillStyle(COLOR.navyDark).fillRoundedRect(cx - w / 2, cy - h / 2 + 8, w, h, SIZE.radiusPanel);
    g.fillStyle(COLOR.navy).fillRoundedRect(cx - w / 2, cy - h / 2, w, h, SIZE.radiusPanel);
    g.lineStyle(2, COLOR.modalBorder).strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, SIZE.radiusPanel);
    const title = this.add.text(cx, cy - h / 2 + 70, '레이즈 듀얼', { fontSize: `${SIZE.h1}px`, color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5);
    const sub = this.add.text(cx, cy - h / 2 + 130, '같은 웨이브를 더 잘 막고, 마지막 라운드를 먼저 깨면 승리', { fontSize: `${SIZE.caption + 2}px`, color: hex(COLOR.textSub), fontFamily: FONT.body, fontStyle: '700' }).setOrigin(0.5);
    const ranked = new Button(this, cx, cy - 60, '랭크 대전\n비슷한 실력의 상대와 · 랭크 반영', () => {
      this.scene.start(SCENE.Match);
    }, { width: w - 80, height: SIZE.btnL + 10, fontSize: 50, variant: 'purple' });
    const friend = new Button(this, cx, cy + 100, '친구 대전\n초대 코드로 친구와 · 랭크 미반영', () => this.scene.start(SCENE.Friend),
      { width: w - 80, height: SIZE.btnL + 10, fontSize: 50, variant: 'blue' });
    const close = new Button(this, cx, cy + h / 2 - 80, '닫기', () => this.closeDuelSheet(), { width: 300, height: SIZE.btnS + 8, fontSize: 34, variant: 'gray' });
    c.add([dim, g, title, sub, ranked, friend, close]);
    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 180 });
    this.sheet = c;
    this.toast.setDepth(50);
  }

  private closeDuelSheet(): void {
    this.sheet?.destroy();
    this.sheet = null;
  }

  private showToast(msg: string): void {
    this.toast.setText(msg).setAlpha(1);
    this.tweens.killTweensOf(this.toast);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 1200, duration: 300 });
  }
}
