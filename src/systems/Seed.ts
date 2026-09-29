/**
 * 시드 난수와 시드 스트림 (docs/mode-design.md §2.2). 순수.
 * 온라인 대전은 서버가 준 매치 시드 하나에서 "손패용"·"전투용" 난수를 라운드마다 따로 뽑는다.
 *  - 전투 스트림: 매치 시드 + 라운드 → 양쪽이 같은 값 (보스 조각 종류 등)
 *  - 손패 스트림: 매치 시드 + 플레이어 키 + 라운드 → 각자 다른 손패. "동일 손패" 규칙이면 키를 공유한다
 * 라운드마다 새로 시드를 잡으므로, 앞 라운드에서 교환을 몇 번 했는지가 다음 라운드 손패에 영향을 주지 않는다.
 */

/** 문자열 → 32비트 정수 (FNV-1a + 마무리 섞기) */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32 — 정수 연산만 쓰므로 기기·런타임이 달라도 같은 수열 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rngFromText = (text: string): (() => number) => seededRng(hashSeed(text));

/** 라운드별 난수 공급자. GameLoop이 라운드 시작·전투 시작 때 새 난수를 받아 쓴다 */
export interface RngStreams {
  hand(wave: number): () => number;
  combat(wave: number): () => number;
}

export interface StreamOptions {
  /** 손패 스트림을 가르는 키 (플레이어 id). sharedHand면 무시 */
  player: string;
  /** 친구 대전 "동일 손패": 두 사람이 같은 5장·같은 덱 순서 */
  sharedHand?: boolean;
}

export function seedStreams(matchSeed: string, opt: StreamOptions): RngStreams {
  const handKey = opt.sharedHand ? 'shared' : `p:${opt.player}`;
  return {
    hand: (wave) => rngFromText(`${matchSeed}|hand|${handKey}|${wave}`),
    combat: (wave) => rngFromText(`${matchSeed}|combat|${wave}`),
  };
}

/** 시드 없는 판(캠페인·로컬)에서 쓸 무작위 매치 시드 */
export function randomSeed(rng: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += Math.floor(rng() * 0x10000).toString(16).padStart(4, '0');
  return s;
}
