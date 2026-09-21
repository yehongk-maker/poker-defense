// waves.json 생성 스크립트 — GDD 3.5. 수정 후 재실행하면 waves.json 갱신.
// 실행: npm run waves -- [--timeLimit 30] [--bossTimeLimit 45] [--hpBase 20] [--hpGrowth 1.15] [--countBase 4] [--countPer 0.5] [--countMax 30] [--bossMult 25] [--armoredMult 1.0] [--specialShare 0.7] [--out path]
// 2026-09-20 밸런스: 1.18^w/15~30마리 → 하이카드 봇 98% 웨이브1 사망. 1.15^w/4+0.5w/중갑 hpMult 1.0으로 조정 (근거: npm run sim).
// 밸런스 근거는 scripts/simulate.ts 결과로 검증한다 (npm run sim).
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? Number(args[i + 1]) : d; };
const optS = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };

// ── 밸런스 파라미터 (기본값 = 현재 채택값) ──
const HP_BASE = opt('hpBase', 20);
const HP_GROWTH = opt('hpGrowth', 1.15);
const COUNT_BASE = opt('countBase', 4);
const COUNT_PER = opt('countPer', 0.5);
const COUNT_MAX = opt('countMax', 30);
const BOSS_HP_MULT = opt('bossMult', 25);
const ARMORED_HP_MULT = opt('armoredMult', 1.0);
const SPECIAL_SHARE = opt('specialShare', 0.7);
const TIME_LIMIT = opt('timeLimit', 30);       // 웨이브 제한 시간(초). 초과 시 남은 적 1기당 라이프 차감
const BOSS_TIME_LIMIT = opt('bossTimeLimit', 45);
const OUT = optS('out', new URL('../src/data/waves.json', import.meta.url));

const waves = [];
for (let w = 1; w <= 40; w++) {
  const boss = w % 10 === 0;
  const hp = Math.round(HP_BASE * Math.pow(HP_GROWTH, w));
  const count = boss ? 1 : Math.min(COUNT_MAX, Math.round(COUNT_BASE + w * COUNT_PER));

  let groups;
  if (boss) {
    groups = [{ type: 'boss', count: 1 }];
  } else if (w < 5) {
    groups = [{ type: 'normal', count }];
  } else {
    // 5웨이브부터 특수 타입 순환 등장: fast → armored → regen, SPECIAL_SHARE 특수 + 나머지 일반
    const cycle = ['fast', 'armored', 'regen'];
    const special = cycle[(w - 5) % 3];
    // regen은 12웨이브, armored는 8웨이브부터
    const gate = { fast: 5, armored: 8, regen: 12 };
    const type = w >= gate[special] ? special : 'normal';
    const specialCount = Math.round(count * SPECIAL_SHARE);
    groups =
      type === 'normal'
        ? [{ type: 'normal', count }]
        : [
            { type, count: specialCount },
            { type: 'normal', count: count - specialCount },
          ];
  }

  waves.push({ wave: w, boss, hp, spawnInterval: boss ? 0 : 0.8, timeLimit: boss ? BOSS_TIME_LIMIT : TIME_LIMIT, groups });
}

const data = {
  comment:
    `GDD 3.5 웨이브 테이블. hp = ${HP_BASE}×${HP_GROWTH}^wave (보스는 ×hpMult), 마릿수 = ${COUNT_BASE} + ${COUNT_PER}×wave (최대 ${COUNT_MAX}), 제한시간 ${TIME_LIMIT}s(보스 ${BOSS_TIME_LIMIT}s). config: gridSize 슬롯 격자, lifePerLeak 시간초과 이탈 적당 라이프, rangeDamageMult 사거리(셀)별 공격 배율. ` +
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
    rangeDamageMult: { '2': 1.35, '3': 1.0, '4': 0.75 }
  },
  enemyTypes: {
    normal: { speedMult: 1.0, physicalResist: 0, regenPctPerSec: 0, hpMult: 1 },
    fast: { speedMult: 1.6, physicalResist: 0, regenPctPerSec: 0, hpMult: 0.75 },
    armored: { speedMult: 0.85, physicalResist: 0.5, regenPctPerSec: 0, hpMult: ARMORED_HP_MULT },
    regen: { speedMult: 1.0, physicalResist: 0, regenPctPerSec: 0.02, hpMult: 1.1 },
    boss: { speedMult: 0.7, physicalResist: 0.3, regenPctPerSec: 0, hpMult: BOSS_HP_MULT }
  },
  waves,
};

writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
console.log(`waves.json generated: ${waves.length} waves (hp ${HP_BASE}×${HP_GROWTH}^w, count ${COUNT_BASE}+${COUNT_PER}w)`);
