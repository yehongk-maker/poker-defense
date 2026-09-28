import Phaser from 'phaser';
import type { Card, HandResult } from '../systems/PokerEvaluator.ts';
import { RANK_TIER, TIER_STYLE, applyTierStyle, fitTextWidth, rainbowColor } from './HandFx.ts';
import { GAME_WIDTH } from '../config.ts';
import { Button } from './Button.ts';
import { TimerRing } from './TimerRing.ts';
import { ALPHA, COLOR, FONT, OUTLINE, SIZE, SUIT_CARD_COLOR, SUIT_SYMBOL, TAP_SLOP, hex, rankLabel, HAND_NAME } from './theme.ts';
import { ticketIcon } from './draw.ts';

export interface CardHandCallbacks {
  /** 카드 탭 = 그 카드 1장 교환 (기본 교환이 남았거나 교환권이 있을 때만 호출됨) */
  onExchange: (index: number) => void;
  onConfirm: () => void;
}

/** 교환 현황 (씬이 CardPhase·MetaProgress에서 읽어 넘김) */
export interface ExchangeStatus {
  /** 카드별 남은 기본 교환 횟수 */
  left: readonly number[];
  /** 사용한 기본 교환 / 총 기본 교환 */
  used: number;
  total: number;
  /** 보유 카드 교환권 */
  tickets: number;
  /** 이번 라운드 교환권 사용 횟수 */
  ticketsUsed: number;
  /** 카드별: 이 카드를 바꾸면 나머지와 어울리는 카드가 덱에 몇 장 (행운 드로우, 보정 꺼져 있으면 빈 배열) */
  outs?: readonly number[];
  /** 행운 게이지: 종류별 현재 배율 (1보다 클 때만 표시) */
  pity?: { label: string; mult: number }[];
}

const CARD_W = SIZE.cardW;
const CARD_H = SIZE.cardH;
const OVERLAP = 14;                      // DESIGN §4: 겹침 -14px
const FAN_DEG = [-9, -4.5, 0, 4.5, 9];   // 부채꼴 -9°~9°
const FAN_DY = [14, 4, 0, 4, 14];        // 바깥 카드일수록 살짝 아래
const FLIP_MS = 160;      // 반 바퀴(앞→옆, 옆→앞) 시간
const DEAL_STAGGER = 220; // 배분 시 카드 간 오픈 간격
const ROW_Y = CARD_H / 2 + 110;          // 진행 버튼 행 (카드 중심 기준)

type TagKind = 'exchange' | 'ticket' | 'done' | 'none';

interface CardView {
  root: Phaser.GameObjects.Container;
  front: Phaser.GameObjects.Container;
  back: Phaser.GameObjects.Container;
  face: Phaser.GameObjects.Graphics;
  rank: Phaser.GameObjects.Text;
  small: Phaser.GameObjects.Text;
  suit: Phaser.GameObjects.Text;
  tagBg: Phaser.GameObjects.Graphics;
  tag: Phaser.GameObjects.Text;
  outs: Phaser.GameObjects.Text;
  faceUp: boolean;
  baseY: number;
  /** 현재 앞면에 그려진 카드 (족보 구성 카드 강조용) */
  cardRef?: Card;
}

/**
 * 손패 (DESIGN §4 HandCard, §5-02): 132×184 흰 카드 5장 부채꼴 + 진행 행(교환 현황 알약 · 진행 gold · 타이머 링).
 *  - 배분: 뒷면으로 받아 한 장씩 뒤집으며 오픈 (긴장감), 다 열리기 전엔 족보 '???'
 *  - 교환: 카드를 탭하면 그 카드만 뒤집혀 새 카드로 오픈. 카드당 1회(메타 2회) + 교환권
 *  - 족보 구성 카드 = 골드 3px 아웃라인 + 살짝 올라옴
 */
