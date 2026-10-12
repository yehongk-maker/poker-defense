/**
 * SoundGate — 효과음을 낼지 말지 정하는 규칙 (순수). 실제 소리는 src/audio/sfx.ts.
 *  - 같은 소리는 최소 간격 안에 다시 내지 않는다 (타격음이 프레임마다 쌓여 소음이 되지 않게)
 *  - 타격류(group)는 1초에 몇 번까지만
 *  - 꺼져 있으면 아무것도 내지 않는다
 */
export interface SoundRule {
  /** 같은 소리 최소 간격(초) */
  minGap: number;
  /** 묶음 이름 — 묶음 전체가 1초에 perSecond번까지 */
  group?: string;
}

export class SoundGate {
  private last = new Map<string, number>();
  private groupHits = new Map<string, number[]>();

  constructor(private rules: Record<string, SoundRule>, private perSecond: Record<string, number>) {}

  /** now(초)에 key를 내도 되는가. 된다면 기록까지 한다 */
  allow(key: string, now: number, enabled: boolean): boolean {
    if (!enabled) return false;
    const rule = this.rules[key] ?? { minGap: 0.03 };
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < rule.minGap) return false;
    if (rule.group) {
      const cap = this.perSecond[rule.group] ?? Infinity;
      const hits = (this.groupHits.get(rule.group) ?? []).filter((t) => now - t < 1);
      if (hits.length >= cap) { this.groupHits.set(rule.group, hits); return false; }
      hits.push(now);
      this.groupHits.set(rule.group, hits);
    }
    this.last.set(key, now);
    return true;
  }
}

export interface Settings {
  version: 1;
  /** 효과음 켜짐 */
  sound: boolean;
  /** 0~1 */
  volume: number;
  /** 감속 모드 (DESIGN §6): 흔들림·회전·펄스·잔상 연출을 줄인다. OS의 reduced-motion도 같이 본다 */
  reduceMotion: boolean;
}

export const DEFAULT_SETTINGS: Settings = { version: 1, sound: true, volume: 0.7, reduceMotion: false };

/** 저장된 값 정리 (모르는 값·범위 밖은 기본값으로) */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw ?? {}) as Partial<Record<keyof Settings, unknown>>;
  const vol = typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.min(1, Math.max(0, r.volume)) : DEFAULT_SETTINGS.volume;
  return {
    version: 1,
    sound: typeof r.sound === 'boolean' ? r.sound : DEFAULT_SETTINGS.sound,
    volume: vol,
    reduceMotion: typeof r.reduceMotion === 'boolean' ? r.reduceMotion : DEFAULT_SETTINGS.reduceMotion,
  };
}
