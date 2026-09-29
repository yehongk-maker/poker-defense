/** 캠페인 이어하기 저장 (localStorage). 카드 페이즈 시작 때 저장하고 판이 끝나면 지운다 */
import type { RunSnapshot } from './systems/GameLoop.ts';

const KEY = 'poker-defense.run.v1';

export function saveRun(snap: RunSnapshot): void {
  try { localStorage.setItem(KEY, JSON.stringify(snap)); } catch { /* 저장 공간 없음 등 — 이어하기만 포기 */ }
}

export function loadRun(): RunSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as RunSnapshot;
    return s && s.version === 1 && Number.isInteger(s.wave) ? s : null;
  } catch {
    return null;
  }
}

export function clearRun(): void {
  try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
}
