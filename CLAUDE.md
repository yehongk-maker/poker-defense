# 포커디펜스 (Poker Defense) — 프로젝트 헌법

기획서: `GDD.md` (v1.7). 이 문서와 충돌하면 GDD가 우선하되, 코드 규칙은 이 문서를 따른다.

## 스택
- Phaser 3 + TypeScript + Vite. 모바일 세로 1080×1920, Scale FIT (`src/config.ts`).
- 테스트: vitest (`npm test`). 타입체크: `npm run typecheck`.
- 모바일 패키징(Capacitor), 광고/결제는 Phase 5 이후.

## 폴더 구조
```
src/
  main.ts        Phaser.Game 생성
  config.ts      해상도·씬 키 상수
  scenes/        Boot, Lobby, Game, Meta(메타 업그레이드 화면)  ← Phaser 의존 OK
  meta.ts        메타 진행 싱글턴 getMeta() (MetaProgress + localStorage)
  systems/       PokerEvaluator, CardPhase, SummonMapper, SynergySystem, Battle, GameLoop, Geometry(트랙/슬롯 좌표·사거리),
                 MetaProgress(젬·영구 업그레이드·영웅 해금·마일스톤, SaveStore DI), storage(localStorage 어댑터),
                 bots(봇 전략 공용), Duel(OpponentAI 실시간/fastForward + resolveDuel 승패),
                 Betting(1:1 판돈 걸기: 앤티/체크·레이즈/콜·폴드/판정/이월 + AI 성향, GameLoop이 BetWallet)
                 ← 순수 로직. Phaser import 금지
  entities/      Unit, Enemy, Projectile 표시 객체 (Phaser)
  ui/            HUD, CardHand, TrackView, ManagePanel, UpgradePanel(스와이프 화면), SwipeController, HandFx(족보 연출),
                 SynergyCodex(도감, embedded 가능) + synergyText(JSON→한글 설명, 순수), SwipeNav(3방향: left=상점 UpgradePanel,
                 right=InfoPanel 족보·시너지, bottom=OpponentPanel 상대 현황), SynergyChips(화면 왼쪽 활성 시너지 칩),
                 BetBar(맨 아래 판돈 바: 체크/레이즈 → 콜/폴드), Button, theme (Phaser)
  data/          units, hands, waves, synergies, heroes, config, duel(판돈 룰·AI 성향) .json
tests/           vitest. systems/와 1:1 대응
scripts/         generate-waves.mjs 등 데이터 생성/시뮬레이터
```

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
- 영웅 토큰 ● (`shards`, 구 조커 조각): 플러시 이상에서 획득, 3개로 영웅 소환.
- 다이아 💎 (`gems`, 구 젬): 캐시+마일스톤 무료 획득, 메타 업그레이드·메타 영웅 해금. localStorage.
- 하트 ♥ (`life`, 구 라이프): 시간 초과 이탈 적당 -1, 0이면 탈락.
- 코드 식별자(shards/gems/life)는 그대로 두고 표시 문자열만 통일한다.

