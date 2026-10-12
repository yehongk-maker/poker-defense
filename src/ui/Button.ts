import Phaser from 'phaser';
import { COLOR, FONT, SIZE, TAP_SLOP, hex } from './theme.ts';
import { glossTop } from './draw.ts';
import { sfx } from '../audio/sfx.ts';

/** 버튼 역할 색 (DESIGN §3) — 새 스타일 금지 */
export type ButtonVariant = 'gold' | 'green' | 'purple' | 'red' | 'gray' | 'blue';

const VARIANT: Record<ButtonVariant, { body: number; dark: number; text: number }> = {
  gold: { body: COLOR.gold, dark: COLOR.goldDark, text: COLOR.textOnGold },
  green: { body: COLOR.green, dark: COLOR.greenDark, text: COLOR.textMain },
  purple: { body: COLOR.purple, dark: COLOR.purpleDark, text: COLOR.textMain },
  red: { body: COLOR.red, dark: COLOR.redDark, text: COLOR.textMain },
  gray: { body: COLOR.gray, dark: COLOR.grayDark, text: COLOR.textMain },
  blue: { body: COLOR.blue, dark: COLOR.blueDark, text: COLOR.textMain },
};

export interface ButtonOptions {
  width?: number;
  height?: number;
  /** 메인 라벨 크기 (서브 라벨은 자동으로 작게) */
  fontSize?: number;
  variant?: ButtonVariant;
  /** @deprecated 구 API — variant로 매핑된다 */
  fill?: number;
  /** @deprecated 구 API — 무시 (색은 variant가 결정) */
  textColor?: string;
}

const LEGACY_FILL: Record<number, ButtonVariant> = { 0x3b4a66: 'blue', 0x5a3b8a: 'purple', 0x6b3b3b: 'red' };

/**
 * UIButton (DESIGN §3): 라운드 몸통 + 하단 진한 섀도(3D) + 상단 하이라이트 + Jua 라벨(+ Noto 서브 라벨).
 *  - 라벨에 줄바꿈이 있으면 첫 줄 = 메인(Jua), 나머지 = 서브(Noto 작게)
 *  - pressed: 몸통 y+8 & 섀도 제거(80ms) / disabled: 회색 + 섀도 제거 (알파는 낮추지 않음)
 */
export class Button extends Phaser.GameObjects.Container {
  private g: Phaser.GameObjects.Graphics;
  private main: Phaser.GameObjects.Text;
  private sub: Phaser.GameObjects.Text;
  private enabled = true;
  private pressed = false;
  private readonly bw: number;
  private readonly bh: number;
  private readonly shadow: number;
  private readonly radius: number;
  private variant: ButtonVariant;
  private labelText: string | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, text: string, onClick: () => void, opt: ButtonOptions = {}) {
    super(scene, x, y);
    this.bw = opt.width ?? 300;
    this.bh = opt.height ?? SIZE.btnM;
    this.variant = opt.variant ?? (opt.fill !== undefined ? LEGACY_FILL[opt.fill] ?? 'gold' : 'gold');
    this.shadow = Math.min(SIZE.btnShadow, Math.round(this.bh * 0.12));
    this.radius = Math.min(SIZE.radiusButton, (this.bh - this.shadow) / 2);
    const fs = opt.fontSize ?? SIZE.button;
    this.g = scene.add.graphics();
    this.main = scene.add.text(0, 0, '', { fontSize: `${fs}px`, fontFamily: FONT.display, align: 'center' }).setOrigin(0.5);
    this.sub = scene.add.text(0, 0, '', { fontSize: `${Math.max(SIZE.tiny, Math.round(fs * 0.62))}px`, fontFamily: FONT.body, fontStyle: '700', align: 'center' }).setOrigin(0.5);
    this.add([this.g, this.main, this.sub]);
    this.setSize(this.bw, this.bh);
    this.setInteractive({ useHandCursor: true });
    // 스와이프 제스처와 구분: 누른 뒤 거의 움직이지 않고 뗐을 때만 클릭
    this.on('pointerdown', () => { if (this.enabled) this.setPressed(true); });
    this.on('pointerout', () => this.setPressed(false));
    this.on('pointerup', (p: Phaser.Input.Pointer) => {
      const was = this.pressed;
      this.setPressed(false);
      if (this.enabled && was && p.getDistance() < TAP_SLOP) { sfx('tap'); onClick(); }
    });
    this.setLabel(text);
    scene.add.existing(this);
  }

  setLabel(text: string): this {
    if (text === this.labelText) return this; // 매 프레임 호출돼도 다시 그리지 않음
    this.labelText = text;
    const [first, ...rest] = text.split('\n');
    this.main.setText(first);
    this.sub.setText(rest.join('\n')).setVisible(rest.length > 0);
    this.redraw();
    return this;
  }

  setVariant(v: ButtonVariant): this {
    if (v === this.variant) return this;
    this.variant = v;
    this.redraw();
    return this;
  }

  setEnabled(on: boolean): this {
    if (on === this.enabled && !this.pressed) return this;
    this.enabled = on;
    if (!on) this.pressed = false;
    this.redraw();
    return this;
  }

  get isEnabled(): boolean { return this.enabled; }

  private setPressed(p: boolean): void {
    if (this.pressed === p) return;
    this.pressed = p;
    this.redraw();
  }

  private redraw(): void {
    const v = VARIANT[this.variant];
    const on = this.enabled;
    const body = on ? v.body : COLOR.grayDark;
    const bodyH = this.bh - this.shadow;
    // 눌림/비활성: 몸통이 섀도 자리로 내려앉음
    const sunk = this.pressed || !on;
    const dy = sunk ? Math.min(SIZE.pressDy, this.shadow) : 0;
    const top = -this.bh / 2 + dy;
    const g = this.g.clear();
    if (!sunk) g.fillStyle(v.dark).fillRoundedRect(-this.bw / 2, -this.bh / 2 + this.shadow, this.bw, bodyH, this.radius);
    g.fillStyle(body).fillRoundedRect(-this.bw / 2, top, this.bw, bodyH, this.radius);
    if (on) {
      glossTop(g, 0, top + bodyH / 2, this.bw, bodyH, this.radius, 0.2);
      g.lineStyle(2, 0xffffff, 0.55).lineBetween(-this.bw / 2 + this.radius, top + 2, this.bw / 2 - this.radius, top + 2);
    }
    const textColor = on ? hex(v.text) : hex(COLOR.textSub);
    const onGold = on && this.variant === 'gold';
    this.main.setColor(textColor).setStroke(onGold ? hex(COLOR.textGold) : hex(on ? v.dark : COLOR.navyDark), onGold ? 0 : 4);
    this.sub.setColor(textColor).setAlpha(0.9).setStroke(hex(on ? v.dark : COLOR.navyDark), onGold ? 0 : 3);
    // 라벨 배치 (몸통 중앙)
    const cy = top + bodyH / 2;
    if (this.sub.visible && this.sub.text) {
      const total = this.main.height + this.sub.height - 6;
      this.main.setY(cy - total / 2 + this.main.height / 2);
      this.sub.setY(this.main.y + this.main.height / 2 + this.sub.height / 2 - 6);
    } else {
      this.main.setY(cy);
    }
    // 폭을 넘는 라벨은 축소
    const maxW = this.bw - 24;
    for (const t of [this.main, this.sub]) t.setScale(t.width > maxW ? maxW / t.width : 1);
  }
}
