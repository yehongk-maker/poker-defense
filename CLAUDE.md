# 포커디펜스 (Poker Defense) — 프로젝트 헌법

기획서: `GDD.md` (v1.8). 이 문서와 충돌하면 GDD가 우선하되, 코드 규칙은 이 문서를 따른다.
UI 디자인 시스템: `DESIGN.md` — 모든 UI는 이 문서의 토큰(`src/ui/theme.ts`의 COLOR/FONT/SIZE)과 컴포넌트 규칙을 따른다. 임의 색·크기·폰트 금지.

## 스택
- Phaser 3 + TypeScript + Vite. 모바일 세로 1080×1920, Scale FIT (`src/config.ts`).
- 테스트: vitest (`npm test`). 타입체크: `npm run typecheck`.
- 모바일 패키징(Capacitor), 광고/결제는 Phase 5 이후.

## 폴더 구조
```
src/
  main.ts        Phaser.Game 생성
  config.ts      해상도·씬 키 상수
  scenes/        Boot(초대 링크 /j/코드 → Friend), Lobby(캠페인 시작·이어하기, 레이즈 듀얼 선택 시트), Game(GameMode로 분기, 실시간 매치는 init.live),
                 Meta, Rank(랭킹 탭: 시즌 카드·보상 수령·리더보드), Match(랭크 매칭 대기 → 상대 소개 → 대전; 서버가 없으면 이 기기의 상대로), Friend(친구 대전: 방 만들기·코드 참가·친구 목록/초대·방 규칙·준비·카운트다운)  ← Phaser 의존 OK
  meta.ts        메타 진행 싱글턴 getMeta() (MetaProgress + localStorage)
  ads.ts         광고 서비스 싱글턴 getAds() (지금은 StubAdService)
  runSave.ts     캠페인 이어하기 저장 (localStorage `poker-defense.run.v1`)
  matchSave.ts   대전 이어하기 저장 (localStorage `poker-defense.match.v1`) — 형식·복원은 systems/MatchResume, 준비는 scenes/resumeMatch
  systems/       PokerEvaluator, CardPhase(+행운 드로우 outsFor), DrawAssist(아웃 판정·가중 추첨, 순수), SummonMapper, SynergySystem, Battle, GameLoop, Geometry(트랙/슬롯 좌표·사거리),
                 MetaProgress(젬·영구 업그레이드·영웅 해금·마일스톤, SaveStore DI), storage(localStorage 어댑터),
                 bots(봇 전략 공용), Duel(OpponentAI 실시간/fastForward + resolveDuel 승패),
                 Betting(1:1 판돈 걸기: 앤티/체크·레이즈/콜·폴드/판정/이월 + AI 성향, GameLoop이 BetWallet),
                 GameMode(모드 프리셋 CAMPAIGN/rankedDuel/friendDuel + buildGameData), Opponent(OpponentSource·OpponentView·AIOpponent),
                 Ads(AdService·StubAdService), Rating(ELO-lite),
                 Ranking(티어·시즌 보상 진행도·남은 기간, 수치는 data/ranking.json),
                 Seed(시드 난수·라운드별 스트림 seedStreams), InputLog(InputRecorder 입력 기록 + replayMatch 결정론 재생)
                 ← 순수 로직. Phaser import 금지
  entities/      Unit, Enemy, Projectile 표시 객체 (Phaser)
  ui/            HUD, CardHand, TrackView, ManagePanel, UpgradePanel(스와이프 화면), SwipeController, HandFx(족보 연출),
                 SynergyCodex(도감, embedded 가능) + synergyText(JSON→한글 설명, 순수), SwipeNav(3방향: left=상점 UpgradePanel,
                 right=InfoPanel 족보·시너지, bottom=OpponentPanel 상대 현황), SynergyChips(화면 왼쪽 활성 시너지 칩),
                 BetBar(팟 알약 + 베팅 3버튼 폴드/체크·콜/레이즈), Button(UIButton: variant gold/green/purple/red/gray/blue,
                 3D 섀도·눌림·비활성, 라벨 '\n' 뒤는 서브 라벨), ResourcePill·TokenBar(재화 알약), TimerRing, SpeechBubble,
                 WaveBanner, ResultOverlay(승리 광선·리본·별 / 패배), Backdrop(월드 그라디언트·하단 시트·가장자리 핸들),
                 OpponentMiniMap(필드 우상단 상대 필드·적 축소 표시, 0.5초 갱신, 탭 → 상대 패널),
                 draw(도형 아이콘: 동전·하트·젬·영웅 토큰·교환권·별), theme(DESIGN 토큰 + 구 COLORS 호환) (Phaser)
  net/           온라인 계층 (Phaser import 금지): supabase(클라이언트·익명 로그인), api(RPC 래퍼·구독·SupabaseTransport),
                 MatchTransport(MatchEvent·LoopbackTransport), roomCode, rules, verify(입력 로그 개연성 검사),
                 verifyMatch(개연성 + 재생, 순수) · verifyServer(Edge Function 번들 입구, JSON 데이터 포함), types, env,
                 Live(LivePublisher 내 공개 정보 송신 · LiveOpponent 수신 → OpponentSource · LiveContext), session(로그인 프로필 캐시·오류 문장)
  data/          units, hands, waves, duel-waves, synergies, heroes, config, duel(판돈 룰·AI 성향·매치 규칙) .json
supabase/        migrations(스키마·RPC·기본 데이터), functions/verify-match(Edge Function), config.toml — docs/server-setup.md
tests/           vitest. systems/와 1:1 대응
scripts/         generate-waves.mjs, simulate(sim-core), hero-shard-report(npm run shards), draw-assist-report(npm run draw)
design/          리포트 산출물 (hero-shard-report.md, draw-assist-report.md)
```

