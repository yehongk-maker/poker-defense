// waves.json 생성 스크립트 — GDD 3.5. 수정 후 재실행하면 waves.json 갱신.
// 실행: npm run waves -- [--timeLimit 30] [--bossTimeLimit 45] [--hpBase 20] [--hpGrowth 1.17] [--countBase 4] [--countPer 0.5] [--countMax 30] [--bossMult 25] [--armoredMult 1.0] [--specialShare 0.7] [--out path]
// 2026-09-20 밸런스: 1.18^w/15~30마리 → 하이카드 봇 98% 웨이브1 사망. 1.15^w/4+0.5w/중갑 hpMult 1.0으로 조정 (근거: npm run sim).
// 2026-09-21 종족·진형 시너지 추가로 화력 상승 → hpGrowth 1.15→1.16 (봇 기준 하이카드 22 / 무전략 24 / 최선 31 유지).
// 2026-09-22 유닛 40종(대공·장사거리 다수)으로 화력 상승 → 1.16→1.17 (하이카드 23 / 무전략 24 / 최선 31).
// 밸런스 근거는 scripts/simulate.ts 결과로 검증한다 (npm run sim).
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? Number(args[i + 1]) : d; };
const optS = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };

// ── 밸런스 파라미터 (기본값 = 현재 채택값) ──
const HP_BASE = opt('hpBase', 20);
const HP_GROWTH = opt('hpGrowth', 1.17);
const COUNT_BASE = opt('countBase', 4);
const COUNT_PER = opt('countPer', 0.5);
const COUNT_MAX = opt('countMax', 30);
const BOSS_HP_MULT = opt('bossMult', 25);
const ARMORED_HP_MULT = opt('armoredMult', 1.0);
const SPECIAL_SHARE = opt('specialShare', 0.7);
const TIME_LIMIT = opt('timeLimit', 30);       // 웨이브 제한 시간(초). 초과 시 남은 적 1기당 라이프 차감
const BOSS_TIME_LIMIT = opt('bossTimeLimit', 45);
const OUT = optS('out', new URL('../src/data/waves.json', import.meta.url));

// 적 몬스터 로스터 13종 — movement: ground/air (air는 targets=ground 유닛이 공격 불가). 타락체(fallen_*)는 아군 유닛의 타락 버전.
const enemyTypes = {
  skeleton:        { name: '해골 병사',     movement: 'ground', speedMult: 1.0,  physicalResist: 0,   regenPctPerSec: 0,    hpMult: 1 },
  wild_hound:      { name: '들개 무리',     movement: 'ground', speedMult: 1.6,  physicalResist: 0,   regenPctPerSec: 0,    hpMult: 0.75 },
  bone_knight:     { name: '해골 중갑기사', movement: 'ground', speedMult: 0.85, physicalResist: 0.5, regenPctPerSec: 0,    hpMult: ARMORED_HP_MULT },
  ghoul:           { name: '구울',         movement: 'ground', speedMult: 1.0,  physicalResist: 0,   regenPctPerSec: 0.02, hpMult: 1.1 },
  fallen_spearman: { name: '타락한 창격병', movement: 'ground', speedMult: 1.3,  physicalResist: 0.2, regenPctPerSec: 0,    hpMult: 0.9 },
  cave_bat:        { name: '동굴 박쥐 떼',  movement: 'air',    speedMult: 1.7,  physicalResist: 0,   regenPctPerSec: 0,    hpMult: 0.6 },
  gargoyle:        { name: '가고일',       movement: 'air',    speedMult: 0.9,  physicalResist: 0.4, regenPctPerSec: 0,    hpMult: 1.0 },
  wraith:          { name: '원혼',         movement: 'air',    speedMult: 1.0,  physicalResist: 0,   regenPctPerSec: 0.02, hpMult: 0.9 },
  fallen_imp:      { name: '타락한 임프',   movement: 'air',    speedMult: 1.2,  physicalResist: 0,   regenPctPerSec: 0,    hpMult: 0.8 },
  bone_golem:      { name: '본 골렘',       movement: 'ground', speedMult: 0.7,  physicalResist: 0.3, regenPctPerSec: 0,    hpMult: BOSS_HP_MULT, boss: true },
  fallen_seraphim: { name: '타락 세라핌',   movement: 'air',    speedMult: 0.8,  physicalResist: 0,   regenPctPerSec: 0.01, hpMult: BOSS_HP_MULT * 0.88, boss: true },
  skeleton_lord:   { name: '해골 군주',     movement: 'ground', speedMult: 0.65, physicalResist: 0.4, regenPctPerSec: 0,    hpMult: BOSS_HP_MULT * 1.12, boss: true },
  specter_dragon:  { name: '망령 드래곤',   movement: 'air',    speedMult: 0.75, physicalResist: 0.2, regenPctPerSec: 0.01, hpMult: BOSS_HP_MULT * 1.2, boss: true },
};
// 보스 스케줄: 지상/공중 교대 → 20웨이브 보스가 대공 빌드 체크포인트
const bosses = { 10: 'bone_golem', 20: 'fallen_seraphim', 30: 'skeleton_lord', 40: 'specter_dragon' };
// 특수 타입 순환 + 등장 게이트 (공중은 6웨이브부터 → 대공 유닛 준비 시간)
const specials = [
  { type: 'wild_hound', gate: 5 },
  { type: 'cave_bat', gate: 6 },
  { type: 'bone_knight', gate: 7 },
  { type: 'gargoyle', gate: 8 },
  { type: 'ghoul', gate: 9 },
  { type: 'wraith', gate: 13 },
  { type: 'fallen_imp', gate: 15 },
  { type: 'fallen_spearman', gate: 15 },
];

