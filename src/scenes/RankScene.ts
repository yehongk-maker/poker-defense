import Phaser from 'phaser';
import { SCENE, GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { loadRanking } from '../data/index.ts';
import { getMeta } from '../meta.ts';
import { nextTier, recordText, remainingText, rewardProgress, tierOf, type TierDef } from '../systems/Ranking.ts';
import { Button } from '../ui/Button.ts';
import { addBackdrop } from '../ui/Backdrop.ts';
import { gemIcon, starPath } from '../ui/draw.ts';
import { COLOR, FONT, OUTLINE, SIZE, SUIT_COLOR, SUIT_SYMBOL, TAP_SLOP, hex } from '../ui/theme.ts';
import { claimSeasonReward, getLeaderboard, getMySeason } from '../net/api.ts';
import { errorText, getSession, onlineAvailable } from '../net/session.ts';
import type { Leaderboard, LeaderboardKind, LeaderboardRow, SeasonInfo } from '../net/types.ts';

const TIER_COLOR: Record<TierDef['color'], number> = { gray: COLOR.gray, blue: COLOR.blue, gold: COLOR.gold, green: COLOR.green, purple: COLOR.purple };
const LIST_TOP = 800;
const LIST_BOTTOM = 1640;
const ROW_H = 104;

/**
 * 랭킹 (로비 탭바 5번째): 시즌 카드(남은 기간 · 내 티어 · 시즌 포인트와 다음 보상) → 지난 시즌 보상 수령
 * → 리더보드(시즌 포인트 / 레이팅 전환, 위아래로 끌어 넘김) → 내 순위 고정 줄.
 * 서버가 준 값을 그리기만 한다. 다이아 보상은 서버에 수령을 기록한 뒤 메타(localStorage)에 더한다.
 */
export class RankScene extends Phaser.Scene {
  private head!: Phaser.GameObjects.Container;
  private list!: Phaser.GameObjects.Container;
  private foot!: Phaser.GameObjects.Container;
  private toast!: Phaser.GameObjects.Text;
  private season: SeasonInfo | null = null;
  private board: Leaderboard | null = null;
  private kind: LeaderboardKind = 'season';
  private scrollMax = 0;
  private dragFrom: { y: number; at: number } | null = null;
  private busy = false;
  private alive = false;

  constructor() {
    super(SCENE.Rank);
  }

  create(): void {
    this.alive = true;
    this.season = null; this.board = null; this.kind = 'season'; this.busy = false; this.dragFrom = null;
    addBackdrop(this, 'solo');
    const cx = GAME_WIDTH / 2;
    new Button(this, SIZE.gutter + 110, 110, '‹ 로비', () => this.scene.start(SCENE.Lobby), { width: 220, height: SIZE.btnS, fontSize: 32, variant: 'gray' });
    this.add.text(cx, 110, '랭킹', { fontSize: `${SIZE.h1}px`, color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE, strokeThickness: 8 }).setOrigin(0.5);
    this.head = this.add.container(0, 0);
    this.list = this.add.container(0, LIST_TOP);
    this.foot = this.add.container(0, 0).setDepth(5);
    const shape = this.make.graphics({ x: 0, y: 0 }, false);
    shape.fillStyle(0xffffff).fillRect(0, LIST_TOP, GAME_WIDTH, LIST_BOTTOM - LIST_TOP);
    this.list.setMask(shape.createGeometryMask());
    this.toast = this.add.text(cx, GAME_HEIGHT - 60, '', { fontSize: '34px', color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE, align: 'center' }).setOrigin(0.5).setAlpha(0).setDepth(60);

    // 목록 끌어 넘기기
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if (p.y >= LIST_TOP && p.y <= LIST_BOTTOM) this.dragFrom = { y: p.y, at: this.list.y }; });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragFrom || !p.isDown) return;
      if (Math.abs(p.y - this.dragFrom.y) < TAP_SLOP) return;
      this.list.y = Phaser.Math.Clamp(this.dragFrom.at + (p.y - this.dragFrom.y), LIST_TOP - this.scrollMax, LIST_TOP);
    });
    this.input.on('pointerup', () => { this.dragFrom = null; });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.list.y = Phaser.Math.Clamp(this.list.y - dy, LIST_TOP - this.scrollMax, LIST_TOP);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.alive = false; });

    if (!onlineAvailable()) { this.message('온라인 설정이 없어요', '랭킹은 서버 연결이 필요해요'); return; }
    this.message('불러오는 중…');
    void this.fetchAll();
  }

  private async fetchAll(): Promise<void> {
    try {
      await getSession();
      const [season, board] = await Promise.all([getMySeason(), getLeaderboard(this.kind, loadRanking().leaderboardSize)]);
      if (!this.alive) return;
      this.season = season;
      this.board = board;
      this.draw();
    } catch (e) {
      if (this.alive) this.message('불러오지 못했어요', errorText(e), () => { this.message('불러오는 중…'); void this.fetchAll(); });
    }
  }

  private text(c: Phaser.GameObjects.Container, x: number, y: number, s: string, size: number, color: number = COLOR.textMain, display = true): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, s, { fontSize: `${size}px`, color: hex(color), fontFamily: display ? FONT.display : FONT.body, fontStyle: display ? '' : '700', ...(display ? OUTLINE : {}) }).setOrigin(0.5);
    c.add(t);
    return t;
  }

  private panel(c: Phaser.GameObjects.Container, y: number, h: number, fill: number = COLOR.navy, border: number = COLOR.modalBorder): Phaser.GameObjects.Graphics {
    const w = GAME_WIDTH - 2 * SIZE.gutter, x = SIZE.gutter;
    const g = this.add.graphics();
    g.fillStyle(COLOR.navyDark, 0.9).fillRoundedRect(x, y + 8, w, h, SIZE.radiusPanel);
    g.fillStyle(fill, 0.97).fillRoundedRect(x, y, w, h, SIZE.radiusPanel);
    g.lineStyle(2, border).strokeRoundedRect(x, y, w, h, SIZE.radiusPanel);
    c.add(g);
    return g;
  }

  private message(title: string, sub = '', retry?: () => void): void {
    this.head.removeAll(true); this.list.removeAll(true); this.foot.removeAll(true);
    const cx = GAME_WIDTH / 2;
    this.text(this.head, cx, 760, title, SIZE.h2);
    if (sub) this.text(this.head, cx, 850, sub, SIZE.body, COLOR.textSub, false);
    if (retry) this.head.add(new Button(this, cx, 1000, '다시 시도', retry, { width: 420, height: SIZE.btnM, variant: 'blue' }));
  }

  private draw(): void {
    const s = this.season, b = this.board;
    if (!s || !b) return;
    this.head.removeAll(true);
    const cx = GAME_WIDTH / 2, L = SIZE.gutter + 44, R = GAME_WIDTH - SIZE.gutter - 44;
    const cfg = loadRanking();

    // 시즌 카드
    this.panel(this.head, 200, 330, COLOR.purple, COLOR.purpleDark);
    this.text(this.head, L, 250, s.season.name, 46).setOrigin(0, 0.5);
    this.text(this.head, R, 250, remainingText(s.season.endsAt), SIZE.body + 2, COLOR.textMain, false).setOrigin(1, 0.5);
    const tier = tierOf(cfg, s.me.rating);
    const tg = this.add.graphics();
    tg.fillStyle(COLOR.navyDark).fillCircle(L + 56, 346, 62);
    tg.fillStyle(TIER_COLOR[tier.color]).fillCircle(L + 56, 340, 58);
    tg.lineStyle(5, 0xffffff).strokeCircle(L + 56, 340, 58);
    starPath(tg, L + 56, 340, 30, 13, 0xffffff);
    this.head.add(tg);
    this.text(this.head, L + 140, 316, `${tier.name} · ${s.me.rating}`, 44).setOrigin(0, 0.5);
    const up = nextTier(cfg, s.me.rating);
    const placing = s.me.placementLeft > 0 ? ` · 배치 ${s.me.placementLeft}판 남음` : '';
    this.text(this.head, L + 140, 368, `${recordText(s.me.wins, s.me.losses, s.me.draws)}${up ? ` · ${up.tier.name}까지 ${up.need}` : ''}${placing}`, SIZE.caption + 4, COLOR.textMain, false).setOrigin(0, 0.5);

    // 시즌 포인트 → 다음 보상
    const pr = rewardProgress(s.season.rewards, s.me.seasonPoints);
    const bx = L, bw = R - L, by = 448, bh = 30;
    const bar = this.add.graphics();
    bar.fillStyle(COLOR.navyDark).fillRoundedRect(bx, by, bw, bh, bh / 2);
    if (pr.ratio > 0) bar.fillStyle(COLOR.gold).fillRoundedRect(bx, by, Math.max(bh, bw * pr.ratio), bh, bh / 2);
    this.head.add(bar);
    this.text(this.head, L, 420, `시즌 포인트 ${s.me.seasonPoints}`, 34, COLOR.textGold).setOrigin(0, 0.5);
    const goal = pr.next ? `다음 보상 다이아 ${pr.next.diamonds} · ${pr.next.minPoints - s.me.seasonPoints}점 남음` : `최고 보상 달성 · 다이아 ${pr.diamonds}`;
    this.text(this.head, R, 420, goal, SIZE.caption + 4, COLOR.textMain, false).setOrigin(1, 0.5);
    this.text(this.head, cx, 504, pr.diamonds > 0 ? `시즌이 끝나면 다이아 ${pr.diamonds}개를 받아요` : '승리 +20 · 패배 -8 · 무승부 +5', SIZE.caption + 2, COLOR.textMain, false).setAlpha(0.85);

    // 지난 시즌 보상
    let y = 560;
    const un = s.unclaimed[0];
    if (un) {
      this.panel(this.head, y, 120, COLOR.navy, COLOR.gold);
      const g = this.add.graphics();
      gemIcon(g, L + 30, y + 60, 56);
      this.head.add(g);
      this.text(this.head, L + 80, y + 40, `${un.name} 보상 · ${un.rank}위`, 34).setOrigin(0, 0.5);
      this.text(this.head, L + 80, y + 84, `시즌 포인트 ${un.points} → 다이아 ${un.diamonds}`, SIZE.caption + 2, COLOR.textSub, false).setOrigin(0, 0.5);
      this.head.add(new Button(this, R - 110, y + 60, '받기', () => void this.claim(un.seasonId, un.diamonds), { width: 220, height: SIZE.btnS, fontSize: 34, variant: 'gold' }));
    } else {
      this.text(this.head, cx, y + 60, `이번 시즌 참가 ${b.total}명`, SIZE.body, COLOR.textMain, false).setAlpha(0.9);
    }
    y += 140;

    // 정렬 전환
    const tab = (x: number, label: string, kind: LeaderboardKind) =>
      this.head.add(new Button(this, x, y + 36, label, () => void this.switchTo(kind), { width: 440, height: SIZE.btnS, fontSize: 34, variant: this.kind === kind ? 'gold' : 'blue' }));
    tab(cx - 236, '시즌 포인트', 'season');
    tab(cx + 236, '레이팅', 'rating');

    this.drawList(b);
  }

  private row(c: Phaser.GameObjects.Container, y: number, r: LeaderboardRow, kind: LeaderboardKind, pinned = false): void {
    const x = SIZE.gutter, w = GAME_WIDTH - 2 * SIZE.gutter, h = ROW_H - 12;
    const g = this.add.graphics();
    g.fillStyle(r.me ? COLOR.blueDark : COLOR.navy, pinned ? 1 : 0.94).fillRoundedRect(x, y, w, h, 22);
    g.lineStyle(r.me ? 4 : 2, r.me ? COLOR.gold : COLOR.modalBorder).strokeRoundedRect(x, y, w, h, 22);
    const medal = r.rank === 1 ? COLOR.gold : r.rank === 2 ? COLOR.gray : r.rank === 3 ? COLOR.goldDark : null;
    if (medal !== null) g.fillStyle(medal).fillCircle(x + 60, y + h / 2, 34);
    g.fillStyle(SUIT_COLOR[r.avatar]).fillCircle(x + 150, y + h / 2, 32);
    g.lineStyle(3, 0xffffff).strokeCircle(x + 150, y + h / 2, 32);
    c.add(g);
    this.text(c, x + 60, y + h / 2, `${r.rank}`, r.rank >= 100 ? 28 : 36, medal !== null ? COLOR.textOnGold : COLOR.textMain).setStroke(hex(COLOR.navyDark), medal !== null ? 0 : 4);
    this.text(c, x + 150, y + h / 2, SUIT_SYMBOL[r.avatar], 34);
    this.text(c, x + 204, y + h / 2 - 18, `${r.name}${r.me ? ' (나)' : ''}`, 34).setOrigin(0, 0.5);
    const cfg = loadRanking();
    this.text(c, x + 204, y + h / 2 + 22, `${tierOf(cfg, r.rating).name} · ${recordText(r.wins, r.losses, r.draws)}`, SIZE.caption, COLOR.textSub, false).setOrigin(0, 0.5);
    const main = kind === 'season' ? `${r.seasonPoints}점` : `${r.rating}`;
    const sub = kind === 'season' ? `레이팅 ${r.rating}` : `${r.seasonPoints}점`;
    this.text(c, x + w - 36, y + h / 2 - 16, main, 40, COLOR.textGold).setOrigin(1, 0.5);
    this.text(c, x + w - 36, y + h / 2 + 24, sub, SIZE.caption, COLOR.textSub, false).setOrigin(1, 0.5);
  }

  private drawList(b: Leaderboard): void {
    this.list.removeAll(true);
    this.foot.removeAll(true);
    this.list.y = LIST_TOP;
    if (b.rows.length === 0) {
      this.text(this.list, GAME_WIDTH / 2, 200, '아직 순위가 없어요\n랭크 대전을 한 판 하면 여기에 올라요', SIZE.body + 2, COLOR.textSub, false).setAlign('center');
      this.scrollMax = 0;
    } else {
      b.rows.forEach((r, i) => this.row(this.list, i * ROW_H + 6, r, b.kind));
      this.scrollMax = Math.max(0, b.rows.length * ROW_H + 12 - (LIST_BOTTOM - LIST_TOP));
    }
    // 내 순위 고정 줄
    const y = LIST_BOTTOM + 24;
    if (b.me) this.row(this.foot, y, b.me, b.kind, true);
    else {
      this.panel(this.foot, y, ROW_H - 12);
      this.text(this.foot, GAME_WIDTH / 2, y + (ROW_H - 12) / 2, '랭크 대전을 한 판 하면 내 순위가 생겨요', SIZE.body, COLOR.textSub, false);
    }
  }

  private async switchTo(kind: LeaderboardKind): Promise<void> {
    if (this.busy || kind === this.kind) return;
    this.busy = true;
    try {
      const b = await getLeaderboard(kind, loadRanking().leaderboardSize);
      if (!this.alive) return;
      this.kind = kind;
      this.board = b;
      this.draw();
    } catch (e) {
      if (this.alive) this.showToast(errorText(e));
    } finally { this.busy = false; }
  }

  private async claim(seasonId: number, shown: number): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const got = await claimSeasonReward(seasonId);
      getMeta().addGems(got); // 서버가 수령을 기록한 뒤에만 지급
      if (!this.alive) return;
      this.showToast(`다이아 ${got}개를 받았어요!`);
      this.cameras.main.flash(160, 255, 228, 94);
      if (this.season) this.season = { ...this.season, unclaimed: this.season.unclaimed.filter((u) => u.seasonId !== seasonId) };
      this.draw();
    } catch (e) {
      if (this.alive) { this.showToast(errorText(e)); void shown; void this.fetchAll(); }
    } finally { this.busy = false; }
  }

  private showToast(msg: string): void {
    this.toast.setText(msg).setAlpha(1);
    this.tweens.killTweensOf(this.toast);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 1800, duration: 300 });
  }
}