## 디자인 규칙 (DESIGN.md 요약)
- 배경: 로비·메타 = 블루 하늘(solo), 게임 = 퍼플 월드(duel, 1:1 레이스가 기본 룰). `addBackdrop(scene, mode)`.
- 폰트: Jua(`FONT.display`, 타이틀·버튼·숫자) + Noto Sans KR(`FONT.body`). index.html에서 Google Fonts 로드, BootScene이 최대 2.5초 대기 후 대체 폰트로 진행. 텍스트 기본 = 흰색 + `OUTLINE`(navy 4px).
- 버튼 색은 역할로만: gold=진행·핵심 CTA, purple=베팅·다이아 가격, blue=일반(체크·콜·배속·탭), gray=보조·닫기, red=위험(판매·초기화), green=광고 보상(▶ AD 필수, 1:1 대결에서는 금지).
- 매 프레임 호출되는 UI 갱신은 값이 바뀔 때만 다시 그린다 (Button.setLabel/setEnabled/setVariant는 같은 값이면 무시).
- 이모지는 임시 아이콘: HUD·알약·결과 화면은 도형 아이콘으로 교체 완료, 토스트·일부 라벨 문자열에 남은 💰💎 등은 스프라이트 도입 때 교체.

## 모드 규칙 (docs/mode-design.md)
- 씬 시작은 `scene.start(SCENE.Game, { mode, opponent?, opponentSource?, resume? })`. 데이터는 항상 `buildGameData(loadModeSources(), mode, meta.effects)`로 만든다 — 씬에서 웨이브·등급·교환권 상한을 직접 고르지 않는다.
- 캠페인(CAMPAIGN): 40웨이브, 상대·판돈 없음, 메타 적용, 광고 3자리(교환 +1·부활·보상 2배), 카드 페이즈 시작마다 자동 저장. 대전(rankedDuel/friendDuel): 20웨이브 곡선, 판돈, 메타 미적용·영웅 전부·배속 고정·교환권 3회(친구 대전은 방장 규칙).
- 상대는 `OpponentSource`로만 다룬다. UI·판돈·레이스 판정은 `view`/`wallet`/`participant`만 보고, 봇인지 사람인지는 화면에 드러내지 않는다(identity의 닉·레이팅·아바타만).
- 광고 보상은 캠페인에서만, 버튼에 `▶ AD` 표기 필수. 대전 화면에는 광고·부활 UI를 넣지 않는다.

## 결정론 규칙 (docs/mode-design.md §2.2)
- 대전 모드의 GameLoop은 `seedStreams(매치 시드, { player, sharedHand })`로 만든다. 손패 난수는 라운드마다 (시드, 플레이어 키, 라운드)로, 전투 난수는 (시드, 라운드)로 새로 잡는다. `src/systems`에 `Math.random` 직접 호출 금지(기본 인자 제외).
- 대전 전투는 고정 step(`duel.json match.simStep` = 0.1초 → `config.simStep`). `tickCombat(dt)`가 dt를 모아 step 단위로만 진행하고, 렌더는 `combatAlpha`로 보간(TrackView.updateEnemies). 시뮬레이터·서버·클라이언트가 같은 값이어야 한다.
- 플레이어 상태를 바꾸는 GameLoop 공개 메서드를 새로 만들면 `emit(op)`로 입력을 알리고 `InputLog`의 `RoundOp`·`apply`·기록기 요약에 추가한다. 전투 중 입력은 step 번호(`combatSteps`)로 기록. 판돈으로 오간 골드·하트는 g/l 외부 입력으로 남는다.
- `tests/InputLog.test.ts`의 "100판 재생 100% 일치"가 결정론 회귀 테스트다. 로직을 고쳐 이 테스트가 깨지면 난수 호출 순서나 가변 dt가 새로 생긴 것이다.

