import { defineConfig } from 'vitest/config';

// 纯逻辑单测（booth-rules + fixtures 回归）：node 环境、不需浏览器、不调模型/不需 API key。
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
