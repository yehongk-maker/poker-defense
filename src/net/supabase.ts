/** Supabase 클라이언트 싱글턴 + 익명 로그인. Phaser 의존 금지 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readOnlineEnv } from './env.ts';
import type { Profile } from './types.ts';

let client: SupabaseClient | null = null;

export function getClient(): SupabaseClient {
  if (client) return client;
  const env = readOnlineEnv();
  if (!env) throw new Error('online_not_configured'); // .env.local 에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
  client = createClient(env.url, env.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'poker-defense.auth' },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return client;
}

/** 테스트용 주입 */
export function setClient(c: SupabaseClient | null): void {
  client = c;
}

/**
 * 로그인(없으면 익명 계정 생성) + 프로필 보장. 기기 변경 이어받기는 소셜 로그인 연동 때 (런칭 후).
 * @returns 내 프로필
 */
export async function signIn(nick?: string): Promise<Profile> {
  const c = getClient();
  const { data: s } = await c.auth.getSession();
  if (!s.session) {
    const { error } = await c.auth.signInAnonymously();
    if (error) throw new Error(`sign_in_failed: ${error.message}`);
  }
  const { data, error } = await c.rpc('ensure_profile', { p_nick: nick ?? null, p_avatar: null });
  if (error) throw new Error(`profile_failed: ${error.message}`);
  return data as Profile;
}

export async function myId(): Promise<string | null> {
  const { data } = await getClient().auth.getUser();
  return data.user?.id ?? null;
}
