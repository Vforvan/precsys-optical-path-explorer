import { defineConfig } from 'vitest/config';

/**
 * 纯静态离线项目：不使用任何后端、数据库或登录功能。
 *
 * 两种构建方式：
 *   npm run build        → 单文件版 dist/index.html（JS/CSS 内联，双击即可打开）
 *                          由 tools/build-standalone.mjs 设置 PRECSYS_BUILD=standalone 触发：
 *                          入口包打成经典脚本（IIFE）、不做代码分割、不生成 modulepreload，
 *                          随后由该脚本把 JS/CSS 内联进 HTML。
 *                          原因：file:// 页面里的外链 module 脚本会被 CORS 拒绝，
 *                          不内联的话双击打开只能看到 HTML 骨架。
 *   npm run build:split  → 传统分离文件版（需要本地静态服务器或 vite preview）
 */

/** 读取构建标记（tools/build-standalone.mjs 会设置该环境变量）。 */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const standalone = env?.PRECSYS_BUILD === 'standalone';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2400,
    cssCodeSplit: !standalone,
    modulePreload: standalone ? false : undefined,
    rollupOptions: standalone
      ? {
          output: {
            format: 'iife',
            inlineDynamicImports: true,
            entryFileNames: 'app.js',
            assetFileNames: 'app.[ext]',
          },
        }
      : {},
  },
  server: {
    port: 5173,
    open: false,
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
});
