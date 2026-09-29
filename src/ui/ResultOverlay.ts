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
  /** 없으면 "한 판 더" 링크를 숨긴다 */
  onAgain?: () => void;
  /** 제목 (기본: 승리!/패배/무승부) */
  title?: string;
  continueLabel?: string;
  continueVariant?: 'gold' | 'gray';
  againLabel?: string;
  /** [계속] 아래에 나란히 놓는 보조 버튼 (친구 추가 등) */
  extras?: { label: string; variant: 'blue' | 'gray' | 'purple'; onClick: (button: Button) => void }[];
  /**
   * 보상형 광고 버튼 (캠페인 전용, DESIGN §5-05/06). green + ▶ AD, 가장 크고 위.
   * onClick은 결과를 돌려준다: 버튼을 끄고 바꿀 문구(지급 완료 등). null이면 그대로 둔다(광고를 닫음).
   */
  ad?: { label: string; onClick: () => Promise<string | null> };
  /** 부활 제안 카운트다운(초). 0이 되면 광고 버튼이 꺼진다 */
  countdownSec?: number;
  /** 카운트다운 아래 아까움 문구 (사실 기반) */
  countdownNote?: string;
}

/**
 * 결과 화면 (DESIGN §5-05 승리 / §5-06 패배·부활). 광고 버튼·부활 카운트다운은 캠페인에서만 넘긴다 (대전은 §10.5로 금지).
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
      this.add(this.ribbon(scene, cx, y, d.title ?? '승리!'));
    } else {
      const t = d.title ?? (d.outcome === 'draw' ? '무승부' : '패배');
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

    // 부활 카운트다운 (DESIGN §5-06: Jua 88 골드 + 아까움 문구)
    let adBtn: Button | null = null;
    let timer: Phaser.Time.TimerEvent | null = null;
    if (d.countdownSec && d.ad) {
      let left = d.countdownSec;
      const cd = scene.add.text(cx, y + 30, `${left}`, { fontSize: '88px', color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE, strokeThickness: 8 }).setOrigin(0.5);
      this.add(cd);
      if (d.countdownNote) this.add(scene.add.text(cx, y + 100, d.countdownNote, { fontSize: `${SIZE.body}px`, color: hex(COLOR.textMain), fontFamily: FONT.body, fontStyle: '700', ...OUTLINE }).setOrigin(0.5));
      timer = scene.time.addEvent({ delay: 1000, repeat: d.countdownSec - 1, callback: () => {
        left--;
        cd.setText(`${Math.max(0, left)}`);
        if (left <= 0) { adBtn?.setLabel('시간 종료').setEnabled(false); cd.setColor(hex(COLOR.gray)); }
      } });
      y += 150;
    }

    y += 60;
    if (d.ad) {
      const ad = d.ad;
      let busy = false;
      adBtn = new Button(scene, cx, y, `${ad.label}\n▶ AD 시청`, () => {
        if (busy) return;
        busy = true;
        timer?.remove();
        void ad.onClick().then((done) => {
          busy = false;
          if (done !== null && adBtn?.active) adBtn.setLabel(done).setEnabled(false);
        });
      }, { width: GAME_WIDTH - 2 * SIZE.gutter, height: SIZE.btnL + 10, fontSize: 48, variant: 'green' });
      this.add(adBtn);
      y += SIZE.btnL + 34;
    }
    this.add(new Button(scene, cx, y, d.continueLabel ?? '계속', d.onContinue, { width: GAME_WIDTH - 2 * SIZE.gutter - (d.ad ? 120 : 0), height: d.ad ? SIZE.btnM : SIZE.btnL, fontSize: d.ad ? 40 : 52, variant: d.continueVariant ?? 'gold' }));
    const extras = d.extras ?? [];
    if (extras.length > 0) {
      y += (d.ad ? SIZE.btnM : SIZE.btnL) / 2 + 24 + SIZE.btnS / 2;
      const gap = 20, bw = Math.min(420, (GAME_WIDTH - 2 * SIZE.gutter - gap * (extras.length - 1)) / extras.length);
      extras.forEach((e, i) => {
        const x = cx + (i - (extras.length - 1) / 2) * (bw + gap);
        const b: Button = new Button(scene, x, y, e.label, () => e.onClick(b), { width: bw, height: SIZE.btnS, fontSize: 34, variant: e.variant });
        this.add(b);
      });
      y -= 10;
    }
    if (d.onAgain) {
      const onAgain = d.onAgain;
      const again = scene.add.text(cx, y + 110, d.againLabel ?? '한 판 더', { fontSize: '34px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      again.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < TAP_SLOP) onAgain(); });
      const ul = scene.add.rectangle(cx, y + 134, again.width, 3, COLOR.textMain);
      this.add([again, ul]);
    }
    this.once('destroy', () => timer?.remove());

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
