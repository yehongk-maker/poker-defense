import Phaser from 'phaser';
import type { GameLoop, HeroDef } from '../systems/GameLoop.ts';
import type { Suit } from '../systems/PokerEvaluator.ts';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { Button } from './Button.ts';
import { CLASS_NAME, COLORS, FONT, SUIT_COLOR, SUIT_NAME, SUIT_SYMBOL } from './theme.ts';

export interface UpgradePanelCallbacks {
  onUpgrade: (suit: Suit) => void;
  onSummonHero: (heroId: string) => void;
  onClose: () => void;
}

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

interface HeroCard {
  def: HeroDef;
  bg: Phaser.GameObjects.Rectangle;
  status: Phaser.GameObjects.Text;
  btn: Button;
}

/**
 * 상점 & 영웅 화면 (GDD 4, 오른쪽으로 스와이프 → 왼쪽에서 들어옴):
 *  종족 업그레이드 4종 / 영웅 토큰 ●●○ / 영웅 선택(8종, 기본 4 + 메타 4 잠금)
 * 업그레이드·소환은 정비 페이즈에서만 가능 (GameLoop 제약) — 다른 페이즈엔 버튼 비활성 + 안내.
 */
export class UpgradePanel extends Phaser.GameObjects.Container {
  private phaseHint: Phaser.GameObjects.Text;
  private upgradeBtns: Record<Suit, Button>;
  private shardText: Phaser.GameObjects.Text;
  private gradeText: Phaser.GameObjects.Text;
  private heroCards: HeroCard[] = [];

  constructor(scene: Phaser.Scene, loop: GameLoop, private cb: UpgradePanelCallbacks, private attackPctPerLevel: number) {
    super(scene, GAME_WIDTH, 0);
    // 배경: 아래 화면 입력 차단
    const bg = scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bg).setInteractive();
    const line = scene.add.rectangle(GAME_WIDTH - 2, GAME_HEIGHT / 2, 4, GAME_HEIGHT, COLORS.panelLine);
    this.add([bg, line]);

