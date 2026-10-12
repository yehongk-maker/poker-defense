/**
 * 효과음 — Web Audio로 그 자리에서 합성한다 (파일·외부 에셋 없음, 오리지널).
 * 브라우저 정책상 첫 터치 전에는 소리를 낼 수 없으므로, 첫 pointerdown에서 AudioContext를 깨운다.
 * 언제 낼지(간격·묶음 상한·켜짐)는 systems/SoundGate가 정한다.
 */
import { SoundGate, type SoundRule } from '../systems/SoundGate.ts';
import { getSettings } from '../settings.ts';

export type SfxName =
  | 'tap' | 'deal' | 'flip' | 'summon' | 'move' | 'sell' | 'merge' | 'upgrade'
  | 'hit_melee' | 'hit_ranged' | 'hit_magic' | 'kill' | 'boss_kill' | 'leak' | 'skill'
  | 'clear' | 'coin' | 'tick' | 'warn' | 'hero'
  | 'check' | 'raise' | 'call' | 'fold' | 'pot_win' | 'pot_lose'
  | 'victory' | 'defeat' | 'hand0' | 'hand1' | 'hand2' | 'hand3' | 'hand4' | 'hand5';

const RULES: Record<string, SoundRule> = {
  hit_melee: { minGap: 0.06, group: 'hits' },
  hit_ranged: { minGap: 0.05, group: 'hits' },
  hit_magic: { minGap: 0.07, group: 'hits' },
  kill: { minGap: 0.09, group: 'kills' },
  coin: { minGap: 0.08 },
  deal: { minGap: 0.05 },
  flip: { minGap: 0.05 },
  tick: { minGap: 0.5 },
  tap: { minGap: 0.04 },
};
const PER_SECOND = { hits: 9, kills: 6 };

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
const gate = new SoundGate(RULES, PER_SECOND);
/** 개발용: 낸 소리 수 (브라우저 검증) */
export const sfxStats = { played: 0, blocked: 0, byName: {} as Record<string, number> };

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = n.getChannelData(0);
  let seed = 22222;
  for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
  noiseBuf = n;
  return ctx;
}

/** 첫 사용자 입력에서 오디오를 깨운다 (main에서 한 번 부른다) */
export function unlockAudioOnFirstInput(target: EventTarget = window): void {
  const wake = () => { const c = ensure(); if (c && c.state === 'suspended') void c.resume(); };
  target.addEventListener('pointerdown', wake, { passive: true });
  target.addEventListener('keydown', wake);
}

interface ToneOpt { type?: OscillatorType; gain?: number; attack?: number; slideTo?: number; delay?: number }
function tone(freq: number, dur: number, o: ToneOpt = {}): void {
  const c = ctx!, t0 = c.currentTime + (o.delay ?? 0);
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), t0 + dur);
  const peak = o.gain ?? 0.25, a = o.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

interface NoiseOpt { gain?: number; filter?: BiquadFilterType; freq?: number; sweepTo?: number; delay?: number; q?: number }
function noise(dur: number, o: NoiseOpt = {}): void {
  const c = ctx!, t0 = c.currentTime + (o.delay ?? 0);
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = noiseBuf;
  f.type = o.filter ?? 'bandpass';
  f.frequency.setValueAtTime(o.freq ?? 2000, t0);
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t0 + dur);
  f.Q.value = o.q ?? 1;
  g.gain.setValueAtTime(o.gain ?? 0.2, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.02);
}

const NOTE = (semi: number) => 523.25 * Math.pow(2, semi / 12); // C5 기준
/** 족보 연출음: 등급이 오를수록 음이 많고 높다 (C 장조 아르페지오) */
function handChord(tier: number): void {
  const steps = [0, 4, 7, 12, 16, 19, 24];
  const n = Math.min(steps.length, 2 + tier);
  for (let i = 0; i < n; i++) tone(NOTE(steps[i]), 0.22 + tier * 0.03, { type: 'triangle', gain: 0.16 + tier * 0.015, delay: i * (0.07 - tier * 0.006) });
  if (tier >= 3) for (let i = 0; i < 4; i++) tone(NOTE(24 + (i % 2) * 7), 0.12, { type: 'sine', gain: 0.06, delay: 0.25 + i * 0.05 });
  if (tier >= 5) noise(0.5, { filter: 'highpass', freq: 5000, gain: 0.05, delay: 0.1 });
}

