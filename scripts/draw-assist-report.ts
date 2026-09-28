// 행운 드로우 리포트 — outWeight별 드로우 성공률 (GDD §3.1.1 표). 실행: npm run draw  (→ design/draw-assist-report.md)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CardPhase } from '../src/systems/CardPhase.ts';
import { createDeck, evaluateHand, parseHand, HandRank, type Card } from '../src/systems/PokerEvaluator.ts';
import { keepFor } from './hero-shard-report.ts';

const config = JSON.parse(readFileSync(new URL('../src/data/config.json', import.meta.url), 'utf8'));
const N = Number(process.env.REPORT_N ?? 20_000);
const WEIGHTS = [0, 1, 2];
function rngFrom(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; }; }

/** 고정 손패에서 exchangeIdx를 교환했을 때 목표 족보 이상이 될 확률 */
function fixed(codes: string, exchangeIdx: number[], target: HandRank, w: number, seed: number): number {
  const r = rngFrom(seed);
  let ok = 0;
  for (let i = 0; i < N; i++) {
    const p = new CardPhase({ drawAssist: { outWeight: w } }, r);
    p.start();
    const hand = parseHand(codes);
    (p as unknown as { handCards: Card[] }).handCards = hand;
    const d = p as unknown as { deck: Card[] };
    d.deck = createDeck().filter((c) => !hand.some((h) => h.rank === c.rank && h.suit === c.suit));
    for (let j = d.deck.length - 1; j > 0; j--) { const k = Math.floor(r() * (j + 1)); [d.deck[j], d.deck[k]] = [d.deck[k], d.deck[j]]; }
    for (const idx of exchangeIdx) p.exchangeCard(idx);
    if (evaluateHand([...p.hand], () => 0).rank >= target) ok++;
  }
  return ok / N;
}

/** 판 전체: 매 라운드 봇이 가장 유망한 조각 족보를 노려 교환 → 트리플 이상 비율 */
function whole(w: number, seed: number): number {
  const r = rngFrom(seed);
  let ok = 0;
  for (let i = 0; i < N; i++) {
    const p = new CardPhase({ drawAssist: { outWeight: w } }, r);
    p.start();
    const rank = evaluateHand([...p.hand], () => 0).rank;
    const target = rank === HandRank.OnePair || rank === HandRank.TwoPair || rank === HandRank.ThreeOfAKind ? 'fullHouse'
      : keepFor(p.hand, 'flush').length >= 3 ? 'flush' : 'straight';
    const keep = new Set(keepFor(p.hand, target));
    for (let idx = 0; idx < p.hand.length; idx++) if (!keep.has(idx) && p.canExchange(idx)) p.exchangeCard(idx);
    if (p.confirm().rank >= HandRank.ThreeOfAKind) ok++;
  }
  return ok / N;
}

const CASES: { name: string; goal: string; run: (w: number) => number }[] = [
  { name: '플러시 드로우 1장 교환', goal: '플러시', run: (w) => fixed('AH KH 7H 4H 2C', [4], HandRank.Flush, w, 101) },
  { name: '양방 스트레이트 1장 교환', goal: '스트레이트', run: (w) => fixed('9S 8H 7D 6C KS', [4], HandRank.Straight, w, 102) },
  { name: '투페어 1장 교환', goal: '풀하우스', run: (w) => fixed('QS QH 5D 5C 2S', [4], HandRank.FullHouse, w, 103) },
  { name: '트리플 유지 2장 교환', goal: '풀하우스+', run: (w) => fixed('QS QH QD 5C 2S', [3, 4], HandRank.FullHouse, w, 104) },
  { name: '원페어 유지 3장 교환', goal: '투페어+', run: (w) => fixed('QS QH 9D 5C 2S', [2, 3, 4], HandRank.TwoPair, w, 105) },
  { name: '판 전체 (봇이 매번 교환)', goal: '트리플 이상', run: (w) => whole(w, 106) },
];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const L: string[] = ['# 행운 드로우 리포트', `\n> \`npm run draw\`(scripts/draw-assist-report.ts)로 생성. 각 ${N.toLocaleString()}회. 현재 config outWeight = ${config.drawAssist.outWeight}.\n`];
L.push(`| 상황 | 목표 | ${WEIGHTS.map((w) => (w === 0 ? '보정 없음' : `outWeight ${w}`)).join(' | ')} |`);
L.push(`|---|---|${WEIGHTS.map(() => '---:').join('|')}|`);
for (const c of CASES) L.push(`| ${c.name} | ${c.goal} | ${WEIGHTS.map((w) => pct(c.run(w))).join(' | ')} |`);
const out = L.join('\n') + '\n';
mkdirSync(new URL('../design/', import.meta.url), { recursive: true });
writeFileSync(new URL('../design/draw-assist-report.md', import.meta.url), out);
console.log(out);
