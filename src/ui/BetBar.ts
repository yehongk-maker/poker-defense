import Phaser from 'phaser';
import { GAME_WIDTH } from '../config.ts';
import { Button } from './Button.ts';
import { COLORS, FONT } from './theme.ts';
import { REASON_TEXT, label, type BetAction, type BetReason, type BetView } from '../systems/Betting.ts';

export const BET_BAR_H = 120;

/**
 * 판돈 걸기 바 (화면 맨 아래, 모든 페이즈에 표시) — 초보자용 2버튼:
 *  - 카드 선택 중: [체크 · 그냥 진행] [레이즈 · +💰N 더 걸기]
 *  - 상대가 레이즈하면 (언제든): [콜 · 💰N 받기] [폴드 · 판돈 포기]
 *  - 그 외: 판돈과 양쪽 선택 상태만 표시
 */
export class BetBar extends Phaser.GameObjects.Container {
  private pot: Phaser.GameObjects.Text;
  private desc: Phaser.GameObjects.Text;
  private btnA: Button;
  private btnB: Button;
  private bg: Phaser.GameObjects.Rectangle;
  private pulse: Phaser.Tweens.Tween | null = null;
  private actA: BetAction | null = null;
  private actB: BetAction | null = null;

  constructor(scene: Phaser.Scene, y: number, private onAct: (a: BetAction) => void) {
    super(scene, 0, y);
    this.bg = scene.add.rectangle(GAME_WIDTH / 2, 0, GAME_WIDTH, BET_BAR_H, 0x151b2a).setStrokeStyle(2, COLORS.panelLine);
    this.pot = scene.add.text(30, -26, '', { fontSize: '34px', color: '#f1d17a', fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.desc = scene.add.text(30, 24, '', { fontSize: '22px', color: COLORS.textDim, fontFamily: FONT, wordWrap: { width: 530 } }).setOrigin(0, 0.5);
    this.btnA = new Button(scene, GAME_WIDTH - 385, 0, '', () => { if (this.actA) this.onAct(this.actA); }, { width: 230, height: 92, fontSize: 26, fill: 0x3b4a66, textColor: COLORS.text });
    this.btnB = new Button(scene, GAME_WIDTH - 135, 0, '', () => { if (this.actB) this.onAct(this.actB); }, { width: 230, height: 92, fontSize: 26 });
    this.add([this.bg, this.pot, this.desc, this.btnA, this.btnB]);
    scene.add.existing(this);
  }

  refresh(v: BetView, phase: string): void {
    const opts = v.options;
    this.pot.setText(`판돈 💰${v.pot}   ·   라운드 ${v.wave}`);
    if (v.pendingRaise !== null) {
      // 상대 레이즈 응답
      this.setButtons('fold', '폴드\n판돈 포기', 'call', `콜\n💰${v.pendingRaise} 받기`, opts);
      this.desc.setText(`상대가 💰${v.pendingRaise} 레이즈! 콜하면 판돈 💰${v.pot + v.pendingRaise} · 안 고르면 라운드 끝에 폴드`);
      this.setPulse(true);
      return;
    }
    this.setPulse(false);
    if (phase === 'card' && (opts.includes('check') || opts.includes('raise'))) {
      this.setButtons('check', '체크\n그냥 진행', 'raise', `레이즈\n+💰${v.raiseAmount} 더 걸기`, opts);
      this.desc.setText(opts.includes('raise') ? '이번 라운드를 더 잘 막는 쪽이 판돈을 가져가요 · 자신 있으면 레이즈!' : `레이즈는 골드 💰${v.raiseAmount}가 필요해요 · 체크로 진행`);
      return;
    }
    this.setButtons(null, '', null, '', []);
    const me = v.mine ? label(v.mine) : '아직';
    const them = v.theirs ? label(v.theirs) : '아직';
    if (v.result) {
      const r = v.result;
      const who = r.winner === 'player' ? '내가 획득' : r.winner === 'opponent' ? '상대가 획득' : '이월';
      this.desc.setText(`라운드 ${r.wave} 판돈 💰${r.pot} → ${who} (${r.winner === 'opponent' ? MIRROR[r.reason] : REASON_TEXT[r.reason]})`);
    } else {
      this.desc.setText(`내 선택: ${me}  ·  상대: ${them}  ·  양쪽 전투가 끝나면 판정 (하트 손실 → 클리어 시간 → 족보)`);
    }
  }

  private setButtons(a: BetAction | null, la: string, b: BetAction | null, lb: string, opts: BetAction[]): void {
    this.actA = a; this.actB = b;
    this.btnA.setVisible(!!a).setLabel(la).setEnabled(!!a && opts.includes(a));
    this.btnB.setVisible(!!b).setLabel(lb).setEnabled(!!b && opts.includes(b));
  }

  private setPulse(on: boolean): void {
    if (on && !this.pulse) {
      this.pulse = this.scene.tweens.add({ targets: this.bg, fillAlpha: { from: 1, to: 0.6 }, duration: 500, yoyo: true, repeat: -1 });
      this.bg.setStrokeStyle(3, 0xf1d17a);
    } else if (!on && this.pulse) {
      this.pulse.remove(); this.pulse = null;
      this.bg.setFillStyle(0x151b2a, 1).setStrokeStyle(2, COLORS.panelLine);
    }
  }
}

/** 상대가 이긴 이유를 내 입장 문장으로 */
const MIRROR: Record<BetReason, string> = { fold: '내가 폴드', life: '상대가 하트를 덜 잃음', time: '상대가 더 빨리 클리어', hand: '상대 족보가 더 높음', out: '내가 탈락', carry: '이월' };