## 데이터 스키마 요약
- `units.json`: 수트(S/H/D/C)×티어(1~5)×변형(cards: low/high) 40종. `targets`(ground/air/both)로 지상/공중 공격 가능 여부. `baseDps×dpsFactor×attackInterval` = 1회 데미지. `effect.type`으로 특수 효과(bonus_vs_air 포함).
- `hands.json`: 족보 → `summonTiers[]`, `jokerShards`, `heroSummon`.
- `waves.json`: 40웨이브, 적 13종(`enemyTypes`: name, movement ground/air, boss 플래그). 공중은 6웨이브부터, 보스 지상/공중 교대. `npm run waves`(scripts/generate-waves.mjs)로 생성. 공식은 파일의 `formula` 필드(hp = 20×1.17^wave, 마릿수 4+0.5w). 웨이브별 `timeLimit`(30s, 보스 45s). `config`: gridSize(5), lifePerLeak/bossLifePerLeak(1/3), rangeDamageMult(사거리 2/3/4/5/6 → ×1.35/1.0/0.75/0.65/0.55).
- 지상/공중(GDD 3.2): `Battle.canAttack` — 유닛 targets와 적 movement가 맞아야 공격(스플래시·체인 포함). SummonMapper는 `unitFor(suit, tier, band)`, 변형은 `bandOfRank`(9 이상 high).
- 전투 룰(GDD 3.5~3.6): 적은 제한 시간 동안 트랙을 돌고, 시간 종료 시 남은 적당 라이프 차감. 유닛은 슬롯에서 사거리(셀) 안의 적만 공격 → 배치가 핵심. `DeployedUnit.slot` 필수, 자동 배치는 `GameLoop.autoSlot`(커버리지 최대 빈 칸). 이동은 `moveUnit` — `placed=false`(소환 직후)인 유닛만 빈 칸으로 1회, 이후/전투 시작 후 고정, 판매만 가능.
- 밸런스 검증: `npm run sim` (scripts/simulate.ts, 봇 3종 헤드리스). `tests/Balance.test.ts`가 GDD 3.5 목표를 회귀 테스트로 고정.
- `synergies.json`: 4축 — suits(수트 기수 2/4/6) · classes(종류 2/4) · races(종족 기수+영웅 3/5/7 등) · formation(사거리/조건 자동 판정) + caps(합산 상한). 상위 구간이 하위를 대체. 설계 근거 docs/synergy-design.md.
- `units.json`/`heroes.json`의 `race`(human/goblin/monster/spirit)는 종족 축 태그. 영웅(`ApplyOptions.hero`)은 수트·클래스 축만 제외, 나머지(종족·진형·빙고·global·오라·상한·업그레이드)에 포함. caps 공격 120/공속 70.
- `heroes.json`: 영웅 12종(수트별 기본/메타/대공). `combat.targets`(ground/air/both)로 지상/공중 구분 — 근접 영웅은 ground. 대공 패시브 air_attack_pct(global|suit)/air_slow_pct/air_kill_gold_mult, 대공 액티브 flak_barrage/light_of_falling/bombard_support/void_gale(Battle 스킬 API의 movement 필터). `active.id`별 구현은 GameLoop.useHeroSkill의 switch, 수치는 `active.params`.
- `config.json`: 라이프/골드/슬롯/업그레이드/영웅 등급/BM + `meta`(영구 업그레이드 3종·영웅 해금 비용·`exchangeTicket`(카드 교환권: cost/initial/max)·젬 보상·저장 키).
- 카드 교환권(GDD 3.4): `MetaProgress.tickets/buyTicket/useTicket`(저장 필드 `tickets`, 구 저장은 initial로 채움) + `CardPhase.exchangeWithTicket(i)`(기본 횟수 무시, `ticketsUsed`). 씬은 `canExchange`가 false이고 교환권이 있으면 `useTicket` 후 `exchangeWithTicket`. CardHand는 `ExchangeStatus`(left/used/total/tickets/ticketsUsed)로 카운터·배지·힌트 표시.
- `duel.json` (GDD 3.9): ante(base+perWave×라운드)/raise(base+perWave, roundTo, max)/shortfall(goldPerLife)/comeback/ai. `BettingSystem.sync(side, loop)`를 매 프레임 호출하면 카드 페이즈 진입 시 `enter`(앤티 납부), `loop.lastRound`(RoundReport: 잃은 하트·클리어 시간·족보)로 보고, 양쪽 보고 시 판정. 응답(콜/폴드)은 그 라운드에 `entered`된 쪽만. GameLoop의 `addGold/spendGold/loseLife`가 지갑 API.
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
- 완료: 시너지 도감 (정보 패널 시너지 탭에 임베드, HUD 📖 버튼/시너지 줄 탭으로 열림). 새 effect 타입을 추가하면 synergyText.describeEffect에 문장을 함께 추가할 것 (SynergyText.test가 미번역을 잡음).
- 미구현: 일일 미션·상점(IAP)·광고, 발사체/피격 이펙트·사운드, 튜토리얼, 시너지 도감 UI.
- 알려진 밸런스 이슈: 최선 전략 봇도 40웨이브 클리어 0% (31~39 구간 벽). 영웅 액티브·부활 광고 구현 후 재측정 필요.
