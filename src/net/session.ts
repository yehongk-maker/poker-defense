/** 온라인 세션: 로그인(익명)한 내 프로필을 한 번만 받아 돌려쓴다. Phaser 의존 금지 */
import { isOnlineConfigured } from './env.ts';
import { signIn } from './supabase.ts';
import { updateProfile } from './api.ts';
import type { Profile } from './types.ts';

let me: Profile | null = null;
let pending: Promise<Profile> | null = null;

export const onlineAvailable = (): boolean => isOnlineConfigured();

/** 로그인 + 프로필. 실패하면 다음 호출에서 다시 시도한다 */
export function getSession(): Promise<Profile> {
  if (me) return Promise.resolve(me);
  if (!pending) {
    pending = signIn().then((p) => { me = p; return p; }).finally(() => { pending = null; });
  }
  return pending;
}

export const currentProfile = (): Profile | null => me;

export async function rename(nick: string): Promise<Profile> {
  me = await updateProfile(nick);
  return me;
}

/** 서버 예외 코드 → 사용자에게 보일 문장 */
export function errorText(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  const table: [RegExp, string][] = [
    [/online_not_configured/, '온라인 설정이 없어요 (.env.local)'],
    [/room_not_found/, '방을 찾을 수 없어요. 코드를 확인해 주세요'],
    [/room_full/, '이미 두 명이 들어간 방이에요'],
    [/room_in_progress/, '이미 대전이 진행 중인 방이에요'],
    [/waiting_for_guest/, '친구가 들어오면 준비할 수 있어요'],
    [/host_only/, '방장만 바꿀 수 있어요'],
    [/not_in_room/, '이 방의 참가자가 아니에요'],
    [/nick/i, '닉네임은 2~12자로 정해 주세요'],
    [/never_played/, '같이 한 판을 한 상대만 친구로 추가할 수 있어요'],
    [/not_friends/, '친구 목록에 있는 상대만 초대할 수 있어요'],
    [/invite_not_found/, '초대가 만료됐어요'],
    [/not_authenticated/, '로그인이 필요해요'],
    [/spectators_full/, '구경꾼이 가득 찼어요 (최대 8명)'],
    [/in_room/, '이 방의 참가자는 구경할 수 없어요'],
    [/not_watching/, '구경 중인 방이 아니에요'],
    [/reward_not_found/, '이미 받았거나 받을 보상이 없어요'],
    [/sign_in_failed|profile_failed/, '로그인에 실패했어요. 잠시 후 다시 시도해 주세요'],
    [/Failed to fetch|NetworkError|network/i, '네트워크 연결을 확인해 주세요'],
  ];
  for (const [re, text] of table) if (re.test(m)) return text;
  return '문제가 생겼어요. 잠시 후 다시 시도해 주세요';
}
