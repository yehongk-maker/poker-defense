import Phaser from 'phaser';
import { SCENE, GAME_WIDTH, GAME_HEIGHT } from '../config.ts';
import { loadModeSources } from '../data/index.ts';
import { buildGameData, friendDuel } from '../systems/GameMode.ts';
import type { GameSceneInit } from './GameScene.ts';
import { Button } from '../ui/Button.ts';
import { addBackdrop } from '../ui/Backdrop.ts';
import { askText, closeTextPrompt } from '../ui/TextPrompt.ts';
import { COLOR, FONT, OUTLINE, SIZE, SUIT_COLOR, SUIT_SYMBOL, hex } from '../ui/theme.ts';
import { answerInvite, countSpectators, createRoom, getMatch, getProfile, inviteFriend, joinRoom, leaveRoom, listFriends, pendingInvites, setReady, setRoomRules, subscribeInvites, subscribeRoom, SupabaseTransport, unwatchRoom, watchInfo, watchRoom } from '../net/api.ts';
import { errorText, getSession, onlineAvailable, rename } from '../net/session.ts';
import { readOnlineEnv } from '../net/env.ts';
import { inviteLink, isValidRoomCode, normalizeRoomCode, parseInvite } from '../net/roomCode.ts';
import { DEFAULT_RULES, isCustom, normalizeRules } from '../net/rules.ts';
import { LiveOpponent, type LiveContext } from '../net/Live.ts';
import type { Friend, Invite, Profile, Room, RoomRules, WatchInfo } from '../net/types.ts';
import type { SpectateSceneInit } from './SpectateScene.ts';
import type { Unsubscribe } from '../net/MatchTransport.ts';
import { clearMatch, loadMatch } from '../matchSave.ts';
import { prepareResume } from './resumeMatch.ts';

export interface FriendSceneInit {
  /** 이 코드의 방으로 바로 들어간다 (초대 링크·재대결) */
  code?: string;
  /** 이 코드의 방을 구경한다 (관전 후 방으로 돌아올 때) */
  watch?: string;
}

interface RuleRow<K extends keyof RoomRules = keyof RoomRules> {
  key: K;
  label: string;
  options: { value: RoomRules[K]; text: string }[];
}
const rule = <K extends keyof RoomRules>(key: K, label: string, options: { value: RoomRules[K]; text: string }[]): RuleRow => ({ key, label, options }) as unknown as RuleRow;

/** 방장이 고르는 규칙 (docs/mode-design.md §1.3). 첫 선택지가 기본값 = 랭크 대전과 같음 */
const RULES: RuleRow[] = [
  rule('waves', '웨이브', [{ value: 20, text: '20' }, { value: 40, text: '40 (긴 판)' }]),
  rule('tickets', '카드 교환권', [{ value: 3, text: '판당 3회' }, { value: 0, text: '금지' }, { value: -1, text: '무제한' }]),
  rule('betting', '판돈 걸기', [{ value: true, text: '켬' }, { value: false, text: '끔 (순수 레이스)' }]),
  rule('allHeroes', '영웅', [{ value: true, text: '전부 개방' }, { value: false, text: '각자 해금분' }]),
  rule('sharedHand', '손패', [{ value: false, text: '각자 랜덤' }, { value: true, text: '동일 손패' }]),
  rule('speed', '배속', [{ value: 1, text: '×1' }, { value: 2, text: '×2' }]),
  rule('applyMeta', '메타 업그레이드', [{ value: false, text: '미적용' }, { value: true, text: '적용' }]),
];

const COUNTDOWN_SEC = 3;

/**
 * 친구 대전 (docs/mode-design.md §1.3): 메뉴(방 만들기 · 코드로 참가 · 친구 목록·초대) → 방(코드 공유 · 규칙 · 준비) → 3초 카운트다운 → 대전.
 * 서버 상태(방 행)를 구독해 그대로 그린다 — 이 씬은 RPC를 부르고 결과를 표시만 한다.
 */