## 실시간 대전 규칙 (src/net/Live.ts)
- 각 기기는 자기 보드만 시뮬하고 공개 정보(MatchEvent)만 보낸다. 손패·아웃·행운 게이지는 보내지 않는다.
- 판돈은 양쪽 기기가 각자 `BettingSystem(…, { remote: 'opponent' })`로 계산한다. 같은 판정이 나오게 하는 규칙: 상대 앤티·레이즈 금액은 이벤트에 실린 값 그대로, 상대 지갑은 건드리지 않음(거울), 동시 레이즈는 늦게 온 쪽을 콜로, 내 레이즈에 대한 상대 응답은 상대 기기가 정해 보낼 때까지 대기, 라운드는 번호 순 판정, 동률 판돈은 N+1로 이월. `tests/Live.test.ts`가 지연·엇갈림에서 양쪽 판정 일치를 고정한다.
- Realtime broadcast는 지난 이벤트를 다시 주지 않는다: LivePublisher는 판정용 이벤트(enter·confirm·bet·report·finish)를 기록해 상대 접속 시 재전송, LiveOpponent는 중복을 무시하고 판돈 연결 전 이벤트는 보관했다 반영한다. 새 이벤트를 추가하면 받는 쪽을 멱등으로 만든다.
- 고스트(대체 매칭의 기록 상대): `AIOpponent`에 `script`(seed·player·rounds)를 주면 그 판의 시드 스트림으로 판을 만들고 대본대로 친다. 대본의 옛 판돈 증감(g/l)은 쓰지 않고, 못 하게 된 입력은 건너뛰며, 대본이 끝나면 봇 두뇌가 이어 받는다. 화면·OpponentView는 봇·사람과 같다. 고스트는 verify-match가 재생 검사를 통과시킨 랭크 로그(5라운드 이상)만 등록한다.
- 대체 매칭 매치(`init.online`)는 끝날 때 양쪽 성적을 함께 보고(`report_result`의 p_opponent) → 로그 제출 → 검증 요청.
- 랭크 이탈 = 기권패: 매치 중 10초마다 `heartbeat`, 도중에 나가면(씬 종료·다시 매칭) `forfeit_match`/`enqueue`가 바로 확정(상대 승리). 상대가 30초 안 보이면 `claim_absent` — 서버가 마지막 heartbeat(25초)로 확인한 뒤에만 기권 처리. 남은 쪽은 매치 행이 done이 되면 결과 화면(상대 기권).
- 봇 강도: `duel.json ai.presets`(easy/normal/hard, 상대 레이팅 구간) → `pickPreset` → `AIOpponent({ preset })`. 수치는 JSON만 고친다.
- 판돈 검증: `net/verifyBets`가 로그의 g/l 증감을 넉넉한 경계(낸 것 하한·받은 것 상한)로 검사, 사람 상대면 상대 로그의 라운드 성적으로 상한을 좁힌다. 판돈 선택 기록에는 걸린 라운드(`bet.wave`)를 남긴다.
- 승패는 서버 판정(report_result → finalize_match)을 표시한다. 친구 대전의 상대 이탈(leave 또는 30초 끊김)은 결과 없이 중단. 재대결은 방으로 돌아가 다시 준비(서버가 새 시드 발급).
- 글자 입력(닉네임·방 코드)은 `ui/TextPrompt.askText`(DOM 입력칸) — 한글 조합·붙여넣기 때문. 색·폰트는 DESIGN 토큰.

