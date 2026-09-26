import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { Button } from './Button.ts';
import { addBackdrop } from './Backdrop.ts';
import { ALPHA, COLOR, FONT, OUTLINE, SIZE, TAP_SLOP, hex } from './theme.ts';
import { coinIcon, gemIcon, starPath, tokenIcon } from './draw.ts';

export interface ResultRow {
  icon: 'coin' | 'gem' | 'token' | 'star';
  label: string;
  value: string;
  /** 골드 보더 (최고 족보 행) */
  highlight?: boolean;
}

export interface ResultData {
  outcome: 'win' | 'lose' | 'draw';
  /** 승리 경로·패배 사유 캡션 (DESIGN §5-05 "승리 경로 캡션") */
  caption: string;
  /** 패배 부제 ("라운드 27에서 전멸..." 등) */
  subtitle?: string;
  /** 0~3 (승리 화면만) */
  stars: number;
  rows: ResultRow[];
  onContinue: () => void;
  onAgain: () => void;
}

/**
 * 결과 화면 (DESIGN §5-05 승리 / §5-06 패배). 1:1 대결이므로 부활·광고 버튼은 없다 (§10.5).
 *  승리: 광선(24초 회전) + 별 3개 + "승리!" 리본 + 경로 캡션 + 보상 알약 + [계속 gold] + "한 판 더" 링크
 *  패배/무승부: 다크 배경 + 제목 + 사유 + 기록 알약 + 같은 버튼
 */
