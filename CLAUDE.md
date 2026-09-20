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
  systems/       PokerEvaluator, CardPhase, SummonMapper, SynergySystem, Battle, GameLoop
                 ← 순수 로직. Phaser import 금지
  entities/      Unit, Enemy, Projectile 표시 객체 (Phaser)
  ui/            HUD, CardHand, TrackView, ManagePanel, Button, theme (Phaser). SwipePanel 예정
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
- `waves.json`: 40웨이브. `npm run waves`(scripts/generate-waves.mjs)로 생성. 공식은 파일의 `formula` 필드(hp = 20×1.15^wave, 마릿수 4+0.5w). 직접 편집도 가능.
- 밸런스 검증: `npm run sim` (scripts/simulate.ts, 봇 3종 헤드리스). `tests/Balance.test.ts`가 GDD 3.5 목표를 회귀 테스트로 고정.
- `synergies.json`: 수트(2/4/6) + 클래스(2/4) 2축. 상위 구간이 하위를 대체.
- `heroes.json`: 영웅 8종. `active`는 데이터만 정의됨(미구현).
- `config.json`: 라이프/골드/슬롯/업그레이드/영웅 등급/BM.

## 진행 상태 (2026-09-20)
- 완료: Phase 0 셋업, Phase 1~2 로직 전부(systems/ + 테스트 121개).
- 완료: 시뮬레이터(`npm run sim`) + 1차 밸런스(웨이브 HP 1.15^w, 마릿수 4+0.5w). 봇 기준 하이카드 중앙값 20, 무전략 22, 최선 29.
- 완료: GameScene 플레이 가능 (src/ui: HUD·CardHand·TrackView·ManagePanel·Button). 카드 선택/교환/진행 → 정비(업그레이드·합성·영웅·판매) → 전투(적 순환·타격선·배속) → 승리/패배 화면.
- 미구현: 스와이프 업그레이드 화면(영웅 선택 UI 포함 — 지금은 다수 수트 기본 영웅 자동 선택), 영웅 액티브 스킬, 메타 업그레이드·localStorage, 발사체/피격 이펙트·사운드, 튜토리얼.
- 알려진 밸런스 이슈: 최선 전략 봇도 40웨이브 클리어 0% (31~39 구간 벽). 영웅 액티브·부활 광고 구현 후 재측정 필요.