## 대전 이어하기·기권 규칙
- 대전 중 1초마다·화면을 떠날 때 `saveMatch`(내 입력 로그 + 판돈 상태 + 이 기기 상대의 라운드 시작 스냅샷). 판이 끝나거나 앱 안에서 대전을 떠나면 지운다.
- 내 판 복원은 `resumeLoop` = 시드 + 입력 로그 재생(검증과 같은 코드). 저장 파일에 골드·유닛을 직접 담지 않는다 — 고친 저장은 재생에서 걸러진다. 카드 선택에 쓴 시간은 복원 후에도 그대로.
- 로비는 저장된 대전이 있으면 [이어하기]/[기권]을 먼저 묻는다(닫을 수 없음). 서버 매치는 `getMatch`로 아직 live인지 확인하고, 끝났으면 저장을 버린다. 랭크 사람 상대는 30초 넘게 비우면 상대의 부재 확인으로 기권패가 된다.
- 사람 상대 복원: 판돈은 `BettingSystem.restore`, 보낸 이벤트 기록은 `LivePublisher.restore`로 다시 만들고, 상대 쪽 이벤트는 상대 기기가 접속을 보고 다시 보낸다(받는 쪽 멱등).
- 기권: 상대 패널(위로 스와이프) 아래 [기권] → 확인 창. 랭크는 `forfeit_match`(패배·레이팅 반영), 친구 대전은 진 성적을 보고(상대 전적에 기록), 서버 없는 판은 바로 패배. 사람 상대에게는 `surrender` 이벤트가 가서 바로 승리 화면.

## 시즌·랭킹 규칙
- 시즌 4주, 시즌 포인트 승 +20 / 패 -8 / 무 +5(바닥 0)는 서버 finalize_match가 계산. 시즌이 끝나면 포인트 0, 레이팅은 1000 쪽으로 절반(`Ranking.softReset` = 서버 ensure_season과 같은 식).
- 티어 구간은 `src/data/ranking.json`(화면 표시용), 보상 구간·다이아는 서버 `seasons.rewards`가 기준. 리더보드에는 랭크 대전을 한 판 이상 한 사람만 나온다.

## 서버 규칙 (Supabase, docs/server-setup.md)
- 클라이언트는 테이블에 직접 쓰지 않는다. 쓰기는 전부 SECURITY DEFINER RPC, RLS는 "내 행 조회"만.
- 상대가 사람/고스트/봇인지는 `match_internal`에만 있고 어떤 RPC 응답에도 넣지 않는다.
- 스키마를 바꾸면 새 마이그레이션 파일을 추가하고 `tests/SupabaseSchema.test.ts`(pglite)를 같이 고친다. 서버 식(레이팅·규칙 정규화)은 `src/systems/Rating.ts`·`src/net/rules.ts`와 같아야 한다.
- 원격 프로젝트: `poker-defense` (ref `tshhszmudzsjwsqyyayo`, 서울). 배포는 `npm run db:push` / `npm run fn:deploy`, 점검은 `npm run smoke:online`. 연결 대상은 `supabase/.temp/project-ref`로 확인 — 기존 Supabase 프로젝트(샐러리 등)에 연결하지 않는다.
- `supabase config push`는 비대화형에서 확인 없이 적용된다. `[auth]`는 원격 값과 맞춰 둔 상태(익명 로그인만 켬).
- service_role key는 저장소·클라이언트 금지. `.env*`는 커밋하지 않는다(`.env.example`만).

## 절대 규칙
1. **게임 로직은 `src/systems/`에 순수 함수/클래스로.** Phaser·DOM 의존 금지. 난수는 `rng` 주입(테스트 재현성).
2. **밸런스 수치는 반드시 `src/data/*.json`에.** 코드에 숫자 하드코딩 금지. 밸런싱 요청은 JSON만 수정한다.
3. **로직 변경에는 테스트를 같이 쓴다.** `tests/`에 vitest. 기존 테스트가 깨지면 GDD와 대조해 어느 쪽이 맞는지 확인 후 수정.
4. **씬은 얇게.** 씬은 `GameLoop` 메서드를 버튼에, `tick*`을 `update()`에 연결하고 결과를 그리기만 한다.
5. **1세션 = 1기능.** 기능 완료마다 커밋.
6. **IP 주의.** 스타크래프트·CoC의 유닛명/종족명/외형 사용 금지. 이름·디자인은 전부 오리지널.
7. **가챠 금지.** 유료 상품은 확정 지급만 (GDD §9).

