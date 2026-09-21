/** 앱 전역 메타 진행 싱글턴 (씬들이 공유). 테스트는 MetaProgress를 직접 쓴다. */
import configJson from './data/config.json';
import heroesJson from './data/heroes.json';
import { MetaProgress, type MetaConfig } from './systems/MetaProgress.ts';
import { LocalStorageStore } from './systems/storage.ts';

let instance: MetaProgress | null = null;

export function getMeta(): MetaProgress {
  if (!instance) {
    const cfg = (configJson as unknown as { meta: MetaConfig }).meta;
    instance = new MetaProgress(cfg, new LocalStorageStore(cfg.saveKey), heroesJson.heroes as { id: string; unlock: 'basic' | 'meta' }[]);
  }
  return instance;
}
