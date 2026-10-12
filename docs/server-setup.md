# 서버 (Supabase) — 구성과 배포

작성일: 2026-09-29 | 근거: docs/mode-design.md §2 | 상태: **원격 프로젝트 생성·배포·실서버 스모크 테스트 완료** (프로젝트 `poker-defense`, ref `tshhszmudzsjwsqyyayo`, 서울 리전, 조직 yehongk@naver.com's Org)

## 1. 무엇이 어디에 있나

| 위치 | 내용 |
|---|---|
| `supabase/migrations/20260929000100_schema.sql` | 테이블 12개 + RLS(조회만 허용) + Realtime 대상(rooms·matches·invites) |
| `supabase/migrations/20260929000200_functions.sql` | 서버 로직 전부 (SECURITY DEFINER RPC). 쓰기는 RPC로만 |
| `supabase/migrations/20260929000300_seed_data.sql` | 대체 상대 닉네임 풀 40개, 시즌 1 |
| `supabase/functions/verify-match/` | 입력 로그 검증 Edge Function (Deno). `_shared/verify.js`는 `npm run build:fn`이 만든다 |
| `supabase/config.toml` | 로컬/프로젝트 설정. 익명 로그인 켬 |
| `src/net/` | 클라이언트 계층 (Phaser 의존 없음): `supabase.ts`(클라이언트·익명 로그인), `api.ts`(RPC 래퍼·구독·`SupabaseTransport`), `MatchTransport.ts`(이벤트 타입·`LoopbackTransport`), `roomCode.ts`, `rules.ts`, `verify.ts`, `types.ts`, `env.ts` |
| `src/systems/Rating.ts` | ELO-lite (서버와 같은 식, 결과 화면 예상치용) |
| `tests/SupabaseSchema.test.ts` | 마이그레이션을 내장 Postgres(pglite)에 적용해 방·매칭·판정·레이팅·RLS를 검증 (20개) |
| `tests/Net.test.ts` | 레이팅·방 코드·규칙·로그 검사·통로 (18개) |

## 2. 데이터 모델

```
profiles      닉·아바타·레이팅(1000)·시즌 포인트·전적·배치 잔여(10)·캠페인 최고 기록
rooms         친구 대전 방: 코드 6자리, 방장/손님, 규칙(json), 준비 플래그, 상태(waiting|live|done|closed), 현재 매치
matches       mode(ranked|friend), 시드, 웨이브 수, 규칙, p1/p2(대체 상대는 p2=null + 표시용 이름·레이팅), 양쪽 보고, 승자·사유, 레이팅 증감
match_internal 상대 종류(human|ghost|bot) — 클라이언트 접근 불가
match_logs    입력 로그(RoundInput[]) + 검증 결과
ghosts        랭크 매치 로그 중 고스트 후보 — 클라이언트 접근 불가
queue         랭크 매칭 큐 + fallback_at(15~40초 랜덤)
friends / head_to_head / invites   친구·상대 전적(최근 5판)·초대
seasons / bot_names
```

## 3. RPC 목록 (클라이언트 → `src/net/api.ts`)

| 영역 | 함수 | 동작 |
|---|---|---|
| 프로필 | `ensure_profile(nick, avatar)` `update_profile` `report_campaign(wave)` | 익명 로그인 후 프로필 보장 |
| 방 | `create_room(rules)` `join_room(code)` `set_room_rules` `set_ready(code, ready)` `leave_room` `kick_guest` | 양쪽 준비 → 새 시드로 매치 생성. 끝난 방에서 다시 준비 = 재대결 |
| 랭크 | `enqueue()` `poll_match()` `cancel_queue()` `get_opponent_script(match)` | 사람(±100 → 10초마다 +50, 최대 ±400) → fallback_at 이후 고스트 → 봇. 응답에 상대 종류는 없다 |
| 결과 | `report_result(match, report, opponent?)` `claim_timeout(match)` `submit_log(match, rounds)` | 양쪽 보고가 모이면 확정. 대체 상대 판은 상대 성적을 같이 보고 |
| 친구 | `add_friend(other)` `remove_friend` `list_friends()` `invite_friend(friend, code)` `answer_invite` | 같이 한 상대만 친구 추가 |

판정 순서(`decide_winner`): 먼저 클리어 → 도달 라운드 → 하트 → 골드 → 무승부. 레이팅: K 32(배치 10판 64, 대체 상대 절반), 시즌 포인트 +20/−8/+5.

## 4. 실시간

- **행 변경 구독**(postgres_changes): `rooms`(입장·준비·매치 시작), `matches`(확정), `invites`(초대 도착). RLS로 내 행만 온다.
- **매치 중 이벤트**: Realtime broadcast 채널 `match:<id>` — DB를 거치지 않는 릴레이. 이벤트 타입은 `MatchEvent`(공개 정보만: 교환 장수·족보 등급·필드·베팅·스냅샷·성적). 손패·아웃·게이지는 보내지 않는다.
- presence로 상대 접속 여부를 본다(끊김 30초 유예).

## 5. 프로젝트 만들고 올리기

**2026-09-29 완료.** 아래는 다시 만들거나 다른 환경(스테이징)을 세울 때의 절차다. 기존 프로젝트("샐러리 MVP" 등)에 연결하지 말 것 — `cat supabase/.temp/project-ref`로 연결 대상을 먼저 확인한다.

- 대시보드: https://supabase.com/dashboard/project/tshhszmudzsjwsqyyayo
- `.env.local`(커밋 안 됨)에 `SUPABASE_DB_PASSWORD`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`가 들어 있다. DB 비밀번호는 이 파일에만 있으니 비밀번호 관리자에 옮겨 둘 것.
- 실서버 점검: `npm run smoke:online` (익명 계정 2개로 방·실시간·판정·랭크·검증 함수 19항목). 끝에 테스트 계정을 지우려면 `SMOKE_SERVICE_KEY`를 환경 변수로 넘긴다.
- **주의 — `supabase config push`는 비대화형에서 확인 없이 바로 적용된다.** config.toml의 `[auth]`는 원격의 현재 값에 맞춰 두었고(익명 로그인만 켬), 인증 설정을 바꿀 때는 config.toml을 고친 뒤 push 한다.

```bash
# 1) 프로젝트 생성 (대시보드에서 만들어도 된다). 리전은 서울 권장
supabase projects create poker-defense --region ap-northeast-2
```

```bash
# 2) 저장소와 연결 (ref는 1)의 출력)
supabase link --project-ref <PROJECT_REF>
```

```bash
# 3) 스키마·RPC·기본 데이터 적용
npm run db:push
```

```bash
# 4) 검증 함수 배포
npm run fn:deploy
```

5) 대시보드 설정: Authentication → Sign In / Providers → **Allow anonymous sign-ins 켜기**. (config.toml은 로컬 스택용이라 원격은 대시보드에서 켠다.)

6) `.env.example`을 `.env.local`로 복사하고 Project URL과 anon key를 넣는다. service_role key는 클라이언트·저장소에 넣지 않는다.

## 6. 검증 상태

| 항목 | 상태 |
|---|---|
| 스키마·RPC·RLS | pglite에 마이그레이션 3개를 그대로 적용해 테스트 20개 통과 |
| 순수 계층(레이팅·코드·규칙·로그 검사·loopback 통로) | 테스트 18개 통과 |
| 원격 배포 | 마이그레이션 3개 적용, `verify-match` 배포(`--use-api`, Docker 불필요), 익명 로그인 켬 |
| 실서버 스모크 (`npm run smoke:online`) | 19항목 통과: 익명 로그인, RLS, 방 생성·참가·준비, 행 변경 실시간 수신, broadcast·presence, 판정, 친구·전적, 랭크 매칭·레이팅, 내부 표 차단, 로그 제출, 검증 함수 |
| `src/net/api.ts`의 래퍼·`SupabaseTransport` 클래스 자체 | 같은 RPC·채널을 스모크가 직접 호출해 확인. 래퍼는 브라우저(Vite env)에서 화면을 붙일 때 확인 |

알아둘 점: postgres_changes 구독은 `SUBSCRIBED` 뒤 1~2초 지나야 이벤트가 오기 시작한다. `subscribeRoom`은 구독 완료 시와 2초 뒤에 현재 행을 다시 읽어 놓친 변경을 메운다.

## 7. 다음 단계 (docs/mode-design.md §5)

1. **A. 모드 분리**: `GameMode`, `OpponentSource`, 솔로 레이아웃.
2. **B. 결정론 로그** ✅: `Seed`·`InputLog`(기록 + `replayMatch`) + `verifyMatch`(개연성 + 재생). verify-match 함수는 `npm run fn:deploy`로 다시 올려야 재생 검사가 서버에 반영된다.
3. **C. 친구 대전 화면** ✅: `FriendScene` + `src/net/Live.ts`(LivePublisher·LiveOpponent) + 네트워크 판돈. 스키마 변경 없음(매치 정보는 `matches`·`profiles` 조회로 조립). 로컬에서 두 계정으로 시험하려면 `localhost:5180`과 `127.0.0.1:5180`을 각각 연다(출처가 달라 로그인이 따로 저장된다).
4. **D. 고스트전** ✅: 매칭 대기 화면(`MatchScene`) + `findMatch()`, 대체 상대(봇 두뇌·고스트 대본) 연결. 마이그레이션 `…000400_ghost_verified.sql`(고스트는 verify-match가 검증 통과 후 등록, 대본에 player 키), `…000500_abandoned_matches.sql`(enqueue 시 끊긴 매치 무효). 
5. **E. 랭크 실시간** ✅: `…000600_forfeit_heartbeat.sql`(heartbeat·forfeit_match·claim_absent, enqueue 시 하던 랭크 매치 기권패), 봇 강도 프리셋, verify-match 판돈 교차 검증.
6. **F. 시즌·랭킹** ✅: `…000700_season_ranking.sql`(season_results, leaderboard, my_season, claim_season_reward, ensure_season). cron 없이 지연 넘김. 시즌을 강제로 넘겨 시험하려면 대시보드 SQL에서 `update seasons set ends_at = now() - interval '1 hour'` 후 랭킹 탭을 연다.
7. **관전** ✅: `…000800_spectators.sql`(room_spectators, watch_room·watch_info·unwatch_room, 구경꾼용 rooms 조회 정책). 로컬에서 세 번째 계정은 `http://[::1]:5180`.
8. **손패 키 비밀** (원격 미반영): `…000900_hand_secrets.sql` — match_secrets(플레이어별 비밀 손패 키, RLS 내 행만, Realtime 발행 제외), 매치 생성 트리거, match_public에 handKey, get_opponent_script에 고스트 주인 키, 옛 매치는 'p:'+id로 채워 재검증 호환. 프로젝트가 일시 중지돼 있으면 대시보드에서 Restore 후 `npm run db:push`·`npm run fn:deploy`.
