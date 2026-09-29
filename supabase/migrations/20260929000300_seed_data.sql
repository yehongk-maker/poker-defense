-- 기본 데이터: 대체 상대 닉네임 풀 + 첫 시즌 (4주)
insert into public.bot_names (name) values
  ('하트왕'), ('심연의궁수'), ('골드러시'), ('스페이드잭'), ('클로버킹'), ('풀하우스장인'), ('플러시헌터'),
  ('레이즈마스터'), ('조커없는덱'), ('철벽수비'), ('황금상단주'), ('성소기사'), ('강철군단장'), ('마족술사'),
  ('올인각'), ('폴드는없다'), ('타짜지망생'), ('디펜스고수'), ('빙고한줄'), ('대공포대장'), ('번개손'),
  ('새벽네시'), ('퇴근길한판'), ('점심내기'), ('치킨은내꺼'), ('라면먹고갈래'), ('월급루팡'), ('야근요정'),
  ('민트초코'), ('감자튀김'), ('고양이집사'), ('댕댕이아빠'), ('주말전사'), ('카드깎는노인'), ('원페어인생'),
  ('스트레이트가자'), ('로열꿈나무'), ('에이스포커'), ('킹받네'), ('퀸의한수')
on conflict do nothing;

insert into public.seasons (name, starts_at, ends_at, rewards)
select '시즌 1', date_trunc('day', now()), date_trunc('day', now()) + interval '28 days',
       '[{"minPoints":100,"diamonds":50},{"minPoints":300,"diamonds":150},{"minPoints":600,"diamonds":300}]'::jsonb
where not exists (select 1 from public.seasons);
