// 영웅 조각 밸런스 리포트 — 족보별 조각 시스템(GDD §3.3)의 수치 검증.
// 실행: npm run shards  (→ design/hero-shard-report.md)
// 1) 특정 족보를 노리는 봇이 라운드마다 어떤 조각을 얻는지 잰다 (행운 드로우 켠 실제 CardPhase, 카드별 교환 API 사용)
// 2) 그 확률로 40웨이브를 반복 시뮬레이션해 영웅 소환 시점 분포를 낸다 (보스 조각 포함)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CardPhase } from '../src/systems/CardPhase.ts';
import { evaluateHand, HandRank, type Card } from '../src/systems/PokerEvaluator.ts';

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const config = read('../src/data/config.json');
const hands = read('../src/data/hands.json');
const waves = read('../src/data/waves.json').waves as { wave: number; boss: boolean }[];
const heroes = read('../src/data/heroes.json').heroes as { name: string; unlock: string; shardType: string }[];

const TYPES = ['straight', 'flush', 'fullHouse'] as const;
type T = (typeof TYPES)[number];
const LABEL: Record<string, string> = { straight: '스트레이트', flush: '플러시', fullHouse: '풀하우스', wild: '와일드', hero: '즉시 소환(로열)' };
const ROUNDS = Number(process.env.REPORT_N ?? 30_000);
const GAMES = Number(process.env.REPORT_GAMES ?? 20_000);
const REQ: number = config.hero.shardsRequired;
const BOSS = config.hero.bossShards as { amount: number; types: T[] };
const TOTAL = config.totalWaves as number;
const BOSS_WAVES = waves.filter((w) => w.boss && w.wave < TOTAL).map((w) => w.wave);
const S_LAST = TOTAL + 1 - config.hero.grades.S.minRemainingWaves; // S급 마지노선 웨이브
const A_LAST = TOTAL + 1 - config.hero.grades.A.minRemainingWaves;

function rngFrom(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; };
}

/** 족보 → 조각 이벤트 키 하나 (straight/flush/fullHouse/wild/hero) 또는 null */
function eventOf(rank: HandRank): string | null {
  const h = hands[HandRank[rank]];
  if (h.heroSummon) return 'hero';
  const keys = Object.keys(h.shards ?? {});
  return keys.length ? keys[0] : null;
}
const AMOUNT: Record<string, number> = {};
for (const h of Object.values(hands) as { shards?: Record<string, number> }[]) {
  for (const [k, v] of Object.entries(h.shards ?? {})) AMOUNT[k] = v;
}

/** 목표 조각을 노릴 때 남길 카드 인덱스 */
export function keepFor(hand: readonly Card[], target: T): number[] {
  const all = hand.map((_, i) => i);
  const r = evaluateHand([...hand], () => 0).rank;
  if (r >= HandRank.Straight) return all; // 이미 조각 족보면 유지
  if (target === 'flush') {
    const bySuit = new Map<string, number[]>();
    hand.forEach((c, i) => bySuit.set(c.suit, [...(bySuit.get(c.suit) ?? []), i]));
    return [...bySuit.values()].sort((a, b) => b.length - a.length)[0];
  }
  if (target === 'straight') {
    let best: number[] = [];
    for (let lo = 1; lo <= 10; lo++) {
      const pick: number[] = [];
      const used = new Set<number>();
      hand.forEach((c, i) => {
        const rr = c.rank === 14 && lo === 1 ? 1 : c.rank;
        if (rr >= lo && rr <= lo + 4 && !used.has(rr)) { used.add(rr); pick.push(i); }
      });
      if (pick.length > best.length) best = pick;
    }
    return best;
  }
  // fullHouse: 짝이 있는 카드는 모두 남기고, 없으면 가장 높은 카드 1장
  const count = new Map<number, number[]>();
  hand.forEach((c, i) => count.set(c.rank, [...(count.get(c.rank) ?? []), i]));
  const paired = [...count.values()].filter((g) => g.length >= 2).flat();
  if (paired.length) return paired;
  return [hand.reduce((bi, c, i) => (c.rank > hand[bi].rank ? i : bi), 0)];
}