## 토큰 용어 (GDD 3.8) — UI 문자열은 이 이름만 쓴다
- 골드 💰 (`gold`): 라운드 내 유닛 업그레이드. 판마다 리셋.
- 영웅 조각 ● (`shards`, 구 영웅 토큰·조커 조각): 종류 4개 — 스트레이트/플러시/풀하우스(각 족보에서) + 와일드(포카드·스플). 영웅마다 `shardType`이 있고 그 종류 + 와일드 3개로 소환. 상단 알약은 "가장 가까운 영웅의 진행도/3". UI 문자열은 "스트레이트 조각"처럼 종류명 + 조각.
- 다이아 💎 (`gems`, 구 젬): 캐시+마일스톤 무료 획득, 메타 업그레이드·메타 영웅 해금. localStorage.
- 하트 ♥ (`life`, 구 라이프): 시간 초과 이탈 적당 -1, 0이면 탈락.
- 코드 식별자(shards/gems/life)는 그대로 두고 표시 문자열만 통일한다.

## 데이터 스키마 요약
- `units.json`: 수트(S/H/D/C)×티어(1~5)×변형(cards: low/high) 40종. `targets`(ground/air/both)로 지상/공중 공격 가능 여부. `baseDps×dpsFactor×attackInterval` = 1회 데미지. `effect.type`으로 특수 효과(bonus_vs_air 포함).
- `hands.json`: 족보 → `summonTiers[]`, `shards`(ShardBag {straight|flush|fullHouse|wild: n}), `heroSummon`.
- 영웅 조각(GDD 3.3): `GameLoop.shards`(Record<ShardKey, number>), `heroProgress`(영웅별 typed/wild/need/ready), `canSummon(id)`, `summonHero`는 해당 종류 → 와일드 순으로 차감, 로열은 `hasFreeHeroSummon`. 보스 웨이브 클리어 시 `config.hero.bossShards`(랜덤 종류 amount개, 마지막 웨이브 제외) → `CombatTickEvents.bossShard`. 봇은 `bots.readyHero`(조각 맞고 빈 슬롯 있을 때만).
- 행운 드로우(GDD 3.1.1): `config.drawAssist.outWeight`(솔로·대전 공통, 판매 금지) → `CardPhase` 생성 시 전달. 교환(교환권 포함) 시 `DrawAssist.pickIndex`로 아웃 가중 추첨(outWeight 0이면 덱 맨 위). `outsFor(i)`로 카드 우상단 "아웃 N" 표시. 시드 재현성 유지.
- 행운 게이지(GDD 3.1.1 피티): `drawAssist.pity {mult: number|{rank,flush,straight}, maxLevel}`. `CardPhase`가 교환 시 `targetsOf(outSpec(kept))`로 노린 루트를 `attempted`에 기록, `confirm()`에서 `kindAchieved`로 성공이면 레벨 0, 실패면 +1(상한). 종류별 보너스 = outWeight × mult^level (`outWeights`, `pityMultiplier(kind)`, `pityLevels`), 라운드를 넘어 유지·판마다 새 CardPhase. CardHand는 `ExchangeStatus.pity`로 타이머 링 위에 표시. 루트별 배율은 세 영웅 루트 소환 시점을 맞추는 손잡이(`npm run shards`).
- `waves.json`: 40웨이브, 적 13종(`enemyTypes`: name, movement ground/air, boss 플래그). 공중은 6웨이브부터, 보스 지상/공중 교대. `npm run waves`(scripts/generate-waves.mjs)로 생성. 공식은 파일의 `formula` 필드(hp = 20×1.17^wave, 마릿수 4+0.5w). 웨이브별 `timeLimit`(30s, 보스 45s). `config`: gridSize(5), lifePerLeak/bossLifePerLeak(1/3), rangeDamageMult(사거리 2/3/4/5/6 → ×1.35/1.0/0.75/0.65/0.55).
- 지상/공중(GDD 3.2): `Battle.canAttack` — 유닛 targets와 적 movement가 맞아야 공격(스플래시·체인 포함). SummonMapper는 `unitFor(suit, tier, band)`, 변형은 `bandOfRank`(9 이상 high).
- 전투 룰(GDD 3.5~3.6): 적은 제한 시간 동안 트랙을 돌고, 시간 종료 시 남은 적당 라이프 차감. 유닛은 슬롯에서 사거리(셀) 안의 적만 공격 → 배치가 핵심. `DeployedUnit.slot` 필수, 자동 배치는 `GameLoop.autoSlot`(커버리지 최대 빈 칸). 이동은 `moveUnit` — `placed=false`(소환 직후)인 유닛만 빈 칸으로 1회, 이후/전투 시작 후 고정, 판매만 가능.
- 밸런스 검증: `npm run sim [-- --mode duel]` (scripts/simulate.ts, 봇 3종 헤드리스; duel은 duel-waves.json 20웨이브). `npm run waves -- --total 20 --bossEvery 5 ...`로 대전 곡선 생성. `tests/Balance.test.ts`가 GDD 3.5 목표를 회귀 테스트로 고정.
- `synergies.json`: 4축 — suits(수트 기수 2/4/6) · classes(종류 2/4) · races(종족 기수+영웅 3/5/7 등) · formation(사거리/조건 자동 판정) + caps(합산 상한). 상위 구간이 하위를 대체. 설계 근거 docs/synergy-design.md.
- `units.json`/`heroes.json`의 `race`(human/goblin/monster/spirit)는 종족 축 태그. 영웅(`ApplyOptions.hero`)은 수트·클래스 축만 제외, 나머지(종족·진형·빙고·global·오라·상한·업그레이드)에 포함. caps 공격 120/공속 70.
- `heroes.json`: 영웅 12종(수트별 기본/메타/대공), `shardType`(straight 5·flush 4·fullHouse 3, 종류마다 basic 최소 1). `combat.targets`(ground/air/both)로 지상/공중 구분 — 근접 영웅은 ground. 대공 패시브 air_attack_pct(global|suit)/air_slow_pct/air_kill_gold_mult, 대공 액티브 flak_barrage/light_of_falling/bombard_support/void_gale(Battle 스킬 API의 movement 필터). `active.id`별 구현은 GameLoop.useHeroSkill의 switch, 수치는 `active.params`.
- `config.json`: 라이프/골드/슬롯/업그레이드/영웅 등급/BM + `meta`(영구 업그레이드 3종·영웅 해금 비용·`exchangeTicket`(카드 교환권: cost/initial/max)·젬 보상·저장 키).
- 카드 교환권(GDD 3.4): `MetaProgress.tickets/buyTicket/useTicket`(저장 필드 `tickets`, 구 저장은 initial로 채움) + `CardPhase.exchangeWithTicket(i)`(기본 횟수 무시, `ticketsUsed`). 씬은 `canExchange`가 false이고 교환권이 있으면 `useTicket` 후 `exchangeWithTicket`. CardHand는 `ExchangeStatus`(left/used/total/tickets/ticketsUsed)로 카운터·배지·힌트 표시.
- `duel.json` (GDD 3.9): `match`(대전 20웨이브: wavesFile=duel-waves.json, hero.grades 등급 경계, bossShardAmount, ticketsPerMatch 교환권 매치 상한 → `GameData.config.ticketsPerRun`, `GameLoop.exchangeWithTicket/ticketsLeftRun`), ante(base+perWave×라운드)/raise(base+perWave, roundTo, max)/shortfall(goldPerLife)/comeback/ai. `BettingSystem.sync(side, loop)`를 매 프레임 호출하면 카드 페이즈 진입 시 `enter`(앤티 납부), `loop.lastRound`(RoundReport: 잃은 하트·클리어 시간·족보)로 보고, 양쪽 보고 시 판정. 응답(콜/폴드)은 그 라운드에 `entered`된 쪽만. GameLoop의 `addGold/spendGold/loseLife`가 지갑 API.
- 메타 저장: localStorage 키 `poker-defense.meta.v1`, JSON {version, gems, upgrades, unlockedHeroes, claimedMilestones, stats}. GameScene은 `getMeta().applyTo(loadGameData())`로 시작하고, 판 종료 시 `recordRun`으로 젬 지급·저장.

