/** 효과음 규칙·설정 (Phase 4) */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, SoundGate, normalizeSettings } from '../src/systems/SoundGate.ts';

describe('SoundGate', () => {
  const gate = () => new SoundGate({ hit: { minGap: 0.05, group: 'hits' }, kill: { minGap: 0.08, group: 'hits' }, tap: { minGap: 0 } }, { hits: 3 });

  it('꺼져 있으면 아무것도 내지 않는다', () => {
    expect(gate().allow('tap', 0, false)).toBe(false);
  });

  it('같은 소리는 최소 간격 안에 다시 내지 않는다', () => {
    const g = gate();
    expect(g.allow('hit', 0, true)).toBe(true);
    expect(g.allow('hit', 0.02, true)).toBe(false);
    expect(g.allow('hit', 0.06, true)).toBe(true);
  });

  it('묶음은 1초에 정해진 횟수까지, 1초가 지나면 다시', () => {
    const g = gate();
    expect([0, 0.1, 0.2, 0.3, 0.4].map((t) => g.allow(t < 0.25 ? 'hit' : 'kill', t, true))).toEqual([true, true, true, false, false]);
    expect(g.allow('hit', 1.05, true)).toBe(true);
  });

  it('규칙이 없는 소리도 같은 프레임에 겹쳐 내지 않는다', () => {
    const g = gate();
    expect(g.allow('other', 1, true)).toBe(true);
    expect(g.allow('other', 1.01, true)).toBe(false);
  });
});

describe('설정 정리', () => {
  it('없거나 깨진 값은 기본값', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ sound: 'yes', volume: 'loud' })).toEqual(DEFAULT_SETTINGS);
  });
  it('볼륨은 0~1로 자른다', () => {
    expect(normalizeSettings({ volume: 3 }).volume).toBe(1);
    expect(normalizeSettings({ volume: -1 }).volume).toBe(0);
    expect(normalizeSettings({ sound: false, reduceMotion: true, showFps: true })).toMatchObject({ sound: false, reduceMotion: true, showFps: true });
    expect(normalizeSettings({ version: 1, sound: true, volume: 0.7, reduceMotion: false }).showFps).toBe(false); // 이전 저장
  });
});