// 1) 라운드당 이벤트 확률
const perRound: Record<string, Record<string, number>> = {};
for (const target of [...TYPES, 'none'] as const) {
  const got: Record<string, number> = { straight: 0, flush: 0, fullHouse: 0, wild: 0, hero: 0 };
  const rng = rngFrom(target.length * 7777 + 13);
  for (let i = 0; i < ROUNDS; i++) {
    const p = new CardPhase({ drawAssist: config.drawAssist }, rng);
    p.start();
    if (target !== 'none') {
      const keep = new Set(keepFor(p.hand, target));
      // 남기지 않는 카드를 한 장씩 교환 (방금 뽑은 카드도 다음 장 판정에 포함됨)
      for (let idx = 0; idx < p.hand.length; idx++) if (!keep.has(idx) && p.canExchange(idx)) p.exchangeCard(idx);
    }
    const ev = eventOf(p.confirm().rank);
    if (ev) got[ev]++;
  }
  perRound[target] = Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v / ROUNDS]));
}

// 2) 소환 시점 시뮬레이션
function simulate(target: T, seed: number) {
  const rng = rngFrom(seed);
  const pr = perRound[target];
  const res: number[] = [];
  for (let g = 0; g < GAMES; g++) {
    let pts = 0;
    let at = 99;
    for (let w = 1; w <= TOTAL; w++) {
      let roll = rng();
      let ev: string | null = null;
      for (const [k, v] of Object.entries(pr)) { if (roll < v) { ev = k; break; } roll -= v; }
      if (ev === 'hero') { at = w; break; }
      if (ev === target || ev === 'wild') pts += AMOUNT[ev];
      if (pts >= REQ) { at = w; break; }
      if (BOSS_WAVES.includes(w)) {
        const t = BOSS.types[Math.floor(rng() * BOSS.types.length)];
        if (t === target) pts += BOSS.amount;
        if (pts >= REQ) { at = w + 1; break; } // 보스 보상은 클리어 직후 → 다음 웨이브 정비 때 소환
      }
    }
    res.push(at);
  }
  res.sort((a, b) => a - b);
  const q = (p: number) => res[Math.floor(p * (res.length - 1))];
  const within = (w: number) => res.filter((x) => x <= w).length / res.length;
  return { p25: q(0.25), med: q(0.5), p75: q(0.75), S: within(S_LAST), A: within(A_LAST), ever: within(TOTAL) };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const wv = (x: number) => (x === 99 ? '못 함' : `W${x}`);
const L: string[] = [];
L.push('# 영웅 조각 밸런스 리포트');
L.push(`\n> \`npm run shards\`(scripts/hero-shard-report.ts)로 생성. 조건: 카드별 교환 1회 + 행운 드로우 outWeight ${config.drawAssist.outWeight}, 영웅 1명당 조각 ${REQ}개, 보스(W${BOSS_WAVES.join('/')}) 클리어 시 랜덤 종류 ${BOSS.amount}개.`);
L.push(`> 조각: ${Object.entries(AMOUNT).map(([k, v]) => `${LABEL[k]} ${v}개`).join(' · ')} (포카드·스트레이트 플러시 = 와일드)\n`);
L.push(`## 1. 한 라운드에 조각을 얻을 확률 (${ROUNDS.toLocaleString()}라운드)\n`);
L.push('| 노리는 족보 | 스트레이트 조각 | 플러시 조각 | 풀하우스 조각 | 와일드 | 로열(즉시 소환) |');
L.push('|---|---:|---:|---:|---:|---:|');
for (const t of [...TYPES, 'none'] as const) {
  const r = perRound[t];
  L.push(`| ${t === 'none' ? '교환 안 함' : LABEL[t]} | ${pct(r.straight)} | ${pct(r.flush)} | ${pct(r.fullHouse)} | ${pct(r.wild)} | ${pct(r.hero)} |`);
}
L.push(`\n## 2. 영웅 소환 시점 (한 족보만 노리는 봇 ${GAMES.toLocaleString()}판)\n`);
L.push(`| 노리는 조각 | 해당 영웅 | 빠른 25% | 중앙값 | 느린 25% | S급 (W${S_LAST}까지) | A급 이상 (W${A_LAST}까지) | 한 판 안에 소환 |`);
L.push('|---|---|---:|---:|---:|---:|---:|---:|');
TYPES.forEach((t, i) => {
  const s = simulate(t, 9000 + i);
  const names = heroes.filter((h) => h.shardType === t).map((h) => h.name + (h.unlock === 'meta' ? '*' : '')).join(', ');
  L.push(`| ${LABEL[t]} | ${names} | ${wv(s.p25)} | ${wv(s.med)} | ${wv(s.p75)} | ${pct(s.S)} | ${pct(s.A)} | ${pct(s.ever)} |`);
});
L.push('\n\\* 메타 해금 영웅');
const out = L.join('\n') + '\n';
mkdirSync(new URL('../design/', import.meta.url), { recursive: true });
writeFileSync(new URL('../design/hero-shard-report.md', import.meta.url), out);
console.log(out);
