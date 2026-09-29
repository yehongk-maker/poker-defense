import Phaser from 'phaser';
import { SCENE, GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { loadModeSources } from '../data/index.ts';
import { buildGameData, friendDuel } from '../systems/GameMode.ts';
import type { GameData } from '../systems/GameLoop.ts';
import { Button } from '../ui/Button.ts';
import { addBackdrop } from '../ui/Backdrop.ts';
import { OpponentMiniMap } from '../ui/OpponentMiniMap.ts';
import { COLOR, FONT, HAND_NAME, OUTLINE, SIZE, SUIT_COLOR, SUIT_SYMBOL, hex } from '../ui/theme.ts';
import { subscribeRoom, SupabaseTransport, unwatchRoom, watchInfo } from '../net/api.ts';
import { normalizeRules, describeRules } from '../net/rules.ts';
import { LiveOpponent, SenderView } from '../net/Live.ts';
import type { Unsubscribe } from '../net/MatchTransport.ts';
import type { WatchInfo } from '../net/types.ts';
import type { FriendSceneInit } from './FriendScene.ts';

export interface SpectateSceneInit { info: WatchInfo; me: string }

const MAP_SCALE = 2.9;
const REFRESH_SEC = 0.3;
const PHASE: Record<string, string> = { card: '카드 선택 중', manage: '정비 중', combat: '전투 중', victory: '전부 클리어!', defeat: '탈락' };
const BET: Record<string, string> = { check: '체크', raise: '레이즈', call: '콜', fold: '폴드' };
const REASON: Record<string, string> = { first_clear: '마지막 라운드 먼저 클리어', wave: '도달 라운드 판정', life: '남은 하트 판정', gold: '골드 판정', draw: '완전 동률', forfeit: '상대 기권', timeout: '시간 초과' };

/**
 * 친구 방 관전: 두 사람의 공개 정보(필드·적·라운드·하트·골드·족보 등급·판돈 선택)를 나란히 본다.
 * 구경꾼은 듣기만 한다 — 손패는 애초에 채널에 실리지 않고, 구경꾼은 아무것도 보내지 않는다.
 * 결과는 방 행이 done이 되면 서버 판정을 읽어 표시한다.
 */
export class SpectateScene extends Phaser.Scene {
  private args!: SpectateSceneInit;
  private data_!: GameData;
  private transport: SupabaseTransport | null = null;
  private sides: { who: LiveOpponent; map: OpponentMiniMap; status: Phaser.GameObjects.Text; bet: Phaser.GameObjects.Text }[] = [];
  private lead!: Phaser.GameObjects.Text;
  private note!: Phaser.GameObjects.Text;
  private offRoom: Unsubscribe | null = null;
  private acc = 0;
  private over = false;
  private alive = false;
  private resultBox: Phaser.GameObjects.Container | null = null;

  constructor() {
    super(SCENE.Spectate);
  }

  init(data: SpectateSceneInit): void {
    this.args = data;
  }

  create(): void {
    this.alive = true; this.over = false; this.acc = 0; this.sides = []; this.resultBox = null;
    const { info } = this.args;
    const m = info.match!;
    addBackdrop(this, 'duel');
    const cx = GAME_WIDTH / 2;
    const rules = normalizeRules({ ...m.rules, waves: m.waveCount });
    this.data_ = buildGameData(loadModeSources(), friendDuel(rules), null);

    new Button(this, SIZE.gutter + 110, 110, '‹ 나가기', () => void this.leave(), { width: 220, height: SIZE.btnS, fontSize: 32, variant: 'gray' });
    this.add.text(cx, 100, '관전', { fontSize: `${SIZE.h1}px`, color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE, strokeThickness: 8 }).setOrigin(0.5);
    this.add.text(cx, 176, `방 ${info.room.code} · ${describeRules(rules)}`, { fontSize: `${SIZE.caption + 2}px`, color: hex(COLOR.textSub), fontFamily: FONT.body, fontStyle: '700', align: 'center', wordWrap: { width: GAME_WIDTH - 520 } }).setOrigin(0.5);

    const transport = new SupabaseTransport(m.id, this.args.me, 'spectator');
    this.transport = transport;
    const mapW = 156 * MAP_SCALE;
    const people = [info.host, info.guest!];
    people.forEach((p, i) => {
      const x = i === 0 ? cx - 270 : cx + 270;
      const who = new LiveOpponent({ name: p.name, rating: null, avatar: p.avatar }, new SenderView(transport, p.id), this.data_);
      const g = this.add.graphics();
      g.fillStyle(COLOR.navyDark).fillCircle(x - 170, 306, 50);
      g.fillStyle(SUIT_COLOR[p.avatar]).fillCircle(x - 170, 300, 46);
      g.lineStyle(4, 0xffffff).strokeCircle(x - 170, 300, 46);
      this.add.text(x - 170, 300, SUIT_SYMBOL[p.avatar], { fontSize: '50px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5);
      this.add.text(x - 106, 284, p.name, { fontSize: '40px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0, 0.5);
      this.add.text(x - 106, 328, i === 0 ? '방장' : '친구', { fontSize: `${SIZE.caption + 2}px`, color: hex(COLOR.textSub), fontFamily: FONT.body, fontStyle: '700' }).setOrigin(0, 0.5);
      const map = new OpponentMiniMap(this, x + mapW / 2, 390, () => undefined).setScale(MAP_SCALE);
      map.setPosition(x - mapW / 2, 390);
      map.label = '';
      const status = this.add.text(x, 980, '', { fontSize: '36px', color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE, align: 'center', lineSpacing: 10 }).setOrigin(0.5, 0);
      const bet = this.add.text(x, 1230, '', { fontSize: '34px', color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE, align: 'center' }).setOrigin(0.5, 0);
      this.sides.push({ who, map, status, bet });
    });
    this.add.text(cx, 300, 'VS', { fontSize: '64px', color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE }).setOrigin(0.5);
    this.lead = this.add.text(cx, 1360, '', { fontSize: `${SIZE.h2}px`, color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE, align: 'center' }).setOrigin(0.5);
    this.note = this.add.text(cx, 1450, '연결 중…', { fontSize: `${SIZE.body + 2}px`, color: hex(COLOR.textSub), fontFamily: FONT.body, fontStyle: '700', align: 'center' }).setOrigin(0.5);
    this.add.text(cx, GAME_HEIGHT - 70, '손패는 보이지 않아요 · 공개 정보만 보여 줘요', { fontSize: `${SIZE.caption}px`, color: hex(COLOR.textSub), fontFamily: FONT.body, fontStyle: '700' }).setOrigin(0.5).setAlpha(0.8);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    void transport.connect().then(() => { if (this.alive) this.note.setText('구경 중 · 두 사람에게 내 화면은 보이지 않아요'); })
      .catch(() => { if (this.alive) this.note.setText('연결하지 못했어요. 나갔다가 다시 들어와 주세요'); });
    this.offRoom = subscribeRoom(info.room.id, (r) => {
      if (r.status === 'done' || r.status === 'closed') void this.finish(r.status === 'closed');
    });
    // 이미 끝난 판이면 바로 결과
    if (m.status === 'done') void this.finish(false);
  }

  update(_t: number, delta: number): void {
    this.acc += delta / 1000;
    if (this.acc < REFRESH_SEC) return;
    this.acc = 0;
    const total = this.data_.config.totalWaves;
    for (const s of this.sides) {
      const v = s.who.view;
      s.map.refresh(v, this.data_.battleConfig.trackLength);
      const hand = v.lastHandRank !== null ? `최근 족보 ${HAND_NAME[v.lastHandRank]}` : '족보 아직';
      const exch = v.phase === 'card' ? ` · 교환 ${v.exchangeCount}장` : '';
      s.status.setText(`라운드 ${Math.min(v.wave, total)}/${total}\n하트 ${v.life} · 골드 ${Math.floor(v.gold)}\n${PHASE[v.phase] ?? v.phase}${exch}\n${hand}`);
      const b = s.who.lastBet;
      s.bet.setText(b ? `R${b.wave} ${BET[b.action]}${b.amount ? ` +${b.amount}` : ''}` : '');
    }
    if (this.over) return;
    const [a, b] = this.sides.map((s) => s.who.view);
    const d = a.wave - b.wave;
    const names = this.sides.map((s) => s.who.identity.name);
    this.lead.setText(d === 0 ? '라운드 동률' : `${d > 0 ? names[0] : names[1]} ${Math.abs(d)}라운드 앞섬`);
    if (this.sides.every((s) => s.who.finished || s.who.surrendered)) this.note.setText('결과 확인 중…');
  }

  /** 방이 끝남: 서버 판정을 읽어 보여 준다 */
  private async finish(closed: boolean): Promise<void> {
    if (this.over || !this.alive) return;
    this.over = true;
    const { info } = this.args;
    const now = await watchInfo(info.room.code).catch(() => null);
    if (!this.alive) return;
    const m = now?.match;
    const cx = GAME_WIDTH / 2, cy = 1560;
    const c = this.add.container(0, 0).setDepth(20);
    const g = this.add.graphics();
    g.fillStyle(COLOR.navyDark).fillRoundedRect(SIZE.gutter, cy - 222, GAME_WIDTH - 2 * SIZE.gutter, 460, SIZE.radiusPanel);
    g.fillStyle(COLOR.navy).fillRoundedRect(SIZE.gutter, cy - 230, GAME_WIDTH - 2 * SIZE.gutter, 460, SIZE.radiusPanel);
    g.lineStyle(3, COLOR.gold).strokeRoundedRect(SIZE.gutter, cy - 230, GAME_WIDTH - 2 * SIZE.gutter, 460, SIZE.radiusPanel);
    let title = '대전이 끝났어요', sub = '';
    if (m && m.status === 'done' && m.winner) {
      const winnerId = m.winner === 'draw' ? null : m.winner === 'p1' ? m.p1 : m.p2;
      const name = winnerId === info.host.id ? info.host.name : info.guest?.name ?? '';
      title = winnerId ? `${name} 승리!` : '무승부';
      const quit = this.sides.find((x) => x.who.surrendered);
      sub = quit ? `${quit.who.identity.name} 기권` : REASON[m.reason ?? ''] ?? '';
    } else if (closed) { title = '방이 닫혔어요'; sub = '결과 없이 끝났어요'; }
    c.add(g);
    c.add(this.add.text(cx, cy - 150, title, { fontSize: `${SIZE.h1}px`, color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE, strokeThickness: 8 }).setOrigin(0.5));
    c.add(this.add.text(cx, cy - 70, sub, { fontSize: `${SIZE.body + 4}px`, color: hex(COLOR.textMain), fontFamily: FONT.body, fontStyle: '700' }).setOrigin(0.5));
    if (!closed) c.add(new Button(this, cx, cy + 40, '방으로\n다음 판도 구경해요', () => this.scene.start(SCENE.Friend, { watch: info.room.code } satisfies FriendSceneInit), { width: GAME_WIDTH - 2 * SIZE.gutter - 120, height: SIZE.btnL, fontSize: 48, variant: 'gold' }));
    c.add(new Button(this, cx, cy + 160, '나가기', () => void this.leave(), { width: 360, height: SIZE.btnS, fontSize: 34, variant: 'gray' }));
    this.lead.setVisible(false);
    this.note.setVisible(false);
    this.resultBox = c;
  }

  private async leave(): Promise<void> {
    const code = this.args.info.room.code;
    this.alive = false;
    await unwatchRoom(code).catch(() => undefined);
    this.scene.start(SCENE.Friend);
  }

  private cleanup(): void {
    this.alive = false;
    this.offRoom?.();
    this.offRoom = null;
    for (const s of this.sides) s.who.close();
    this.transport?.close();
    this.transport = null;
  }
}
