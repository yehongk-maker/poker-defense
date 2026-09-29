/** 온라인 계층의 순수 부분: 레이팅·방 코드·규칙·로그 검사·통로(loopback) */
import { describe, it, expect } from 'vitest';
import { RATING, applyResult, eloDelta, expectedScore, kFactor, matchSpan } from '../src/systems/Rating.ts';
import { ROOM_CODE_ALPHABET, generateRoomCode, inviteLink, isValidRoomCode, normalizeRoomCode, parseInvite } from '../src/net/roomCode.ts';
import { DEFAULT_RULES, describeRules, isCustom, normalizeRules } from '../src/net/rules.ts';
import { verifyLog, type VerifyContext } from '../src/net/verify.ts';
import { LoopbackTransport, type MatchEvent } from '../src/net/MatchTransport.ts';
import type { RoundInput } from '../src/net/types.ts';

function rng(seed: number) { let s = seed; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; }; }

describe('Rating (서버 elo_delta 와 같은 식)', () => {
  it('같은 레이팅이면 기대 승률 50%, 승리 +K/2', () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
    expect(eloDelta(1000, 1000, 1, 32)).toBe(16);
    expect(eloDelta(1000, 1000, 0, 32)).toBe(-16);
    expect(eloDelta(1000, 1000, 0.5, 32)).toBe(0);
  });

  it('강한 상대를 이기면 많이 오르고, 약한 상대에게 지면 많이 떨어진다', () => {
    expect(eloDelta(1000, 1400, 1, 32)).toBeGreaterThan(eloDelta(1000, 1000, 1, 32));
    expect(eloDelta(1400, 1000, 0, 32)).toBeLessThan(eloDelta(1000, 1000, 0, 32));
  });

  it('배치 10판은 K 64, 대체 상대 판은 절반', () => {
    expect(kFactor(3, false)).toBe(64);
    expect(kFactor(0, false)).toBe(32);
    expect(kFactor(3, true)).toBe(32);
    expect(kFactor(0, true)).toBe(16);
  });

  it('applyResult: 레이팅 바닥 100, 시즌 포인트 +20/−8/+5에 바닥 0', () => {
    const win = applyResult({ rating: 1000, seasonPoints: 0, placementLeft: 0 }, 1000, 'win');
    expect(win).toEqual({ rating: 1016, delta: 16, seasonPoints: 20 });
    const loss = applyResult({ rating: 105, seasonPoints: 3, placementLeft: 0 }, 105, 'loss');
    expect(loss.rating).toBe(RATING.floor);
    expect(loss.seasonPoints).toBe(0);
    expect(applyResult({ rating: 1000, seasonPoints: 10, placementLeft: 0 }, 1000, 'draw').seasonPoints).toBe(15);
  });

  it('매칭 범위: ±100에서 10초마다 +50, 최대 ±400', () => {
    expect([0, 9, 10, 25, 60, 300].map(matchSpan)).toEqual([100, 100, 150, 200, 400, 400]);
  });
});

describe('방 코드·초대 링크', () => {
  it('혼동 문자 없는 32자 집합의 6자리', () => {
    expect(ROOM_CODE_ALPHABET.length).toBe(32);
    expect(/[IO01]/.test(ROOM_CODE_ALPHABET)).toBe(false);
    const r = rng(7);
    for (let i = 0; i < 500; i++) expect(isValidRoomCode(generateRoomCode(r))).toBe(true);
  });

  it('입력 정리: 소문자·공백·하이픈 허용, 없는 글자는 거절', () => {
    expect(normalizeRoomCode(' k7q-2m4 ')).toBe('K7Q2M4');
    expect(isValidRoomCode('K7Q2M4')).toBe(true);
    expect(isValidRoomCode('K7Q2M0')).toBe(false); // 0
    expect(isValidRoomCode('K7Q2M')).toBe(false);
  });

  it('초대 링크 생성·해석 (링크·딥링크·코드만)', () => {
    expect(inviteLink('K7Q2M4', 'https://pokerdefense.app/')).toBe('https://pokerdefense.app/j/K7Q2M4');
    expect(parseInvite('https://pokerdefense.app/j/K7Q2M4')).toBe('K7Q2M4');
    expect(parseInvite('pokerdefense://join/k7q2m4')).toBe('K7Q2M4');
    expect(parseInvite('https://x.app/?code=K7Q2M4&x=1')).toBe('K7Q2M4');
    expect(parseInvite('같이 하자! https://pokerdefense.app/j/K7Q2M4 들어와')).toBe('K7Q2M4');
    expect(parseInvite('k7q 2m4')).toBe('K7Q2M4');
    expect(parseInvite('안녕하세요')).toBeNull();
  });
});

describe('방 규칙', () => {
  it('허용값 밖이면 기본값 (서버 normalize_rules 와 같은 결과)', () => {
    expect(normalizeRules({ waves: 40, betting: false, speed: 9, tickets: 7, sharedHand: true }))
      .toEqual({ waves: 40, betting: false, allHeroes: true, sharedHand: true, speed: 1, applyMeta: false, tickets: 3 });
    expect(normalizeRules(null)).toEqual(DEFAULT_RULES);
    expect(normalizeRules({ betting: 'yes' as unknown as boolean })).toEqual(DEFAULT_RULES);
  });

  it('기본과 다르면 커스텀, 요약 문구', () => {
    expect(isCustom(DEFAULT_RULES)).toBe(false);
    expect(isCustom({ ...DEFAULT_RULES, betting: false })).toBe(true);
    expect(describeRules({ ...DEFAULT_RULES, betting: false, tickets: 0 })).toBe('20웨이브 · 판돈 없음 · 교환권 금지');
  });
});