## 진행 상태 (2026-09-20)
- 완료: Phase 0 셋업, Phase 1~2 로직 전부(systems/ + 테스트 121개).
- 완료: 시뮬레이터(`npm run sim`) + 1차 밸런스(웨이브 HP 1.15^w, 마릿수 4+0.5w). 2026-09-21 제한 시간·사거리 룰 + 종족·진형 시너지 적용 후 hpGrowth 1.16, 2026-09-22 유닛 40종·지상/공중 적용 후 1.17로 재조정. 봇 기준 하이카드 중앙값 23, 무전략 24, 최선 31 (목표 범위 안).
- 완료: GameScene 플레이 가능. 카드 선택/교환/진행 → 정비(배치 이동·합성·판매·전투 시작) → 전투(제한 시간 타이머·적 순환·타격선·배속·시간 초과 토스트) → 승리/패배 화면. TrackView는 선택 유닛의 사거리 원과 빈 칸 커버리지 힌트를 표시.
- 완료: 스와이프 업그레이드 화면(UpgradePanel + SwipeController). 종족 업그레이드 4종, 조커 조각, 영웅 8종 카드(기본 4 소환 가능·메타 4 잠금, 등급 미리보기). 좌스와이프/우측 핸들/정비 패널 버튼으로 열고, 우스와이프/게임 화면 버튼으로 닫음. 구매·소환은 정비 페이즈에서만.
- 카드 교환(v1.4): CardPhase.exchangeCard(i) — 카드당 exchangeLimit회(기본 1, 메타 2), 5장 전부 가능. 선택/일괄 교환 API는 제거됨. CardHand는 배분 시 뒷면→순차 오픈, 교환 시 해당 카드만 뒤집기(애니메이션 중 입력 잠금).
- 족보 표시/연출: CardHand가 패 위에 현재 족보를 라이브로 표시(evaluateHand 순수함수 재사용). HandFx.RANK_TIER(0~5)로 색·크기·맥동·불꽃·링·흔들림·플래시가 단계적으로 강해짐. 확정 시 트랙 중앙 큰 연출, 교환으로 족보가 오르면 패 위 작은 연출.
- 입력 규칙: 버튼/카드/슬롯 탭은 pointerup + 이동거리 TAP_SLOP(24px) 이하일 때만 (스와이프와 구분).
- 개발 편의: dev 빌드에서 `window.__game`으로 Phaser 인스턴스 노출. 브라우저 탭이 숨겨져 rAF가 멈출 때 `__game.step(t, 16.7)`로 수동 진행 가능.
- 완료: 종족·진형 시너지 1~2단계 (SynergySystem 4축, Battle rangeBonus/timeLimitBonus/enemySpeedPct/waveStartStun/rangeMultOverride, GameLoop waveStartGold/leakGold).
- 완료: 시너지 3단계(모서리 수비·밀집 방진·인접 오라 실체화) + 빙고(countBy 'lines', matchBy suit|race, per_line_attack_pct 줄 수 중첩, SynergyResult.bingoLines → TrackView 선 표시). 오라는 `effect.area`(adjacent/adjacent4/global) 기준, 자기 제외.
- 완료: 영웅 액티브 스킬 8종 (GameLoop.useHeroSkill → Battle 스킬 API: damageAllEnemies/hitTopHpEnemies/executeHighestHp/freezeEnemies/setSanctuary/slowAllEnemies/addTemporaryUnits/startStorm). 쿨 45초는 전투 시간 기준, 웨이브 넘어 유지. 전투 패널의 ⚡ 버튼.
- 완료: 메타 업그레이드(교환 +1·타이머 +10초·시작 골드 +100×3)·메타 영웅 젬 해금·젬 마일스톤·localStorage 저장, 로비 → MetaScene.
- 완료: 유닛 40종(low/high 변형)·지상/공중 분리·적 13종 로스터 (GDD v1.6, 2026-09-22).
- 완료: 1:1 실시간 레이스(GDD 3.7): GameScene이 OpponentAI를 매 프레임 tick(배속 공통), 매 프레임 raceStatus로 즉시 판정(40 먼저 클리어·탈락 후 앞섬), 플레이어 종료 시 finishRace(fastForward → resolveDuel). HUD 상단 중앙 '라운드 N/40', 우상단 상대 라운드. 3방향 스와이프(SwipeNav): 위=상대, 오른쪽=상점·영웅, 왼쪽=족보·시너지.
- 완료: 1:1 판돈 걸기(GDD 3.9, 2026-09-25): Betting 순수 시스템 + BetBar + OpponentAI 베팅 성향 + 상대 패널 원장 + 결과 화면 합계. 앤티는 각자 라운드 진입 시(앞선 쪽 때문에 먼저 빠지지 않음), 레이즈 응답은 그 라운드 진입 후.
- 완료: 교환 카운터(교환 N/5 ✓)·카드 교환권 소모품(2026-09-25): 카드 페이즈 좌하단 표시, 상점 패널(영웅 토큰 옆)·메타 화면 구매.
- 완료: 족보별 영웅 조각·보스 조각·행운 드로우(GDD v1.8, 2026-09-28): DrawAssist + CardPhase 가중 추첨, hands.json shards, heroes.json shardType, 상점 패널 조각 게이지 3줄+와일드 뱃지(DESIGN §5-04), 영웅 카드는 조각 맞는 것만 활성(§5-07), 카드 우상단 아웃 표시, 보스 조각 토스트. 밸런스 재측정: 하이카드 23·무전략 25·최선 32 (JSON 변경 없음).
- 완료: DESIGN.md 캐주얼 디자인 적용(2026-09-26): 토큰·UIButton·재화 알약·타이머 링·부채꼴 손패·잔디 필드/모래 트랙·유닛 칩·지상/공중 적 표현·데미지 숫자·베팅 3버튼·상대 말풍선·웨이브/위기 배너·결과 화면·로비 탭바. GameLoop.heroGradeDrop(등급 하락 카피).
- 완료: 시너지 도감 (정보 패널 시너지 탭에 임베드, HUD 📖 버튼/시너지 줄 탭으로 열림). 새 effect 타입을 추가하면 synergyText.describeEffect에 문장을 함께 추가할 것 (SynergyText.test가 미번역을 잡음).
- 완료(2026-09-29): A단계 모드 분리 — GameMode·OpponentSource·캠페인 레이아웃(CampaignBar)·광고 스텁 3자리·부활(GameLoop.revive)·이어하기(snapshot/restore)·로비 선택 시트. 랭크 대전은 매칭 화면 전까지 로컬 봇 상대로 바로 시작, 친구 대전은 C단계.
- 완료(2026-09-29): Supabase 서버 1차 — 스키마 12테이블·RLS·RPC(프로필/방/랭크 매칭+숨김 대체/판정·레이팅/친구·초대)·verify-match Edge Function·src/net 클라이언트 계층. 원격 프로젝트 생성·배포·실서버 스모크 19항목 통과.
- 완료(2026-09-29): B단계 결정론 입력 로그 — Seed·InputLog·고정 step·렌더 보간·GameScene 기록기(`matchLog`)·dev 빌드 종료 시 자동 재생 점검(`[replay] ok`)·verify-match에 재생 검사 추가(번들만, 함수 재배포는 아직).
- 완료(2026-09-29): C단계 친구 대전 — FriendScene·LiveOpponent/LivePublisher·네트워크 판돈(remote 모드)·서버 판정 결과 화면·친구 추가/초대·초대 링크·재대결. 실서버에서 두 계정으로 방→준비→대전→판정→전적→재대결 방 복귀 확인.
- 완료(2026-09-29): D단계 고스트전 — 고스트 대본 재생(OpponentAI script), MatchScene(매칭 대기·상대 소개), 대체 매칭 결과 보고·레이팅 표시, 마이그레이션 000400(검증된 로그만 고스트·대본에 플레이어 키)·000500(끊긴 랭크 매치 무효), verify-match 재배포. 실서버에서 봇 매치 → 로그 검증 통과 → 다른 계정에 고스트로 등장 확인.
- 완료(2026-09-29): E단계 랭크 실시간 — 사람 대 사람 매칭 실서버 확인, 기권패·heartbeat·claim_absent(마이그레이션 000600), 봇 강도 프리셋, 판돈 교차 검증, verify-match 재배포. 기획의 '끊김 후 봇 대행'은 '부재 = 기권패'로 단순화.
- 완료(2026-09-29): F단계 시즌·랭킹 — 마이그레이션 000700(season_results, ensure_season 지연 넘김, leaderboard, my_season, claim_season_reward), Ranking 순수 로직, RankScene(로비 랭킹 탭). 시즌은 cron 없이 시즌을 읽는 RPC·enqueue가 넘긴다. 보상 다이아는 서버에 수령 기록 후 메타(localStorage)에 더한다.
- 온라인 단계 A~F 완료. 기획에 있던 친구 방 관전은 미구현.
- 완료(2026-09-29): 대전 중 기권 버튼, 재접속 이어하기(랭크·친구·서버 없는 판). 실서버에서 대체 상대 매치 전투 중 새로고침 → 복원, 사람 상대 매치 새로고침 → 복원(판돈 일치) → 상대 기권 확인.
- 기획(화면 미구현): 싱글 캠페인 / 랭크 대전 / 친구 대전(초대 코드·링크·방장 룰·재대결·친구 목록). AI 상대는 모드가 아니라 매칭 15~40초 초과 시 고스트→봇을 일반 상대처럼 붙이는 숨김 대체(닉 풀·강도 프리셋·K 절반) — docs/mode-design.md §1.1.1 (GameMode 프리셋, OpponentSource 추상화, 입력 로그 결정론 재생, 릴레이+사후 검증 네트워크, Supabase, 단계 A~E).
- 미구현: 일일 미션·상점(IAP)·광고, 발사체/피격 이펙트·사운드, 튜토리얼.
- 알려진 밸런스 이슈: 최선 전략 봇도 40웨이브 클리어 0% (31~39 구간 벽). 영웅 액티브·부활 광고 구현 후 재측정 필요.
