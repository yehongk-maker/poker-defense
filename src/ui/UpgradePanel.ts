import Phaser from 'phaser';
import { SHARD_LABEL, type GameLoop, type HeroDef } from '../systems/GameLoop.ts';
import { HERO_SHARD_TYPES, type HeroShardType } from '../systems/SummonMapper.ts';
import type { Suit } from '../systems/PokerEvaluator.ts';
import { GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { Button } from './Button.ts';
import { CLASS_NAME, COLORS, FONT, OUTLINE, SUIT_COLOR, SUIT_NAME, SUIT_SYMBOL, SUIT_TEXT_COLOR, hex, COLOR } from './theme.ts';

export interface UpgradePanelCallbacks {
  onUpgrade: (suit: Suit) => void;
  onSummonHero: (heroId: string) => void;
  onBuyTicket: () => void;
  onClose: () => void;
}

/** 카드 교환권 표시/구매에 필요한 메타 정보 */
export interface TicketInfo {
  tickets: number;
  gems: number;
  cost: number;
  max: number;
  canBuy: boolean;
}

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
/** 조각 게이지 레이아웃 (섹션 2) */
const SHARD_ROW_Y = 566, SHARD_ROW_H = 44, SHARD_SOCKET_X = 190, SHARD_HERO_X = 340, SHARD_WILD_X = 560;
/** 조각 종류 색 (DESIGN 토큰): 스트레이트=블루(연결), 플러시=퍼플(군단), 풀하우스=그린(수호), 와일드=골드 */
const SHARD_COLOR: Record<HeroShardType, number> = { straight: COLOR.blue, flush: COLOR.purple, fullHouse: COLOR.green };

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
  private shardGfx: Phaser.GameObjects.Graphics;
  private shardLabels: Record<HeroShardType, Phaser.GameObjects.Text>;
  private wildText: Phaser.GameObjects.Text;
  private gradeText: Phaser.GameObjects.Text;
  private lastShardKey = '';
  private ticketText: Phaser.GameObjects.Text;
  private ticketBtn: Button;
  private heroCards: HeroCard[] = [];

  constructor(scene: Phaser.Scene, loop: GameLoop, private cb: UpgradePanelCallbacks, private attackPctPerLevel: number) {
    super(scene, GAME_WIDTH, 0);
    // 배경: 아래 화면 입력 차단
    const bg = scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bg).setInteractive();
    const line = scene.add.rectangle(GAME_WIDTH - 2, GAME_HEIGHT / 2, 4, GAME_HEIGHT, COLORS.panelLine);
    this.add([bg, line]);

    // 헤더
    this.add(scene.add.rectangle(GAME_WIDTH / 2, 90, GAME_WIDTH, 180, COLORS.panel));
    this.add(scene.add.text(40, 70, '상점 & 영웅', { fontSize: '46px', color: COLORS.text, fontFamily: FONT.display, ...OUTLINE }).setOrigin(0, 0.5));
    this.phaseHint = scene.add.text(40, 130, '', { fontSize: '26px', color: COLORS.textDim, fontFamily: FONT.body }).setOrigin(0, 0.5);
    this.add(this.phaseHint);
    this.add(new Button(scene, GAME_WIDTH - 170, 90, '게임 화면 ▶', () => cb.onClose(), { width: 260, height: 90, fontSize: 32, variant: 'gray' }));

    // 1) 종족 업그레이드
    this.add(this.section(scene, 250, '종족 업그레이드', '이번 판 한정 · 공격력 +6%/Lv · 비용 50×1.4^Lv'));
    const bw = 236;
    const x0 = (GAME_WIDTH - (4 * bw + 3 * 16)) / 2 + bw / 2;
    this.upgradeBtns = {} as Record<Suit, Button>;
    SUITS.forEach((s, i) => {
      const b = new Button(scene, x0 + i * (bw + 16), 370, '', () => cb.onUpgrade(s), { width: bw, height: 130, fontSize: 30, variant: 'gold' });
      this.upgradeBtns[s] = b;
      this.add(b);
    });

    // 2) 영웅 조각 게이지 3줄 (DESIGN §5-04) · 카드 교환권 (오른쪽)
    this.add(this.section(scene, 500, '영웅 조각 · 카드 교환권', '스트레이트/플러시/풀하우스 조각 3개 = 그 조각의 영웅 소환 · 와일드는 어느 영웅에든 · 보스 클리어 시 랜덤 조각 2개   ·   교환권: 교환을 다 쓴 카드를 한 번 더'));
    this.shardGfx = scene.add.graphics();
    this.add(this.shardGfx);
    this.shardLabels = {} as Record<HeroShardType, Phaser.GameObjects.Text>;
    HERO_SHARD_TYPES.forEach((t, i) => {
      const y = SHARD_ROW_Y + i * SHARD_ROW_H;
      const label = scene.add.text(40, y, SHARD_LABEL[t], { fontSize: '24px', color: hex(SHARD_COLOR[t]), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0, 0.5);
      this.shardLabels[t] = label;
      this.add(label);
      // 게이지 옆: 그 조각으로 부르는 영웅 미니 아이콘 (수트 글리프)
      const owners = loop.allHeroes.filter((h) => h.shardType === t);
      owners.forEach((h, j) => {
        const x = SHARD_HERO_X + j * 36;
        const ic = scene.add.text(x, y, SUIT_SYMBOL[h.suit], { fontSize: '22px', color: hex(SUIT_TEXT_COLOR[h.suit]), fontFamily: FONT.display, ...OUTLINE, strokeThickness: 3 }).setOrigin(0.5);
        ic.setAlpha(h.unlock === 'basic' ? 1 : 0.45);
        this.add(ic);
      });
    });
    this.wildText = scene.add.text(SHARD_WILD_X, SHARD_ROW_Y + SHARD_ROW_H, '', { fontSize: '24px', color: hex(COLOR.textOnGold), fontFamily: FONT.display }).setOrigin(0.5);
    this.gradeText = scene.add.text(40, SHARD_ROW_Y + 3 * SHARD_ROW_H + 2, '', { fontSize: '22px', color: COLORS.textDim, fontFamily: FONT.body }).setOrigin(0, 0.5);
    this.ticketText = scene.add.text(GAME_WIDTH - 300, 600, '', { fontSize: '30px', color: '#8fe3ff', fontFamily: FONT.body, align: 'right' }).setOrigin(1, 0.5);
    this.ticketBtn = new Button(scene, GAME_WIDTH - 150, 600, '', () => cb.onBuyTicket(), { width: 250, height: 84, fontSize: 28, variant: 'purple' });
    this.add([this.wildText, this.gradeText, this.ticketText, this.ticketBtn]);

    // 3) 영웅 선택
    this.add(this.section(scene, 730, '영웅 선택 (판당 1기 · 조각 종류가 맞는 영웅만 소환 가능)', '일찍 소환할수록 강함: 남은 웨이브 20+ = S(×1.5) · 10+ = A · 그 외 B(×0.7). 카드 하단 "종류 n/3(+w)" = 그 조각 n개 + 와일드 w개. 근접 영웅은 지상만, 대공 영웅은 공중 특화'));
    // 12종 = 3열 × 4행
    const cols = 3, cw = 328, ch = 250, gapX = 12, gapY = 10;
    const cx0 = (GAME_WIDTH - (cols * cw + (cols - 1) * gapX)) / 2 + cw / 2;
    const cy0 = 796 + ch / 2;
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

    this.add(scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 36, '◀ 왼쪽으로 스와이프하면 게임 화면', { fontSize: '24px', color: COLORS.textMuted, fontFamily: FONT.body }).setOrigin(0.5));
    scene.add.existing(this);
  }

  refresh(loop: GameLoop, ticket?: TicketInfo): void {
    const manage = loop.phase === 'manage';
    if (ticket) {
      this.ticketText.setText(`🎫 교환권 ${ticket.tickets}/${ticket.max}장\n💎 ${ticket.gems} 보유`);
      this.ticketBtn.setLabel(ticket.tickets >= ticket.max ? '보관 최대' : `다이아 ${ticket.cost}\n교환권 구매`).setEnabled(ticket.canBuy);
    }
    this.phaseHint.setText(manage ? `💰 ${Math.floor(loop.gold)} · 정비 중 — 구매/소환 가능` : `💰 ${Math.floor(loop.gold)} · 구매/소환은 정비 페이즈(소환 직후)에서`);

    for (const s of SUITS) {
      const cost = loop.upgradeCost(s);
      const lv = loop.upgrades[s];
      const b = this.upgradeBtns[s];
      const bonus = lv * this.attackPctPerLevel;
      if (cost === null) b.setLabel(`${SUIT_SYMBOL[s]} ${SUIT_NAME[s]} MAX\n공격 +${bonus}%`).setEnabled(false);
      else b.setLabel(`${SUIT_SYMBOL[s]} ${SUIT_NAME[s]} Lv${lv}\n💰${cost} · +${bonus}%`).setEnabled(manage && loop.gold >= cost);
    }

    this.drawShardGauges(loop);
    const grade = loop.heroGradeNow;
    const drop = loop.heroGradeDrop;
    this.gradeText.setText(loop.hero ? `소환 완료: ${loop.hero.def.name} ${loop.hero.grade}급`
      : drop ? `지금 소환 시 ${grade}급 · 라운드 ${drop.until} 이후엔 ${drop.next}급으로 하락!` : `지금 소환 시 ${grade}급 (최하 등급)`);

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
        // DESIGN §5-07: 조각 종류가 맞는 영웅만 활성, 나머지는 진행도 표시
        const p = loop.heroProgress.find((p) => p.hero.id === c.def.id);
        const ready = !!p?.ready;
        const can = manage && ready;
        const t = c.def.shardType;
        // 버튼 왼쪽 공간이 좁아 짧게: "플러시 1/3(+1)" — (+n)은 와일드
        const progress = p ? `${SHARD_LABEL[t]} ${Math.min(p.need, p.typed)}/${p.need}${p.wild > 0 ? `(+${p.wild})` : ''}` : SHARD_LABEL[t];
        c.status.setText(can ? `소환 가능 · ${grade}급` : ready ? '정비 페이즈에서 소환' : progress).setColor(can ? '#5fcf7a' : ready ? COLORS.textDim : hex(SHARD_COLOR[t]));
        c.btn.setLabel(`${grade}급 소환`).setEnabled(can);
        c.bg.setAlpha(ready ? 1 : 0.7);
      }
    }
  }

  /** 조각 게이지: 종류별 소켓 3칸 (해당 조각 = 종류색, 와일드로 채워지는 칸 = 골드 테두리) + 와일드 뱃지 */
  private drawShardGauges(loop: GameLoop): void {
    const sh = loop.shards;
    const need = loop.heroProgress[0]?.need ?? 3;
    const free = loop.hasFreeHeroSummon;
    const key = `${sh.straight}/${sh.flush}/${sh.fullHouse}/${sh.wild}/${need}/${free}`;
    if (key === this.lastShardKey) return;
    this.lastShardKey = key;
    const g = this.shardGfx.clear();
    HERO_SHARD_TYPES.forEach((t, i) => {
      const y = SHARD_ROW_Y + i * SHARD_ROW_H;
      const typed = free ? need : sh[t];
      const wildFill = free ? 0 : Math.min(sh.wild, Math.max(0, need - typed));
      for (let k = 0; k < need; k++) {
        const x = SHARD_SOCKET_X + k * 40;
        g.fillStyle(COLOR.navyDark).fillCircle(x, y, 16);
        if (k < typed) {
          g.fillStyle(SHARD_COLOR[t]).fillCircle(x, y, 13);
          g.fillStyle(0xffffff, 0.35).fillCircle(x - 4, y - 4, 5);
        } else if (k < typed + wildFill) {
          g.fillStyle(COLOR.gold).fillCircle(x, y, 13);
          g.fillStyle(0xffffff, 0.35).fillCircle(x - 4, y - 4, 5);
        } else {
          g.lineStyle(2, COLOR.gray, 0.7).strokeCircle(x, y, 12);
        }
      }
      if (typed + wildFill >= need) g.lineStyle(3, COLOR.textGold, 0.9).strokeRoundedRect(SHARD_SOCKET_X - 24, y - 21, need * 40 + 8, 42, 21);
    });
    // 와일드 뱃지
    const wy = SHARD_ROW_Y + SHARD_ROW_H;
    g.fillStyle(COLOR.goldDark).fillRoundedRect(SHARD_WILD_X - 60, wy - 20 + 4, 120, 40, 20);
    g.fillStyle(COLOR.gold).fillRoundedRect(SHARD_WILD_X - 60, wy - 20, 120, 40, 20);
    this.wildText.setText(`와일드 ${free ? '∞' : sh.wild}`);
  }

  private section(scene: Phaser.Scene, y: number, title: string, sub: string): Phaser.GameObjects.Container {
    const c = scene.add.container(0, y);
    c.add(scene.add.text(40, 0, title, { fontSize: '34px', color: COLORS.text, fontFamily: FONT.display, ...OUTLINE }).setOrigin(0, 0.5));
    const t = scene.add.text(40, 40, sub, { fontSize: '22px', color: COLORS.textDim, fontFamily: FONT.body }).setOrigin(0, 0.5);
    // 화면 밖(닫힌 패널은 x=-1080)으로 삐져나와 보이지 않게 폭에 맞춰 축소
    if (t.width > GAME_WIDTH - 80) t.setScale((GAME_WIDTH - 80) / t.width);
    c.add(t);
    return c;
  }

  private heroCard(scene: Phaser.Scene, h: HeroDef, x: number, y: number, w: number, ht: number): Phaser.GameObjects.Container {
    const c = scene.add.container(x, y);
    const bg = scene.add.rectangle(0, 0, w, ht, COLORS.panel).setStrokeStyle(3, SUIT_COLOR[h.suit]);
    const left = -w / 2 + 20;
    const top = -ht / 2 + 18;
    const title = scene.add.text(left, top, `${SUIT_SYMBOL[h.suit]} ${h.name}`, { fontSize: '26px', color: hex(SUIT_TEXT_COLOR[h.suit]), fontFamily: FONT.display, ...OUTLINE });
    const tg = h.combat.targets ?? 'both';
    const tgText = tg === 'ground' ? '지상' : tg === 'air' ? '공중만' : '지상·공중';
    const tag = scene.add.text(w / 2 - 14, top + 4, `${h.unlock === 'basic' ? '기본' : '메타'} · ${tgText}`, { fontSize: '17px', color: tg === 'air' ? '#6fb7ff' : tg === 'ground' ? '#c9a06a' : COLORS.textMuted, fontFamily: FONT.body }).setOrigin(1, 0);
    const passive = scene.add.text(left, top + 38, `패시브: ${this.passiveText(h)}`, { fontSize: '18px', color: COLORS.text, fontFamily: FONT.body, wordWrap: { width: w - 30 } });
    const a = h.active;
    const active = scene.add.text(left, top + 96, `액티브: ${a.name} (${a.cooldownSec}s) — ${a.desc}`, { fontSize: '17px', color: COLORS.textDim, fontFamily: FONT.body, wordWrap: { width: w - 30 } });
    const status = scene.add.text(left, ht / 2 - 32, '', { fontSize: '17px', color: COLORS.textDim, fontFamily: FONT.body }).setOrigin(0, 0.5);
    const btn = new Button(scene, w / 2 - 82, ht / 2 - 36, '소환', () => this.cb.onSummonHero(h.id), { width: 140, height: 62, fontSize: 24, variant: 'gold' });
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