describe('입력 로그 개연성 검사', () => {
  const round = (wave: number, over: Partial<RoundInput> = {}): RoundInput => ({
    wave, exchanges: [0, 3], ticketExchanges: 0, confirmedAt: 6,
    manage: { moves: [], sells: [], merges: [], upgrades: [] },
    combatSec: 22, skills: [], bet: [{ action: 'check', at: 5 }],
    result: { lifeLost: 0, clearSec: 22, handRank: 1, cleared: true }, ...over,
  });
  const ctx = (n: number, over: Partial<VerifyContext> = {}): VerifyContext => ({
    waveCount: 20, rules: DEFAULT_RULES, wallSec: n * 35,
    report: { reached: n + 1, life: 10, gold: 100, clearedSec: null }, ...over,
  });
  const log = (n: number) => Array.from({ length: n }, (_, i) => round(i + 1));

  it('정상 로그는 통과', () => {
    expect(verifyLog(log(8), ctx(8))).toEqual({ ok: true, issues: [] });
  });

  it('교환권 매치 상한(3) 초과를 잡는다', () => {
    const l = log(4).map((r) => ({ ...r, exchanges: [0, 0], ticketExchanges: 1 }));
    expect(verifyLog(l, ctx(4)).issues).toContain('ticket_cap');
    expect(verifyLog(l, ctx(4, { rules: { ...DEFAULT_RULES, tickets: -1 } })).ok).toBe(true);
  });

  it('배속 위반: 전투 시간 합이 벽시계보다 길 수 없다', () => {
    expect(verifyLog(log(10), ctx(10, { wallSec: 60 })).issues).toContain('speed_violation');
    expect(verifyLog(log(10), ctx(10, { wallSec: 130, rules: { ...DEFAULT_RULES, speed: 2 } })).ok).toBe(true);
  });

  it('스킬 쿨타임(45초, 전투 시간 누적)·영웅 없는 스킬·타이머 초과·탈락 후 진행을 잡는다', () => {
    const hero = log(3);
    hero[0] = round(1, { manage: { moves: [], sells: [], merges: [], upgrades: [], hero: 'golden_sniper' }, skills: [5] });
    hero[1] = round(2, { skills: [10] }); // 누적 22+10 = 32초 → 직전 5초에서 27초 뒤 = 쿨타임 위반
    expect(verifyLog(hero, ctx(3)).issues).toContain('r2:skill_cooldown');
    hero[1] = round(2, { skills: [] });
    hero[2] = round(3, { skills: [8] });  // 누적 44+8 = 52 → 47초 뒤 = 통과
    expect(verifyLog(hero, ctx(3)).ok).toBe(true);

    expect(verifyLog([round(1, { skills: [3] })], ctx(1)).issues).toContain('r1:skill_without_hero');
    expect(verifyLog([round(1, { confirmedAt: 45 })], ctx(1)).issues).toContain('r1:confirm_time');
    const dead = log(3);
    dead[1] = round(2, { result: { lifeLost: 10, clearSec: 22, handRank: 0, cleared: false } });
    expect(verifyLog(dead, ctx(3)).issues).toContain('r2:continued_after_defeat');
  });

  it('성적과 로그가 안 맞으면 잡는다 (도달 라운드, 클리어 안 했는데 클리어 시간)', () => {
    expect(verifyLog(log(5), ctx(5, { report: { reached: 9, life: 10, gold: 0, clearedSec: null } })).issues).toContain('reached_mismatch');
    expect(verifyLog(log(5), ctx(5, { report: { reached: 6, life: 10, gold: 0, clearedSec: 100 } })).issues).toContain('cleared_without_clear');
    expect(verifyLog([], ctx(0)).issues).toEqual(['rounds_empty']);
  });

  it('판돈을 끈 방에서 베팅 기록이 있으면 잡는다', () => {
    expect(verifyLog(log(2), ctx(2, { rules: { ...DEFAULT_RULES, betting: false } })).issues).toContain('r1:bet_disabled');
  });
});

describe('LoopbackTransport (릴레이와 같은 동작)', () => {
  it('보낸 이벤트는 상대에게만 가고, 값은 복사된다', async () => {
    const [a, b] = LoopbackTransport.pair();
    const gotA: MatchEvent[] = [], gotB: MatchEvent[] = [];
    a.on((e) => gotA.push(e)); b.on((e) => gotB.push(e));
    await a.connect(); await b.connect();
    const ev: MatchEvent = { t: 'bet', wave: 3, action: 'raise', amount: 15 };
    a.send(ev);
    expect(gotB).toEqual([ev]);
    expect(gotB[0]).not.toBe(ev);
    expect(gotA).toEqual([]);
    b.send({ t: 'exchange', wave: 3, count: 2 });
    expect(gotA).toEqual([{ t: 'exchange', wave: 3, count: 2 }]);
  });

  it('접속 상태를 알리고, 끊긴 상대에게 보낸 것은 버려진다', async () => {
    const [a, b] = LoopbackTransport.pair();
    const seen: boolean[] = [];
    a.onPresence((on) => seen.push(on));
    await a.connect();
    await b.connect();
    expect(seen).toEqual([true]);
    const got: MatchEvent[] = [];
    b.on((e) => got.push(e));
    b.close();
    expect(seen).toEqual([true, false]);
    a.send({ t: 'enter', wave: 1 });
    expect(got).toEqual([]);
    expect(() => b.send({ t: 'enter', wave: 1 })).toThrow(/transport_closed/);
  });
});
