/**
 * MatchTransport — 매치 중 실시간 이벤트 통로 (docs/mode-design.md §2.3 릴레이 모델).
 * 자기 보드는 자기 클라이언트가 권위, 상대에게는 "공개 정보"만 보낸다 (손패·아웃·게이지는 보내지 않는다).
 * 구현: SupabaseTransport(Realtime broadcast 채널 match:<id>), LoopbackTransport(테스트·로컬).
 */
import type { SuitCode } from './types.ts';

/** 상대에게 공개되는 이벤트 */
export type MatchEvent =
  | { t: 'enter'; wave: number; ante?: number }                    // 라운드 카드 선택 진입 + 낸 앤티 (판돈 없는 방은 ante 없음)
  | { t: 'exchange'; wave: number; count: number }                 // 교환 장수만 (무엇으로 바꿨는지는 비공개)
  | { t: 'confirm'; wave: number; handRank: number }               // 족보 등급 공개
  | { t: 'field'; units: { slot: number; suit: SuitCode; tier: number }[]; hero: { slot: number; suit: SuitCode; id: string; grade: string } | null; life: number; gold: number }
  | { t: 'bet'; wave: number; action: 'check' | 'raise' | 'call' | 'fold'; amount?: number }
  | { t: 'combat'; wave: number }                                  // 전투 시작
  | { t: 'snapshot'; wave: number; sec: number; enemies: [number, number, number][] } // [적 종류 인덱스, 트랙 위치(0~1000), hp%]
  | { t: 'skill'; wave: number; sec: number; id: string }
  | { t: 'report'; wave: number; lifeLost: number; clearSec: number; handRank: number; cleared: boolean }
  | { t: 'finish'; reached: number; life: number; gold: number; clearedSec: number | null }
  | { t: 'rematch'; ready: boolean }
  | { t: 'leave' };                                                // 방을 나감 (판 중이면 기권)

export type MatchEventType = MatchEvent['t'];
export type Unsubscribe = () => void;

export interface MatchTransport {
  /** 채널 연결이 끝나면 resolve */
  connect(): Promise<void>;
  send(event: MatchEvent): void;
  on(handler: (event: MatchEvent) => void): Unsubscribe;
  /** 상대 접속 상태 (끊김 30초 유예 판단용) */
  onPresence(handler: (opponentOnline: boolean) => void): Unsubscribe;
  close(): void;
}

/** 같은 프로세스 안의 두 끝을 잇는 통로 (테스트·로컬 2인 시뮬). delayMs로 지연을 흉내 낼 수 있다 */
export class LoopbackTransport implements MatchTransport {
  private peer: LoopbackTransport | null = null;
  private handlers = new Set<(e: MatchEvent) => void>();
  private presence = new Set<(on: boolean) => void>();
  private open = false;

  static pair(delayMs = 0): [LoopbackTransport, LoopbackTransport] {
    const a = new LoopbackTransport(delayMs), b = new LoopbackTransport(delayMs);
    a.peer = b; b.peer = a;
    return [a, b];
  }

  private constructor(private delayMs: number) {}

  async connect(): Promise<void> {
    this.open = true;
    this.peer?.presence.forEach((h) => h(true));
    if (this.peer?.open) this.presence.forEach((h) => h(true));
  }

  send(event: MatchEvent): void {
    if (!this.open) throw new Error('transport_closed');
    const peer = this.peer;
    if (!peer || !peer.open) return; // 상대가 끊겨 있으면 버린다 (릴레이와 같은 동작)
    const copy = JSON.parse(JSON.stringify(event)) as MatchEvent; // 직렬화 가능한 값만
    const deliver = () => peer.handlers.forEach((h) => h(copy));
    if (this.delayMs > 0) setTimeout(deliver, this.delayMs); else deliver();
  }

  on(handler: (e: MatchEvent) => void): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onPresence(handler: (on: boolean) => void): Unsubscribe {
    this.presence.add(handler);
    return () => this.presence.delete(handler);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.peer?.presence.forEach((h) => h(false));
  }
}
