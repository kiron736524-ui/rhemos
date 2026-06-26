import { defineConfig } from 'vitest/config';
import path from 'node:path';

// 纯逻辑单测（booth-rules + fixtures 回归）：node 环境、不需浏览器、不调模型/不需 API key。
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
