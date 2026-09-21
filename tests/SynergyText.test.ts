/** 도감 설명문: synergies.json의 모든 효과 타입이 사람이 읽는 문장으로 변환되는지 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { SynergiesTable, SynergyKind, SynergyGroupDef } from '../src/systems/SynergySystem.ts';
import { describeEffect, describeTier, groupCondition, groupTitle, thresholdLabel, countLabel } from '../src/ui/synergyText.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../src/data');
const table: SynergiesTable = JSON.parse(readFileSync(join(dataDir, 'synergies.json'), 'utf8'));
const groupsOf = (k: SynergyKind): Record<string, SynergyGroupDef> =>
  k === 'suit' ? table.suits : k === 'class' ? table.classes : k === 'race' ? table.races! : table.formation!;

describe('synergyText', () => {
  it('모든 그룹·구간·효과가 타입명 그대로 노출되지 않고 한글 문장으로 나온다', () => {
    for (const kind of ['suit', 'class', 'race', 'formation'] as SynergyKind[]) {
      for (const [key, def] of Object.entries(groupsOf(kind))) {
        expect(groupTitle(kind, key, def).length).toBeGreaterThan(0);
        expect(groupCondition(kind, key, def).length).toBeGreaterThan(0);
        def.thresholds.forEach((t, i) => {
          expect(thresholdLabel(kind, def, t).length).toBeGreaterThan(0);
          const text = describeTier(def.effects[i], kind, key);
          for (const eff of def.effects[i]) {
            const d = describeEffect(eff, kind, key);
            expect(d).not.toBe(eff.type); // default 분기(미번역) 금지
            expect(/[가-힣]/.test(d)).toBe(true);
          }
          expect(text.length).toBeGreaterThan(0);
        });
      }
    }
  });

  it('대표 문장', () => {
    expect(describeEffect({ type: 'attack_pct', pct: 25, scope: 'suit' }, 'suit', 'S')).toBe('♠ 유닛 공격력 +25%');
    expect(describeEffect({ type: 'enemy_speed_pct', pct: -8, scope: 'battle' }, 'race', 'monster')).toBe('적 이동 속도 -8%');
    expect(describeEffect({ type: 'range_plus', amount: 1, onlyEdge: true, scope: 'race' }, 'race', 'human')).toBe('휴먼 유닛 사거리 +1 (가장자리 칸만)');
    expect(describeEffect({ type: 'per_line_attack_pct', pct: 20, scope: 'formation' }, 'formation', 'bingo')).toContain('줄 구성원 공격력 +20%');
    expect(countLabel('class', table.classes.raider, 2)).toBe('2종');
    expect(countLabel('formation', table.formation!.bingo, 1)).toBe('1줄');
    expect(thresholdLabel('formation', table.formation!.corners, 1)).toBe('완성');
    expect(groupCondition('formation', 'mixed', table.formation!.mixed)).toContain('근접(사거리 2) 3기 이상');
  });
});
