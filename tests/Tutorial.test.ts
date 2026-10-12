/** 첫 판 가이드 진행 (Phase 4) */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Tutorial, type TutorialStep } from '../src/systems/Tutorial.ts';

const data = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/data/tutorial.json'), 'utf8')) as { campaign: TutorialStep[]; duel: TutorialStep[] };
const at = (phase: string, wave = 1) => ({ phase, wave });

describe('캠페인 가이드', () => {
  it('정석대로 따라가면 모든 단계를 순서대로 본다', () => {
    const t = new Tutorial(data.campaign);
    const seen: string[] = [];
    const see = (st: { phase: string; wave: number }) => { const s = t.current(st); if (s) seen.push(s.id); return s; };
    see(at('card')); t.on('exchange', at('card'));
    see(at('card')); t.on('confirm', at('card'));
    see(at('manage')); t.on('move', at('manage'));
    see(at('manage')); t.on('combat', at('manage'));
    see(at('combat')); t.on('tap', at('combat'));
    expect(see(at('combat'))).toBeNull(); // 1라운드 나머지는 조용히
    see(at('card', 2)); t.on('tap', at('card', 2));
    expect(seen).toEqual(['hand', 'confirm', 'place', 'start', 'combat', 'swipe']);
    expect(t.done).toBe(true);
  });

  it('교환 없이 바로 확정해 버리면 카드 단계들을 건너뛴다 (강제하지 않음)', () => {
    const t = new Tutorial(data.campaign);
    expect(t.current(at('card'))?.id).toBe('hand');
    expect(t.current(at('manage'))?.id).toBe('place');
  });

  it('기다리는 사건이 아니면 넘어가지 않는다', () => {
    const t = new Tutorial(data.campaign);
    expect(t.on('tap', at('card'))).toBe(false);
    expect(t.on('move', at('card'))).toBe(false);
    expect(t.current(at('card'))?.id).toBe('hand');
    expect(t.on('skip', at('card'))).toBe(true); // "그대로 둘래요"
    expect(t.current(at('card'))?.id).toBe('confirm');
  });

  it('이어하기로 3라운드부터 시작하면 볼 것이 없다', () => {
    const t = new Tutorial(data.campaign);
    expect(t.current(at('card', 3))).toBeNull();
    expect(t.done).toBe(true);
  });

  it('전부 건너뛰기', () => {
    const t = new Tutorial(data.campaign);
    t.skipAll();
    expect(t.current(at('card'))).toBeNull();
    expect(t.done && t.skipped).toBe(true);
  });

  it('멈춤: 카드 단계는 타이머를 멈추고, 배치 단계는 멈추지 않는다', () => {
    const t = new Tutorial(data.campaign);
    expect(t.pausing(at('card'))).toBe(true);
    t.on('skip', at('card')); t.on('confirm', at('card'));
    expect(t.pausing(at('manage'))).toBe(false);
  });

  it('승리·패배 화면에서는 아무것도 보이지 않는다', () => {
    expect(new Tutorial(data.campaign).current(at('defeat'))).toBeNull();
  });
});

describe('대전 가이드', () => {
  it('판돈 없는 방은 판돈 단계를 빼고, 첫 웨이브가 몇이든 그 웨이브에서 보인다', () => {
    const no = new Tutorial(data.duel, { betting: false });
    expect(no.total).toBe(1);
    const t = new Tutorial(data.duel, { betting: true });
    expect(t.total).toBe(2);
    expect(t.current(at('card', 4))?.id).toBe('race'); // 이어하기로 4라운드에 처음 봄
    t.on('tap', at('card', 4));
    expect(t.current(at('card', 4))?.id).toBe('bet');
    t.on('tap', at('card', 4));
    expect(t.done).toBe(true);
  });
});

describe('문구 데이터', () => {
  it('모든 단계에 제목·본문·강조 위치가 있고, 탭으로 넘기지 않는 단계는 사건 이름이 맞다', () => {
    for (const s of [...data.campaign, ...data.duel]) {
      expect(s.title.length, s.id).toBeGreaterThan(0);
      expect(s.text.length, s.id).toBeGreaterThan(0);
      expect(s.anchor.length).toBeGreaterThan(0);
      expect(['exchange', 'confirm', 'move', 'combat', 'tap']).toContain(s.until);
      expect(['card', 'manage', 'combat']).toContain(s.phase);
    }
  });
});