export class ResultOverlay extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, d: ResultData) {
    super(scene, 0, 0);
    const win = d.outcome === 'win';
    const block = scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLOR.dim, win ? ALPHA.dim : 0).setInteractive();
    this.add(block);
    if (!win) this.add(addBackdrop(scene, 'defeat', 0).setAlpha(0.96));

    const cx = GAME_WIDTH / 2;
    let y = 560;
    if (win) {
      // 광선 (repeating-conic 흰 16%) — reduced-motion이면 정지
      const rays = scene.add.graphics({ x: cx, y });
      for (let i = 0; i < 16; i++) {
        const a0 = (i * Math.PI * 2) / 16, a1 = a0 + Math.PI / 16;
        rays.fillStyle(0xffffff, 0.16).fillTriangle(0, 0, Math.cos(a0) * 1400, Math.sin(a0) * 1400, Math.cos(a1) * 1400, Math.sin(a1) * 1400);
      }
      this.add(rays);
      if (!reducedMotion()) scene.tweens.add({ targets: rays, angle: 360, duration: 24000, repeat: -1 });
      // 별 3개 (중앙이 크고 높게)
      const sg = scene.add.graphics();
      [-1, 0, 1].forEach((k, i) => {
        const on = i === 1 ? d.stars >= 1 : i === 0 ? d.stars >= 2 : d.stars >= 3;
        const big = k === 0;
        starPath(sg, cx + k * 150, y - 150 + (big ? -30 : 0) + 6, big ? 78 : 60, big ? 34 : 26, COLOR.navyDark);
        starPath(sg, cx + k * 150, y - 150 + (big ? -30 : 0), big ? 78 : 60, big ? 34 : 26, on ? COLOR.gold : COLOR.starOff);
      });
      this.add(sg);
      // 리본
      this.add(this.ribbon(scene, cx, y, d.outcome === 'win' ? '승리!' : ''));
    } else {
      const t = d.outcome === 'draw' ? '무승부' : '패배';
      this.add(scene.add.text(cx, y - 60, t, { fontSize: '120px', color: hex(d.outcome === 'draw' ? COLOR.textSub : COLOR.red), fontFamily: FONT.display, ...OUTLINE, strokeThickness: 8 }).setOrigin(0.5));
      if (d.subtitle) this.add(scene.add.text(cx, y + 50, d.subtitle, { fontSize: `${SIZE.h2}px`, color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5));
    }
    y += 130;
    this.add(scene.add.text(cx, y, d.caption, { fontSize: `${SIZE.body}px`, color: hex(win ? COLOR.textGold : COLOR.textSub), fontFamily: FONT.body, fontStyle: '700', ...OUTLINE, align: 'center', wordWrap: { width: GAME_WIDTH - 2 * SIZE.gutter } }).setOrigin(0.5));
    y += 80;

    // 보상/기록 알약
    const rw = GAME_WIDTH - 4 * SIZE.gutter, rh = 84;
    d.rows.forEach((r) => {
      const g = scene.add.graphics();
      g.fillStyle(COLOR.hudBg, 0.8).fillRoundedRect(cx - rw / 2, y - rh / 2, rw, rh, rh / 2);
      if (r.highlight) g.lineStyle(4, COLOR.gold).strokeRoundedRect(cx - rw / 2, y - rh / 2, rw, rh, rh / 2);
      const ix = cx - rw / 2 + 50;
      if (r.icon === 'coin') coinIcon(g, ix, y, 46);
      else if (r.icon === 'gem') gemIcon(g, ix, y, 46);
      else if (r.icon === 'token') tokenIcon(g, ix, y, 46);
      else starPath(g, ix, y, 24, 11, COLOR.gold);
      const l = scene.add.text(ix + 44, y, r.label, { fontSize: `${SIZE.body}px`, color: hex(COLOR.textSub), fontFamily: FONT.body, fontStyle: '700' }).setOrigin(0, 0.5);
      const v = scene.add.text(cx + rw / 2 - 40, y, r.value, { fontSize: '36px', color: hex(r.highlight ? COLOR.textGold : COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(1, 0.5);
      this.add([g, l, v]);
      y += rh + 16;
    });

    y += 60;
    this.add(new Button(scene, cx, y, '계속', d.onContinue, { width: GAME_WIDTH - 2 * SIZE.gutter, height: SIZE.btnL, fontSize: 52, variant: 'gold' }));
    const again = scene.add.text(cx, y + 110, '한 판 더', { fontSize: '34px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    again.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < TAP_SLOP) d.onAgain(); });
    const ul = scene.add.rectangle(cx, y + 134, again.width, 3, COLOR.textMain);
    this.add([again, ul]);

    this.setDepth(30).setAlpha(0);
    scene.tweens.add({ targets: this, alpha: 1, duration: 300 });
    scene.add.existing(this);
  }

  /** 리본 (DESIGN §4 VictoryRibbon): 골드 + 양끝 접힌 다크골드 꼬리 + Jua 52 */
  private ribbon(scene: Phaser.Scene, x: number, y: number, text: string): Phaser.GameObjects.Container {
    const c = scene.add.container(x, y);
    const g = scene.add.graphics();
    const w = 560, h = 110, tail = 80;
    g.fillStyle(COLOR.goldDark);
    g.fillTriangle(-w / 2 - tail, -h / 2 + 30, -w / 2 + 10, -h / 2 + 30, -w / 2 + 10, h / 2 + 30);
    g.fillTriangle(-w / 2 - tail, h / 2 + 30, -w / 2 - tail + 36, h / 2 / 2 + 30, -w / 2 - tail, -h / 2 + 30);
    g.fillTriangle(w / 2 + tail, -h / 2 + 30, w / 2 - 10, -h / 2 + 30, w / 2 - 10, h / 2 + 30);
    g.fillTriangle(w / 2 + tail, h / 2 + 30, w / 2 + tail - 36, h / 2 / 2 + 30, w / 2 + tail, -h / 2 + 30);
    g.fillStyle(COLOR.gold).fillRoundedRect(-w / 2, -h / 2, w, h, 18);
    g.fillStyle(0xffffff, 0.25).fillRoundedRect(-w / 2, -h / 2, w, h / 2, { tl: 18, tr: 18, bl: 0, br: 0 });
    const t = scene.add.text(0, 0, text, { fontSize: '64px', color: hex(COLOR.textMain), fontFamily: FONT.display, stroke: hex(COLOR.goldDark), strokeThickness: 8 }).setOrigin(0.5);
    c.add([g, t]);
    // 리본 드롭 (강조 연출 1개)
    c.setScale(1.6).setAlpha(0);
    scene.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 300, ease: 'Back.easeOut', delay: 120 });
    return c;
  }
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