export class CardHand extends Phaser.GameObjects.Container {
  private cards: CardView[] = [];
  private confirmBtn: Button;
  private timer: TimerRing;
  private hintText: Phaser.GameObjects.Text;
  private rankText: Phaser.GameObjects.Text;
  private rankTier = -1;
  private pulse: Phaser.Tweens.Tween | null = null;
  /** 진행 중인 뒤집기 수 (0이면 입력 가능) */
  private busy = 0;
  private lastResult: HandResult | null = null;
  private exchangeLeft: number[] = [0, 0, 0, 0, 0];
  private status: ExchangeStatus = { left: [0, 0, 0, 0, 0], used: 0, total: 5, tickets: 0, ticketsUsed: 0 };
  private infoBg: Phaser.GameObjects.Graphics;
  private countText: Phaser.GameObjects.Text;
  private ticketText: Phaser.GameObjects.Text;
  private pityText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, y: number, private cb: CardHandCallbacks) {
    super(scene, 0, y);
    const step = CARD_W - OVERLAP;
    const x0 = GAME_WIDTH / 2 - 2 * step;
    for (let i = 0; i < 5; i++) {
      const root = scene.add.container(x0 + i * step, FAN_DY[i]).setAngle(FAN_DEG[i]);
      // 앞면
      const face = scene.add.graphics();
      const rank = scene.add.text(-CARD_W / 2 + 12, -CARD_H / 2 + 6, '', { fontSize: '44px', fontFamily: FONT.body, fontStyle: '900' });
      const small = scene.add.text(-CARD_W / 2 + 14, -CARD_H / 2 + 56, '', { fontSize: '26px', fontFamily: FONT.body, fontStyle: '900' });
      const suit = scene.add.text(8, 22, '', { fontSize: '76px', fontFamily: FONT.body }).setOrigin(0.5);
      const tagBg = scene.add.graphics();
      const tag = scene.add.text(0, CARD_H / 2 - 20, '', { fontSize: '19px', fontFamily: FONT.display }).setOrigin(0.5);
      // 행운 드로우: 이 카드를 바꾸면 어울리는 카드가 몇 장 남았는지 (우상단)
      const outs = scene.add.text(CARD_W / 2 - 8, -CARD_H / 2 + 8, '', { fontSize: '16px', fontFamily: FONT.body, fontStyle: '900', color: hex(COLOR.blueDark) }).setOrigin(1, 0);
      const front = scene.add.container(0, 0, [face, rank, small, suit, tagBg, tag, outs]);
      // 뒷면: navy + 골드 테두리 + 수트 문양
      const bg = scene.add.graphics();
      bg.fillStyle(0x000000, 0.25).fillRoundedRect(-CARD_W / 2, -CARD_H / 2 + 6, CARD_W, CARD_H, SIZE.radiusCard);
      bg.fillStyle(COLOR.navy).fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, SIZE.radiusCard);
      bg.lineStyle(4, COLOR.gold).strokeRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, SIZE.radiusCard);
      bg.lineStyle(2, COLOR.gold, 0.6).strokeRoundedRect(-CARD_W / 2 + 12, -CARD_H / 2 + 12, CARD_W - 24, CARD_H - 24, 8);
      const mark = scene.add.text(0, 0, '♠♥\n♦♣', { fontSize: '36px', color: hex(COLOR.gold), fontFamily: FONT.display, align: 'center' }).setOrigin(0.5);
      const back = scene.add.container(0, 0, [bg, mark]);
      root.add([back, front]);
      root.setSize(CARD_W, CARD_H).setInteractive({ useHandCursor: true });
      root.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (p.getDistance() < TAP_SLOP && this.busy === 0 && (this.exchangeLeft[i] > 0 || this.status.tickets > 0)) this.cb.onExchange(i);
      });
      const v: CardView = { root, front, back, face, rank, small, suit, tagBg, tag, outs, faceUp: true, baseY: FAN_DY[i] };
      this.drawFace(v, false);
      this.cards.push(v);
      this.add(root);
    }
    this.rankText = scene.add.text(GAME_WIDTH / 2, -CARD_H / 2 - 42, '', { fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5);
    this.add(this.rankText);
    // 행운 게이지 (족보 라벨 오른쪽 위, 게이지가 올라 있을 때만)
    // 타이머 링 위 빈 공간에 아래→위로 쌓이는 짧은 줄들 (레이즈 버튼·족보 라벨과 안 겹치게)
    this.pityText = scene.add.text(GAME_WIDTH - SIZE.gutter - 52, -66, '', { fontSize: `${SIZE.tiny}px`, color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE, strokeThickness: 3, align: 'right' }).setOrigin(1, 1);
    this.add(this.pityText);

    // 진행 행: [교환 현황 알약] [진행 → 소환 gold] + 우측 타이머 링(카드 옆)
    this.infoBg = scene.add.graphics();
    this.infoBg.fillStyle(COLOR.hudBg, ALPHA.hudBg).fillRoundedRect(SIZE.gutter, ROW_Y - SIZE.btnM / 2, 250, SIZE.btnM, SIZE.radiusButton);
    this.infoBg.lineStyle(3, COLOR.blue).strokeRoundedRect(SIZE.gutter, ROW_Y - SIZE.btnM / 2, 250, SIZE.btnM, SIZE.radiusButton);
    ticketIcon(this.infoBg, SIZE.gutter + 34, ROW_Y + 22, 26);
    this.countText = scene.add.text(SIZE.gutter + 20, ROW_Y - 20, '', { fontSize: '32px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0, 0.5);
    this.ticketText = scene.add.text(SIZE.gutter + 58, ROW_Y + 22, '', { fontSize: `${SIZE.caption}px`, color: hex(COLOR.textSub), fontFamily: FONT.body, fontStyle: '700' }).setOrigin(0, 0.5);
    this.confirmBtn = new Button(scene, GAME_WIDTH / 2 + 60, ROW_Y, '진행 → 소환', () => { if (this.busy === 0) this.cb.onConfirm(); }, { width: 440, height: SIZE.btnM, fontSize: SIZE.button, variant: 'gold' });
    this.timer = new TimerRing(scene, GAME_WIDTH - SIZE.gutter - SIZE.timerD / 2 - 6, 0);
    this.hintText = scene.add.text(GAME_WIDTH / 2, ROW_Y + 86, '', { fontSize: `${SIZE.caption}px`, color: hex(COLOR.textMain), fontFamily: FONT.body, ...OUTLINE, strokeThickness: 3 }).setOrigin(0.5).setAlpha(ALPHA.sub);
    this.add([this.infoBg, this.countText, this.ticketText, this.confirmBtn, this.timer, this.hintText]);
    scene.add.existing(this);
  }

  /** 새 라운드 배분: 전부 뒷면으로 놓고 한 장씩 오픈 */
  deal(hand: readonly Card[], status: ExchangeStatus, result: HandResult): void {
    this.lastResult = result;
    this.setStatus(status);
    this.rankTier = -1;
    this.pulse?.remove(); this.pulse = null;
    this.rankText.setText('? ? ?').setScale(1);
    applyTierStyle(this.rankText, 0);
    this.confirmBtn.setEnabled(false);
    this.hintText.setText('카드를 오픈하는 중…');
    hand.forEach((card, i) => {
      const v = this.cards[i];
      this.setFace(v, card);
      this.setTag(v, 'none');
      v.outs.setText('');
      this.drawFace(v, false);
      v.root.setY(v.baseY);
      this.showSide(v, false);
    });
    this.busy = hand.length;
    hand.forEach((_, i) => {
      this.scene.time.delayedCall(200 + i * DEAL_STAGGER, () => this.flip(this.cards[i], true, () => {
        this.busy--;
        if (this.busy === 0) this.afterReveal();
      }));
    });
  }

  /** 교환 결과 반영: 해당 카드만 뒤집어 새 카드로 오픈 */
  exchangeCard(index: number, card: Card, status: ExchangeStatus, result: HandResult): void {
    this.setStatus(status);
    this.lastResult = result;
    const v = this.cards[index];
    this.busy++;
    this.confirmBtn.setEnabled(false);
    this.rankText.setText('? ? ?');
    applyTierStyle(this.rankText, 0);
    this.rankTier = -1;
    this.flip(v, false, () => {
      this.setFace(v, card);
      this.setTag(v, 'none');
      v.outs.setText('');
      this.flip(v, true, () => {
        this.busy--;
        if (this.busy === 0) this.afterReveal();
      });
    });
  }

  /** 애니메이션 없이 즉시 갱신 (교환 횟수 표시 등) */
  refreshStatic(hand: readonly Card[], status: ExchangeStatus, result: HandResult): void {
    this.setStatus(status);
    this.lastResult = result;
    if (this.busy > 0) return;
    hand.forEach((card, i) => this.setFace(this.cards[i], card));
    this.afterReveal();
  }

  get isAnimating(): boolean { return this.busy > 0; }

  /** 교환 현황 갱신 (카운터·교환권은 즉시, 카드 태그는 오픈 완료 후) */
  setStatus(status: ExchangeStatus): void {
    this.status = { ...status, left: [...status.left] };
    this.exchangeLeft = [...status.left];
    const done = status.used >= status.total;
    this.countText.setText(`교환 ${status.used}/${status.total}${done ? ' ✓' : ''}`).setColor(hex(done ? COLOR.green : COLOR.textMain));
    const t = status.tickets;
    this.ticketText.setText(`교환권 ${t}장${status.ticketsUsed > 0 ? ` · 사용 ${status.ticketsUsed}` : ''}`).setColor(hex(t > 0 ? COLOR.textSub : COLOR.gray));
    const pity = (status.pity ?? []).filter((p) => p.mult > 1);
    const fmt = (m: number) => (Number.isInteger(m) ? `${m}` : m.toFixed(1));
    this.pityText.setText(pity.length ? ['행운 게이지', ...pity.map((p) => `${p.label} ×${fmt(p.mult)}`)].join('\n') : '');
    if (this.busy === 0 && this.lastResult) this.cards.forEach((v, i) => this.setTag(v, this.tagKind(i)));
  }

  /** 우상단 아웃 수: 교환 가능한 카드에만 */
  private setOuts(v: CardView, i: number): void {
    const kind = this.tagKind(i);
    const n = this.status.outs?.[i];
    v.outs.setText(kind !== 'done' && n !== undefined && n > 0 ? `아웃 ${n}` : '');
  }

  /** 남은 시간 (타이머 링) */
  setTimer(sec: number, total = 30): void {
    this.timer.set(sec, total);
  }

  /** 매 프레임 (tier 5 무지개 순환) */
  update(timeMs: number): void {
    if (this.rankTier >= 5 && this.visible) this.rankText.setColor(rainbowColor(timeMs));
  }

  /** 족보 라벨의 씬 좌표 (연출 위치용) */
  get rankLabelPosition(): { x: number; y: number } {
    return { x: this.x + this.rankText.x, y: this.y + this.rankText.y };
  }

  // ── 내부 ──
  private tagKind(i: number): TagKind {
    const left = this.exchangeLeft[i];
    return left > 0 ? 'exchange' : this.status.tickets > 0 ? 'ticket' : 'done';
  }

  private afterReveal(): void {
    if (!this.lastResult) return;
    const result = this.lastResult;
    const core = new Set(result.coreCards);
    this.cards.forEach((v, i) => {
      const isCore = v.faceUp && core.has(v.cardRef!) && result.rank > 0;
      this.drawFace(v, isCore);
      this.scene.tweens.add({ targets: v.root, y: v.baseY - (isCore ? 18 : 0), duration: 180, ease: 'Back.easeOut' });
      this.setTag(v, this.tagKind(i));
      this.setOuts(v, i);
    });
    this.setRank(result);
    const st = this.status;
    const left = st.total - st.used;
    const assist = st.outs && st.outs.length ? ' · 행운 드로우: 남긴 카드와 어울리는 카드가 2배 잘 나와요' : '';
    if (left > 0) this.hintText.setText(`카드를 탭하면 그 카드만 교환 · 남은 ${left}회${assist}`);
    else if (st.tickets > 0) this.hintText.setText(`기본 교환 완료 · 카드를 탭하면 교환권 1장으로 한 번 더 (남은 ${st.tickets}장)`);
    else this.hintText.setText('교환 완료 · 진행하세요 (교환권은 상점에서 다이아로 구매)');
    this.confirmBtn.setEnabled(true);
  }

  /** 흰 라운드 카드 (구성 카드 = 골드 3px 아웃라인) */
  private drawFace(v: CardView, core: boolean): void {
    const g = v.face.clear();
    g.fillStyle(0x000000, 0.25).fillRoundedRect(-CARD_W / 2, -CARD_H / 2 + 6, CARD_W, CARD_H, SIZE.radiusCard);
    g.fillStyle(0xffffff).fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, SIZE.radiusCard);
    if (core) g.lineStyle(3, COLOR.gold).strokeRoundedRect(-CARD_W / 2 - 1, -CARD_H / 2 - 1, CARD_W + 2, CARD_H + 2, SIZE.radiusCard);
    else g.lineStyle(2, COLOR.gray, 0.5).strokeRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, SIZE.radiusCard);
  }

  /** 카드 하단 태그: 교환(골드) / 교환권(블루) / 완료(회색) */
  private setTag(v: CardView, kind: TagKind): void {
    v.tagBg.clear();
    if (kind === 'none') { v.tag.setText(''); return; }
    const spec = {
      exchange: { fill: COLOR.gold, text: COLOR.textOnGold, label: '교환' },
      ticket: { fill: COLOR.blue, text: COLOR.textMain, label: '교환권' },
      done: { fill: COLOR.gray, text: COLOR.textMain, label: '완료' },
    }[kind];
    v.tag.setText(spec.label).setColor(hex(spec.text));
    const w = v.tag.width + 22, h = 28, y = CARD_H / 2 - 20;
    v.tagBg.fillStyle(spec.fill).fillRoundedRect(-w / 2, y - h / 2, w, h, h / 2);
  }

  private setFace(v: CardView, card: Card): void {
    const color = SUIT_CARD_COLOR[card.suit];
    v.rank.setText(rankLabel(card.rank)).setColor(color);
    v.small.setText(SUIT_SYMBOL[card.suit]).setColor(color);
    v.suit.setText(SUIT_SYMBOL[card.suit]).setColor(color);
    v.cardRef = card;
  }

  private showSide(v: CardView, faceUp: boolean): void {
    v.front.setVisible(faceUp);
    v.back.setVisible(!faceUp);
    v.faceUp = faceUp;
  }

  /** 뒤집기: scaleX 1→0 (옆면) → 면 교체 → 0→1 */
  private flip(v: CardView, toFaceUp: boolean, onDone: () => void): void {
    this.scene.tweens.add({
      targets: v.root, scaleX: 0, duration: FLIP_MS, ease: 'Sine.easeIn',
      onComplete: () => {
        this.showSide(v, toFaceUp);
        this.scene.tweens.add({ targets: v.root, scaleX: 1, duration: FLIP_MS, ease: 'Sine.easeOut', onComplete: onDone });
      },
    });
  }

  private setRank(result: HandResult): void {
    const tier = RANK_TIER[result.rank];
    const stars = tier >= 3 ? ' ' + '✦'.repeat(tier - 2) : '';
    this.rankText.setText(`${stars}${HAND_NAME[result.rank]}${stars}`);
    if (tier === this.rankTier) { fitTextWidth(this.rankText, GAME_WIDTH - 100); return; }
    this.rankTier = tier;
    applyTierStyle(this.rankText, tier);
    fitTextWidth(this.rankText, GAME_WIDTH - 100);
    this.pulse?.remove();
    this.pulse = null;
    this.rankText.setScale(1);
    // 오픈 완료 팝 (DESIGN §6: Back.easeOut)
    this.scene.tweens.add({ targets: this.rankText, scale: { from: 0.6, to: 1 }, duration: 220, ease: 'Back.easeOut' });
    const st = TIER_STYLE[tier];
    if (st.pulseMs > 0) {
      this.scene.time.delayedCall(240, () => {
        if (this.rankTier !== tier) return;
        this.pulse = this.scene.tweens.add({ targets: this.rankText, scale: 1 + tier * 0.03, duration: st.pulseMs / 2, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      });
    }
  }
}
