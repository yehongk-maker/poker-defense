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
import { clearMatch, loadMatch } from '../matchSave.ts';
import { getSettings, updateSettings } from '../settings.ts';
import { resetTutorials } from '../tutorialSave.ts';
import { sfx } from '../audio/sfx.ts';
import { abandonSaved, prepareResume } from './resumeMatch.ts';
import type { SavedMatch } from '../systems/MatchResume.ts';

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

    new Button(this, SIZE.gutter + 100, SIZE.topbarY + 84, '설정', () => this.openSettingsSheet(), { width: 200, height: 64, fontSize: 30, variant: 'gray' });

    this.tabBar('battle');

    this.add.text(cx, GAME_HEIGHT - SIZE.tabbarH - 30, 'v0.3.0 · 저장: localStorage', { fontSize: `${SIZE.tiny}px`, color: hex(COLOR.textMain), fontFamily: FONT.body }).setOrigin(0.5).setAlpha(0.6);
    this.toast = this.add.text(cx, 1650, '', { fontSize: '34px', color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5).setAlpha(0);

    // 끊겼던 대전이 있으면 먼저 묻는다 (이어하기 / 기권)
    const match = loadMatch();
    if (match) this.openResumeSheet(match);
  }

  /** 설정 (모달): 효과음·볼륨·감속 모드. 바꾸는 즉시 저장된다 */
  private openSettingsSheet(): void {
    if (this.sheet) return;
    const cx = GAME_WIDTH / 2, cy = 960, w = GAME_WIDTH - 2 * SIZE.gutter, h = 1000;
    const c = this.add.container(0, 0).setDepth(40);
    const close = () => { c.destroy(); this.sheet = null; };
    const dim = this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLOR.dim, 0.72).setInteractive();
    dim.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < TAP_SLOP && Math.abs(p.y - cy) > h / 2) close(); });
    const g = this.add.graphics();
    g.fillStyle(COLOR.navyDark).fillRoundedRect(cx - w / 2, cy - h / 2 + 8, w, h, SIZE.radiusPanel);
    g.fillStyle(COLOR.navy).fillRoundedRect(cx - w / 2, cy - h / 2, w, h, SIZE.radiusPanel);
    g.lineStyle(2, COLOR.modalBorder).strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, SIZE.radiusPanel);
    c.add([dim, g, this.add.text(cx, cy - h / 2 + 70, '설정', { fontSize: `${SIZE.h1}px`, color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5)]);
    const VOLUMES = [{ v: 0.35, t: '작게' }, { v: 0.7, t: '보통' }, { v: 1, t: '크게' }];
    const rows: { label: string; value: () => string; on: () => boolean; next: () => void }[] = [
      { label: '효과음', value: () => (getSettings().sound ? '켬' : '끔'), on: () => getSettings().sound, next: () => updateSettings({ sound: !getSettings().sound }) },
      {
        label: '볼륨',
        value: () => VOLUMES.reduce((a, b) => (Math.abs(b.v - getSettings().volume) < Math.abs(a.v - getSettings().volume) ? b : a)).t,
        on: () => true,
        next: () => { const i = VOLUMES.findIndex((x) => Math.abs(x.v - getSettings().volume) < 0.01); updateSettings({ volume: VOLUMES[(i + 1) % VOLUMES.length].v }); },
      },
      { label: '감속 모드', value: () => (getSettings().reduceMotion ? '켬' : '끔'), on: () => getSettings().reduceMotion, next: () => updateSettings({ reduceMotion: !getSettings().reduceMotion }) },
      { label: '프레임 표시', value: () => (getSettings().showFps ? '켬' : '끔'), on: () => getSettings().showFps, next: () => updateSettings({ showFps: !getSettings().showFps }) },
    ];
    rows.forEach((r, i) => {
      const y = cy - h / 2 + 200 + i * 130;
      c.add(this.add.text(cx - w / 2 + 60, y, r.label, { fontSize: '44px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0, 0.5));
      const b: Button = new Button(this, cx + w / 2 - 200, y, r.value(), () => { r.next(); b.setLabel(r.value()).setVariant(r.on() ? 'blue' : 'gray'); sfx('coin'); }, { width: 280, height: SIZE.btnS, fontSize: 36, variant: r.on() ? 'blue' : 'gray' });
      c.add(b);
    });
    c.add(new Button(this, cx, cy + 290, '튜토리얼 다시 보기', () => { resetTutorials(); this.showToast('다음 판에서 가이드가 다시 나와요'); }, { width: 440, height: SIZE.btnS, fontSize: 32, variant: 'blue' }));
    c.add(this.add.text(cx, cy + 210, '감속 모드: 흔들림·회전·잔상 연출을 줄여요', { fontSize: `${SIZE.caption + 2}px`, color: hex(COLOR.textSub), fontFamily: FONT.body, fontStyle: '700' }).setOrigin(0.5));
    c.add(new Button(this, cx, cy + h / 2 - 90, '닫기', close, { width: 300, height: SIZE.btnS + 8, fontSize: 34, variant: 'gray' }));
    this.sheet = c;
  }

  /** 진행 중이던 대전 안내 (모달). 닫을 수 없다 — 이어 하거나 기권해야 다른 대전을 시작할 수 있다 */
  private openResumeSheet(saved: SavedMatch): void {
    if (this.sheet) return;
    const cx = GAME_WIDTH / 2, cy = 1000, w = GAME_WIDTH - 2 * SIZE.gutter, h = 700;
    const c = this.add.container(0, 0).setDepth(40);
    const dim = this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLOR.dim, 0.72).setInteractive();
    const g = this.add.graphics();
    g.fillStyle(COLOR.navyDark).fillRoundedRect(cx - w / 2, cy - h / 2 + 8, w, h, SIZE.radiusPanel);
    g.fillStyle(COLOR.navy).fillRoundedRect(cx - w / 2, cy - h / 2, w, h, SIZE.radiusPanel);
    g.lineStyle(2, COLOR.modalBorder).strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, SIZE.radiusPanel);
    const last = saved.rounds[saved.rounds.length - 1];
    const title = this.add.text(cx, cy - h / 2 + 80, '진행 중인 대전이 있어요', { fontSize: `${SIZE.h2 + 8}px`, color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5);
    const ranked = saved.mode.id === 'ranked_duel';
    const info = this.add.text(cx, cy - h / 2 + 190, `${saved.mode.label} · ${saved.identity.name}\n라운드 ${last?.wave ?? 1} / ${saved.mode.waves}`, { fontSize: `${SIZE.body + 6}px`, color: hex(COLOR.textSub), fontFamily: FONT.body, fontStyle: '700', align: 'center' }).setOrigin(0.5);
    const state = this.add.text(cx, cy + 250, '', { fontSize: `${SIZE.body}px`, color: hex(COLOR.textGold), fontFamily: FONT.body, fontStyle: '700', align: 'center' }).setOrigin(0.5);
    let busy = false;
    const close = () => { c.destroy(); this.sheet = null; };
    const resume = new Button(this, cx, cy - 10, '이어하기\n끊긴 곳에서 다시', () => {
      if (busy) return;
      busy = true;
      state.setText('연결 중…');
      void prepareResume(saved).then((r) => {
        if (!this.scene.isActive()) { if (r.ok) r.init.live?.transport.close(); return; }
        if (r.ok) { this.scene.start(SCENE.Game, r.init); return; }
        busy = false;
        if (r.reason === 'offline') { state.setText('연결하지 못했어요. 다시 눌러 주세요'); return; }
        clearMatch();
        close();
        this.showToast(r.reason === 'finished' ? '대전이 이미 끝났어요' : '이어 할 수 없는 대전이에요');
      });
    }, { width: w - 80, height: SIZE.btnL + 16, fontSize: 56, variant: 'gold' });
    const quit = new Button(this, cx, cy + 150, ranked ? '기권\n패배로 기록돼요' : '기권\n이 대전을 포기해요', () => {
      if (busy) return;
      busy = true;
      state.setText('처리 중…');
      void abandonSaved(saved).catch(() => undefined).then(() => {
        clearMatch();
        if (!this.scene.isActive()) return;
        close();
        this.showToast('대전을 포기했어요');
      });
    }, { width: w - 200, height: SIZE.btnM + 8, fontSize: 40, variant: 'red' });
    c.add([dim, g, title, info, resume, quit, state]);
    this.sheet = c;
    this.toast.setDepth(50);
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

  /** Android 뒤로 가기: 열린 시트를 닫는다 (진행 중 대전 안내는 닫지 않음). 아무것도 없으면 앱이 처리(두 번 눌러 종료) */
  onBack(): boolean {
    if (!this.sheet) return false;
    if (loadMatch()) return true;
    this.sheet.destroy();
    this.sheet = null;
    return true;
  }

  showToast(msg: string): void {
    this.toast.setText(msg).setAlpha(1);
    this.tweens.killTweensOf(this.toast);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 1200, duration: 300 });
  }
}