export class FriendScene extends Phaser.Scene {
  private args: FriendSceneInit = {};
  private me: Profile | null = null;
  private room: Room | null = null;
  /** 구경 중인 방 (내가 참가자가 아닌 방) */
  private watching: WatchInfo | null = null;
  private spectators = 0;
  private names = new Map<string, Profile>();
  private body!: Phaser.GameObjects.Container;
  private toast!: Phaser.GameObjects.Text;
  private nickText!: Phaser.GameObjects.Text;
  private unsubRoom: Unsubscribe | null = null;
  private unsubInvites: Unsubscribe | null = null;
  private friends: Friend[] = [];
  private invite: Invite | null = null;
  private busy = false;
  private starting = false;
  private alive = false;

  constructor() {
    super(SCENE.Friend);
  }

  init(data?: FriendSceneInit): void {
    this.args = data ?? {};
  }

  create(): void {
    this.alive = true;
    this.room = null; this.invite = null; this.friends = []; this.busy = false; this.starting = false;
    this.watching = null; this.spectators = 0;
    addBackdrop(this, 'duel');
    const cx = GAME_WIDTH / 2;
    new Button(this, SIZE.gutter + 110, 110, '‹ 로비', () => void this.exit(), { width: 220, height: SIZE.btnS, fontSize: 32, variant: 'gray' });
    this.add.text(cx, 110, '친구 대전', { fontSize: `${SIZE.h1}px`, color: hex(COLOR.textMain), fontFamily: FONT.display, ...OUTLINE, strokeThickness: 8 }).setOrigin(0.5);
    this.nickText = this.add.text(cx, 210, '', { fontSize: `${SIZE.body + 4}px`, color: hex(COLOR.textSub), fontFamily: FONT.body, fontStyle: '700' }).setOrigin(0.5);
    this.body = this.add.container(0, 0);
    this.toast = this.add.text(cx, GAME_HEIGHT - 120, '', { fontSize: '34px', color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE, align: 'center', wordWrap: { width: GAME_WIDTH - 120 } }).setOrigin(0.5).setAlpha(0).setDepth(60);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());

