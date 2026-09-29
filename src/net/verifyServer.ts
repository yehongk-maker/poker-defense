/** verify-match Edge Function용 묶음 입구 (npm run build:fn). 게임 데이터(JSON)를 같이 번들한다 */
import { loadModeSources } from '../data/index.ts';
import { verifyMatchLog, type MatchVerifyInput, type MatchVerifyResult } from './verifyMatch.ts';

export function verifyMatch(rounds: unknown, m: MatchVerifyInput): MatchVerifyResult {
  return verifyMatchLog(loadModeSources(), rounds, m);
}