    // 헤더
    this.add(scene.add.rectangle(GAME_WIDTH / 2, 90, GAME_WIDTH, 180, COLORS.panel));
    this.add(scene.add.text(40, 70, '상점 & 영웅', { fontSize: '46px', color: COLORS.text, fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0, 0.5));
    this.phaseHint = scene.add.text(40, 130, '', { fontSize: '26px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(0, 0.5);
    this.add(this.phaseHint);
    this.add(new Button(scene, GAME_WIDTH - 170, 90, '게임 화면 ▶', () => cb.onClose(), { width: 260, height: 90, fontSize: 30, fill: 0x3b4a66, textColor: COLORS.text }));

    // 1) 종족 업그레이드
    this.add(this.section(scene, 250, '종족 업그레이드', '이번 판 한정 · 공격력 +6%/Lv · 비용 50×1.4^Lv'));
    const bw = 236;
    const x0 = (GAME_WIDTH - (4 * bw + 3 * 16)) / 2 + bw / 2;
    this.upgradeBtns = {} as Record<Suit, Button>;
    SUITS.forEach((s, i) => {
      const b = new Button(scene, x0 + i * (bw + 16), 370, '', () => cb.onUpgrade(s), { width: bw, height: 130, fontSize: 26, fill: 0x3b4a66, textColor: COLORS.text });
      this.upgradeBtns[s] = b;
      this.add(b);
    });

    // 2) 영웅 토큰
    this.add(this.section(scene, 500, '영웅 토큰', '플러시 이상 달성 시 획득 · 3개 = 영웅 소환 1회'));
    this.shardText = scene.add.text(40, 570, '', { fontSize: '44px', color: '#f1d17a', fontFamily: FONT }).setOrigin(0, 0.5);
    this.gradeText = scene.add.text(GAME_WIDTH - 40, 570, '', { fontSize: '28px', color: COLORS.textDim, fontFamily: FONT, align: 'right' }).setOrigin(1, 0.5);
    this.add([this.shardText, this.gradeText]);

    // 3) 영웅 선택
    this.add(this.section(scene, 660, '영웅 선택 (판당 1기 · 수트별 기본/메타/대공)', '일찍 소환할수록 강함: 남은 웨이브 20+ = S(×1.5) · 10+ = A · 그 외 B(×0.7). 근접 영웅은 지상만, 대공 영웅은 공중 특화'));
    // 12종 = 3열(기본/메타/대공 순 아님: 정의 순) × 4행
    const cols = 3, cw = 328, ch = 262, gapX = 12, gapY = 12;
    const cx0 = (GAME_WIDTH - (cols * cw + (cols - 1) * gapX)) / 2 + cw / 2;
    const cy0 = 730 + ch / 2;
    // 수트별로 묶어 한 행에 ♠♥♦♣ 순이 되도록 정렬: 행 = 기본/메타/대공 순서
    const order = [...loop.allHeroes].sort((a, b) => {
      const si = ['S', 'H', 'D', 'C'];
      return si.indexOf(a.suit) - si.indexOf(b.suit) || loop.allHeroes.indexOf(a) - loop.allHeroes.indexOf(b);
    });
    order.forEach((h, i) => {
      const x = cx0 + (i % cols) * (cw + gapX);
      const y = cy0 + Math.floor(i / cols) * (ch + gapY);
      this.add(this.heroCard(scene, h, x, y, cw, ch));
    });

    this.add(scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 36, '◀ 왼쪽으로 스와이프하면 게임 화면', { fontSize: '24px', color: COLORS.textMuted, fontFamily: FONT }).setOrigin(0.5));
    scene.add.existing(this);
  }

  refresh(loop: GameLoop): void {
    const manage = loop.phase === 'manage';
    this.phaseHint.setText(manage ? `💰 ${Math.floor(loop.gold)} · 정비 중 — 구매/소환 가능` : `💰 ${Math.floor(loop.gold)} · 구매/소환은 정비 페이즈(소환 직후)에서`);

    for (const s of SUITS) {
      const cost = loop.upgradeCost(s);
      const lv = loop.upgrades[s];
      const b = this.upgradeBtns[s];
      const bonus = lv * this.attackPctPerLevel;
      if (cost === null) b.setLabel(`${SUIT_SYMBOL[s]} ${SUIT_NAME[s]} MAX\n공격 +${bonus}%`).setEnabled(false);
      else b.setLabel(`${SUIT_SYMBOL[s]} ${SUIT_NAME[s]} Lv${lv}\n💰${cost} · +${bonus}%`).setEnabled(manage && loop.gold >= cost);
    }

    const need = 3;
    const dots = '●'.repeat(Math.min(loop.shards, need)) + '○'.repeat(Math.max(0, need - Math.min(loop.shards, need)));
    this.shardText.setText(`${dots}  ${loop.shards}/${need}`);
    const grade = loop.heroGradeNow;
    this.gradeText.setText(loop.hero ? `소환 완료: ${loop.hero.def.name} ${loop.hero.grade}급` : `지금 소환하면 ${grade}급\n(웨이브 ${loop.wave})`);

    for (const c of this.heroCards) {
      const unlocked = loop.isHeroUnlocked(c.def.id);
      const isMine = loop.hero?.def.id === c.def.id;
      c.bg.setStrokeStyle(isMine ? 5 : 3, isMine ? COLORS.goldLight : unlocked ? SUIT_COLOR[c.def.suit] : COLORS.panelLine);
      c.bg.setAlpha(unlocked ? 1 : 0.55);
      if (isMine) {
        c.status.setText(`소환됨 · ${loop.hero!.grade}급`).setColor('#f1d17a');
        c.btn.setLabel('소환됨').setEnabled(false);
      } else if (!unlocked) {
        c.status.setText('🔒 메타 해금 (다이아)').setColor(COLORS.textMuted);
        c.btn.setLabel('잠김').setEnabled(false);
      } else if (loop.hero) {
        c.status.setText('판당 1기 제한').setColor(COLORS.textMuted);
        c.btn.setLabel('소환').setEnabled(false);
      } else {
        const can = manage && loop.canSummonHero;
        c.status.setText(can ? `소환 가능 · ${grade}급` : loop.canSummonHero ? '정비 페이즈에서 소환' : `영웅 토큰 ${loop.shards}/${need}`).setColor(can ? '#5fcf7a' : COLORS.textDim);
        c.btn.setLabel(`${grade}급 소환`).setEnabled(can);
      }
    }
  }

  private section(scene: Phaser.Scene, y: number, title: string, sub: string): Phaser.GameObjects.Container {
    const c = scene.add.container(0, y);
    c.add(scene.add.text(40, 0, title, { fontSize: '34px', color: COLORS.text, fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0, 0.5));
    c.add(scene.add.text(40, 40, sub, { fontSize: '22px', color: COLORS.textMuted, fontFamily: FONT }).setOrigin(0, 0.5));
    return c;
  }

  private heroCard(scene: Phaser.Scene, h: HeroDef, x: number, y: number, w: number, ht: number): Phaser.GameObjects.Container {
    const c = scene.add.container(x, y);
    const bg = scene.add.rectangle(0, 0, w, ht, COLORS.panel).setStrokeStyle(3, SUIT_COLOR[h.suit]);
    const left = -w / 2 + 20;
    const top = -ht / 2 + 18;
    const title = scene.add.text(left, top, `${SUIT_SYMBOL[h.suit]} ${h.name}`, { fontSize: '26px', color: `#${SUIT_COLOR[h.suit].toString(16).padStart(6, '0')}`, fontFamily: FONT, fontStyle: 'bold' });
    const tg = h.combat.targets ?? 'both';
    const tgText = tg === 'ground' ? '지상' : tg === 'air' ? '공중만' : '지상·공중';
    const tag = scene.add.text(w / 2 - 14, top + 4, `${h.unlock === 'basic' ? '기본' : '메타'} · ${tgText}`, { fontSize: '17px', color: tg === 'air' ? '#6fb7ff' : tg === 'ground' ? '#c9a06a' : COLORS.textMuted, fontFamily: FONT }).setOrigin(1, 0);
    const passive = scene.add.text(left, top + 38, `패시브: ${this.passiveText(h)}`, { fontSize: '18px', color: COLORS.text, fontFamily: FONT, wordWrap: { width: w - 30 } });
    const a = h.active;
    const active = scene.add.text(left, top + 96, `액티브: ${a.name} (${a.cooldownSec}s) — ${a.desc}`, { fontSize: '17px', color: COLORS.textDim, fontFamily: FONT, wordWrap: { width: w - 30 } });
    const status = scene.add.text(left, ht / 2 - 32, '', { fontSize: '17px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(0, 0.5);
    const btn = new Button(scene, w / 2 - 82, ht / 2 - 36, '소환', () => this.cb.onSummonHero(h.id), { width: 140, height: 54, fontSize: 21 });
    c.add([bg, title, tag, passive, active, status, btn]);
    this.heroCards.push({ def: h, bg, status, btn });
    return c;
  }

  private passiveText(h: HeroDef): string {
    const p = h.passive as Record<string, unknown>;
    const pct = p.pct as number;
    switch (p.type) {
      case 'suit_attack_pct': return `${SUIT_SYMBOL[p.suit as Suit]} 유닛 공격력 +${pct}%`;
      case 'class_count': return `${CLASS_NAME[p.class as string] ?? p.class} 시너지 +${p.plus} 카운트`;
      case 'global_attack_speed_pct': return `전체 공속 +${pct}%`;
      case 'life_save_chance_pct': return `하트 피해 ${pct}% 확률 무효`;
      case 'kill_gold_pct': return `처치 골드 +${pct}%`;
      case 'suit_aoe_radius_pct': return `${SUIT_SYMBOL[p.suit as Suit]} 유닛 광역 범위 +${pct}%`;
      case 'chain_targets_plus': return `뇌전 연쇄 대상 +${p.plus}`;
      case 'air_attack_pct': return p.scope === 'suit' ? `${SUIT_SYMBOL[p.suit as Suit]} 유닛 공중 피해 +${pct}%` : `전체 유닛 공중 피해 +${pct}%`;
      case 'air_slow_pct': return `공중 적 이속 -${pct}%`;
      case 'air_kill_gold_mult': return `공중 적 처치 골드 ×${p.mult}`;
      default: return String(p.type);
    }
  }
}