    if (!onlineAvailable()) {
      this.message('온라인 설정이 없어요', '친구 대전은 서버 연결이 필요해요.\n.env.local 에 Supabase 주소와 키를 넣어 주세요.');
      return;
    }
    this.message('연결 중…');
    void this.connect();
  }

  // ── 연결 ──
  private async connect(): Promise<void> {
    try {
      this.me = await getSession();
      if (!this.alive) return;
      this.names.set(this.me.id, this.me);
      this.showNick();
      this.unsubInvites = subscribeInvites(this.me.id, (i) => { this.invite = i; void this.loadName(i.from_id).then(() => { if (!this.room && !this.watching) this.drawMenu(); }); });
      if (this.args.code) {
        await this.enterRoom(() => joinRoom(this.args.code!));
        if (this.room) return;
      }
      if (this.args.watch) {
        await this.enterWatch(this.args.watch);
        if (this.watching) return;
      }
      await this.refreshMenu();
    } catch (e) {
      if (this.alive) this.message('연결하지 못했어요', errorText(e), () => { this.message('연결 중…'); void this.connect(); });
    }
  }

  private showNick(): void {
    if (this.me) this.nickText.setText(`${SUIT_SYMBOL[this.me.avatar]} ${this.me.nick}`);
  }

  private async loadName(id: string): Promise<Profile | null> {
    const hit = this.names.get(id);
    if (hit) return hit;
    const p = await getProfile(id).catch(() => null);
    if (p) this.names.set(id, p);
    return p;
  }

  private async refreshMenu(): Promise<void> {
    const me = this.me!;
    const [friends, invites] = await Promise.all([listFriends().catch(() => [] as Friend[]), pendingInvites(me.id).catch(() => [] as Invite[])]);
    if (!this.alive || this.room || this.watching) return;
    this.friends = friends;
    this.invite = invites[0] ?? null;
    if (this.invite) await this.loadName(this.invite.from_id);
    if (this.alive && !this.room && !this.watching) this.drawMenu();
  }

  // ── 그리기 ──
  private clear(): void {
    this.body.removeAll(true);
  }

  private panel(y: number, h: number, w = GAME_WIDTH - 2 * SIZE.gutter): Phaser.GameObjects.Graphics {
    const cx = GAME_WIDTH / 2;
    const g = this.add.graphics();
    g.fillStyle(COLOR.navyDark, 0.9).fillRoundedRect(cx - w / 2, y + 8, w, h, SIZE.radiusPanel);
    g.fillStyle(COLOR.navy, 0.96).fillRoundedRect(cx - w / 2, y, w, h, SIZE.radiusPanel);
    g.lineStyle(2, COLOR.modalBorder).strokeRoundedRect(cx - w / 2, y, w, h, SIZE.radiusPanel);
    this.body.add(g);
    return g;
  }

  private label(x: number, y: number, text: string, size: number, color: number = COLOR.textMain, display = true): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, text, { fontSize: `${size}px`, color: hex(color), fontFamily: display ? FONT.display : FONT.body, fontStyle: display ? '' : '700', align: 'center', ...(display ? OUTLINE : {}) }).setOrigin(0.5);
    this.body.add(t);
    return t;
  }

  private button(x: number, y: number, text: string, onClick: () => void, opt: ConstructorParameters<typeof Button>[5]): Button {
    const b = new Button(this, x, y, text, onClick, opt);
    this.body.add(b);
    return b;
  }

  private message(title: string, sub = '', retry?: () => void): void {
    this.clear();
    const cx = GAME_WIDTH / 2;
    this.label(cx, 760, title, SIZE.h2);
    if (sub) this.label(cx, 860, sub, SIZE.body, COLOR.textSub, false);
    if (retry) this.button(cx, 1020, '다시 시도', retry, { width: 420, height: SIZE.btnM, variant: 'blue' });
  }

  private drawMenu(): void {
    this.clear();
    const cx = GAME_WIDTH / 2, w = GAME_WIDTH - 2 * SIZE.gutter;
    this.button(cx + 330, 210, '닉네임 변경', () => void this.changeNick(), { width: 260, height: 64, fontSize: 28, variant: 'blue' });
    this.nickText.setX(cx - 120);

    this.button(cx, 400, '방 만들기\n6자리 코드로 친구를 초대해요', () => void this.enterRoom(() => createRoom(DEFAULT_RULES)), { width: w, height: SIZE.btnL + 16, fontSize: 56, variant: 'gold' });
    this.button(cx, 570, '코드로 참가\n친구가 알려 준 코드를 입력해요', () => void this.askCode(), { width: w, height: SIZE.btnL + 16, fontSize: 52, variant: 'blue' });

    this.button(cx, 720, '관전하기\n친구들의 대전을 코드로 구경해요', () => void this.askWatch(), { width: w - 160, height: SIZE.btnM + 8, fontSize: 40, variant: 'purple' });

    let y = 810;
    if (this.invite) {
      const from = this.names.get(this.invite.from_id);
      this.panel(y, 190);
      this.label(cx, y + 56, `${from?.nick ?? '친구'}님이 대전을 걸었어요`, 40, COLOR.textGold);
      const inv = this.invite;
      this.button(cx - 170, y + 130, '수락', () => void this.answer(inv, true), { width: 300, height: SIZE.btnS, fontSize: 34, variant: 'gold' });
      this.button(cx + 170, y + 130, '거절', () => void this.answer(inv, false), { width: 300, height: SIZE.btnS, fontSize: 34, variant: 'gray' });
      y += 220;
    }

    this.label(SIZE.gutter + 60, y + 40, '친구', SIZE.h2).setOrigin(0, 0.5);
    y += 90;
    if (this.friends.length === 0) {
      this.panel(y, 200);
      this.label(cx, y + 100, '아직 친구가 없어요\n대전이 끝난 뒤 [친구 추가]를 누르면 여기에서 바로 초대할 수 있어요', SIZE.body, COLOR.textSub, false);
      return;
    }
    const rowH = 130;
    const max = Math.max(1, Math.floor((GAME_HEIGHT - 200 - y) / (rowH + 14)));
    this.friends.slice(0, max).forEach((f) => {
      this.panel(y, rowH);
      this.avatar(SIZE.gutter + 80, y + rowH / 2, f.avatar, 40);
      this.label(SIZE.gutter + 150, y + 44, f.name, 38).setOrigin(0, 0.5);
      const last = f.last.slice(-5).map((r) => (r === 'draw' ? '무' : r === f.iAm ? '승' : '패')).join(' ');
      this.label(SIZE.gutter + 150, y + 92, `${f.myWins}승 ${f.theirWins}패${f.draws ? ` ${f.draws}무` : ''}${last ? `   최근 ${last}` : ''}`, SIZE.caption + 2, COLOR.textSub, false).setOrigin(0, 0.5);
      this.button(GAME_WIDTH - SIZE.gutter - 140, y + rowH / 2, '초대', () => void this.inviteToNewRoom(f), { width: 220, height: SIZE.btnS, fontSize: 34, variant: 'purple' });
      y += rowH + 14;
    });
  }

  private avatar(x: number, y: number, suit: Profile['avatar'], r: number): void {
    const g = this.add.graphics();
    g.fillStyle(COLOR.navyDark).fillCircle(x, y + 4, r + 4);
    g.fillStyle(SUIT_COLOR[suit]).fillCircle(x, y, r);
    g.lineStyle(4, 0xffffff).strokeCircle(x, y, r);
    this.body.add(g);
    this.label(x, y, SUIT_SYMBOL[suit], Math.round(r * 1.1));
  }

  private drawRoom(): void {
    const room = this.room, me = this.me;
    if (!room || !me) return;
    this.clear();
    this.nickText.setX(GAME_WIDTH / 2);
    const cx = GAME_WIDTH / 2, w = GAME_WIDTH - 2 * SIZE.gutter;
    const host = room.host === me.id;
    const guestIn = room.guest !== null;
    const rules = normalizeRules(room.rules);

    // 방 코드
    this.panel(280, 250);
    this.label(cx, 330, guestIn ? '방 코드' : '초대 대기 중… 이 코드를 친구에게 알려 주세요', SIZE.body, COLOR.textSub, false);
    this.label(cx, 410, room.code.split('').join(' '), 92, COLOR.textGold);
    this.button(cx - 190, 490, '코드 복사', () => void this.copy(room.code, '코드를 복사했어요'), { width: 340, height: 64, fontSize: 30, variant: 'blue' });
    this.button(cx + 190, 490, '초대 링크 공유', () => void this.share(room.code), { width: 340, height: 64, fontSize: 30, variant: 'blue' });

    // 방장 VS 손님
    const side = (x: number, id: string | null, ready: boolean, tag: string) => {
      const p = id ? this.names.get(id) : null;
      if (p) this.avatar(x, 660, p.avatar, 70);
      else { const g = this.add.graphics(); g.lineStyle(6, COLOR.textSub, 0.7).strokeCircle(x, 660, 70); this.body.add(g); this.label(x, 660, '?', 72, COLOR.textSub); }
      this.label(x, 770, p ? p.nick : id ? '…' : '빈 자리', 38);
      this.label(x, 818, `${tag}${id === me.id ? ' · 나' : ''}`, SIZE.caption + 2, COLOR.textSub, false);
      if (id) this.label(x, 866, ready ? '준비 완료' : '준비 전', 32, ready ? COLOR.green : COLOR.textSub);
    };
    side(cx - 300, room.host, room.host_ready, '방장');
    this.label(cx, 660, 'VS', 84, COLOR.textGold);
    side(cx + 300, room.guest, room.guest_ready, '친구');

    // 규칙
    const top = 920, rowH = 84;
    this.panel(top, 70 + RULES.length * rowH + 20);
    this.label(SIZE.gutter + 50, top + 46, '규칙', 40).setOrigin(0, 0.5);
    this.label(GAME_WIDTH - SIZE.gutter - 50, top + 46, isCustom(rules) ? '커스텀' : host ? '눌러서 바꾸기' : '방장이 정해요', SIZE.caption + 4, isCustom(rules) ? COLOR.textGold : COLOR.textSub, false).setOrigin(1, 0.5);
    RULES.forEach((r, i) => {
      const y = top + 70 + i * rowH + rowH / 2;
      this.label(SIZE.gutter + 50, y, r.label, 34).setOrigin(0, 0.5);
      const at = Math.max(0, r.options.findIndex((o) => o.value === rules[r.key]));
      const cur = r.options[at];
      if (host && room.status !== 'live') {
        const next = r.options[(at + 1) % r.options.length];
        this.button(GAME_WIDTH - SIZE.gutter - 220, y, cur.text, () => void this.changeRule({ [r.key]: next.value }), { width: 380, height: 66, fontSize: 30, variant: at === 0 ? 'blue' : 'purple' });
      } else {
        this.label(GAME_WIDTH - SIZE.gutter - 50, y, cur.text, 34, at === 0 ? COLOR.textMain : COLOR.textGold).setOrigin(1, 0.5);
      }
    });

    // 준비
    const myReady = host ? room.host_ready : room.guest_ready;
    const y = top + 70 + RULES.length * rowH + 20 + 110;
    if (room.status === 'live') {
      this.label(cx, y, '대전을 시작해요!', SIZE.h2, COLOR.textGold);
    } else if (!guestIn) {
      this.button(cx, y, '친구를 기다리는 중…', () => undefined, { width: w, height: SIZE.btnL, fontSize: 46, variant: 'gray' }).setEnabled(false);
    } else {
      this.button(cx, y, myReady ? '준비 취소\n상대가 준비하면 바로 시작해요' : '준비\n둘 다 준비하면 3초 뒤 시작', () => void this.ready(!myReady), { width: w, height: SIZE.btnL + 16, fontSize: 56, variant: myReady ? 'gray' : 'gold' });
    }
    const played = room.games_played > 0 && room.status !== 'live' ? `이 방에서 ${room.games_played}판 · 준비하면 새 판을 시작해요` : '';
    const seen = this.spectators > 0 ? `구경꾼 ${this.spectators}명` : '';
    if (played || seen) this.label(cx, y + 110, [played, seen].filter(Boolean).join('   ·   '), SIZE.caption + 4, COLOR.textSub, false);
  }

  /** 구경꾼이 보는 방 화면: 읽기 전용. 대전이 시작되면 관전 화면으로 넘어간다 */
  private drawWatch(): void {
    const info = this.watching;
    if (!info) return;
    this.clear();
    this.nickText.setX(GAME_WIDTH / 2);
    const cx = GAME_WIDTH / 2;
    const rules = normalizeRules(info.room.rules);
    this.panel(280, 250);
    this.label(cx, 330, '구경 중인 방', SIZE.body, COLOR.textSub, false);
    this.label(cx, 410, info.room.code.split('').join(' '), 92, COLOR.textGold);
    this.label(cx, 490, `구경꾼 ${info.spectators}명 · 두 사람에게 내 화면은 보이지 않아요`, SIZE.caption + 4, COLOR.textSub, false);
    const side = (x: number, p: WatchInfo['host'] | null, ready: boolean, tag: string) => {
      if (p) this.avatar(x, 660, p.avatar, 70);
      else { const g = this.add.graphics(); g.lineStyle(6, COLOR.textSub, 0.7).strokeCircle(x, 660, 70); this.body.add(g); this.label(x, 660, '?', 72, COLOR.textSub); }
      this.label(x, 770, p ? p.name : '빈 자리', 38);
      this.label(x, 818, tag, SIZE.caption + 2, COLOR.textSub, false);
      if (p) this.label(x, 866, ready ? '준비 완료' : '준비 전', 32, ready ? COLOR.green : COLOR.textSub);
    };
    side(cx - 300, info.host, info.room.hostReady, '방장');
    this.label(cx, 660, 'VS', 84, COLOR.textGold);
    side(cx + 300, info.guest, info.room.guestReady, '친구');
    const top = 920, rowH = 84;
    this.panel(top, 70 + RULES.length * rowH + 20);
    this.label(SIZE.gutter + 50, top + 46, '규칙', 40).setOrigin(0, 0.5);
    RULES.forEach((r, i) => {
      const y = top + 70 + i * rowH + rowH / 2;
      const at = Math.max(0, r.options.findIndex((o) => o.value === rules[r.key]));
      this.label(SIZE.gutter + 50, y, r.label, 34).setOrigin(0, 0.5);
      this.label(GAME_WIDTH - SIZE.gutter - 50, y, r.options[at].text, 34, at === 0 ? COLOR.textMain : COLOR.textGold).setOrigin(1, 0.5);
    });
    const y = top + 70 + RULES.length * rowH + 20 + 110;
    const st = info.room.status;
    this.label(cx, y, st === 'live' ? '대전 중 — 관전 화면으로 가요' : st === 'done' ? '다음 판을 기다리는 중…' : info.guest ? '두 사람이 준비하면 시작해요' : '친구가 들어오기를 기다리는 중…', SIZE.h2 - 4, COLOR.textGold);
  }

  // ── 동작 ──
  private async guard(fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try { await fn(); } catch (e) { if (this.alive) this.showToast(errorText(e)); } finally { this.busy = false; }
  }

  private async changeNick(): Promise<void> {
    const v = await askText({ title: '닉네임 변경', hint: '2~12자', initial: this.me?.nick ?? '', maxLength: 12, valid: (s) => s.trim().length >= 2 && s.trim().length <= 12 });
    if (!v || !this.alive) return;
    await this.guard(async () => {
      this.me = await rename(v);
      this.names.set(this.me.id, this.me);
      this.showNick();
      this.showToast('닉네임을 바꿨어요');
    });
  }

  private async askCode(): Promise<void> {
    let initial = '';
    try { initial = parseInvite(await navigator.clipboard.readText()) ?? ''; } catch { /* 클립보드 권한 없음 */ }
    const v = await askText({
      title: '방 코드 입력', hint: '영문·숫자 6자리 (링크를 붙여 넣어도 돼요)', placeholder: 'K7Q2M4', initial, kind: 'code', okLabel: '참가',
      transform: (raw) => parseInvite(raw) ?? normalizeRoomCode(raw).slice(0, 6),
      valid: isValidRoomCode,
    });
    if (!v || !this.alive) return;
    await this.enterRoom(() => joinRoom(v));
  }

  private async askWatch(): Promise<void> {
    const v = await askText({
      title: '구경할 방 코드', hint: '영문·숫자 6자리', placeholder: 'K7Q2M4', kind: 'code', okLabel: '구경',
      transform: (raw) => parseInvite(raw) ?? normalizeRoomCode(raw).slice(0, 6),
      valid: isValidRoomCode,
    });
    if (!v || !this.alive) return;
    await this.enterWatch(v);
  }

  private async enterWatch(code: string): Promise<void> {
    await this.guard(async () => {
      const info = await watchRoom(code);
      if (!this.alive) return;
      this.watching = info;
      this.unsubRoom?.();
      // 방 행이 바뀔 때마다 공개 정보를 다시 읽는다 (프로필·매치 상태 포함)
      this.unsubRoom = subscribeRoom(info.room.id, () => void this.refreshWatch());
      this.onWatch(info);
    });
  }

  private async refreshWatch(): Promise<void> {
    const cur = this.watching;
    if (!cur || !this.alive) return;
    const info = await watchInfo(cur.room.code).catch(() => null);
    if (!this.alive || this.watching?.room.id !== cur.room.id) return;
    if (!info || info.room.status === 'closed') {
      this.leaveLocal();
      this.showToast('방이 닫혔어요');
      await this.refreshMenu();
      return;
    }
    this.onWatch(info);
  }

  private onWatch(info: WatchInfo): void {
    this.watching = info;
    this.drawWatch();
    if (info.room.status === 'live' && info.match && info.guest && !this.starting && this.me) {
      this.starting = true;
      const init: SpectateSceneInit = { info, me: this.me.id };
      this.time.delayedCall(600, () => { if (this.alive) this.scene.start(SCENE.Spectate, init); });
    }
  }

  private async enterRoom(open: () => Promise<Room>): Promise<void> {
    await this.guard(async () => {
      const room = await open();
      if (!this.alive) return;
      this.room = room;
      this.unsubRoom?.();
      this.unsubRoom = subscribeRoom(room.id, (r) => void this.onRoom(r));
      await this.onRoom(room);
    });
  }

  private async onRoom(r: Room): Promise<void> {
    if (!this.alive || !this.room || r.id !== this.room.id) return;
    const me = this.me!;
    if (r.status === 'closed' || (r.host !== me.id && r.guest !== me.id)) {
      const kicked = r.status !== 'closed';
      this.leaveLocal();
      this.showToast(kicked ? '방에서 나왔어요' : '방이 닫혔어요');
      await this.refreshMenu();
      return;
    }
    this.room = r;
    const [, , seen] = await Promise.all([this.loadName(r.host), r.guest ? this.loadName(r.guest) : null, countSpectators(r.id).catch(() => 0)]);
    this.spectators = seen;
    if (!this.alive || this.room?.id !== r.id) return;
    this.drawRoom();
    if (r.status === 'live' && r.match_id && !this.starting) void this.startMatch(r, r.match_id);
  }

  private async changeRule(patch: Partial<RoomRules>): Promise<void> {
    const room = this.room;
    if (!room) return;
    await this.guard(async () => { await this.onRoom(await setRoomRules(room.code, { ...normalizeRules(room.rules), ...patch })); });
  }

  private async ready(on: boolean): Promise<void> {
    const room = this.room;
    if (!room) return;
    await this.guard(async () => { await this.onRoom(await setReady(room.code, on)); });
  }

  private async inviteToNewRoom(f: Friend): Promise<void> {
    await this.enterRoom(() => createRoom(DEFAULT_RULES));
    const room = this.room;
    if (!room) return;
    await this.guard(async () => { await inviteFriend(f.id, room.code); this.showToast(`${f.name}님에게 초대를 보냈어요`); });
  }

  private async answer(inv: Invite, accept: boolean): Promise<void> {
    this.invite = null;
    await this.guard(async () => { await answerInvite(inv.id, accept); });
    if (accept) await this.enterRoom(() => joinRoom(inv.room_code));
    if (!this.room && this.alive) this.drawMenu();
  }

  private async copy(text: string, done: string): Promise<void> {
    try { await navigator.clipboard.writeText(text); this.showToast(done); } catch { this.showToast(`코드: ${text}`); }
  }

  private async share(code: string): Promise<void> {
    const url = inviteLink(code, readOnlineEnv()?.inviteBase ?? location.origin);
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: '포커디펜스 친구 대전', text: `포커디펜스 한 판 해요! 방 코드 ${code}`, url }); return; } catch { /* 취소 → 복사로 */ }
    }
    await this.copy(url, '초대 링크를 복사했어요');
  }

  /** 방이 live가 됨: 매치 정보 → 실시간 채널 연결 → 3초 카운트다운 → 대전 */
  private async startMatch(room: Room, matchId: string): Promise<void> {
    this.starting = true;
    const me = this.me!;
    // 이 매치를 하다가 끊겼던 것이면 이어서
    const saved = loadMatch();
    if (saved && saved.matchId === matchId) {
      const r = await prepareResume(saved);
      if (!this.alive) { if (r.ok) r.init.live?.transport.close(); return; }
      if (r.ok) { this.scene.start(SCENE.Game, r.init); return; }
      clearMatch();
    }
    try {
      const info = await getMatch(matchId, me.id);
      if (!info.handKey) throw new Error('hand_key_missing');
      const rules = normalizeRules({ ...info.rules, waves: info.waveCount });
      const mode = friendDuel(rules, info.seed);
      const transport = new SupabaseTransport(info.id, me.id);
      await transport.connect();
      if (!this.alive) { transport.close(); return; }
      const opponent = new LiveOpponent({ name: info.opponent.name, rating: null, avatar: info.opponent.avatar }, transport, buildGameData(loadModeSources(), mode, null));
      const live: LiveContext = { matchId: info.id, roomCode: room.code, me: me.id, opponentId: info.opponent.id, transport };
      const init: GameSceneInit = { mode, opponentSource: opponent, playerId: me.id, handKey: info.handKey, live };
      this.countdown(() => this.scene.start(SCENE.Game, init));
    } catch (e) {
      this.starting = false;
      if (this.alive) this.showToast(errorText(e));
    }
  }

  private countdown(go: () => void): void {
    const cx = GAME_WIDTH / 2;
    const dim = this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLOR.dim, 0.72).setDepth(70).setInteractive();
    const num = this.add.text(cx, GAME_HEIGHT / 2, `${COUNTDOWN_SEC}`, { fontSize: '320px', color: hex(COLOR.textGold), fontFamily: FONT.display, ...OUTLINE, strokeThickness: 16 }).setOrigin(0.5).setDepth(71);
    let left = COUNTDOWN_SEC;
    const pop = () => { num.setScale(1.4); this.tweens.add({ targets: num, scale: 1, duration: 260, ease: 'Back.easeOut' }); };
    pop();
    this.time.addEvent({ delay: 1000, repeat: COUNTDOWN_SEC - 1, callback: () => {
      left--;
      if (left <= 0) { dim.destroy(); go(); return; }
      num.setText(`${left}`);
      pop();
    } });
  }

  private leaveLocal(): void {
    this.unsubRoom?.();
    this.unsubRoom = null;
    this.room = null;
    this.watching = null;
  }

  private async exit(): Promise<void> {
    if (this.starting) return;
    const seen = this.watching;
    if (seen) {
      this.leaveLocal();
      await unwatchRoom(seen.room.code).catch(() => undefined);
      if (!this.alive) return;
      await this.refreshMenu().catch(() => this.drawMenu());
      return;
    }
    const room = this.room;
    if (room) {
      this.leaveLocal();
      await leaveRoom(room.code).catch(() => undefined);
      if (!this.alive) return;
      this.showToast('방에서 나왔어요');
      await this.refreshMenu().catch(() => this.drawMenu());
      return;
    }
    this.scene.start(SCENE.Lobby);
  }

  private cleanup(): void {
    this.alive = false;
    closeTextPrompt();
    this.unsubRoom?.();
    this.unsubInvites?.();
    this.unsubRoom = null;
    this.unsubInvites = null;
  }

  private showToast(msg: string): void {
    this.toast.setText(msg).setAlpha(1);
    this.tweens.killTweensOf(this.toast);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 1800, duration: 300 });
  }
}
