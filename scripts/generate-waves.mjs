// waves.json 생성 스크립트 — GDD 3.5 공식 기반. 수정 후 재실행하면 waves.json 갱신.
// 실행: node scripts/generate-waves.mjs
import { writeFileSync } from 'node:fs';

const waves = [];
for (let w = 1; w <= 40; w++) {
  const boss = w % 10 === 0;
  const hp = Math.round(20 * Math.pow(1.18, w));
  const count = boss ? 1 : Math.min(30, 15 + Math.floor(w * 0.4));

  let groups;
  if (boss) {
    groups = [{ type: 'boss', count: 1 }];
  } else if (w < 5) {
    groups = [{ type: 'normal', count }];
  } else {
    // 5웨이브부터 특수 타입 순환 등장: fast → armored → regen, 70% 특수 + 30% 일반
    const cycle = ['fast', 'armored', 'regen'];
    const special = cycle[(w - 5) % 3];
    // regen은 12웨이브, armored는 8웨이브부터
    const gate = { fast: 5, armored: 8, regen: 12 };
    const type = w >= gate[special] ? special : 'normal';
    const specialCount = Math.round(count * 0.7);
    groups =
      type === 'normal'
        ? [{ type: 'normal', count }]
        : [
            { type, count: specialCount },
            { type: 'normal', count: count - specialCount },
          ];
  }

  waves.push({
    wave: w,
    boss,
    hp,
    spawnInterval: boss ? 0 : 0.8,
    groups,
  });
}

const data = {
  comment:
    'GDD 3.5 웨이브 테이블. hp = 20×1.18^wave (보스는 ×hpMult). 생성: scripts/generate-waves.mjs — 수치 바꾸려면 스크립트 수정 후 재실행하거나 이 파일 직접 편집.',
  config: {
    trackLength: 40,
    baseEnemySpeed: 4,
    baseKillGold: 1,
    bossKillGold: 20,
    clearGoldBase: 30,
    clearGoldPerWave: 5
  },
  enemyTypes: {
    normal: { speedMult: 1.0, physicalResist: 0, regenPctPerSec: 0, hpMult: 1 },
    fast: { speedMult: 1.6, physicalResist: 0, regenPctPerSec: 0, hpMult: 0.75 },
    armored: { speedMult: 0.85, physicalResist: 0.5, regenPctPerSec: 0, hpMult: 1.2 },
    regen: { speedMult: 1.0, physicalResist: 0, regenPctPerSec: 0.02, hpMult: 1.1 },
    boss: { speedMult: 0.7, physicalResist: 0.3, regenPctPerSec: 0, hpMult: 25 }
  },
  waves,
};

writeFileSync(new URL('../src/data/waves.json', import.meta.url), JSON.stringify(data, null, 2) + '\n');
console.log(`waves.json generated: ${waves.length} waves`);
