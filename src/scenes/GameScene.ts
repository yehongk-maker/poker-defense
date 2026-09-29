import Phaser from 'phaser';
import { SCENE, GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { loadDuelConfig, loadModeSources, loadRewardedAds } from '../data/index.ts';
import { getAds } from '../ads.ts';
import { clearRun, loadRun, saveRun } from '../runSave.ts';
import { CAMPAIGN, buildGameData, isDuel, type GameMode } from '../systems/GameMode.ts';
import { AIOpponent, localBotIdentity, type OpponentIdentity, type OpponentSource } from '../systems/Opponent.ts';
import { CampaignBar } from '../ui/CampaignBar.ts';
import { getMeta } from '../meta.ts';
import { GameLoop, SHARD_LABEL, type GameData } from '../systems/GameLoop.ts';
import { randomSeed, seedStreams, type RngStreams } from '../systems/Seed.ts';
import { InputRecorder, replayMatch, type RoundInput } from '../systems/InputLog.ts';
import { LiveOpponent, LivePublisher, type LiveContext } from '../net/Live.ts';
import { addFriend, getMatch, leaveRoom, reportResult, submitLog, subscribeMatch } from '../net/api.ts';
import { errorText } from '../net/session.ts';
import type { MatchInfo } from '../net/types.ts';
import type { FriendSceneInit } from './FriendScene.ts';
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
import { raceStatus, resolveDuel, sideOf, type DuelResult } from '../systems/Duel.ts';
import { BettingSystem, REASON_TEXT, type BetAction } from '../systems/Betting.ts';
import { BetBar } from '../ui/BetBar.ts';
import { Button } from '../ui/Button.ts';
import { TimerRing } from '../ui/TimerRing.ts';
import { SpeechBubble } from '../ui/SpeechBubble.ts';
import { WaveBanner } from '../ui/WaveBanner.ts';
import { ResultOverlay, type ResultRow } from '../ui/ResultOverlay.ts';
import { FIELD } from '../ui/TrackView.ts';
import { OpponentMiniMap } from '../ui/OpponentMiniMap.ts';
import { addBackdrop, addBottomSheet, addEdgeHandle } from '../ui/Backdrop.ts';
import { COLOR, FONT, OUTLINE, HAND_NAME, SIZE, SUIT_SYMBOL, hex } from '../ui/theme.ts';

const PANEL_Y = 1530; // 정비/전투 패널 기준 y (베팅 행 아래)
const HAND_Y = 1490;  // 손패 카드 중심 y
const SHEET_TOP = FIELD.y + FIELD.h + 12; // 하단 조작 시트 시작

/** 씬 시작 인자: scene.start(SCENE.Game, { mode, opponent, opponentSource, resume }) */
export interface GameSceneInit {
  mode?: GameMode;
  /** 대전 상대 표시 정보 (없으면 로컬 닉 풀에서) */
  opponent?: OpponentIdentity;
  /** 이미 만들어진 상대 (네트워크·고스트). 없으면 봇 두뇌로 만든다 */
  opponentSource?: OpponentSource;
  /** 캠페인 이어하기 */
  resume?: boolean;
  /** 내 계정 id — 손패 시드 스트림을 가르는 키 (온라인). 없으면 'local' */
  playerId?: string;
  /** 실시간 매치 (친구 대전·랭크 실시간). opponentSource는 LiveOpponent여야 한다 */
  live?: LiveContext;
}

/** 상대 접속이 이만큼(초) 끊기면 판을 중단한다 */
const DISCONNECT_GRACE_SEC = 30;
/** 서버 판정을 기다리는 최대 시간(ms). 넘으면 이 기기의 판정으로 표시한다 */
const VERDICT_WAIT_MS = 6000;

/**
 * 게임 씬 — GameLoop(순수 로직)에 UI를 얇게 연결한다. GameMode가 화면 조각을 켜고 끈다 (docs/mode-design.md §2.1).
 *  캠페인: 상대·판돈·미니맵 없음, 그 자리에 웨이브 예고 + 광고 보상(교환 +1·부활·보상 2배), 라운드마다 자동 저장
 *  대전: 상대(OpponentSource)를 매 프레임 같이 진행, 판돈 걸기, 레이스 판정
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
  private oppPanel: OpponentPanel | null = null;
  private mode: GameMode = CAMPAIGN;
  private initArgs: GameSceneInit = {};
  private campaignBar: CampaignBar | null = null;
  private adExchangeWave = 0; // 광고 교환을 쓴 라운드 (라운드당 1회)
  private overlay: ResultOverlay | null = null;
  private nav!: SwipeNav;
  private fx!: HandFx;
  private opponent: OpponentSource | null = null;
  /** 대전: 입력 로그 기록기와 그 판의 시드 (결과 보고 때 서버로 보낸다) */
  private recorder: InputRecorder | null = null;
  private matchSeed = '';
  private live: LiveContext | null = null;
  private publisher: LivePublisher | null = null;
  private lastFrameAt = 0;
  private waitingForOpponent = false;
  private oppRefreshAcc = 0;
  private chips!: SynergyChips;
  private oppDefeatAnnounced = false;
  private betting: BettingSystem | null = null;
  private betBar: BetBar | null = null;
  private oppMini: OpponentMiniMap | null = null;
  private combatPanel!: Phaser.GameObjects.Container;
  private combatText!: Phaser.GameObjects.Text;
  private speedBtn!: Button;
  private skillBtn!: Button;
  private toast!: Phaser.GameObjects.Text;
  private combatTimer!: TimerRing;
  private oppBubble: SpeechBubble | null = null;
  private banner!: WaveBanner;
  private seenOppActions = new Set<string>();
  private bestRank = -1;
  private selectedSlot = -1;
  private speed = 1;
  private ended = false;

  constructor() {
    super(SCENE.Game);
  }

  init(data?: GameSceneInit): void {
    this.initArgs = data ?? {};
    this.mode = this.initArgs.mode ?? CAMPAIGN;
  }

  create(): void {
    const mode = this.mode;
    const src = loadModeSources();
    const meta = getMeta();
    this.data_ = buildGameData(src, mode, meta.effects); // 모드 규칙 + (적용 모드만) 메타 업그레이드
    this.loop = this.startLoop();
    this.selectedSlot = -1;
    this.speed = 1;
    this.ended = false;
    this.seenOppActions = new Set();
    this.bestRank = -1;
    this.adExchangeWave = 0;
    this.overlay = null;
    this.live = null; this.publisher = null; this.waitingForOpponent = false;
    this.opponent = null; this.betting = null; this.betBar = null; this.oppMini = null; this.oppPanel = null; this.oppBubble = null; this.campaignBar = null;
    addBackdrop(this, mode.world); // DESIGN §2: 솔로 = 블루 하늘, 듀얼 = 퍼플 월드

    // 대전: 상대는 메타 없이 같은 규칙. 사람·고스트는 밖에서 만들어 넘기고, 없으면 봇 두뇌
    if (isDuel(mode)) {
      const duelCfg = loadDuelConfig();
      const opp = this.initArgs.opponentSource
        ?? new AIOpponent(buildGameData(src, mode, null), this.initArgs.opponent ?? localBotIdentity(1000), Math.random);
      this.opponent = opp;
      const remote = opp instanceof LiveOpponent;
      if (mode.betting) {
        this.betting = new BettingSystem(duelCfg, { player: this.loop, opponent: opp.wallet }, remote ? { remote: 'opponent' } : {});
        if (opp instanceof AIOpponent) opp.attachBetting(this.betting, duelCfg);
        if (opp instanceof LiveOpponent) opp.attachBetting(this.betting);
        this.betting.sync('player', this.loop);
        this.betting.sync('opponent', opp.participant);
      }
      if (opp instanceof LiveOpponent && this.initArgs.live) {
        this.live = this.initArgs.live;
        this.publisher = new LivePublisher(this.live.transport, this.loop, this.data_, this.betting);
        opp.events.onSkill = () => this.oppBubble?.show('영웅 스킬!', true);
      }
    }
    this.lastFrameAt = performance.now();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.closeLive());
    this.oppDefeatAnnounced = false;
    this.oppRefreshAcc = 0;

    this.hud = new HUD(this, () => { this.nav.open('right'); this.info.show('synergy'); }, this.opponent ? this.opponent.identity.avatar : null);
    this.track = new TrackView(this);
    // 우상단 상대 진행 미니맵 (탭 → 상대 패널)
    if (this.opponent) this.oppMini = new OpponentMiniMap(this, FIELD.x + FIELD.w - 10, FIELD.y + 10, () => this.nav.open('bottom'));
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
        } else if (p.bonusExchanges > 0) {
          card = p.exchangeWithBonus(i); // 광고 보상 교환 (교환권보다 먼저)
          this.showToast(`광고 보상 교환 사용 (남은 ${p.bonusExchanges}회)`);
        } else if (getMeta().tickets > 0 && p.canExchangeWithTicket(i)) {
          // 기본 교환을 다 쓴 카드: 교환권 1장 소모 (대전은 매치당 상한 — 상한이면 GameLoop이 throw)
          if (this.loop.ticketsLeftRun <= 0) throw new Error(`이 판의 교환권 사용 ${this.loop.ticketsUsedRun}/${this.data_.config.ticketsPerRun}회를 다 썼어요`);
          getMeta().useTicket();
          card = this.loop.exchangeWithTicket(i);
          this.showToast(`교환권 사용 (보유 ${getMeta().tickets}장 · 이 판 ${this.loop.ticketsUsedRun}/${this.data_.config.ticketsPerRun ?? '∞'})`);
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
    if (this.opponent) this.oppPanel = new OpponentPanel(this, () => this.nav.close()).setDepth(10);
    this.nav = new SwipeNav(this, { left: this.shop, right: this.info, ...(this.oppPanel ? { bottom: this.oppPanel } : {}) }, (side) => {
      if (side === 'left') this.shop.refresh(this.loop, this.ticketInfo());
      if (side === 'right') this.info.refresh(this.loop);
      if (side === 'bottom') this.refreshOpponentPanel();
    });
    // 가장자리 핸들 (탭으로도 열기). 왼쪽 위는 시너지 뱃지가 차지하므로 핸들은 손패 높이에
    addEdgeHandle(this, 22, HAND_Y, 40, 230, '상점 · 영웅 ▶', 90, () => this.nav.open('left'));
    addEdgeHandle(this, GAME_WIDTH - 22, HAND_Y, 40, 230, '◀ 족보 · 시너지', -90, () => this.nav.open('right'));
    if (this.opponent) {
      addEdgeHandle(this, GAME_WIDTH / 2, GAME_HEIGHT - 26, 380, 40, '▲ 상대 진행 상황', 0, () => this.nav.open('bottom'));
      this.oppBubble = new SpeechBubble(this, this.hud.opponentAnchor.x, this.hud.opponentAnchor.y + 24).setDepth(16);
    }
    // 필드 바로 아래 행: 대전 = 판돈(팟 알약 + 베팅 3버튼), 캠페인 = 웨이브 예고 + 광고 교환
    if (this.betting) this.betBar = new BetBar(this, (a) => this.bet(a));
    else if (!this.opponent) this.campaignBar = new CampaignBar(this, () => void this.adExchange(), mode.ads && loadRewardedAds().extraExchange.enabled);

    // 전투 패널
    this.combatText = this.add.text(GAME_WIDTH / 2 - 60, PANEL_Y - 30, '', { fontSize: '36px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE, align: 'center' }).setOrigin(0.5);
    this.speedBtn = new Button(this, GAME_WIDTH / 2, PANEL_Y + 90, '배속 ×1', () => {
      this.speed = this.speed >= this.mode.maxSpeed ? 1 : this.speed + 1;
      this.speedBtn.setLabel(`배속 ×${this.speed}`);
    }, { width: 280, height: SIZE.btnM, fontSize: 36, variant: 'blue' });
    this.speedBtn.setVisible(mode.maxSpeed > 1); // 랭크 대전은 배속 고정 → 버튼 숨김
    // 영웅 액티브 스킬 버튼 (전투 중, 쿨타임 표시)
    this.skillBtn = new Button(this, GAME_WIDTH / 2 - 250, PANEL_Y + 90, '영웅 없음', () => this.safe(() => {
      const r = this.loop.useHeroSkill();
      this.publisher?.skill(r.id);
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

  update(time: number, delta: number): void {
    this.frame(time, delta);
    const now = performance.now();
    const wall = Math.min(1, Math.max(0, (now - this.lastFrameAt) / 1000));
    this.lastFrameAt = now;
    this.liveFrame(wall);
  }

  /** 실시간 매치: 내 공개 정보를 보내고, 상대 이탈·내 판 종료 후 대기를 처리한다 */
  private liveFrame(wallDt: number): void {
    const opp = this.opponent;
    if (!this.live || !(opp instanceof LiveOpponent)) return;
    this.publisher?.tick(wallDt);
    if (this.ended) return;
    if (opp.left || opp.offlineFor >= DISCONNECT_GRACE_SEC) {
      this.abortLive(opp.left ? '상대가 방을 나갔어요' : '상대의 연결이 끊겼어요');
      return;
    }
    const over = this.loop.phase === 'victory' || this.loop.phase === 'defeat';
    if (!over) return;
    if (opp.finished) { this.finishRace(opp); return; }
    if (!this.waitingForOpponent) {
      this.waitingForOpponent = true;
      this.nav.close();
      this.banner.show(`${opp.identity.name}님이 끝날 때까지 기다리는 중…`, { holdMs: 4000 });
    }
  }

  private frame(_time: number, delta: number): void {
    if (this.ended) return;
    const dt = Math.min(delta / 1000, 0.1);
    const cfg = this.data_.battleConfig;
    if (this.opponent) {
      // 실시간 레이스: 배속은 양쪽에 같은 시간 배율로 적용
      this.tickOpponent(this.opponent, dt * this.speed);
      this.syncBetting();
      const race = raceStatus(sideOf(this.loop), sideOf(this.opponent.view), this.data_.config.totalWaves);
      if (race) { this.showEnd(race); return; }
    }

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
        this.track.updateEnemies(b.aliveEnemies, cfg.trackLength, this.loop.combatAlpha);
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
        if (this.loop.phase === 'victory' || this.loop.phase === 'defeat') {
          if (this.opponent) this.finishRace(this.opponent);
          else this.finishCampaign();
        }
      }
      return;
    }
    this.track.update(dt);
  }

  /** 상대 실시간 진행 + 상대 바·미니맵·패널 갱신 (0.5초마다) */
  private tickOpponent(opp: OpponentSource, dt: number): void {
    opp.tick(dt);
    this.oppRefreshAcc += dt;
    if (this.oppRefreshAcc >= 0.5) {
      this.oppRefreshAcc = 0;
      const o = opp.view;
      const diff = this.loop.wave - o.wave;
      const lead = diff > 0 ? `내가 ${diff} 앞섬` : diff < 0 ? `상대가 ${-diff} 앞섬` : '동률';
      const exch = o.phase === 'card' ? ` · 교환 ${o.exchangeCount}장` : '';
      this.hud.setOpponent(`${opp.identity.name} · R${o.wave} ♥${o.life}${o.phase === 'defeat' ? ' 탈락' : ''}${exch} · ${lead}`);
      this.oppMini?.refresh(o, this.data_.battleConfig.trackLength);
      if (this.nav.openSide === 'bottom') this.refreshOpponentPanel();
      if (o.phase === 'defeat' && !this.oppDefeatAnnounced) {
        this.oppDefeatAnnounced = true;
        this.showToast(`상대 탈락! (라운드 ${o.wave}) — 라운드 ${o.wave + 1}에 들어가면 승리`);
      }
    }
  }

  private refreshOpponentPanel(): void {
    if (this.opponent && this.oppPanel) this.oppPanel.refresh(this.opponent.view, this.opponent.identity, this.loop, this.data_.config.totalWaves, this.betting);
  }

  /** 새 판 또는 이어하기 (캠페인). 저장이 맞지 않으면 버리고 새로 시작 */
  private startLoop(): GameLoop {
    if (this.mode.resumable && this.initArgs.resume) {
      const snap = loadRun();
      if (snap) {
        try { return GameLoop.restore(this.data_, snap); } catch { clearRun(); }
      }
    }
    if (this.mode.resumable) clearRun();
    this.recorder = null;
    if (!isDuel(this.mode)) return new GameLoop(this.data_);
    // 대전: 매치 시드로 난수를 고정하고 입력을 기록한다 (결정론 재생 — docs/mode-design.md §2.2)
    this.matchSeed = this.mode.seed ?? randomSeed();
    const loop = new GameLoop(this.data_, this.streams());
    this.recorder = new InputRecorder(loop, this.data_.config.simStep);
    return loop;
  }

  private streams(): RngStreams {
    return seedStreams(this.matchSeed, { player: this.initArgs.playerId ?? 'local', sharedHand: this.mode.sharedHand });
  }

  /** 이 판의 입력 로그 (대전만). 결과 보고와 함께 서버에 제출한다 */
  get matchLog(): { seed: string; rounds: RoundInput[]; checksum: string } | null {
    return this.recorder ? { seed: this.matchSeed, rounds: this.recorder.rounds, checksum: this.recorder.checksum() } : null;
  }

  /** 개발 빌드: 판이 끝나면 방금 로그를 재생해 결정론이 깨지지 않았는지 콘솔에 알린다 */
  private checkReplay(): void {
    const log = this.matchLog;
    if (!import.meta.env.DEV || !log) return;
    const re = replayMatch(this.data_, this.streams(), log.rounds);
    const same = re.final.life === this.loop.life && re.final.gold === this.loop.gold && re.final.reached === (this.loop.phase === 'victory' ? this.data_.config.totalWaves + 1 : this.loop.wave);
    if (re.ok && same) console.info(`[replay] ok — ${log.rounds.length}라운드, checksum ${log.checksum}`);
    else console.warn('[replay] 불일치', re.issues, re.final, { life: this.loop.life, gold: this.loop.gold, wave: this.loop.wave });
  }

  /** 캠페인 광고 보상: 이번 라운드 교환 +N (라운드당 1회) */
  private async adExchange(): Promise<void> {
    if (this.loop.phase !== 'card' || this.adExchangeWave === this.loop.wave || this.hand.isAnimating) return;
    const wave = this.loop.wave;
    const ok = await getAds().show('extra_exchange');
    if (!ok || this.ended || this.loop.phase !== 'card' || this.loop.wave !== wave) return;
    this.adExchangeWave = wave;
    this.loop.cardPhase.grantBonusExchange(loadRewardedAds().extraExchange.grantExchanges);
    this.hand.setStatus(this.exchangeStatus());
    this.showToast('교환 +1! 다 쓴 카드를 한 번 더 바꿀 수 있어요');
    this.refreshCampaignBar();
  }

  private refreshCampaignBar(): void {
    if (!this.campaignBar) return;
    const w = this.data_.waves[this.loop.wave - 1];
    const parts = w ? w.groups.map((g) => {
      const t = this.data_.enemyTypes[g.type];
      return `${t?.name ?? g.type} ${g.count}${t?.movement === 'air' ? '(공중)' : ''}`;
    }) : [];
    const preview = w ? `${w.boss ? '보스 · ' : ''}${parts.join(' · ')} · 제한 ${w.timeLimit}초` : '';
    this.campaignBar.refresh({
      wave: this.loop.wave, total: this.data_.config.totalWaves, preview, best: getMeta().stats.bestWave,
      canAd: this.loop.phase === 'card', adUsed: this.adExchangeWave === this.loop.wave,
    });
  }

  // ── 페이즈 처리 ──────────────────────────────────────────
  private confirmHand(): void {
    if (this.loop.phase !== 'card') return;
    // 판돈: 아무것도 안 골랐으면 체크
    if (this.betting?.options('player', this.loop.wave).includes('check')) { this.betting.act('player', this.loop.wave, 'check'); this.recorder?.bet('check'); this.publisher?.bet(this.loop.wave, 'check'); }
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
    const betting = this.betting;
    if (!betting) return;
    const v = betting.view('player', this.loop.wave);
    this.safe(() => {
      betting.act('player', v.wave, a);
      this.recorder?.bet(a);
      this.publisher?.bet(v.wave, a, a === 'raise' ? v.raiseAmount : undefined);
      const msg: Record<BetAction, string> = { check: '체크 — 그대로 진행', raise: `레이즈! 💰${v.raiseAmount} 더 걸었어요 (상대가 콜하면 판돈 💰${v.pot + v.raiseAmount * 2 - (v.pendingRaise ?? 0)})`, call: `콜! 💰${v.pendingRaise} 받았어요 → 판돈 💰${v.pot + (v.pendingRaise ?? 0)}`, fold: '폴드 — 이번 판돈은 포기 (방어는 그대로)' };
      this.showToast(msg[a]);
    });
  }

  /** 양쪽 GameLoop 상태를 판돈 시스템에 반영하고, 새 판정이 나면 알린다 */
  private syncBetting(): void {
    const betting = this.betting, opp = this.opponent;
    if (!betting || !opp) return;
    const results = [...betting.sync('player', this.loop), ...betting.sync('opponent', opp.participant)];
    for (const r of results) {
      if (r.winner === 'player') { this.showToast(`💰 라운드 ${r.wave} 판돈 💰${r.pot} 획득! (${REASON_TEXT[r.reason]})`); this.cameras.main.flash(120, 241, 209, 122); }
      else if (r.winner === 'opponent') this.showToast(`라운드 ${r.wave} 판돈 💰${r.pot}은 상대에게 (${r.reason === 'fold' ? '내가 폴드' : r.reason === 'life' ? '상대가 하트를 덜 잃음' : r.reason === 'time' ? '상대가 더 빨리 클리어' : r.reason === 'hand' ? '상대 족보가 더 높음' : '내가 탈락'})`);
      else this.showToast(`라운드 ${r.wave} 동률 — 판돈 💰${r.pot} 다음 라운드로 이월`);
      this.hud.refresh(this.loop, this.data_.config.totalWaves, this.tokenMeta());
    }
    this.announceOpponentBets();
    // 상대 선택이 바뀌었을 수 있으니 바는 매 프레임 갱신 (텍스트 setText는 같은 값이면 비용 없음)
    this.betBar?.refresh(betting.view('player', this.loop.wave), this.loop.phase);
  }

  /** 상대 베팅 액션을 말풍선으로 (DESIGN §4 SpeechBubble, 강조어 red) */
  private announceOpponentBets(): void {
    const betting = this.betting, opp = this.opponent, bubble = this.oppBubble;
    if (!betting || !opp || !bubble) return;
    const o = opp.view;
    for (const w of new Set([o.wave, o.wave - 1, this.loop.wave])) {
      const rb = betting.round(w);
      if (!rb) continue;
      const a = rb.action.opponent, r = rb.response.opponent;
      if (a && !this.seenOppActions.has(`${w}:a`)) {
        this.seenOppActions.add(`${w}:a`);
        if (a === 'raise') bubble.show(`레이즈 +${rb.raise?.amount ?? ''}!`, true);
        else if (!rb.raise || rb.raise.by !== 'player') bubble.show('체크');
      }
      if (r && !this.seenOppActions.has(`${w}:r`)) {
        this.seenOppActions.add(`${w}:r`);
        bubble.show(r === 'call' ? '콜! 받아친다' : '폴드…', r === 'call');
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
    const pity = ([['straight', '스트레이트'], ['flush', '플러시'], ['rank', '풀하우스']] as const).map(([k, label]) => ({ label, mult: p.pityMultiplier(k) }));
    return { left: p.hand.map((_, i) => p.exchangesRemainingFor(i)), used: p.exchangesUsed, total: p.exchangesTotal, tickets: this.loop.ticketsLeftRun > 0 ? getMeta().tickets : 0, ticketsUsed: p.ticketsUsed, outs, pity, bonus: p.bonusExchanges, runCap: this.data_.config.ticketsPerRun !== undefined ? { used: this.loop.ticketsUsedRun, max: this.data_.config.ticketsPerRun } : undefined };
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
    // 캠페인: 라운드 시작마다 자동 저장 (이어하기)
    if (this.mode.resumable) saveRun(this.loop.snapshot());
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
    if (!this.opponent) this.hud.setOpponent(getMeta().stats.bestWave > 0 ? `내 최고 R${getMeta().stats.bestWave}` : '싱글 캠페인');
    this.refreshCampaignBar();
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
  private finishRace(opp: OpponentSource): void {
    const total = this.data_.config.totalWaves;
    let r = raceStatus(sideOf(this.loop), sideOf(opp.view), total);
    // 네트워크 상대의 판은 대신 굴릴 수 없다 — 상대가 끝낼 때까지 기다린다 (liveFrame)
    if (!r && opp instanceof LiveOpponent && !opp.finished) return;
    if (!r) {
      opp.fastForward();
      r = raceStatus(sideOf(this.loop), sideOf(opp.view), total) ?? resolveDuel(sideOf(this.loop), sideOf(opp.view), total);
    }
    this.showEnd(r);
  }

  /** 대전 결과 (DESIGN §5-05). 광고·부활 없음 (§10.5) */
  private showEnd(duel: DuelResult): void {
    if (this.ended || !this.opponent) return;
    this.ended = true;
    this.checkReplay();
    if (this.live) void this.settleLive(this.live, duel);
    else this.showDuelResult(duel);
  }

  /**
   * 실시간 매치 마무리: 내 성적·입력 로그를 서버에 내고, 서버 판정을 받아 표시한다.
   * 두 기기의 시계·지연 차이로 "누가 먼저"가 갈릴 수 있으므로 승패는 서버 판정을 따른다 (못 받으면 이 기기의 판정).
   */
  private async settleLive(live: LiveContext, local: DuelResult): Promise<void> {
    this.nav.close();
    this.banner.show('결과 확인 중…', { holdMs: VERDICT_WAIT_MS });
    const report = this.publisher!.report;
    const log = this.matchLog;
    let info: MatchInfo | null = await reportResult(live.matchId, report).catch(() => null);
    if (log) void submitLog(live.matchId, log.rounds, log.checksum).catch(() => undefined);
    if (!info || info.status !== 'done') info = await this.waitVerdict(live) ?? info;
    if (!this.scene.isActive()) return;
    let duel = local;
    if (info && info.status === 'done' && info.winner) {
      const winner = info.winner === 'draw' ? 'draw' : info.winner === info.role ? 'player' : 'opponent';
      const known: DuelResult['reason'][] = ['first_clear', 'opponent_out', 'wave', 'life', 'gold', 'draw'];
      const reason = known.find((k) => k === info!.reason) ?? local.reason;
      duel = { ...local, winner, reason };
    }
    this.showDuelResult(duel, info?.status === 'done');
  }

  private waitVerdict(live: LiveContext): Promise<MatchInfo | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (m: MatchInfo | null) => { if (settled) return; settled = true; off(); clearTimeout(timer); resolve(m); };
      const read = () => getMatch(live.matchId, live.me).then((m) => (m.status === 'done' ? m : null)).catch(() => null);
      const off = subscribeMatch(live.matchId, (status) => { if (status === 'done') void read().then((m) => { if (m) finish(m); }); });
      const timer = setTimeout(() => void read().then(finish), VERDICT_WAIT_MS);
      // 구독이 붙기 전에 확정됐을 수 있다
      setTimeout(() => void read().then((m) => { if (m) finish(m); }), 1500);
    });
  }

  /** 실시간 매치 중단 (상대 이탈): 결과 없이 끝낸다 — 전적 미기록 (docs/mode-design.md §1.3) */
  private abortLive(why: string): void {
    if (this.ended) return;
    this.ended = true;
    this.nav.close();
    this.overlay = new ResultOverlay(this, {
      outcome: 'draw', title: '대전 중단', caption: `${why}\n이 판은 전적에 기록되지 않아요`, stars: 0, rows: [],
      continueLabel: '나가기', continueVariant: 'gray',
      onContinue: () => this.leaveLive(),
    });
  }

  private leaveLive(): void {
    const code = this.live?.roomCode;
    if (code) void leaveRoom(code).catch(() => undefined);
    this.scene.start(this.live ? SCENE.Friend : SCENE.Lobby);
  }

  private closeLive(): void {
    const live = this.live;
    if (!live) return;
    if (!this.ended) { try { this.publisher?.leave(); } catch { /* 이미 닫힘 */ } }
    if (this.opponent instanceof LiveOpponent) this.opponent.close();
    this.publisher?.close();
    live.transport.close();
    this.live = null;
    this.publisher = null;
  }

  private showDuelResult(duel: DuelResult, confirmed = true): void {
    if (!this.opponent) return;
    const total = this.data_.config.totalWaves;
    const cleared = this.loop.phase === 'victory';
    this.nav.close();
    const outcome = duel.winner === 'draw' ? 'draw' : duel.winner === 'player' ? 'win' : 'lose';
    const PATH: Record<string, string> = {
      first_clear: '마지막 라운드 먼저 클리어',
      opponent_out: '상대 탈락 후 라운드 앞섬',
      wave: '도달 라운드 판정',
      life: '남은 하트 판정',
      gold: '골드 판정',
      draw: '완전 동률',
    };
    const o = this.opponent.view;
    const name = this.opponent.identity.name;
    const rules = this.mode.custom ? ' (커스텀 룰)' : '';
    const pending = confirmed ? '' : ' (서버 확인 전)';
    const caption = `${this.mode.label}${rules} · ${PATH[duel.reason]}${pending}\n나 R${cleared ? `${total} 클리어` : this.loop.wave} ♥${this.loop.life}  vs  ${name} R${o.phase === 'victory' ? `${total} 클리어` : o.wave} ♥${o.life}`;
    const rows: ResultRow[] = [];
    if (this.betting) rows.push({ icon: 'coin', label: `판돈 획득 (나 / ${name})`, value: `${this.betting.won.player} / ${this.betting.won.opponent}` });
    rows.push({ icon: 'star', label: '최고 족보', value: this.bestRank >= 0 ? HAND_NAME[this.bestRank] : '-', highlight: true });
    // 별 3개: 승리 / 하트 4+ / 하트 7+ (DESIGN §5-05)
    const stars = outcome === 'win' ? 1 + (this.loop.life >= 4 ? 1 : 0) + (this.loop.life >= 7 ? 1 : 0) : 0;
    const subtitle = outcome === 'lose' ? (this.loop.phase === 'defeat' ? `라운드 ${this.loop.wave}에서 전멸...` : `${name}이(가) 먼저 결승선을 넘었어요`) : undefined;
    const live = this.live;
    if (live) {
      // 친구 대전: 재대결은 방으로 돌아가 다시 준비 (서버가 새 시드를 준다). 광고·부활 없음
      const friendId = live.opponentId;
      this.overlay = new ResultOverlay(this, {
        outcome, caption, subtitle, stars, rows,
        continueLabel: live.roomCode ? '재대결\n방으로 돌아가 다시 준비' : '계속',
        onContinue: () => (live.roomCode ? this.scene.start(SCENE.Friend, { code: live.roomCode } satisfies FriendSceneInit) : this.scene.start(SCENE.Lobby)),
        extras: friendId ? [{
          label: '친구 추가', variant: 'blue',
          onClick: (b) => { b.setEnabled(false); void addFriend(friendId).then(() => b.setLabel('친구 추가 완료')).catch((e) => { b.setEnabled(true); this.showToast(errorText(e)); }); },
        }] : [],
        againLabel: '나가기',
        onAgain: () => this.leaveLive(),
      });
      return;
    }
    this.overlay = new ResultOverlay(this, {
      outcome, caption, subtitle, stars, rows,
      onContinue: () => this.scene.start(SCENE.Lobby),
      onAgain: () => this.scene.restart({ ...this.initArgs, opponentSource: undefined, opponent: undefined }),
    });
  }

  // ── 캠페인 종료 ───────────────────────────────────────────
  private finishCampaign(): void {
    if (this.ended) return;
    this.ended = true;
    this.nav.close();
    const rv = loadRewardedAds().revive;
    const canRevive = this.loop.phase === 'defeat' && this.mode.ads && rv.enabled && this.loop.revivesUsed < rv.maxPerRun;
    if (canRevive) this.showReviveOffer(rv.restoreLife, rv.maxPerRun);
    else this.showCampaignResult();
  }

  /** 패배·부활 제안 (DESIGN §5-06): 카운트다운 5초 + 사실 기반 아까움 문구. 판당 1회 */
  private showReviveOffer(restoreLife: number, maxPerRun: number): void {
    const wave = this.loop.wave;
    const nextBoss = this.data_.waves.find((w) => w.boss && w.wave >= wave);
    const bossName = nextBoss ? this.data_.enemyTypes[nextBoss.groups[0]?.type]?.name ?? '보스' : null;
    const note = nextBoss ? (nextBoss.wave === wave ? `${bossName}만 넘기면 됐어요` : `${bossName}까지 ${nextBoss.wave - wave}라운드 남았어요`) : undefined;
    this.overlay = new ResultOverlay(this, {
      outcome: 'lose', title: '패배', subtitle: `라운드 ${wave}에서 전멸...`, stars: 0,
      caption: '부활하면 하트를 회복하고 이 라운드를 다시 시작해요 (판당 1회)',
      rows: [
        { icon: 'star', label: '최고 족보', value: this.bestRank >= 0 ? HAND_NAME[this.bestRank] : '-', highlight: true },
        { icon: 'coin', label: '보유 골드', value: `${Math.floor(this.loop.gold)}` },
      ],
      countdownSec: 5, countdownNote: note,
      ad: {
        label: `부활하기 ♥${restoreLife} 회복`,
        onClick: async () => {
          const ok = await getAds().show('revive');
          if (!ok) return null;
          this.loop.revive(restoreLife, maxPerRun);
          this.overlay?.destroy();
          this.overlay = null;
          this.ended = false;
          this.track.clearEnemies();
          this.refreshHand();
          this.refreshPanels();
          this.showToast(`부활! 하트 ${restoreLife} · 라운드 ${this.loop.wave} 다시 도전`);
          return null;
        },
      },
      continueLabel: '포기하고 보상 받기', continueVariant: 'gray',
      onContinue: () => { this.overlay?.destroy(); this.overlay = null; this.showCampaignResult(); },
    });
  }

  /** 캠페인 최종 결과: 기록·다이아 지급 + [보상 2배 받기 ▶AD] */
  private showCampaignResult(): void {
    const total = this.data_.config.totalWaves;
    const cleared = this.loop.phase === 'victory';
    clearRun();
    // 메타 진행 기록 + 다이아 지급 (localStorage 저장)
    const reward = getMeta().recordRun({ wave: cleared ? total : this.loop.wave, victory: cleared });
    const rows: ResultRow[] = [
      { icon: 'gem', label: '다이아', value: `+${reward.gemsGained}` },
      { icon: 'star', label: '최고 족보', value: this.bestRank >= 0 ? HAND_NAME[this.bestRank] : '-', highlight: true },
      { icon: 'coin', label: '도달 라운드', value: cleared ? `${total} 클리어` : `${this.loop.wave} / ${total}` },
    ];
    if (reward.newMilestones.length || reward.newBest) {
      rows.push({ icon: 'token', label: reward.newMilestones.length ? `라운드 ${reward.newMilestones.join('·')} 최초 달성` : '최고 기록', value: reward.newBest ? '갱신!' : '달성!' });
    }
    const dbl = loadRewardedAds().doubleClearGold;
    const stars = cleared ? 1 + (this.loop.life >= 4 ? 1 : 0) + (this.loop.life >= 7 ? 1 : 0) : 0;
    this.overlay = new ResultOverlay(this, {
      outcome: cleared ? 'win' : 'lose',
      caption: cleared ? `싱글 캠페인 · ${total}라운드 클리어` : '싱글 캠페인',
      subtitle: cleared ? undefined : `라운드 ${this.loop.wave}에서 전멸...`,
      stars, rows,
      ad: this.mode.ads && dbl.enabled && reward.gemsGained > 0 ? {
        label: `보상 ${dbl.multiplier}배 받기`,
        onClick: async () => {
          const ok = await getAds().show('double_reward');
          if (!ok) return null;
          const extra = reward.gemsGained * (dbl.multiplier - 1);
          getMeta().addGems(extra);
          return `다이아 +${extra} 더 받음`;
        },
      } : undefined,
      onContinue: () => this.scene.start(SCENE.Lobby),
      onAgain: () => this.scene.restart({ mode: this.mode }),
    });
  }
}
