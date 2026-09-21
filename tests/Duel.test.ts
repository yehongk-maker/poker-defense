/** 1:1 대결: 상대 AI 진행 + 승패 판정 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OpponentAI, resolveDuel, raceStatus, reachScore, sideOf } from '../src/systems/Duel.ts';
import { GameLoop, type GameData } from '../src/systems/GameLoop.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
const load = (f: string) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
const u = load('units.json'), w = load('waves.json');
const data = (): GameData => ({ units: u.units, hands: load('hands.json'), synergies: load('synergies.json'), heroes: load('heroes.json').heroes, waves: w.waves, enemyTypes: w.enemyTypes, battleConfig: w.config, config: load('config.json') });
function rng(seed: number) { let s = seed; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; }; }

describe('OpponentAI', () => {
  it('실시간 tick: 생각 시간 뒤 카드 확정 → 정비 → 전투로 진행한다', () => {
    const ai = new OpponentAI(data(), rng(3), { thinkSec: [1, 1], manageSec: [0.5, 0.5] });
    expect(ai.loop.phase).toBe('card');
    for (let t = 0; t < 0.9; t += 0.1) ai.tick(0.1);
    expect(ai.loop.phase).toBe('card'); // 아직 생각 중
    for (let t = 0; t < 0.3; t += 0.1) ai.tick(0.1);
    expect(ai.loop.phase).toBe('manage');
    expect(ai.lastHandRank).not.toBeNull();
    for (let t = 0; t < 0.6; t += 0.1) ai.tick(0.1);
    expect(ai.loop.phase).toBe('combat');
    for (let t = 0; t < 60 && ai.loop.phase === 'combat'; t += 0.1) ai.tick(0.1);
    expect(['card', 'defeat']).toContain(ai.loop.phase); // 웨이브 1 종료
  });

  it('타이머 만료 시 자동 확정도 처리한다 (생각 시간이 타이머보다 길 때)', () => {
    const ai = new OpponentAI(data(), rng(4), { thinkSec: [99, 99], manageSec: [0.1, 0.1] });
    for (let t = 0; t < 31; t += 0.5) ai.tick(0.5);
    expect(ai.loop.phase).not.toBe('card');
  });

  it('fastForward: 끝까지 진행해 승리/패배로 끝난다', () => {
    const ai = new OpponentAI(data(), rng(5));
    ai.fastForward();
    expect(ai.finished).toBe(true);
    expect(ai.loop.wave).toBeGreaterThanOrEqual(5);
  });
});

describe('resolveDuel', () => {
  const side = (phase: string, wave: number, life = 5, gold = 100) => ({ phase, wave, life, gold });
  it('도달 웨이브가 높은 쪽이 승리, 승리(40클리어)는 41점', () => {
    expect(reachScore(side('victory', 40), 40)).toBe(41);
    expect(reachScore(side('defeat', 22), 40)).toBe(22);
    expect(resolveDuel(side('defeat', 25), side('defeat', 22), 40).winner).toBe('player');
    expect(resolveDuel(side('defeat', 20), side('victory', 40), 40).winner).toBe('opponent');
    expect(resolveDuel(side('defeat', 20), side('combat', 25), 40)).toMatchObject({ winner: 'opponent', reason: 'wave' });
  });
  it('같은 웨이브면 라이프 → 골드 → 무승부', () => {
    expect(resolveDuel(side('defeat', 20, 0, 50), side('defeat', 20, 3, 10), 40)).toMatchObject({ winner: 'opponent', reason: 'life' });
    expect(resolveDuel(side('victory', 40, 5, 900), side('victory', 40, 5, 300), 40)).toMatchObject({ winner: 'player', reason: 'gold' });
    expect(resolveDuel(side('victory', 40, 5, 300), side('victory', 40, 5, 300), 40).winner).toBe('draw');
  });
  it('raceStatus: 40을 먼저 깬 쪽 즉시 승리, 한쪽 탈락 후 앞서면 승리, 아니면 null', () => {
    expect(raceStatus(side('victory', 40), side('combat', 33), 40)).toMatchObject({ winner: 'player', reason: 'first_clear' });
    expect(raceStatus(side('card', 38), side('victory', 40), 40)).toMatchObject({ winner: 'opponent', reason: 'first_clear' });
    expect(raceStatus(side('victory', 40, 3), side('victory', 40, 5), 40)).toMatchObject({ winner: 'opponent', reason: 'life' });
    expect(raceStatus(side('combat', 12), side('combat', 15), 40)).toBeNull(); // 진행 중
    expect(raceStatus(side('card', 12), side('defeat', 12), 40)).toBeNull(); // 상대 탈락했지만 아직 같은 라운드
    expect(raceStatus(side('card', 13), side('defeat', 12), 40)).toMatchObject({ winner: 'player', reason: 'opponent_out' });
    expect(raceStatus(side('defeat', 10), side('combat', 11), 40)).toMatchObject({ winner: 'opponent', reason: 'opponent_out' });
    expect(raceStatus(side('defeat', 10), side('combat', 10), 40)).toBeNull(); // 내가 탈락, 상대는 같은 라운드 진행 중 → 미정
    expect(raceStatus(side('defeat', 10, 0, 50), side('defeat', 10, 0, 40), 40)).toMatchObject({ winner: 'player', reason: 'gold' });
  });

  it('sideOf: GameLoop 상태를 판정 입력으로', () => {
    const g = new GameLoop(data(), rng(1));
    expect(sideOf(g)).toEqual({ phase: 'card', wave: 1, life: 10, gold: 100 });
  });
});
