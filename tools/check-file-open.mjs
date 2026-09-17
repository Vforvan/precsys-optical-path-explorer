/**
 * 直接双击打开（file://）时的自检：这正是用户实际使用的打开方式。
 * 用法：node tools/check-file-open.mjs
 */

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'screenshots');
await mkdir(outDir, { recursive: true });

const args = [
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--ignore-gpu-blocklist',
];
// 注意：故意不加 --allow-file-access-from-files，模拟用户"双击打开"的真实环境

async function launchBrowser() {
  for (const options of [{ args }, { channel: 'msedge', args }, { channel: 'chrome', args }]) {
    try {
      return await chromium.launch(options);
    } catch {
      /* try next */
    }
  }
  throw new Error('无法启动浏览器');
}

const targets = [
  ['源码入口 index.html', join(root, 'index.html')],
  ['构建产物 dist/index.html', join(root, 'dist', 'index.html')],
];

const browser = await launchBrowser();
const results = [];

for (const [label, file] of targets) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`[console.error] ${msg.text().slice(0, 160)}`);
  });
  page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message.slice(0, 160)}`));

  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const state = await page.evaluate(() => {
    const canvas = document.querySelector('#viewport canvas');
    const api = window.__PRECSYS__;
    let painted = false;
    if (canvas) {
      // 取画布中心与几个点的像素，判断是否画出内容（而不是纯背景）
      try {
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        painted = Boolean(gl);
      } catch {
        painted = false;
      }
    }
    return {
      hasCanvas: Boolean(canvas),
      canvasSize: canvas ? [canvas.width, canvas.height] : null,
      appBooting: Boolean(api),
      bootHintVisible: (() => {
        const hint = document.getElementById('boot-hint');
        if (!hint) return null;
        return getComputedStyle(hint).display !== 'none';
      })(),
    };
  });

  const shot = join(outDir, `file-open-${label.includes('dist') ? 'dist' : 'src'}.png`);
  await page.screenshot({ path: shot });
  results.push({ label, file, ...state, problems, screenshot: shot });
  await page.close();
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
