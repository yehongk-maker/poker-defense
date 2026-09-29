/**
 * 헤드리스 밸런스 시뮬레이터 CLI.
 * 실행: npm run sim -- [--games 300] [--bot naive|smart|highcard|all] [--seed 1] [--mode campaign|duel] [--csv]
 * 전략 설명과 구현은 scripts/sim-core.ts.
 */
import { run, report, type Bot, type Mode } from './sim-core.ts';

// ── CLI ──
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const games = Number(opt('games', '300'));
const seed = Number(opt('seed', '1'));
const botArg = opt('bot', 'all');
const csv = args.includes('--csv');
const mode = opt('mode', 'campaign') as Mode;
const bots: Bot[] = botArg === 'all' ? ['highcard', 'naive', 'smart'] : [botArg as Bot];

if (csv) console.log('bot,games,wins,avgWave,median,reach10,reach15,reach21,reach30,clear');
for (const b of bots) report(b, run(b, games, seed, mode), csv);