const RECIPES: Record<SfxName, () => void> = {
  tap: () => tone(1250, 0.05, { gain: 0.12 }),
  deal: () => noise(0.07, { freq: 2600, q: 0.8, gain: 0.14, sweepTo: 4200 }),
  flip: () => { noise(0.05, { freq: 3200, gain: 0.12 }); tone(880, 0.05, { gain: 0.06, type: 'triangle' }); },
  summon: () => { tone(320, 0.12, { slideTo: 720, gain: 0.2 }); tone(640, 0.14, { slideTo: 1100, gain: 0.08, delay: 0.04, type: 'triangle' }); },
  move: () => tone(520, 0.07, { slideTo: 660, gain: 0.12, type: 'triangle' }),
  sell: () => { tone(1500, 0.06, { gain: 0.1 }); tone(1100, 0.08, { gain: 0.1, delay: 0.05 }); },
  merge: () => { for (let i = 0; i < 3; i++) tone(NOTE(i * 4), 0.1, { gain: 0.14, delay: i * 0.05, type: 'triangle' }); },
  upgrade: () => { tone(NOTE(7), 0.08, { gain: 0.14, type: 'square' }); tone(NOTE(12), 0.12, { gain: 0.12, delay: 0.06, type: 'square' }); },
  hit_melee: () => noise(0.035, { filter: 'lowpass', freq: 1400, gain: 0.13 }),
  hit_ranged: () => tone(1500, 0.035, { slideTo: 900, gain: 0.07, type: 'triangle' }),
  hit_magic: () => tone(700, 0.06, { slideTo: 1500, gain: 0.05, type: 'square' }),
  kill: () => { tone(560, 0.09, { slideTo: 240, gain: 0.13 }); noise(0.06, { freq: 1800, gain: 0.07 }); },
  boss_kill: () => { tone(140, 0.5, { slideTo: 40, gain: 0.35 }); noise(0.45, { filter: 'lowpass', freq: 900, sweepTo: 120, gain: 0.25 }); handChord(4); },
  leak: () => { tone(240, 0.28, { slideTo: 110, gain: 0.25, type: 'triangle' }); noise(0.12, { filter: 'lowpass', freq: 500, gain: 0.12 }); },
  skill: () => { noise(0.35, { freq: 300, sweepTo: 4000, q: 2, gain: 0.18 }); tone(NOTE(12), 0.3, { gain: 0.1, delay: 0.12, type: 'sawtooth' }); },
  clear: () => { [7, 12, 16].forEach((s, i) => tone(NOTE(s), 0.16, { type: 'triangle', gain: 0.16, delay: i * 0.08 })); },
  coin: () => { tone(1800, 0.06, { gain: 0.09 }); tone(2400, 0.09, { gain: 0.08, delay: 0.05 }); },
  tick: () => tone(1000, 0.04, { gain: 0.1, type: 'square' }),
  warn: () => { tone(660, 0.14, { gain: 0.14, type: 'square' }); tone(520, 0.18, { gain: 0.14, type: 'square', delay: 0.16 }); },
  hero: () => { handChord(5); tone(130, 0.6, { gain: 0.2, type: 'sawtooth', slideTo: 260 }); },
  check: () => { tone(190, 0.06, { gain: 0.2, type: 'triangle' }); tone(170, 0.06, { gain: 0.16, type: 'triangle', delay: 0.09 }); },
  raise: () => { for (let i = 0; i < 4; i++) noise(0.03, { freq: 3500 + i * 300, gain: 0.14, delay: i * 0.045, q: 3 }); tone(NOTE(7), 0.15, { gain: 0.1, delay: 0.18 }); },
  call: () => { for (let i = 0; i < 2; i++) noise(0.03, { freq: 3300, gain: 0.13, delay: i * 0.05, q: 3 }); },
  fold: () => tone(420, 0.2, { slideTo: 200, gain: 0.14, type: 'triangle' }),
  pot_win: () => { for (let i = 0; i < 5; i++) tone(1600 + i * 180, 0.07, { gain: 0.08, delay: i * 0.05 }); },
  pot_lose: () => tone(330, 0.22, { slideTo: 220, gain: 0.12, type: 'triangle' }),
  victory: () => { [0, 4, 7, 12, 7, 12, 16].forEach((s, i) => tone(NOTE(s), i === 6 ? 0.6 : 0.16, { type: 'square', gain: 0.1, delay: i * 0.12 })); },
  defeat: () => { [7, 3, 0, -5].forEach((s, i) => tone(NOTE(s), i === 3 ? 0.6 : 0.25, { type: 'triangle', gain: 0.15, delay: i * 0.22 })); },
  hand0: () => handChord(0), hand1: () => handChord(1), hand2: () => handChord(2),
  hand3: () => handChord(3), hand4: () => handChord(4), hand5: () => handChord(5),
};

/** 효과음 내기. 꺼져 있거나 너무 잦으면 조용히 무시한다 */
export function sfx(name: SfxName): void {
  const s = getSettings();
  const c = ctx; // 첫 입력 전에는 ctx가 없다 — 소리 없이 지나간다
  if (!c || c.state !== 'running') return;
  if (!gate.allow(name, c.currentTime, s.sound && s.volume > 0)) { sfxStats.blocked++; return; }
  master!.gain.setValueAtTime(s.volume, c.currentTime);
  try {
    RECIPES[name]();
    sfxStats.played++;
    sfxStats.byName[name] = (sfxStats.byName[name] ?? 0) + 1;
  } catch { /* 오디오 장치 문제 — 게임은 계속 */ }
}

/** 족보 등급(HandFx.RANK_TIER 0~5) → 연출음 */
export function handSfx(tier: number): void {
  sfx(`hand${Math.max(0, Math.min(5, Math.round(tier)))}` as SfxName);
}
