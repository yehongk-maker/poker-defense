import Phaser from 'phaser';
import { GAME_WIDTH } from '../config.ts';
import { Button } from './Button.ts';
import { ALPHA, COLOR, FONT, OUTLINE, SIZE, hex } from './theme.ts';
import { coinIcon } from './draw.ts';
import { REASON_TEXT, label, type BetAction, type BetReason, type BetView } from '../systems/Betting.ts';

/** 베팅 영역 세로 배치 (필드 바로 아래, DESIGN §5-02: 팟 알약 → 베팅 3버튼) */
export const BET_LAYOUT = { potY: 1158, captionY: 1206, rowY: 1270 } as const;

/**
 * 판돈 걸기 (DESIGN §5-02): 골드 보더 팟 알약 + 베팅 3버튼 [폴드 gray | 체크·콜 blue | 레이즈 purple] (등폭, h96).
 *  - 카드 선택 중: 체크 / 레이즈
 *  - 상대가 레이즈하면 (언제든): 폴드 / 콜 — 팟 알약이 맥동
 *  - 그 외: 버튼 비활성 + 양쪽 선택·판정 결과를 캡션으로
 */
export class BetBar extends Phaser.GameObjects.Container {
  private potBg: Phaser.GameObjects.Graphics;
  private pot: Phaser.GameObjects.Text;
  private potBox: Phaser.GameObjects.Container;
  private caption: Phaser.GameObjects.Text;
  private foldBtn: Button;
  private midBtn: Button;
  private raiseBtn: Button;
  private midAct: BetAction | null = null;
  private pulse: Phaser.Tweens.Tween | null = null;
  private lastPotLabel = '';

  constructor(scene: Phaser.Scene, private onAct: (a: BetAction) => void) {
    super(scene, 0, 0);
    this.potBg = scene.add.graphics();
    this.pot = scene.add.text(0, 0, '', { fontSize: '30px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5);
    this.potBox = scene.add.container(GAME_WIDTH / 2, BET_LAYOUT.potY, [this.potBg, this.pot]);
    this.caption = scene.add.text(GAME_WIDTH / 2, BET_LAYOUT.captionY, '', { fontSize: `${SIZE.caption}px`, color: hex(COLOR.textMain), fontFamily: FONT.body, ...OUTLINE, strokeThickness: 3, align: 'center', wordWrap: { width: GAME_WIDTH - 2 * SIZE.gutter } }).setOrigin(0.5).setAlpha(ALPHA.sub);
    const gap = 16;
    const bw = (GAME_WIDTH - 2 * SIZE.gutter - 2 * gap) / 3;
    const bx = (i: number) => SIZE.gutter + bw / 2 + i * (bw + gap);
    const opt = { width: bw, height: SIZE.btnM, fontSize: 34 };
    this.foldBtn = new Button(scene, bx(0), BET_LAYOUT.rowY, '폴드\n판돈 포기', () => this.onAct('fold'), { ...opt, variant: 'gray' });
    this.midBtn = new Button(scene, bx(1), BET_LAYOUT.rowY, '체크\n그냥 진행', () => { if (this.midAct) this.onAct(this.midAct); }, { ...opt, variant: 'blue' });
    this.raiseBtn = new Button(scene, bx(2), BET_LAYOUT.rowY, '레이즈', () => this.onAct('raise'), { ...opt, variant: 'purple' });
    this.add([this.potBox, this.caption, this.foldBtn, this.midBtn, this.raiseBtn]);
    scene.add.existing(this);
  }

  refresh(v: BetView, phase: string): void {
    const opts = v.options;
    this.setPot(`판돈 ${v.pot}  ·  앤티 ${v.ante}  ·  R${v.wave}`);
    this.raiseBtn.setLabel(`레이즈\n+${v.raiseAmount} 골드`).setEnabled(opts.includes('raise'));
    this.foldBtn.setEnabled(opts.includes('fold'));
    if (v.pendingRaise !== null) {
      this.midAct = opts.includes('call') ? 'call' : null;
      this.midBtn.setLabel(`콜\n${v.pendingRaise} 골드 받기`).setEnabled(this.midAct !== null);
      this.caption.setText(`상대가 ${v.pendingRaise} 골드 레이즈! 콜하면 판돈 ${v.pot + v.pendingRaise} · 안 고르면 라운드 끝에 폴드`).setColor(hex(COLOR.textGold));
      this.setPulse(true);
      return;
    }
    this.setPulse(false);
    this.caption.setColor(hex(COLOR.textMain));
    if (phase === 'card' && opts.includes('check')) {
      this.midAct = 'check';
      this.midBtn.setLabel('체크\n그냥 진행').setEnabled(true);
      this.caption.setText(opts.includes('raise') ? '이번 라운드를 더 잘 막는 쪽이 판돈을 가져가요 · 자신 있으면 레이즈!' : `레이즈는 ${v.raiseAmount} 골드가 필요해요 · 체크로 진행`);
      return;
    }
    this.midAct = null;
    const me = v.mine ? label(v.mine) : '대기';
    this.midBtn.setLabel(`${me}\n내 선택`).setEnabled(false);
    if (v.result) {
      const r = v.result;
      const who = r.winner === 'player' ? '내가 획득' : r.winner === 'opponent' ? '상대가 획득' : '다음 라운드로 이월';
      this.caption.setText(`라운드 ${r.wave} 판돈 ${r.pot} → ${who} (${r.winner === 'opponent' ? MIRROR[r.reason] : REASON_TEXT[r.reason]})`);
    } else {
      const them = v.theirs ? label(v.theirs) : '대기';
      this.caption.setText(`나 ${me} · 상대 ${them} · 양쪽 전투가 끝나면 판정 (하트 손실 → 클리어 시간 → 족보)`);
    }
  }

  private setPot(text: string): void {
    if (text === this.lastPotLabel) return;
    this.lastPotLabel = text;
    this.pot.setText(text);
    const w = this.pot.width + 96, h = 52;
    this.pot.setX(22);
    const g = this.potBg.clear();
    g.fillStyle(COLOR.hudBg, ALPHA.hudBg).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    g.lineStyle(3, COLOR.gold).strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    coinIcon(g, -w / 2 + 32, 0, 36);
  }

  private setPulse(on: boolean): void {
    if (on && !this.pulse) this.pulse = this.scene.tweens.add({ targets: this.potBox, scale: 1.08, duration: 360, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    else if (!on && this.pulse) { this.pulse.remove(); this.pulse = null; this.potBox.setScale(1); }
  }
}

/** 상대가 이긴 이유를 내 입장 문장으로 */
const MIRROR: Record<BetReason, string> = { fold: '내가 폴드', life: '상대가 하트를 덜 잃음', time: '상대가 더 빨리 클리어', hand: '상대 족보가 더 높음', out: '내가 탈락', carry: '이월' };
