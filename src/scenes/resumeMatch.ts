/**
 * 저장된 대전을 이어 할 준비 (로비·친구 방이 부른다): 서버에서 매치가 아직 진행 중인지 확인 → 내 판 복원 → 상대 준비.
 * 결과는 GameScene에 그대로 넘길 init. 이어 할 수 없으면 이유를 돌려주고 저장은 호출 측이 지운다.
 */
import { loadDuelConfig, loadModeSources } from '../data/index.ts';
import { buildGameData } from '../systems/GameMode.ts';
import { AIOpponent } from '../systems/Opponent.ts';
import { resumeLoop, type SavedMatch } from '../systems/MatchResume.ts';
import { getMeta } from '../meta.ts';
import { forfeitMatch, getMatch, leaveRoom, SupabaseTransport } from '../net/api.ts';
import { getSession } from '../net/session.ts';
import { LiveOpponent } from '../net/Live.ts';
import type { GameSceneInit } from './GameScene.ts';

export type ResumeOutcome =
  | { ok: true; init: GameSceneInit }
  | { ok: false; reason: 'finished' | 'broken' | 'offline' };

export async function prepareResume(saved: SavedMatch): Promise<ResumeOutcome> {
  const src = loadModeSources();
  const mode = saved.mode;
  const data = buildGameData(src, mode, getMeta().effects);
  let resumed;
  try {
    resumed = resumeLoop(data, saved);
  } catch {
    return { ok: false, reason: 'broken' };
  }
  const oppData = buildGameData(src, mode, null);

  if (saved.kind === 'local') {
    const o = saved.opponent;
    const preset = loadDuelConfig().ai.presets?.find((p) => p.id === o?.presetId);
    const opponent = new AIOpponent(oppData, saved.identity, Math.random, { script: o?.script ?? undefined, preset, restore: o?.snapshot ?? undefined });
    return { ok: true, init: { mode, opponentSource: opponent, playerId: saved.playerId, handKey: saved.handKey, saved, resumed, opponentSave: { script: o?.script ?? null, presetId: o?.presetId ?? null } } };
  }

  // 서버 매치: 아직 진행 중이어야 한다 (자리를 비운 사이 기권패 처리됐을 수 있다)
  if (!saved.matchId || !saved.me) return { ok: false, reason: 'broken' };
  try {
    const me = await getSession();
    if (me.id !== saved.me) return { ok: false, reason: 'broken' };
    const m = await getMatch(saved.matchId, me.id);
    if (m.status !== 'live') return { ok: false, reason: 'finished' };
  } catch {
    return { ok: false, reason: 'offline' };
  }

  if (saved.kind === 'online') {
    const o = saved.opponent;
    const preset = loadDuelConfig().ai.presets?.find((p) => p.id === o?.presetId);
    const opponent = new AIOpponent(oppData, saved.identity, Math.random, { script: o?.script ?? undefined, preset, restore: o?.snapshot ?? undefined });
    return { ok: true, init: { mode, opponentSource: opponent, playerId: saved.playerId, handKey: saved.handKey, online: { matchId: saved.matchId, me: saved.me }, saved, resumed, opponentSave: { script: o?.script ?? null, presetId: o?.presetId ?? null } } };
  }

  try {
    const transport = new SupabaseTransport(saved.matchId, saved.me);
    await transport.connect();
    const opponent = new LiveOpponent(saved.identity, transport, oppData);
    return { ok: true, init: { mode, opponentSource: opponent, playerId: saved.playerId, handKey: saved.handKey, live: { matchId: saved.matchId, roomCode: saved.roomCode, me: saved.me, opponentId: saved.opponentId, transport }, saved, resumed } };
  } catch {
    return { ok: false, reason: 'offline' };
  }
}

/** 저장된 대전을 포기한다: 랭크는 기권패, 친구 대전은 방을 나간다 */
export async function abandonSaved(saved: SavedMatch): Promise<void> {
  if (saved.kind === 'local' || !saved.matchId) return;
  await getSession();
  if (saved.mode.id === 'ranked_duel') await forfeitMatch(saved.matchId).catch(() => undefined);
  else if (saved.roomCode) await leaveRoom(saved.roomCode).catch(() => undefined);
}