const waves = [];
for (let w = 1; w <= 40; w++) {
  const boss = w % 10 === 0;
  const hp = Math.round(HP_BASE * Math.pow(HP_GROWTH, w));
  const count = boss ? 1 : Math.min(COUNT_MAX, Math.round(COUNT_BASE + w * COUNT_PER));

  let groups;
  if (boss) {
    groups = [{ type: bosses[w], count: 1 }];
  } else if (w < 5) {
    groups = [{ type: 'skeleton', count }];
  } else {
    const sp = specials[(w - 5) % specials.length];
    const type = w >= sp.gate ? sp.type : 'skeleton';
    const specialCount = Math.round(count * SPECIAL_SHARE);
    groups =
      type === 'skeleton'
        ? [{ type: 'skeleton', count }]
        : [
            { type, count: specialCount },
            { type: 'skeleton', count: count - specialCount },
          ];
  }

  waves.push({ wave: w, boss, hp, spawnInterval: boss ? 0 : 0.8, timeLimit: boss ? BOSS_TIME_LIMIT : TIME_LIMIT, groups });
}

const data = {
  comment:
    `GDD 3.5 웨이브 테이블. hp = ${HP_BASE}×${HP_GROWTH}^wave (보스는 ×hpMult), 마릿수 = ${COUNT_BASE} + ${COUNT_PER}×wave (최대 ${COUNT_MAX}), 제한시간 ${TIME_LIMIT}s(보스 ${BOSS_TIME_LIMIT}s). config: gridSize 슬롯 격자, lifePerLeak 시간초과 이탈 적당 하트, rangeDamageMult 사거리(셀)별 공격 배율. enemyTypes.movement: air 적은 targets=ground 유닛이 공격 불가(스플래시·체인도 안 튐). 공중 6웨이브부터, 보스 지상/공중 교대. ` +
    '생성: scripts/generate-waves.mjs — 수치 바꾸려면 스크립트 인자로 재생성하거나 이 파일 직접 편집.',
  formula: { hpBase: HP_BASE, hpGrowth: HP_GROWTH, countBase: COUNT_BASE, countPerWave: COUNT_PER, countMax: COUNT_MAX },
  config: {
    trackLength: 40,
    gridSize: 5,
    baseEnemySpeed: 4,
    baseKillGold: 1,
    bossKillGold: 20,
    clearGoldBase: 30,
    clearGoldPerWave: 5,
    lifePerLeak: 1,
    bossLifePerLeak: 3,
    rangeDamageMult: { '2': 1.35, '3': 1.0, '4': 0.75, '5': 0.65, '6': 0.55 }
  },
  enemyTypes,
  waves,
};

writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
const airWaves = waves.filter((w) => w.groups.some((g) => enemyTypes[g.type].movement === 'air')).map((w) => w.wave);
console.log(`waves.json generated: ${waves.length} waves (hp ${HP_BASE}×${HP_GROWTH}^w, count ${COUNT_BASE}+${COUNT_PER}w), air waves: ${airWaves.join(',')}`);
