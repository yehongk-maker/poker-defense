import Phaser from 'phaser';
import { SCENE, GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { loadGameData, loadDuelConfig } from '../data/index.ts';
import { getMeta } from '../meta.ts';
import { GameLoop, SHARD_LABEL, type GameData } from '../systems/GameLoop.ts';
import type { ShardKey } from '../systems/SummonMapper.ts';
import { evaluateHand, type Suit } from '../systems/PokerEvaluator.ts';
import { HandFx, FX_CENTER, RANK_TIER } from '../ui/HandFx.ts';
import { HUD } from '../ui/HUD.ts';
import { CardHand, type ExchangeStatus } from '../ui/CardHand.ts';
import { TrackView } from '../ui/TrackView.ts';
import { ManagePanel } from '../ui/ManagePanel.ts';
import { UpgradePanel, type TicketInfo } from '../ui/UpgradePanel.ts';
import { SwipeNav } from '../ui/SwipeNav.ts';
import { InfoPanel } from '../ui/InfoPanel.ts';
import { OpponentPanel } from '../ui/OpponentPanel.ts';
import { SynergyChips } from '../ui/SynergyChips.ts';
import { OpponentAI, raceStatus, resolveDuel, sideOf, type DuelResult } from '../systems/Duel.ts';
import { BettingSystem, REASON_TEXT, type BetAction } from '../systems/Betting.ts';
import { BetBar } from '../ui/BetBar.ts';
import { Button } from '../ui/Button.ts';
import { TimerRing } from '../ui/TimerRing.ts';
import { SpeechBubble } from '../ui/SpeechBubble.ts';
import { WaveBanner } from '../ui/WaveBanner.ts';
import { ResultOverlay, type ResultRow } from '../ui/ResultOverlay.ts';
import { FIELD } from '../ui/TrackView.ts';
import { addBackdrop, addBottomSheet, addEdgeHandle } from '../ui/Backdrop.ts';
import { COLOR, FONT, OUTLINE, HAND_NAME, SIZE, SUIT_SYMBOL, hex } from '../ui/theme.ts';

const PANEL_Y = 1530; // 정비/전투 패널 기준 y (베팅 행 아래)
const HAND_Y = 1490;  // 손패 카드 중심 y
const SHEET_TOP = FIELD.y + FIELD.h + 12; // 하단 조작 시트 시작

/**
 * 게임 씬 — GameLoop(순수 로직)에 UI를 얇게 연결한다. 1:1 대결: 상대 AI(OpponentAI)를 매 프레임 같이 진행.
 *  card   : CardHand 표시, cardPhase.tick → 자동 확정
 *  manage : ManagePanel 표시 (합성/판매/전투 시작)
 *  combat : tickCombat → TrackView에 적/타격 그리기
 *  스와이프: 오른쪽 → 상점·영웅(왼쪽 패널), 왼쪽 → 족보·시너지(오른쪽 패널), 위 → 상대 현황(아래 패널)
 */
export class GameScene extends Phaser.Scene {
  private data_!: GameData;
  private loop!: GameLoop;
  private hud!: HUD;
  private hand!: CardHand;
  private track!: TrackView;
  private manage!: ManagePanel;
  private shop!: UpgradePanel;
  private info!: InfoPanel;
  private oppPanel!: OpponentPanel;
  private nav!: SwipeNav;
  private fx!: HandFx;
  private opponent!: OpponentAI;
  private oppRefreshAcc = 0;
  private chips!: SynergyChips;
  private oppDefeatAnnounced = false;
  private betting!: BettingSystem;
  private betBar!: BetBar;
  private combatPanel!: Phaser.GameObjects.Container;
  private combatText!: Phaser.GameObjects.Text;
  private speedBtn!: Button;
  private skillBtn!: Button;
  private toast!: Phaser.GameObjects.Text;
  private combatTimer!: TimerRing;
  private oppBubble!: SpeechBubble;
  private banner!: WaveBanner;
  private seenOppActions = new Set<string>();
  private bestRank = -1;
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
    this.seenOppActions = new Set();
    this.bestRank = -1;
    addBackdrop(this, 'duel'); // DESIGN §2: 듀얼 = 퍼플 월드

    // 1:1 대결 상대 (메타 업그레이드 없는 기본 설정, smart 봇) + 판돈 걸기
    const oppData = loadGameData();
    const duelCfg = loadDuelConfig();
    const oppLoop = new GameLoop(oppData);
    this.betting = new BettingSystem(duelCfg, { player: this.loop, opponent: oppLoop });
    this.opponent = new OpponentAI(oppData, Math.random, { betting: { system: this.betting, config: duelCfg }, loop: oppLoop });
    this.oppDefeatAnnounced = false;
    this.oppRefreshAcc = 0;
    this.betting.sync('player', this.loop);
    this.betting.sync('opponent', oppLoop);

    this.hud = new HUD(this, () => { this.nav.open('right'); this.info.show('synergy'); });
    this.track = new TrackView(this);
    this.chips = new SynergyChips(this, () => { this.nav.open('right'); this.info.show('synergy'); });
    this.fx = new HandFx(this);
    addBottomSheet(this, SHEET_TOP);
    this.banner = new WaveBanner(this, GAME_WIDTH / 2, FIELD.y + 150);

    this.hand = new CardHand(this, HAND_Y, {
      onExchange: (i) => this.safe(() => {
        const p = this.loop.cardPhase;
        const before = evaluateHand([...p.hand], () => 0).rank;
        let card;
        if (p.canExchange(i)) {
          card = p.exchangeCard(i);
        } else if (getMeta().tickets > 0 && p.canExchangeWithTicket(i)) {
          // 기본 교환을 다 쓴 카드: 교환권 1장 소모
          getMeta().useTicket();
          card = p.exchangeWithTicket(i);
          this.showToast(`🎫 교환권 사용 (남은 ${getMeta().tickets}장)`);
        } else return;
        const result = evaluateHand([...p.hand], () => 0);
        // 카드가 뒤집혀 새 카드로 오픈된 뒤 족보 갱신
        this.hand.exchangeCard(i, card, this.exchangeStatus(), result);
        // 교환으로 족보가 올랐으면 오픈 직후 패 위에서 작은 연출
        if (result.rank > before && RANK_TIER[result.rank] >= 1) {
          this.time.delayedCall(360, () => { const pos = this.hand.rankLabelPosition; this.fx.celebrate(result.rank, pos.x, pos.y, false); });
        }
      }),
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
      onOpenUpgrades: () => this.nav.open('left'),
      onStart: () => this.safe(() => {
        this.loop.startCombat();
        this.selectedSlot = -1;
        this.refreshPanels();
      }),
    });

    // 3방향 스와이프 패널: 왼쪽=상점·영웅, 오른쪽=족보·시너지, 아래=상대 현황
    this.shop = new UpgradePanel(this, this.loop, {
      onUpgrade: (s: Suit) => this.safe(() => { this.loop.buyUpgrade(s); this.showToast(`${SUIT_SYMBOL[s]} 공격력 Lv${this.loop.upgrades[s]}`); }),
      onSummonHero: (id) => this.safe(() => {
        const r = this.loop.summonHero(id);
        this.showToast(`영웅 소환: ${r.def.name} ${r.grade}급`);
      }),
      onBuyTicket: () => this.safe(() => {
        getMeta().buyTicket();
        this.showToast(`🎫 카드 교환권 구매 (보유 ${getMeta().tickets}장)`);
        if (this.loop.phase === 'card') this.hand.setStatus(this.exchangeStatus());
      }),
      onClose: () => this.nav.close(),
    }, this.data_.config.upgrade.attackPctPerLevel).setDepth(10);
    this.info = new InfoPanel(this, this.data_.hands, () => this.nav.close()).setDepth(10);
    this.oppPanel = new OpponentPanel(this, () => this.nav.close()).setDepth(10);
    this.nav = new SwipeNav(this, { left: this.shop, right: this.info, bottom: this.oppPanel }, (side) => {
      if (side === 'left') this.shop.refresh(this.loop, this.ticketInfo());
      if (side === 'right') this.info.refresh(this.loop);
      if (side === 'bottom') this.oppPanel.refresh(this.opponent, this.loop, this.data_.config.totalWaves, this.betting);
    });
    // 가장자리 핸들 (탭으로도 열기). 왼쪽 위는 시너지 뱃지가 차지하므로 핸들은 손패 높이에
    addEdgeHandle(this, 22, HAND_Y, 40, 230, '상점 · 영웅 ▶', 90, () => this.nav.open('left'));
    addEdgeHandle(this, GAME_WIDTH - 22, HAND_Y, 40, 230, '◀ 족보 · 시너지', -90, () => this.nav.open('right'));
    addEdgeHandle(this, GAME_WIDTH / 2, GAME_HEIGHT - 26, 380, 40, '▲ 상대 진행 상황', 0, () => this.nav.open('bottom'));

    // 판돈 걸기: 팟 알약 + 베팅 3버튼 (필드 바로 아래)
    this.betBar = new BetBar(this, (a) => this.bet(a));
    this.oppBubble = new SpeechBubble(this, this.hud.opponentAnchor.x, this.hud.opponentAnchor.y + 24).setDepth(16);

    // 전투 패널
    this.combatText = this.add.text(GAME_WIDTH / 2 - 60, PANEL_Y - 30, '', { fontSize: '36px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE, align: 'center' }).setOrigin(0.5);
    this.speedBtn = new Button(this, GAME_WIDTH / 2, PANEL_Y + 90, '배속 ×1', () => {
      this.speed = this.speed >= 3 ? 1 : this.speed + 1;
      this.speedBtn.setLabel(`배속 ×${this.speed}`);
    }, { width: 280, height: SIZE.btnM, fontSize: 36, variant: 'blue' });
    // 영웅 액티브 스킬 버튼 (전투 중, 쿨타임 표시)
    this.skillBtn = new Button(this, GAME_WIDTH / 2 - 250, PANEL_Y + 90, '영웅 없음', () => this.safe(() => {
      const r = this.loop.useHeroSkill();
      this.showToast(`${r.name}: ${r.text}`);
      this.cameras.main.flash(140, 241, 209, 122);
      const hero = this.loop.hero;
      if (hero) this.track.pulseCell(hero.unit.slot);
    }), { width: 420, height: SIZE.btnM, fontSize: 30, variant: 'purple' });
    this.skillBtn.setX(SIZE.gutter + 210);
    this.speedBtn.setX(SIZE.gutter + 420 + 16 + 140);
    this.combatTimer = new TimerRing(this, GAME_WIDTH - SIZE.gutter - SIZE.timerD / 2 - 6, PANEL_Y + 40);
    this.combatPanel = this.add.container(0, 0, [this.combatText, this.speedBtn, this.skillBtn, this.combatTimer]);

    this.toast = this.add.text(GAME_WIDTH / 2, FIELD.y + FIELD.h - 70, '', { fontSize: '34px', color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE, strokeThickness: 5, align: 'center' }).setOrigin(0.5).setAlpha(0).setDepth(20);

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
    // 실시간 레이스: 배속(⏩)은 양쪽에 같은 시간 배율로 적용
    this.tickOpponent(dt * this.speed);
    this.syncBetting();
    const race = raceStatus(sideOf(this.loop), sideOf(this.opponent.loop), this.data_.config.totalWaves);
    if (race) { this.showEnd(race); return; }

    if (this.loop.phase === 'card') {
      const r = this.loop.cardPhase.tick(dt * this.speed);
      this.hand.setTimer(r.remaining, this.loop.cardPhase.timerSeconds);
      this.hand.update(_time);
      if (r.autoConfirmed) this.confirmHand();
      return;
    }

    if (this.loop.phase === 'combat') {
      const steps = this.speed;
      let leakMsg: string | null = null;
      let bossMsg: string | null = null;
      for (let i = 0; i < steps && this.loop.phase === 'combat'; i++) {
        const ev = this.loop.tickCombat(dt);
        const b = this.loop.battle;
        if (b) this.track.addHits(ev.hits, b.aliveEnemies, cfg.trackLength);
        if (ev.bossShard) {
          bossMsg = `보스 격파! ${SHARD_LABEL[ev.bossShard.type]} 조각 +${ev.bossShard.amount}`;
          this.cameras.main.flash(180, 255, 228, 94);
        }
        if (ev.timeUp && ev.leaked > 0) {
          leakMsg = `시간 초과! 이탈 ${ev.leaked}기 → 하트 -${ev.lifeLost}`;
          this.cameras.main.flash(220, 224, 71, 63);
          // 위기 배너 (DESIGN §5-03): 하트를 잃었고 대공 유닛이 0기이며 공중 적이 있을 때만
          if (ev.lifeLost > 0 && this.antiAirCount() === 0 && this.waveHasAir(this.loop.wave)) this.banner.show('공중 적 통과 중! 대공 유닛 부족', { danger: true, holdMs: 2400 });
        }
      }
      const b = this.loop.battle;
      if (b) {
        this.track.updateEnemies(b.aliveEnemies, cfg.trackLength);
        this.track.updateTemporaryUnits(b.temporaryUnits);
        this.refreshSkillButton();
        const t = Math.ceil(b.timeRemaining);
        this.combatText.setText(`라운드 ${this.loop.wave} · 남은 적 ${b.aliveEnemies.length}${b.allSpawned ? '' : ' (스폰 중)'}`)
          .setColor(t <= 5 ? hex(COLOR.red) : hex(COLOR.textMain));
        this.combatTimer.set(b.timeRemaining, this.data_.waves[this.loop.wave - 1]?.timeLimit ?? 30);
      }
      this.track.update(dt * steps);
      this.hud.refresh(this.loop, this.data_.config.totalWaves, this.tokenMeta());

      if (this.loop.phase !== 'combat') {
        // 클리어 → 카드 / 패배 / 승리
        this.track.clearEnemies();
        if (this.loop.phase === 'card') {
          this.showToast(bossMsg ?? leakMsg ?? `라운드 ${this.loop.wave - 1} 클리어! 바로 다음 라운드`);
          this.refreshHand();
        } else if (leakMsg) {
          this.showToast(leakMsg);
        }
        this.refreshPanels();
        if (this.loop.phase === 'victory' || this.loop.phase === 'defeat') this.finishRace();
      }
      return;
    }
    this.track.update(dt);
  }

  /** 상대 AI 실시간 진행 + 상대 패널/HUD 갱신 (0.5초마다) */
  private tickOpponent(dt: number): void {
    this.opponent.tick(dt);
    this.oppRefreshAcc += dt;
    if (this.oppRefreshAcc >= 0.5) {
      this.oppRefreshAcc = 0;
      const o = this.opponent.loop;
      const diff = this.loop.wave - o.wave;
      const lead = diff > 0 ? `내가 ${diff} 앞섬` : diff < 0 ? `상대가 ${-diff} 앞섬` : '동률';
      const exch = o.phase === 'card' ? ` · 교환 ${o.cardPhase.exchangesUsed}장` : '';
      this.hud.setOpponent(`R${o.wave} ♥${o.life}${o.phase === 'defeat' ? ' 탈락' : ''}${exch} · ${lead}`);
      if (this.nav.openSide === 'bottom') this.oppPanel.refresh(this.opponent, this.loop, this.data_.config.totalWaves, this.betting);
      if (o.phase === 'defeat' && !this.oppDefeatAnnounced) {
        this.oppDefeatAnnounced = true;
        this.showToast(`상대 탈락! (라운드 ${o.wave}) — 라운드 ${o.wave + 1}에 들어가면 승리`);
      }
    }
  }

  // ── 페이즈 처리 ──────────────────────────────────────────
  private confirmHand(): void {
    if (this.loop.phase !== 'card') return;
    // 판돈: 아무것도 안 골랐으면 체크
    if (this.betting.options('player', this.loop.wave).includes('check')) this.betting.act('player', this.loop.wave, 'check');
    const res = this.loop.confirmHand();
    const hr = this.loop.cardPhase.handResult!;
    this.bestRank = Math.max(this.bestRank, hr.rank);
    // 족보 확정 연출: 등급이 높을수록 화려하게 (트랙 중앙)
    if (RANK_TIER[hr.rank] >= 1) this.fx.celebrate(hr.rank, FX_CENTER.x, FX_CENTER.y, true);
    const lines = [`${HAND_NAME[hr.rank]}!`];
    if (res.deployed.length) lines.push('소환: ' + res.deployed.map((d) => `${SUIT_SYMBOL[d.def.suit]}${d.def.name} T${d.def.tier}`).join(', '));
    if (res.overflowSold.length) lines.push(`슬롯 초과 자동 판매 +💰${res.overflowSold.reduce((s, o) => s + o.gold, 0)}`);
    const gained = (Object.entries(res.shardsGained) as [ShardKey, number][]).filter(([, n]) => n > 0).map(([k, n]) => `${SHARD_LABEL[k]} 조각 +${n}`);
    if (gained.length) lines.push(`영웅 조각: ${gained.join(', ')}`);
    if (res.freeHeroSummon) lines.push('로열 스트레이트 플러시! 조각 없이 아무 영웅이나 소환 가능');
    this.manage.setSummary(lines.join('\n'));
    this.selectedSlot = -1;
    this.refreshPanels();
  }

  // ── 판돈 걸기 ──
  private bet(a: BetAction): void {
    const v = this.betting.view('player', this.loop.wave);
    this.safe(() => {
      this.betting.act('player', v.wave, a);
      const msg: Record<BetAction, string> = { check: '체크 — 그대로 진행', raise: `레이즈! 💰${v.raiseAmount} 더 걸었어요 (상대가 콜하면 판돈 💰${v.pot + v.raiseAmount * 2 - (v.pendingRaise ?? 0)})`, call: `콜! 💰${v.pendingRaise} 받았어요 → 판돈 💰${v.pot + (v.pendingRaise ?? 0)}`, fold: '폴드 — 이번 판돈은 포기 (방어는 그대로)' };
      this.showToast(msg[a]);
    });
  }

  /** 양쪽 GameLoop 상태를 판돈 시스템에 반영하고, 새 판정이 나면 알린다 */
  private syncBetting(): void {
    const results = [...this.betting.sync('player', this.loop), ...this.betting.sync('opponent', this.opponent.loop)];
    for (const r of results) {
      if (r.winner === 'player') { this.showToast(`💰 라운드 ${r.wave} 판돈 💰${r.pot} 획득! (${REASON_TEXT[r.reason]})`); this.cameras.main.flash(120, 241, 209, 122); }
      else if (r.winner === 'opponent') this.showToast(`라운드 ${r.wave} 판돈 💰${r.pot}은 상대에게 (${r.reason === 'fold' ? '내가 폴드' : r.reason === 'life' ? '상대가 하트를 덜 잃음' : r.reason === 'time' ? '상대가 더 빨리 클리어' : r.reason === 'hand' ? '상대 족보가 더 높음' : '내가 탈락'})`);
      else this.showToast(`라운드 ${r.wave} 동률 — 판돈 💰${r.pot} 다음 라운드로 이월`);
      this.hud.refresh(this.loop, this.data_.config.totalWaves, this.tokenMeta());
    }
    this.announceOpponentBets();
    // 상대 선택이 바뀌었을 수 있으니 바는 매 프레임 갱신 (텍스트 setText는 같은 값이면 비용 없음)
    this.betBar.refresh(this.betting.view('player', this.loop.wave), this.loop.phase);
  }

  /** 상대 베팅 액션을 말풍선으로 (DESIGN §4 SpeechBubble, 강조어 red) */
  private announceOpponentBets(): void {
    const o = this.opponent.loop;
    for (const w of new Set([o.wave, o.wave - 1, this.loop.wave])) {
      const rb = this.betting.round(w);
      if (!rb) continue;
      const a = rb.action.opponent, r = rb.response.opponent;
      if (a && !this.seenOppActions.has(`${w}:a`)) {
        this.seenOppActions.add(`${w}:a`);
        if (a === 'raise') this.oppBubble.show(`레이즈 +${rb.raise?.amount ?? ''}!`, true);
        else if (!rb.raise || rb.raise.by !== 'player') this.oppBubble.show('체크');
      }
      if (r && !this.seenOppActions.has(`${w}:r`)) {
        this.seenOppActions.add(`${w}:r`);
        this.oppBubble.show(r === 'call' ? '콜! 받아친다' : '폴드…', r === 'call');
      }
    }
  }

  /** 대공 가능한 유닛 수 (영웅 포함) */
  private antiAirCount(): number {
    const all = this.loop.hero ? [...this.loop.units, this.loop.hero.unit] : [...this.loop.units];
    return all.filter((u) => u.def.targets !== 'ground').length;
  }

  private waveHasAir(wave: number): boolean {
    const w = this.data_.waves[wave - 1];
    return !!w && w.groups.some((g) => this.data_.enemyTypes[g.type]?.movement === 'air');
  }

  /** 새 라운드 예고 배너: 보스 / 공중 웨이브 */
  private announceWave(): void {
    const w = this.data_.waves[this.loop.wave - 1];
    if (!w) return;
    const air = w.groups.filter((g) => this.data_.enemyTypes[g.type]?.movement === 'air').reduce((n, g) => n + g.count, 0);
    if (w.boss) this.banner.show(`보스 라운드! ${this.data_.enemyTypes[w.groups.find((g) => this.data_.enemyTypes[g.type]?.boss)?.type ?? '']?.name ?? ''}`.trim(), { danger: true });
    else if (air > 0) this.banner.show(`공중 적 ${air}기 접근!`, { wings: true });
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

  /** 토큰 바에 필요한 고정값 (하트 최대·영웅 토큰 필요 수·보유 다이아) */
  private tokenMeta(): { diamonds: number; heartsMax: number; heroTokensMax: number } {
    return { diamonds: getMeta().gems, heartsMax: this.data_.config.startLife, heroTokensMax: this.data_.config.hero.shardsRequired };
  }

  /** 교환 현황 (카드별 남은 횟수·카운터·교환권) */
  private exchangeStatus(): ExchangeStatus {
    const p = this.loop.cardPhase;
    const outs = p.outWeight > 0 && p.state === 'choosing' ? p.hand.map((_, i) => p.outsFor(i)) : [];
    return { left: p.hand.map((_, i) => p.exchangesRemainingFor(i)), used: p.exchangesUsed, total: p.exchangesTotal, tickets: getMeta().tickets, ticketsUsed: p.ticketsUsed, outs };
  }

  /** 상점 패널용 교환권 정보 */
  private ticketInfo(): TicketInfo {
    const m = getMeta();
    return { tickets: m.tickets, gems: m.gems, cost: m.ticketDef.cost, max: m.ticketDef.max, canBuy: m.canBuyTicket };
  }

  /** 새 라운드: 뒷면으로 받아 한 장씩 오픈 */
  private refreshHand(): void {
    const p = this.loop.cardPhase;
    if (p.state !== 'choosing') return;
    // 라이브 족보: 수트 동수 경합은 표시에 영향 없으므로 고정 rng
    const result = evaluateHand([...p.hand], () => 0);
    this.hand.deal(p.hand, this.exchangeStatus(), result);
    this.hand.setTimer(p.timeRemaining, p.timerSeconds);
    this.announceWave();
  }

  private refreshPanels(): void {
    const ph = this.loop.phase;
    this.hand.setVisible(ph === 'card');
    this.manage.setVisible(ph === 'manage');
    this.combatPanel.setVisible(ph === 'combat');
    if (ph === 'combat') this.refreshSkillButton();
    this.track.setField(this.loop, ph === 'manage' ? this.selectedSlot : -1);
    if (ph === 'manage') this.manage.refresh(this.loop, this.selectedSlot, this.data_.config.sellRatio);
    this.shop.refresh(this.loop, this.ticketInfo());
    this.info.refresh(this.loop);
    this.chips.refresh(this.loop);
    this.hud.refresh(this.loop, this.data_.config.totalWaves, this.tokenMeta());
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

  /** 플레이어 판 종료(승리/패배) 시: 레이스 판정이 아직 안 났으면 상대를 끝까지 돌려 비교 */
  private finishRace(): void {
    const total = this.data_.config.totalWaves;
    let r = raceStatus(sideOf(this.loop), sideOf(this.opponent.loop), total);
    if (!r) {
      this.opponent.fastForward();
      r = raceStatus(sideOf(this.loop), sideOf(this.opponent.loop), total) ?? resolveDuel(sideOf(this.loop), sideOf(this.opponent.loop), total);
    }
    this.showEnd(r);
  }

  private showEnd(duel: DuelResult): void {
    if (this.ended) return;
    this.ended = true;
    const total = this.data_.config.totalWaves;
    const cleared = this.loop.phase === 'victory';
    this.nav.close();
    const outcome = duel.winner === 'draw' ? 'draw' : duel.winner === 'player' ? 'win' : 'lose';
    const PATH: Record<string, string> = {
      first_clear: '1:1 레이스 · 마지막 라운드 먼저 클리어',
      opponent_out: '1:1 레이스 · 상대 탈락 후 라운드 앞섬',
      wave: '1:1 레이스 · 도달 라운드 판정',
      life: '1:1 레이스 · 남은 하트 판정',
      gold: '1:1 레이스 · 골드 판정',
      draw: '1:1 레이스 · 완전 동률',
    };
    const o = this.opponent.loop;
    const caption = `${PATH[duel.reason]}\n나 R${cleared ? '40 클리어' : this.loop.wave} ♥${this.loop.life}  vs  상대 R${o.phase === 'victory' ? '40 클리어' : o.wave} ♥${o.life}`;
    // 메타 진행 기록 + 다이아 지급 (localStorage 저장)
    const reward = getMeta().recordRun({ wave: cleared ? total : this.loop.wave, victory: cleared });
    const rows: ResultRow[] = [
      { icon: 'gem', label: '다이아', value: `+${reward.gemsGained}` },
      { icon: 'coin', label: '판돈 획득 (나 / 상대)', value: `${this.betting.won.player} / ${this.betting.won.opponent}` },
      { icon: 'star', label: '최고 족보', value: this.bestRank >= 0 ? HAND_NAME[this.bestRank] : '-', highlight: true },
    ];
    if (reward.newMilestones.length || reward.newBest) {
      rows.push({ icon: 'token', label: reward.newMilestones.length ? `라운드 ${reward.newMilestones.join('·')} 최초 달성` : '최고 기록', value: reward.newBest ? '갱신!' : '달성!' });
    }
    // 별 3개: 승리 / 하트 4+ / 하트 7+ (DESIGN §5-05)
    const stars = outcome === 'win' ? 1 + (this.loop.life >= 4 ? 1 : 0) + (this.loop.life >= 7 ? 1 : 0) : 0;
    const subtitle = outcome === 'lose' ? (this.loop.phase === 'defeat' ? `라운드 ${this.loop.wave}에서 전멸...` : '상대가 먼저 결승선을 넘었어요') : undefined;
    new ResultOverlay(this, {
      outcome, caption, subtitle, stars, rows,
      onContinue: () => this.scene.start(SCENE.Lobby),
      onAgain: () => this.scene.restart(),
    });
  }

}
