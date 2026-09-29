# 서버 (Supabase) — 구성과 배포

작성일: 2026-09-29 | 근거: docs/mode-design.md §2 | 상태: 스키마·RPC·클라이언트 계층 완료, 원격 프로젝트 미생성

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

Supabase CLI는 로그인돼 있다. **포커디펜스용 프로젝트는 아직 없다** — 기존 프로젝트("샐러리 MVP" 등)에 연결하지 말 것.

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
| `SupabaseTransport`·`api.ts` | 타입 체크만. 실제 프로젝트 연결 후 두 기기로 확인 필요 |
| Edge Function `verify-match` | 작성·번들만. Docker/Deno가 없어 로컬 실행 못 함 → 배포 후 확인 필요 |
| Realtime publication·익명 로그인 | 원격 프로젝트에서 확인 필요 |

pglite는 Supabase의 auth 스키마·역할을 흉내 낸 것이라, 원격 첫 `db push` 때 권한 관련 차이가 나올 수 있다(특히 함수 실행 권한 revoke/grant).

## 7. 다음 단계 (docs/mode-design.md §5)

1. **A. 모드 분리**: `GameMode`, `OpponentSource`, 솔로 레이아웃.
2. **B. 결정론 로그**: `InputLog`(RoundInput 기록) + `replayMatch` → `verify.ts`에 재생 검사 추가.
3. **C. 친구 대전 화면**: `FriendScene`(방 만들기/코드 참가/방 화면) + `LiveOpponent`(MatchEvent → OpponentView).
4. 매칭 대기 화면(09) + `findMatch()` 연결, 대체 상대(봇 두뇌·고스트 재생) 연결.
