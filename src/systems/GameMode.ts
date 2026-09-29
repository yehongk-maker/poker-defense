/**
 * GameMode — 모드별 규칙 한 장 (docs/mode-design.md §2.1). 순수.
 *  캠페인: 혼자 40웨이브, 광고·메타 적용, 상대·판돈 없음
 *  랭크 대전: 20웨이브 레이스 + 판돈, 메타 미적용, 영웅 전부 개방, 배속 고정, 교환권 매치당 3회
 *  친구 대전: 랭크와 같되 방장 규칙(DuelRules)으로 바꿀 수 있고 랭크 미반영
 * 상대가 사람/고스트/봇인지는 모드가 아니라 opponent 값으로만 구분한다 (UI 비노출).
 */
import type { GameData, HeroGrade } from './GameLoop.ts';
import type { BattleConfig, EnemyTypeDef, WaveDef } from './Battle.ts';

export type ModeId = 'campaign' | 'ranked_duel' | 'friend_duel';
export type OpponentKind = 'none' | 'ai' | 'ghost' | 'live';

/** 대전 규칙 (친구 대전 방장 옵션, 서버 normalize_rules 와 같은 키) */
export interface DuelRules {
  waves: 20 | 40;
  betting: boolean;
  allHeroes: boolean;
  sharedHand: boolean;
  speed: 1 | 2;
  applyMeta: boolean;
  /** 교환권 매치당 상한: 0 / 3 / -1(무제한) */
  tickets: 0 | 3 | -1;
}

export const RANKED_RULES: DuelRules = { waves: 20, betting: true, allHeroes: true, sharedHand: false, speed: 1, applyMeta: false, tickets: 3 };

export interface GameMode {
  id: ModeId;
  /** 화면에 쓰는 모드 이름 */
  label: string;
  waves: 20 | 40;
  opponent: OpponentKind;
  betting: boolean;
  /** 보상형 광고 자리(교환 +1·부활·보상 2배) 노출 — 캠페인 전용 */
  ads: boolean;
  applyMeta: boolean;
  allHeroes: boolean;
  /** 배속 상한 (1이면 배속 버튼 숨김) */
  maxSpeed: 1 | 2 | 3;
  /** 교환권 판당 상한. -1 = 무제한 */
  tickets: number;
  /** 배경 (DESIGN §2): 솔로 = 블루, 듀얼 = 퍼플 */
  world: 'solo' | 'duel';
  rewards: 'campaign' | 'ranked' | 'friendly';
  /** 이어하기 저장 (캠페인만) */
  resumable: boolean;
  /** 서버가 준 매치 시드 (없으면 무작위) */
  seed?: string;
  sharedHand: boolean;
  /** 친구 대전에서 기본 규칙과 달라졌는가 (결과 캡션용) */
  custom: boolean;
}

export const CAMPAIGN: GameMode = {
  id: 'campaign', label: '싱글 캠페인', waves: 40, opponent: 'none', betting: false, ads: true, applyMeta: true,
  allHeroes: false, maxSpeed: 3, tickets: -1, world: 'solo', rewards: 'campaign', resumable: true, sharedHand: false, custom: false,
};

export function rankedDuel(opponent: Exclude<OpponentKind, 'none'>, seed?: string): GameMode {
  return { ...fromRules(RANKED_RULES), id: 'ranked_duel', label: '랭크 대전', opponent, rewards: 'ranked', seed, custom: false };
}

export function friendDuel(rules: DuelRules, seed?: string): GameMode {
  const custom = (Object.keys(RANKED_RULES) as (keyof DuelRules)[]).some((k) => rules[k] !== RANKED_RULES[k]);
  return { ...fromRules(rules), id: 'friend_duel', label: '친구 대전', opponent: 'live', rewards: 'friendly', seed, custom };
}

function fromRules(r: DuelRules): GameMode {
  return {
    id: 'ranked_duel', label: '', waves: r.waves, opponent: 'ai', betting: r.betting, ads: false, applyMeta: r.applyMeta,
    allHeroes: r.allHeroes, maxSpeed: r.speed, tickets: r.tickets, world: 'duel', rewards: 'ranked', resumable: false,
    sharedHand: r.sharedHand, custom: false,
  };
}

export const isDuel = (m: GameMode): boolean => m.opponent !== 'none';

/** 웨이브 데이터 한 벌 (waves.json 또는 duel-waves.json) */
export interface WaveSet {
  waves: WaveDef[];
  enemyTypes: Record<string, EnemyTypeDef>;
  battleConfig: BattleConfig;
}

/** duel.json match 섹션 중 데이터 조립에 쓰는 부분 */
export interface DuelMatchConfig {
  waves: number;
  hero: { grades: Record<HeroGrade, { minRemainingWaves: number; mult: number }>; bossShardAmount: number };
  ticketsPerMatch: number;
  /** 전투 시뮬 고정 간격(초) — 대전 모드는 항상 고정 step */
  simStep: number;
}

/** 메타 업그레이드가 한 판에 주는 효과 (MetaProgress.effects) */
export interface MetaEffects {
  exchangeLimit: number;
  timerSeconds: number;
  startGoldBonus: number;
  unlockedHeroes: string[];
}

export interface ModeSources {
  /** 캠페인 웨이브(40)가 들어 있는 기본 데이터 */
  base: GameData;
  /** 대전 20웨이브 곡선 */
  duelWaves: WaveSet;
  duelMatch: DuelMatchConfig;
}

/**
 * 모드 규칙을 GameData로 조립한다 (원본 불변).
 * @param meta 플레이어의 메타 효과. 상대(봇)나 메타 미적용 모드는 null
 */
export function buildGameData(src: ModeSources, mode: GameMode, meta: MetaEffects | null): GameData {
  const b = src.base;
  const duelCurve = mode.waves === 20;
  const ws: WaveSet = duelCurve ? src.duelWaves : { waves: b.waves, enemyTypes: b.enemyTypes, battleConfig: b.battleConfig };
  const useMeta = mode.applyMeta && meta !== null;
  const hero = duelCurve
    ? { ...b.config.hero, grades: src.duelMatch.hero.grades, bossShards: b.config.hero.bossShards ? { ...b.config.hero.bossShards, amount: src.duelMatch.hero.bossShardAmount } : undefined }
    : b.config.hero;
  return {
    ...b,
    waves: ws.waves,
    enemyTypes: ws.enemyTypes,
    battleConfig: ws.battleConfig,
    config: {
      ...b.config,
      totalWaves: ws.waves.length,
      startGold: b.config.startGold + (useMeta ? meta.startGoldBonus : 0),
      ticketsPerRun: mode.tickets < 0 ? undefined : mode.tickets,
      simStep: isDuel(mode) ? src.duelMatch.simStep : undefined,
      hero,
    },
    cardPhase: useMeta ? { exchangeLimit: meta.exchangeLimit, timerSeconds: meta.timerSeconds } : {},
    unlockedHeroes: mode.allHeroes ? b.heroes.map((h) => h.id) : meta ? meta.unlockedHeroes : undefined,
  };
}
