/** 기기 설정 (localStorage `poker-defense.settings.v1`): 효과음·볼륨·감속 모드 */
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from './systems/SoundGate.ts';

const KEY = 'poker-defense.settings.v1';
let cache: Settings | null = null;
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  if (cache) return cache;
  try { cache = normalizeSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { cache = { ...DEFAULT_SETTINGS }; }
  return cache;
}

export function updateSettings(patch: Partial<Omit<Settings, 'version'>>): Settings {
  cache = normalizeSettings({ ...getSettings(), ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* 저장 공간 없음 — 이번 실행에만 적용 */ }
  listeners.forEach((f) => f(cache!));
  return cache;
}

export function onSettings(f: (s: Settings) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** 감속 모드 또는 OS의 reduced-motion */
export function reducedMotion(): boolean {
  const os = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return os || getSettings().reduceMotion;
}
