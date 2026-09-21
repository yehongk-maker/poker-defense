import Phaser from 'phaser';
import { GAME_WIDTH } from '../config.ts';
import { COLORS, FONT } from './theme.ts';

export interface TokenValues {
  hearts: number;
  heartsMax: number;
  gold: number;
  heroTokens: number;
  heroTokensMax: number;
  diamonds: number;
}

export const TOKEN_BAR_H = 64;

/**
 * 최상단 고정 토큰 바 (GDD 3.8): 하트 ♥ · 골드 💰 · 영웅 토큰 ● · 다이아 💎 를 항상 같은 자리에 표시.
 * 값이 바뀌면 해당 칩이 잠깐 커졌다 돌아온다.
 */
export class TokenBar {
  private chips: Record<keyof Omit<TokenValues, 'heartsMax' | 'heroTokensMax'>, { text: Phaser.GameObjects.Text; box: Phaser.GameObjects.Rectangle }>;
  private last: Partial<TokenValues> = {};

  constructor(private scene: Phaser.Scene) {
    scene.add.rectangle(GAME_WIDTH / 2, TOKEN_BAR_H / 2, GAME_WIDTH, TOKEN_BAR_H, 0x0e1220).setDepth(6);
    scene.add.rectangle(GAME_WIDTH / 2, TOKEN_BAR_H - 1, GAME_WIDTH, 2, COLORS.panelLine).setDepth(6);
    const defs: { key: keyof TokenBar['chips']; color: number; label: string }[] = [
      { key: 'hearts', color: 0x5a2a33, label: '♥' },
      { key: 'gold', color: 0x5a4a1a, label: '💰' },
      { key: 'heroTokens', color: 0x3a2a5a, label: '●' },
      { key: 'diamonds', color: 0x1f3a4a, label: '💎' },
    ];
    const w = 250, gap = 12;
    const x0 = (GAME_WIDTH - (defs.length * w + (defs.length - 1) * gap)) / 2 + w / 2;
    this.chips = {} as TokenBar['chips'];
    defs.forEach((d, i) => {
      const x = x0 + i * (w + gap);
      const box = scene.add.rectangle(x, TOKEN_BAR_H / 2, w, 46, d.color).setStrokeStyle(2, COLORS.panelLine).setDepth(6);
      const text = scene.add.text(x, TOKEN_BAR_H / 2, `${d.label} -`, { fontSize: '30px', color: COLORS.text, fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0.5).setDepth(7);
      this.chips[d.key] = { text, box };
    });
  }

  set(v: TokenValues): void {
    const labels: Record<keyof TokenBar['chips'], string> = {
      hearts: `♥ ${v.hearts} / ${v.heartsMax}`,
      gold: `💰 ${Math.floor(v.gold)}`,
      heroTokens: `● ${v.heroTokens} / ${v.heroTokensMax}`,
      diamonds: `💎 ${v.diamonds}`,
    };
    (Object.keys(labels) as (keyof TokenBar['chips'])[]).forEach((k) => {
      const chip = this.chips[k];
      chip.text.setText(labels[k]);
      const cur = v[k as keyof TokenValues];
      if (this.last[k as keyof TokenValues] !== undefined && this.last[k as keyof TokenValues] !== cur) {
        this.scene.tweens.killTweensOf(chip.text);
        chip.text.setScale(1.25);
        this.scene.tweens.add({ targets: chip.text, scale: 1, duration: 260, ease: 'Back.easeOut' });
        chip.text.setColor(cur > (this.last[k as keyof TokenValues] as number) ? '#8fe3ff' : '#ff9a9a');
        this.scene.time.delayedCall(500, () => chip.text.setColor(COLORS.text));
      }
      this.last[k as keyof TokenValues] = cur;
    });
    // 하트가 적으면 붉게 강조
    this.chips.hearts.box.setFillStyle(v.hearts <= 3 ? 0x8a2a2a : 0x5a2a33);
  }
}
