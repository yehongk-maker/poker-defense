import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { port: 5173, host: true },
  build: { target: 'es2022', sourcemap: true },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20000 }, // 헤드리스 시뮬(20판·20만 판)은 병렬 부하에서 5초를 넘길 수 있음
});
