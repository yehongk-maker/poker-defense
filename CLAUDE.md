# 포커디펜스 (Poker Defense) — 프로젝트 헌법

기획서: `GDD.md` (v1.3). 이 문서와 충돌하면 GDD가 우선하되, 코드 규칙은 이 문서를 따른다.

## 스택
- Phaser 3 + TypeScript + Vite. 모바일 세로 1080×1920, Scale FIT (`src/config.ts`).
- 테스트: vitest (`npm test`). 타입체크: `npm run typecheck`.
- 모바일 패키징(Capacitor), 광고/결제는 Phase 5 이후.

## 폴더 구조
```
src/
  main.ts        Phaser.Game 생성
  config.ts      해상도·씬 키 상수
  scenes/        Boot, Lobby, Game (+ UpgradePanel 예정)  ← Phaser 의존 OK
  systems/       PokerEvaluator, CardPhase, SummonMapper, SynergySystem, Battle, GameLoop, Geometry(트랙/슬롯 좌표·사거리)
                 ← 순수 로직. Phaser import 금지
  entities/      Unit, Enemy, Projectile 표시 객체 (Phaser)
  ui/            HUD, CardHand, TrackView, ManagePanel, UpgradePanel(스와이프 화면), SwipeController, HandFx(족보 연출), Button, theme (Phaser)
  data/          units, hands, waves, synergies, heroes, config .json
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

## 데이터 스키마 요약
- `units.json`: 수트(S/H/D/C)×티어(1~5) 20종. `baseDps×dpsFactor×attackInterval` = 1회 데미지. `effect.type`으로 특수 효과.
- `hands.json`: 족보 → `summonTiers[]`, `jokerShards`, `heroSummon`.
- `waves.json`: 40웨이브. `npm run waves`(scripts/generate-waves.mjs)로 생성. 공식은 파일의 `formula` 필드(hp = 20×1.16^wave, 마릿수 4+0.5w). 웨이브별 `timeLimit`(30s, 보스 45s). `config`: gridSize(5), lifePerLeak/bossLifePerLeak(1/3), rangeDamageMult(사거리 2/3/4 → ×1.35/1.0/0.75).
- 전투 룰(GDD 3.5~3.6): 적은 제한 시간 동안 트랙을 돌고, 시간 종료 시 남은 적당 라이프 차감. 유닛은 슬롯에서 사거리(셀) 안의 적만 공격 → 배치가 핵심. `DeployedUnit.slot` 필수, 자동 배치는 `GameLoop.autoSlot`(커버리지 최대 빈 칸), 이동은 `moveUnit`.
- 밸런스 검증: `npm run sim` (scripts/simulate.ts, 봇 3종 헤드리스). `tests/Balance.test.ts`가 GDD 3.5 목표를 회귀 테스트로 고정.
- `synergies.json`: 4축 — suits(수트 기수 2/4/6) · classes(종류 2/4) · races(종족 기수+영웅 3/5/7 등) · formation(사거리/조건 자동 판정) + caps(합산 상한). 상위 구간이 하위를 대체. 설계 근거 docs/synergy-design.md.
- `units.json`/`heroes.json`의 `race`(human/goblin/monster/spirit)는 종족 축 태그. 영웅(`ApplyOptions.hero`)은 수트·클래스 축만 제외, 나머지(종족·진형·빙고·global·오라·상한·업그레이드)에 포함. caps 공격 120/공속 70.
- `heroes.json`: 영웅 8종. `active.id`별 구현은 GameLoop.useHeroSkill의 switch, 수치는 `active.params`.
- `config.json`: 라이프/골드/슬롯/업그레이드/영웅 등급/BM.

## 진행 상태 (2026-09-20)
- 완료: Phase 0 셋업, Phase 1~2 로직 전부(systems/ + 테스트 121개).
- 완료: 시뮬레이터(`npm run sim`) + 1차 밸런스(웨이브 HP 1.15^w, 마릿수 4+0.5w). 2026-09-21 제한 시간·사거리 룰 + 종족·진형 시너지 적용 후 hpGrowth 1.16으로 재조정, 봇 기준 하이카드 중앙값 22, 무전략 24, 최선 31 (목표 범위 안).
- 완료: GameScene 플레이 가능. 카드 선택/교환/진행 → 정비(배치 이동·합성·판매·전투 시작) → 전투(제한 시간 타이머·적 순환·타격선·배속·시간 초과 토스트) → 승리/패배 화면. TrackView는 선택 유닛의 사거리 원과 빈 칸 커버리지 힌트를 표시.
- 완료: 스와이프 업그레이드 화면(UpgradePanel + SwipeController). 종족 업그레이드 4종, 조커 조각, 영웅 8종 카드(기본 4 소환 가능·메타 4 잠금, 등급 미리보기). 좌스와이프/우측 핸들/정비 패널 버튼으로 열고, 우스와이프/게임 화면 버튼으로 닫음. 구매·소환은 정비 페이즈에서만.
- 족보 표시/연출: CardHand가 패 위에 현재 족보를 라이브로 표시(evaluateHand 순수함수 재사용). HandFx.RANK_TIER(0~5)로 색·크기·맥동·불꽃·링·흔들림·플래시가 단계적으로 강해짐. 확정 시 트랙 중앙 큰 연출, 교환으로 족보가 오르면 패 위 작은 연출.
- 입력 규칙: 버튼/카드/슬롯 탭은 pointerup + 이동거리 TAP_SLOP(24px) 이하일 때만 (스와이프와 구분).
- 개발 편의: dev 빌드에서 `window.__game`으로 Phaser 인스턴스 노출. 브라우저 탭이 숨겨져 rAF가 멈출 때 `__game.step(t, 16.7)`로 수동 진행 가능.
- 완료: 종족·진형 시너지 1~2단계 (SynergySystem 4축, Battle rangeBonus/timeLimitBonus/enemySpeedPct/waveStartStun/rangeMultOverride, GameLoop waveStartGold/leakGold).
- 완료: 시너지 3단계(모서리 수비·밀집 방진·인접 오라 실체화) + 빙고(countBy 'lines', matchBy suit|race, per_line_attack_pct 줄 수 중첩, SynergyResult.bingoLines → TrackView 선 표시). 오라는 `effect.area`(adjacent/adjacent4/global) 기준, 자기 제외.
- 완료: 영웅 액티브 스킬 8종 (GameLoop.useHeroSkill → Battle 스킬 API: damageAllEnemies/hitTopHpEnemies/executeHighestHp/freezeEnemies/setSanctuary/slowAllEnemies/addTemporaryUnits/startStorm). 쿨 45초는 전투 시간 기준, 웨이브 넘어 유지. 전투 패널의 ⚡ 버튼.
- 미구현: 메타 업그레이드·localStorage·젬 해금, 발사체/피격 이펙트·사운드, 튜토리얼, 시너지 도감 UI.
- 알려진 밸런스 이슈: 최선 전략 봇도 40웨이브 클리어 0% (31~39 구간 벽). 영웅 액티브·부활 광고 구현 후 재측정 필요.
