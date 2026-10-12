/** 튜토리얼 완료 기록 (localStorage `poker-defense.tutorial.v1`) */
import type { TutorialTrack } from './systems/Tutorial.ts';

const KEY = 'poker-defense.tutorial.v1';
type Done = Partial<Record<TutorialTrack, boolean>>;

function read(): Done {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return v && typeof v === 'object' ? v as Done : {}; } catch { return {}; }
}

export function tutorialDone(track: TutorialTrack): boolean {
  return read()[track] === true;
}

export function markTutorialDone(track: TutorialTrack): void {
  try { localStorage.setItem(KEY, JSON.stringify({ ...read(), [track]: true })); } catch { /* 저장 실패 — 다음에 다시 보일 뿐 */ }
}

/** 설정의 "튜토리얼 다시 보기" */
export function resetTutorials(): void {
  try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
}
