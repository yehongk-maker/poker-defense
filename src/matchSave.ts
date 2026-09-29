/** 대전 이어하기 저장 (localStorage). 대전 중 1초마다·화면을 떠날 때 저장하고, 판이 끝나면 지운다 */
import { isSavedMatch, type SavedMatch } from './systems/MatchResume.ts';

const KEY = 'poker-defense.match.v1';

export function saveMatch(s: SavedMatch): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 저장 공간 없음 등 — 이어하기만 포기 */ }
}

export function loadMatch(): SavedMatch | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s: unknown = JSON.parse(raw);
    return isSavedMatch(s) ? s : null;
  } catch {
    return null;
  }
}

export function clearMatch(): void {
  try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
}
