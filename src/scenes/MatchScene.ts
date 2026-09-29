import Phaser from 'phaser';
import { SCENE, GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { loadDuelConfig, loadModeSources } from '../data/index.ts';
import { pickPreset } from '../systems/Betting.ts';
import { buildGameData, rankedDuel } from '../systems/GameMode.ts';
import { AIOpponent, localBotIdentity, type OpponentSource } from '../systems/Opponent.ts';
import type { GameSceneInit } from './GameScene.ts';
import { Button } from '../ui/Button.ts';
import { addBackdrop } from '../ui/Backdrop.ts';
import { COLOR, FONT, OUTLINE, SIZE, SUIT_COLOR, SUIT_SYMBOL, hex } from '../ui/theme.ts';
import { findMatch, getOpponentScript, SupabaseTransport } from '../net/api.ts';
import { errorText, getSession, onlineAvailable } from '../net/session.ts';
import { LiveOpponent } from '../net/Live.ts';
import type { MatchInfo, Profile } from '../net/types.ts';

const TIPS = [
  '같은 수트를 모으면 수트 시너지가 켜져요',
  '영웅은 일찍 소환할수록 등급이 높아요',
  '레이즈는 라운드마다 한 번, 금액은 정해져 있어요',
  '하트가 3 이하면 앤티가 절반으로 줄어요',
  '공중 적은 대공 유닛만 공격할 수 있어요',
  '교환권은 한 판에 3번까지 쓸 수 있어요',
];
const REVEAL_MS = 2200;

/**
 * 랭크 대전 매칭 대기 (DESIGN §5-09): "매칭 중… 00:07" + TIP + [취소].
 * 상대를 찾으면 닉·레이팅을 잠깐 보여 주고 대전으로 넘어간다. 상대가 어떤 종류든(사람·기록·봇) 같은 화면, 같은 흐름이다.
 * 서버 설정이 없거나 연결에 실패하면 이 기기의 상대와 바로 시작한다(랭크 미반영).
 */
export class MatchScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;
  private clock!: Phaser.GameObjects.Text;
  private tip!: Phaser.GameObjects.Text;
  private cancelBtn!: Button;
  private ring: Phaser.GameObjects.Container | null = null;
  private glyphs: Phaser.GameObjects.Text[] = [];
  private search: { cancel: () => Promise<void> } | null = null;
  private startedAt = 0;
  private found = false;
  private alive = false;

  constructor() {
    super(SCENE.Match);
  }

  create(): void {
    this.alive = true;
    this.found = false;
    this.search = null;
    this.glyphs = [];
    addBackdrop(this, 'duel');
    const cx = GAME_WIDTH / 2;
    this.add.text(cx, 260, '랭크 대전', { fontSize: `${SIZE.h1}px`, color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE, strokeThickness: 8 }).setOrigin(0.5);
    this.add.text(cx, 340, '레이즈 듀얼 · 라운드 20', { fontSize: `${SIZE.body + 4}px`, color: hex(COLOR.textSub), fontFamily: FONT.body, fontStyle: '700' }).setOrigin(0.5);

    // 돌아가는 수트 4개
    const ring = this.add.container(cx, 760);
    (['S', 'H', 'D', 'C'] as const).forEach((s, i) => {
      const a = (Math.PI / 2) * i;
      const g = this.add.graphics();
      g.fillStyle(COLOR.navyDark).fillCircle(Math.cos(a) * 150, Math.sin(a) * 150 + 6, 62);
      g.fillStyle(SUIT_COLOR[s]).fillCircle(Math.cos(a) * 150, Math.sin(a) * 150, 58);
      g.lineStyle(5, 0xffffff).strokeCircle(Math.cos(a) * 150, Math.sin(a) * 150, 58);
      const t = this.add.text(Math.cos(a) * 150, Math.sin(a) * 150, SUIT_SYMBOL[s], { fontSize: '64px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5);
      ring.add([g, t]);
      this.glyphs.push(t);
    });
    this.ring = ring;
    this.tweens.add({ targets: ring, angle: 360, duration: 6000, repeat: -1 });

    this.status = this.add.text(cx, 1080, '연결 중…', { fontSize: `${SIZE.h2}px`, color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5);
    this.clock = this.add.text(cx, 1170, '', { fontSize: '72px', color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE, strokeThickness: 6 }).setOrigin(0.5);
    this.tip = this.add.text(cx, 1340, `TIP  ${TIPS[Math.floor(Math.random() * TIPS.length)]}`, { fontSize: `${SIZE.body + 2}px`, color: hex(COLOR.textSub), fontFamily: FONT.body, fontStyle: '700', align: 'center', wordWrap: { width: GAME_WIDTH - 160 } }).setOrigin(0.5);
    this.time.addEvent({ delay: 5000, loop: true, callback: () => { if (!this.found) this.tip.setText(`TIP  ${TIPS[Math.floor(Math.random() * TIPS.length)]}`); } });
    this.cancelBtn = new Button(this, cx, 1560, '취소', () => void this.cancel(), { width: 420, height: SIZE.btnM, variant: 'gray' });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.alive = false; if (!this.found) void this.search?.cancel().catch(() => undefined); });

    if (!onlineAvailable()) { this.startLocal(); return; }
    void this.begin();
  }

  update(): void {
    // 고리는 돌아도 수트 글자는 똑바로
    if (this.ring) for (const t of this.glyphs) t.setAngle(-this.ring.angle);
    if (this.found || !this.startedAt) return;
    const s = Math.floor((performance.now() - this.startedAt) / 1000);
    this.clock.setText(`${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
  }

  private async begin(): Promise<void> {
    let me: Profile;
    try {
      me = await getSession();
    } catch {
      if (this.alive) this.startLocal();
      return;
    }
    if (!this.alive) return;
    this.status.setText('매칭 중…');
    this.startedAt = performance.now();
    const search = findMatch();
    this.search = search;
    try {
      const info = await search.promise;
      if (!this.alive) return;
      this.found = true;
      await this.prepare(info, me);
    } catch (e) {
      if (!this.alive || /match_cancelled/.test(String((e as Error).message))) return;
      this.status.setText(errorText(e));
      this.cancelBtn.setLabel('돌아가기');
    }
  }

  /** 상대를 만들고(종류는 화면에 드러내지 않는다) 상대 소개 → 대전 */
  private async prepare(info: MatchInfo, me: Profile): Promise<void> {
    this.cancelBtn.setEnabled(false);
    const mode = rankedDuel(info.opponent.id ? 'live' : 'ai', info.seed);
    const data = buildGameData(loadModeSources(), mode, null);
    const identity = { name: info.opponent.name, rating: info.opponent.rating, avatar: info.opponent.avatar };
    let init: GameSceneInit;
    if (info.opponent.id) {
      const transport = new SupabaseTransport(info.id, me.id);
      await transport.connect();
      const opponent = new LiveOpponent(identity, transport, data);
      init = { mode, opponentSource: opponent, playerId: me.id, live: { matchId: info.id, roomCode: null, me: me.id, opponentId: info.opponent.id, transport } };
    } else {
      const script = await getOpponentScript(info.id).catch(() => null);
      const usable = script && Array.isArray(script.rounds) && script.rounds.length > 0 ? script : undefined;
      const opponent: OpponentSource = new AIOpponent(data, identity, Math.random, { script: usable, preset: pickPreset(loadDuelConfig().ai.presets, identity.rating) });
      init = { mode, opponentSource: opponent, playerId: me.id, online: { matchId: info.id, me: me.id } };
    }
    if (!this.alive) { init.live?.transport.close(); return; }
    this.reveal(identity.name, identity.rating, identity.avatar, () => this.scene.start(SCENE.Game, init));
  }

  private reveal(name: string, rating: number | null, avatar: Profile['avatar'], go: () => void): void {
    const cx = GAME_WIDTH / 2;
    this.status.setText('상대를 찾았어요!').setColor(hex(COLOR.textGold));
    this.clock.setVisible(false);
    this.tip.setVisible(false);
    this.cancelBtn.setVisible(false);
    const c = this.add.container(cx, 1300);
    const g = this.add.graphics();
    g.fillStyle(COLOR.navyDark).fillCircle(0, 6, 86);
    g.fillStyle(SUIT_COLOR[avatar]).fillCircle(0, 0, 80);
    g.lineStyle(6, 0xffffff).strokeCircle(0, 0, 80);
    const s = this.add.text(0, 0, SUIT_SYMBOL[avatar], { fontSize: '88px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5);
    const n = this.add.text(0, 130, name, { fontSize: `${SIZE.h2 + 4}px`, color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5);
    const r = this.add.text(0, 190, rating === null ? '' : `레이팅 ${rating}`, { fontSize: `${SIZE.body + 2}px`, color: hex(COLOR.textSub), fontFamily: FONT.body, fontStyle: '700' }).setOrigin(0.5);
    c.add([g, s, n, r]);
    c.setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 280, ease: 'Back.easeOut' });
    this.time.delayedCall(REVEAL_MS, go);
  }

  /** 서버 없이: 이 기기의 상대와 바로 (랭크 미반영). 화면 흐름은 같다 */
  private startLocal(): void {
    this.found = true;
    const id = localBotIdentity(1000);
    const mode = rankedDuel('ai');
    const opponent = new AIOpponent(buildGameData(loadModeSources(), mode, null), id, Math.random, { preset: pickPreset(loadDuelConfig().ai.presets, id.rating) });
    const init: GameSceneInit = { mode, opponentSource: opponent };
    this.reveal(id.name, id.rating, id.avatar, () => this.scene.start(SCENE.Game, init));
  }

  private async cancel(): Promise<void> {
    if (this.found) return;
    const s = this.search;
    this.search = null;
    this.alive = false;
    await s?.cancel().catch(() => undefined);
    this.scene.start(SCENE.Lobby);
  }
}
