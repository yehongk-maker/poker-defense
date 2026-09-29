/** 온라인 설정 (Vite 환경 변수). 값이 없으면 온라인 기능을 끈다 — 싱글 캠페인은 서버 없이 동작 */
interface OnlineEnv { url: string; anonKey: string; inviteBase: string }

export function readOnlineEnv(): OnlineEnv | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey || url.includes('YOUR-PROJECT-REF')) return null;
  const inviteBase = env.VITE_INVITE_BASE?.trim() || (typeof location !== 'undefined' ? location.origin : url);
  return { url, anonKey, inviteBase };
}

export const isOnlineConfigured = (): boolean => readOnlineEnv() !== null;
