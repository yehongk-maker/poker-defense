-- 도중에 끊긴 랭크 매치 정리.
-- 앱을 닫거나 새로고침하면 매치가 'live'로 남는데, poll_match는 "이미 잡힌 매치"를 먼저 돌려주므로 다음 매칭이 그 판에 묶인다.
-- 새로 매칭을 시작한다는 것은 그 판을 버렸다는 뜻이므로 enqueue에서 정리한다:
--   대체 상대 매치(p2 없음)는 바로 무효, 사람 상대 매치는 최대 시간(웨이브당 90초)이 지났을 때만 무효.
-- 무효 매치는 레이팅에 반영되지 않는다. 이탈 패널티(패배 처리)는 E단계에서 다룬다.
create or replace function public.enqueue()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_uid(); p public.profiles;
begin
  p := public.ensure_profile();
  update public.matches
     set status = 'void', reason = 'abandoned', ended_at = now()
   where mode = 'ranked' and status = 'live' and (p1 = me or p2 = me)
     and (p2 is null or started_at < now() - make_interval(secs => wave_count * 90));
  insert into public.queue (player_id, rating, enqueued_at, fallback_at)
  values (me, p.rating, now(), now() + make_interval(secs => 15 + random() * 25)) -- 15~40초 랜덤
  on conflict (player_id) do update
    set rating = excluded.rating, enqueued_at = excluded.enqueued_at, fallback_at = excluded.fallback_at;
  return public.poll_match();
end $$;
