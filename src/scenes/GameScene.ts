import Phaser from 'phaser';
import { SCENE, GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { loadGameData } from '../data/index.ts';
import { getMeta } from '../meta.ts';
import { GameLoop, type GameData } from '../systems/GameLoop.ts';
import { evaluateHand, type Suit } from '../systems/PokerEvaluator.ts';
import { HandFx, FX_CENTER, RANK_TIER } from '../ui/HandFx.ts';
import { HUD } from '../ui/HUD.ts';
import { CardHand } from '../ui/CardHand.ts';
import { TrackView } from '../ui/TrackView.ts';
import { ManagePanel } from '../ui/ManagePanel.ts';
import { UpgradePanel } from '../ui/UpgradePanel.ts';
import { SwipeController } from '../ui/SwipeController.ts';
import { SynergyCodex } from '../ui/SynergyCodex.ts';
import { Button } from '../ui/Button.ts';
import { COLORS, FONT, HAND_NAME, SUIT_SYMBOL } from '../ui/theme.ts';

const PANEL_Y = 1490; // 하단 패널 중심

/**
 * 게임 씬 — GameLoop(순수 로직)에 UI를 얇게 연결한다.
 *  card   : CardHand 표시, cardPhase.tick → 자동 확정
 *  manage : ManagePanel 표시 (업그레이드/합성/영웅/판매/전투 시작)
 *  combat : tickCombat → TrackView에 적/타격 그리기
 */
export class GameScene extends Phaser.Scene {
  private data_!: GameData;
  private loop!: GameLoop;
  private hud!: HUD;
  private hand!: CardHand;
  private track!: TrackView;
  private manage!: ManagePanel;
  private upgrades!: UpgradePanel;
  private swipe!: SwipeController;
  private fx!: HandFx;
  private codex!: SynergyCodex;
  private combatPanel!: Phaser.GameObjects.Container;
  private combatText!: Phaser.GameObjects.Text;
  private speedBtn!: Button;
  private skillBtn!: Button;
  private toast!: Phaser.GameObjects.Text;
  private selectedSlot = -1;
  private speed = 1;
  private ended = false;

  constructor() {
    super(SCENE.Game);
  }

  create(): void {
    this.data_ = getMeta().applyTo(loadGameData()); // 메타 업그레이드(교환 횟수·타이머·시작 골드·해금 영웅) 반영
    this.loop = new GameLoop(this.data_);
    this.selectedSlot = -1;
    this.speed = 1;
    this.ended = false;

    this.hud = new HUD(this, () => this.codex.open(this.loop));
    this.track = new TrackView(this);
    this.fx = new HandFx(this);
    this.codex = new SynergyCodex(this, () => this.codex.setVisible(false));
    this.add.rectangle(GAME_WIDTH / 2, 1560, GAME_WIDTH, 720, COLORS.panel);

    this.hand = new CardHand(this, PANEL_Y - 60, {
      onToggle: (i) => { this.loop.cardPhase.toggleSelect(i); this.refreshHand(); },
      onExchange: () => {
        const before = evaluateHand([...this.loop.cardPhase.hand], () => 0).rank;
        this.loop.cardPhase.exchange();
        this.refreshHand();
        const after = evaluateHand([...this.loop.cardPhase.hand], () => 0).rank;
        // 교환으로 족보가 올랐으면 패 위에서 작은 연출
        if (after > before && RANK_TIER[after] >= 1) {
          const p = this.hand.rankLabelPosition;
          this.fx.celebrate(after, p.x, p.y, false);
        }
      },
      onConfirm: () => this.confirmHand(),
    });

    this.manage = new ManagePanel(this, PANEL_Y, {
      onMerge: () => this.safe(() => {
        const ids = this.loop.mergeable;
        for (const id of ids) { try { const m = this.loop.mergeUnits(id); this.showToast(`합성 → ${m.def.name} T${m.def.tier}`); } catch { /* 경합 */ } }
        this.selectedSlot = -1;
      }),
      onSell: () => this.safe(() => {
        const u = this.loop.unitAtSlot(this.selectedSlot);
        const idx = u ? this.loop.units.indexOf(u) : -1;
        if (idx < 0) throw new Error('판매할 유닛을 탭하세요');
        const g = this.loop.sellUnit(idx);
        this.selectedSlot = -1;
        this.showToast(`판매 +💰${g}`);
      }),
      onOpenUpgrades: () => this.swipe.open(),
      onStart: () => this.safe(() => {
        this.loop.startCombat();
        this.selectedSlot = -1;
        this.refreshPanels();
      }),
    });

    // 스와이프 업그레이드/영웅 화면 (GDD 4 우측 화면)
    this.upgrades = new UpgradePanel(this, this.loop, {
      onUpgrade: (s: Suit) => this.safe(() => { this.loop.buyUpgrade(s); this.showToast(`${SUIT_SYMBOL[s]} 공격력 Lv${this.loop.upgrades[s]}`); }),
      onSummonHero: (id) => this.safe(() => {
        const r = this.loop.summonHero(id);
        this.showToast(`영웅 소환: ${r.def.name} ${r.grade}급`);
      }),
      onClose: () => this.swipe.close(),
    }, this.data_.config.upgrade.attackPctPerLevel).setDepth(10);
    this.swipe = new SwipeController(this, this.upgrades, (open) => { if (open) this.upgrades.refresh(this.loop); });
    // 우측 가장자리 탭 핸들 (모든 페이즈에서 열기 가능)
    const handle = this.add.rectangle(GAME_WIDTH - 22, 690, 44, 220, COLORS.panel).setStrokeStyle(2, COLORS.panelLine).setInteractive({ useHandCursor: true });
    handle.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.getDistance() < 24) this.swipe.open(); });
    this.add.text(GAME_WIDTH - 22, 690, '◀ 업그레이드', { fontSize: '22px', color: COLORS.textDim, fontFamily: FONT }).setOrigin(0.5).setAngle(-90);

    // 전투 패널
    this.combatText = this.add.text(GAME_WIDTH / 2, PANEL_Y - 40, '', { fontSize: '36px', color: COLORS.text, fontFamily: FONT, align: 'center' }).setOrigin(0.5);
    this.speedBtn = new Button(this, GAME_WIDTH / 2, PANEL_Y + 90, '⏩ 1×', () => {
      this.speed = this.speed >= 3 ? 1 : this.speed + 1;
      this.speedBtn.setLabel(`⏩ ${this.speed}×`);
    }, { width: 300, height: 100, fontSize: 34, fill: 0x3b4a66, textColor: COLORS.text });
    // 영웅 액티브 스킬 버튼 (전투 중, 쿨타임 표시)
    this.skillBtn = new Button(this, GAME_WIDTH / 2 - 250, PANEL_Y + 90, '영웅 없음', () => this.safe(() => {
      const r = this.loop.useHeroSkill();
      this.showToast(`${r.name}: ${r.text}`);
      this.cameras.main.flash(140, 241, 209, 122);
      const hero = this.loop.hero;
      if (hero) this.track.pulseCell(hero.unit.slot);
    }), { width: 420, height: 100, fontSize: 28, fill: 0x5a3b8a, textColor: COLORS.text });
    this.speedBtn.setX(GAME_WIDTH / 2 + 170);
    this.combatPanel = this.add.container(0, 0, [this.combatText, this.speedBtn, this.skillBtn]);

    this.toast = this.add.text(GAME_WIDTH / 2, 1215, '', { fontSize: '32px', color: '#f1d17a', fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0.5).setAlpha(0).setDepth(20);

    // 배치: 유닛 탭 = 선택(판매 대상), 미확정 유닛 선택 중 빈 칸 탭 = 1회 이동 후 확정, 다른 유닛 탭 = 선택 변경, 같은 칸 = 해제
    this.track.setCellTapHandler((slot) => {
      if (this.loop.phase !== 'manage') return;
      const here = this.loop.unitAtSlot(slot);
      const sel = this.selectedSlot >= 0 ? this.loop.unitAtSlot(this.selectedSlot) : null;
      if (slot === this.selectedSlot) {
        this.selectedSlot = -1;
      } else if (here) {
        this.selectedSlot = slot;
      } else if (sel && !sel.placed) {
        this.safe(() => { this.loop.moveUnit(this.selectedSlot, slot); this.showToast(`${sel.def.name} 배치 확정`); });
        this.selectedSlot = -1;
      } else if (sel) {
        this.showToast('배치가 확정된 유닛은 옮길 수 없습니다 (판매만 가능)');
      }
      this.track.setField(this.loop, this.selectedSlot);
      this.manage.refresh(this.loop, this.selectedSlot, this.data_.config.sellRatio);
    });

    this.refreshHand();
    this.refreshPanels();
  }

  update(_time: number, delta: number): void {
    if (this.ended) return;
    const dt = Math.min(delta / 1000, 0.1);
    const cfg = this.data_.battleConfig;

    if (this.loop.phase === 'card') {
      const r = this.loop.cardPhase.tick(dt);
      this.hand.setTimer(r.remaining);
      this.hand.update(_time);
      if (r.autoConfirmed) this.confirmHand();
      return;
    }

    if (this.loop.phase === 'combat') {
      const steps = this.speed;
      let leakMsg: string | null = null;
      for (let i = 0; i < steps && this.loop.phase === 'combat'; i++) {
        const ev = this.loop.tickCombat(dt);
        const b = this.loop.battle;
        if (b) this.track.addHits(ev.hits, b.aliveEnemies, cfg.trackLength);
        if (ev.timeUp && ev.leaked > 0) {
          leakMsg = `⏱ 시간 초과! 이탈 ${ev.leaked}기 → 라이프 -${ev.lifeLost}`;
          this.cameras.main.flash(220, 224, 71, 63);
        }
      }
      const b = this.loop.battle;
      if (b) {
        this.track.updateEnemies(b.aliveEnemies, cfg.trackLength);
        this.track.updateTemporaryUnits(b.temporaryUnits);
        this.refreshSkillButton();
        const t = Math.ceil(b.timeRemaining);
        this.combatText.setText(`웨이브 ${this.loop.wave}   ⏱ ${t}초   남은 적 ${b.aliveEnemies.length}${b.allSpawned ? '' : ' (스폰 중)'}`)
          .setColor(t <= 5 ? '#e0473f' : COLORS.text);
      }
      this.track.update(dt * steps);
      this.hud.refresh(this.loop, this.data_.config.totalWaves);

      if (this.loop.phase !== 'combat') {
        // 클리어 → 카드 / 패배 / 승리
        this.track.clearEnemies();
        if (this.loop.phase === 'card') {
          this.showToast(leakMsg ?? `웨이브 ${this.loop.wave - 1} 클리어!`);
          this.refreshHand();
        } else if (leakMsg) {
          this.showToast(leakMsg);
        }
        this.refreshPanels();
        if (this.loop.phase === 'victory' || this.loop.phase === 'defeat') this.showEnd();
      }
      return;
    }
    this.track.update(dt);
  }

  // ── 페이즈 처리 ──────────────────────────────────────────
  private confirmHand(): void {
    if (this.loop.phase !== 'card') return;
    const res = this.loop.confirmHand();
    const hr = this.loop.cardPhase.handResult!;
    // 족보 확정 연출: 등급이 높을수록 화려하게 (트랙 중앙)
    if (RANK_TIER[hr.rank] >= 1) this.fx.celebrate(hr.rank, FX_CENTER.x, FX_CENTER.y, true);
    const lines = [`${HAND_NAME[hr.rank]}!`];
    if (res.deployed.length) lines.push('소환: ' + res.deployed.map((d) => `${SUIT_SYMBOL[d.def.suit]}${d.def.name} T${d.def.tier}`).join(', '));
    if (res.overflowSold.length) lines.push(`슬롯 초과 자동 판매 +💰${res.overflowSold.reduce((s, o) => s + o.gold, 0)}`);
    if (res.shardsGained) lines.push(`조커 조각 +${res.shardsGained}`);
    if (res.freeHeroSummon) lines.push('로열 스트레이트 플러시! 영웅 즉시 소환 가능');
    this.manage.setSummary(lines.join('\n'));
    this.selectedSlot = -1;
    this.refreshPanels();
  }

  private refreshSkillButton(): void {
    const hero = this.loop.hero;
    if (!hero) { this.skillBtn.setLabel('영웅 없음').setEnabled(false); return; }
    const cd = this.loop.heroSkillCooldown;
    const b = this.loop.battle;
    const status = b && b.sanctuaryRemaining > 0 ? ` · 성역 ${Math.ceil(b.sanctuaryRemaining)}s`
      : b && b.freezeRemaining > 0 ? ` · 방벽 ${Math.ceil(b.freezeRemaining)}s` : '';
    if (cd > 0) this.skillBtn.setLabel(`${hero.def.active.name}\n⏳ ${Math.ceil(cd)}초${status}`).setEnabled(false);
    else this.skillBtn.setLabel(`⚡ ${hero.def.active.name}\n${hero.def.active.desc}`).setEnabled(this.loop.heroSkillReady);
  }

  private refreshHand(): void {
    const p = this.loop.cardPhase;
    if (p.state !== 'choosing') return;
    // 라이브 족보: 수트 동수 경합은 표시에 영향 없으므로 고정 rng
    const result = evaluateHand([...p.hand], () => 0);
    this.hand.setHand(p.hand, p.selectedIndices, p.exchangesRemaining, result);
    this.hand.setTimer(p.timeRemaining);
  }

  private refreshPanels(): void {
    const ph = this.loop.phase;
    this.hand.setVisible(ph === 'card');
    this.manage.setVisible(ph === 'manage');
    this.combatPanel.setVisible(ph === 'combat');
    if (ph === 'combat') this.refreshSkillButton();
    this.track.setField(this.loop, ph === 'manage' ? this.selectedSlot : -1);
    if (ph === 'manage') this.manage.refresh(this.loop, this.selectedSlot, this.data_.config.sellRatio);
    this.upgrades.refresh(this.loop);
    this.codex.refresh(this.loop);
    this.hud.refresh(this.loop, this.data_.config.totalWaves);
  }

  /** manage 액션 공통: 실행 후 패널 갱신, 오류는 토스트 */
  private safe(fn: () => void): void {
    try { fn(); } catch (e) { this.showToast(String((e as Error).message)); }
    this.refreshPanels();
  }

  private showToast(msg: string): void {
    this.toast.setText(msg).setAlpha(1);
    this.tweens.killTweensOf(this.toast);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 1400, duration: 400 });
  }

  private showEnd(): void {
    this.ended = true;
    const win = this.loop.phase === 'victory';
    this.swipe.close();
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.75).setInteractive().setDepth(30);
    this.add.text(GAME_WIDTH / 2, 760, win ? '승리!' : '패배', { fontSize: '120px', color: win ? '#f1d17a' : '#e0473f', fontFamily: FONT, fontStyle: 'bold' }).setOrigin(0.5).setDepth(31);
    this.add.text(GAME_WIDTH / 2, 880, `도달 웨이브 ${this.loop.wave} / ${this.data_.config.totalWaves}   💰 ${Math.floor(this.loop.gold)}`, { fontSize: '40px', color: COLORS.text, fontFamily: FONT }).setOrigin(0.5).setDepth(31);
    // 메타 진행 기록 + 젬 지급 (localStorage 저장)
    const reward = getMeta().recordRun({ wave: win ? this.data_.config.totalWaves : this.loop.wave, victory: win });
    const parts = [`💎 +${reward.gemsGained}`];
    if (reward.newMilestones.length) parts.push(`마일스톤 ${reward.newMilestones.map((w) => `웨이브 ${w}`).join('·')} 최초 달성!`);
    if (reward.newBest) parts.push('최고 기록 갱신!');
    this.add.text(GAME_WIDTH / 2, 950, parts.join('   '), { fontSize: '34px', color: '#8fe3ff', fontFamily: FONT }).setOrigin(0.5).setDepth(31);
    new Button(this, GAME_WIDTH / 2, 1040, '다시 시작', () => this.scene.restart(), { width: 480, height: 120, fontSize: 44 }).setDepth(31);
    new Button(this, GAME_WIDTH / 2, 1200, '로비로', () => this.scene.start(SCENE.Lobby), { width: 480, height: 120, fontSize: 44, fill: 0x3b4a66, textColor: COLORS.text }).setDepth(31);
  }
}
