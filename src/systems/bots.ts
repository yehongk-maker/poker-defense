/**
 * bots — GameLoop을 조작하는 봇 전략 (순수). 시뮬레이터(scripts/sim-core)와 1:1 대결의 상대 AI(Duel)가 공유한다.
 */
import { GameLoop } from './GameLoop.ts';
import { HandRank, evaluateHand, type Suit } from './PokerEvaluator.ts';

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

export function dominantSuit(g: GameLoop): Suit {
  const c: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 };
  for (const u of g.units) c[u.def.suit]++;
  return SUITS.reduce((a, b) => (c[b] > c[a] ? b : a));
}

export function spendAllOnUpgrades(g: GameLoop, suit: Suit): void {
  let cost = g.upgradeCost(suit);
  while (cost !== null && g.gold >= cost) {
    g.buyUpgrade(suit);
    cost = g.upgradeCost(suit);
  }
}

/** smart 카드 전략: 족보 구성 카드는 두고 나머지를 한 장씩 교환 (하이카드는 3장 이상 같은 수트면 플러시 드로우), 스트레이트 이상은 그대로 */
export function smartExchange(g: GameLoop): void {
  const p = g.cardPhase;
  if (p.state !== 'choosing' || p.exchangesRemaining <= 0) return;
  const hand = p.hand;
  const r = evaluateHand([...hand], () => 0);
  let keep = new Set(r.coreCards);
  if (r.rank === HandRank.HighCard) {
    const bySuit = new Map<Suit, number>();
    for (const c of hand) bySuit.set(c.suit, (bySuit.get(c.suit) ?? 0) + 1);
    const [suit, n] = [...bySuit.entries()].sort((a, b) => b[1] - a[1])[0];
    keep = n >= 3 ? new Set(hand.filter((c) => c.suit === suit)) : new Set([r.coreCards[0]]);
  }
  if (r.rank < HandRank.Straight) {
    hand.forEach((c, i) => { if (!keep.has(c) && p.canExchange(i)) p.exchangeCard(i); });
  }
}

/** 강도 조절 (Betting.BotPreset 중 전략에 쓰는 부분) */
export interface BotSkill { exchangeChance: number; upgradeSpend: number; hero: boolean; skill: boolean }

/** 강도 조절 카드 전략: smart와 같은 판단을 하되, 바꿀 카드를 exchangeChance 확률로만 바꾼다 */
export function presetExchange(g: GameLoop, k: BotSkill, rng: () => number): void {
  const p = g.cardPhase;
  if (p.state !== 'choosing' || p.exchangesRemaining <= 0) return;
  const hand = p.hand;
  const r = evaluateHand([...hand], () => 0);
  let keep = new Set(r.coreCards);
  if (r.rank === HandRank.HighCard) {
    const bySuit = new Map<Suit, number>();
    for (const c of hand) bySuit.set(c.suit, (bySuit.get(c.suit) ?? 0) + 1);
    const [suit, n] = [...bySuit.entries()].sort((a, b) => b[1] - a[1])[0];
    keep = n >= 3 ? new Set(hand.filter((c) => c.suit === suit)) : new Set([r.coreCards[0]]);
  }
  if (r.rank < HandRank.Straight) {
    hand.forEach((c, i) => { if (!keep.has(c) && p.canExchange(i) && rng() < k.exchangeChance) p.exchangeCard(i); });
  }
}

/** 강도 조절 정비: 골드의 upgradeSpend만큼만 업그레이드, hero가 꺼져 있으면 영웅을 소환하지 않는다 */
export function presetManage(g: GameLoop, k: BotSkill): void {
  if (g.units.length >= 23) for (const id of g.mergeable) { try { g.mergeUnits(id); } catch { /* 경합 무시 */ } }
  if (k.hero) { const hero = readyHero(g); if (hero) g.summonHero(hero); }
  const suit = dominantSuit(g);
  let budget = g.gold * k.upgradeSpend;
  let cost = g.upgradeCost(suit);
  while (cost !== null && cost <= budget && g.gold >= cost) {
    g.buyUpgrade(suit);
    budget -= cost;
    cost = g.upgradeCost(suit);
  }
}

export function presetCombatTick(g: GameLoop, k: BotSkill, dt: number): void {
  if (k.skill && g.heroSkillReady && g.battle && g.battle.aliveEnemies.length >= 3) g.useHeroSkill();
  g.tickCombat(dt);
}

/** smart 카드 페이즈: 교환 후 확정 */
export function smartCardPhase(g: GameLoop): void {
  smartExchange(g);
  g.confirmHand();
}

/** 소환 가능한 영웅 중 다수 수트 영웅 우선, 없으면 아무거나 (조각 종류가 맞는 영웅만 ready) */
export function readyHero(g: GameLoop): string | null {
  if (!g.canSummonHero || g.freeSlots.length === 0) return null; // 영웅도 슬롯이 필요
  const ready = g.heroProgress.filter((p) => p.ready);
  if (ready.length === 0) return null;
  const s = dominantSuit(g);
  return (ready.find((p) => p.hero.suit === s) ?? ready[0]).hero.id;
}

/** smart 정비: 슬롯이 찰 때만 합성, 조각이 모이면 다수 수트 영웅 소환, 골드는 다수 수트 업그레이드에 전부 */
export function smartManage(g: GameLoop): void {
  if (g.units.length >= 23) for (const id of g.mergeable) { try { g.mergeUnits(id); } catch { /* 경합 무시 */ } }
  const hero = readyHero(g);
  if (hero) g.summonHero(hero);
  spendAllOnUpgrades(g, dominantSuit(g));
}

/** smart 전투 1틱: 영웅 액티브는 쿨이 돌면 적이 3기 이상일 때 */
export function smartCombatTick(g: GameLoop, dt: number): void {
  if (g.heroSkillReady && g.battle && g.battle.aliveEnemies.length >= 3) g.useHeroSkill();
  g.tickCombat(dt);
}
