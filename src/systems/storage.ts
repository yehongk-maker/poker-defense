/** localStorage 어댑터 (브라우저 전용). 접근 불가(프라이빗 모드 등) 시 메모리로 폴백. */
import { MemoryStore, type SaveStore } from './MetaProgress.ts';

export class LocalStorageStore implements SaveStore {
  private fallback = new MemoryStore();
  constructor(private key: string) {}
  private get ls(): Storage | null {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
  }
  load(): string | null {
    try { return this.ls?.getItem(this.key) ?? this.fallback.load(); } catch { return this.fallback.load(); }
  }
  save(json: string): void {
    this.fallback.save(json);
    try { this.ls?.setItem(this.key, json); } catch { /* 저장 불가 환경: 메모리만 */ }
  }
  clear(): void {
    this.fallback.clear();
    try { this.ls?.removeItem(this.key); } catch { /* ignore */ }
  }
}
