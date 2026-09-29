/** 방 코드·초대 링크 (순수). 코드는 혼동 문자(I·O·0·1)를 뺀 32자 집합의 6자리 — 서버 gen_room_code 와 같은 집합 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

/** 사용자가 친 코드 정리: 공백·하이픈 제거, 대문자. 흔한 오타(0→O 등)는 고치지 않는다 — 없는 글자이므로 그대로 거절 */
export function normalizeRoomCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export function isValidRoomCode(code: string): boolean {
  return CODE_RE.test(code);
}

export function generateRoomCode(rng: () => number = Math.random): string {
  let c = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_CODE_ALPHABET[Math.min(31, Math.floor(rng() * 32))];
  return c;
}

/** 초대 링크: 코드만 담는다 (개인정보 없음) */
export function inviteLink(code: string, base: string): string {
  return `${base.replace(/\/+$/, '')}/j/${code}`;
}

/** 링크·딥링크·클립보드 글에서 방 코드 찾기. 없으면 null */
export function parseInvite(text: string): string | null {
  const t = text.trim();
  const m = /(?:\/j\/|join\/|[?&]code=)([A-Za-z0-9]{6})(?![A-Za-z0-9])/.exec(t);
  const cand = normalizeRoomCode(m ? m[1] : t);
  return isValidRoomCode(cand) ? cand : null;
}
