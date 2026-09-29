// verify-match — 매치 입력 로그 검증 (docs/mode-design.md §2.2). Deno Edge Function.
// 호출: 매치 참가자가 결과 보고·로그 제출 뒤에 invoke('verify-match', { body: { matchId } }).
// _shared/verify.js 는 src/net/verify.ts 를 번들한 것 (npm run build:fn) — 서버와 클라이언트가 같은 검사 코드를 쓴다.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyLog } from '../_shared/verify.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const auth = req.headers.get('Authorization') ?? '';
    // 호출자 확인 (참가자만)
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await asUser.auth.getUser();
    if (!u.user) return json({ error: 'not_authenticated' }, 401);

    const { matchId } = await req.json();
    if (typeof matchId !== 'string') return json({ error: 'matchId_required' }, 400);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: m, error: me } = await admin.from('matches').select('*').eq('id', matchId).single();
    if (me || !m) return json({ error: 'match_not_found' }, 404);
    if (m.p1 !== u.user.id && m.p2 !== u.user.id) return json({ error: 'not_in_match' }, 403);
    if (m.status !== 'done') return json({ error: 'match_not_done' }, 409);

    const { data: logs } = await admin.from('match_logs').select('*').eq('match_id', matchId);
    const wallSec = (new Date(m.ended_at).getTime() - new Date(m.started_at).getTime()) / 1000;
    const results: Record<string, { ok: boolean; issues: string[] }> = {};
    for (const l of logs ?? []) {
      const report = l.player_id === m.p1 ? m.p1_report : m.p2_report;
      const r = verifyLog(l.rounds, { waveCount: m.wave_count, rules: m.rules, report, wallSec });
      results[l.player_id] = r;
      await admin.from('match_logs')
        .update({ verified: r.ok, verify_note: r.ok ? null : r.issues.slice(0, 10).join(',') })
        .eq('match_id', matchId).eq('player_id', l.player_id);
      // 검증 실패한 로그는 고스트로 쓰지 않는다
      if (!r.ok) await admin.from('ghosts').delete().eq('match_id', matchId).eq('player_id', l.player_id);
    }
    return json({ matchId, results });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
